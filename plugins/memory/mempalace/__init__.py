"""MemPalace memory provider — injects wake-up context + search-as-you-think.

Plugin for Hermes that connects to the local MemPalace palace and provides:
- system_prompt_block(): compact palace overview + recent diary at session start
- prefetch(): semantic search before each turn for relevant context
- sync_turn(): diary write after each turn (optional, respects auto-save config)

Config in $HERMES_HOME/config.yaml:
  memory:
    provider: mempalace

The MCP server tools (mempalace_search, mempalace_kg_query, etc.) remain
available for explicit tool calls. This provider handles AUTOMATIC context
injection so the AI doesn't have to manually search.
"""

from __future__ import annotations

import json
import logging
import os
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Dict, List, Mapping, Optional

logger = logging.getLogger(__name__)

try:
    from hermes_mempalace_routing import (
        HermesHostHooks,
        HermesMemPalaceRoutingPlugin,
        RoutingConfig as HermesMemPalaceRoutingConfig,
    )
except Exception:  # pragma: no cover - optional dependency in host checkout
    HermesHostHooks = None
    HermesMemPalaceRoutingPlugin = None
    HermesMemPalaceRoutingConfig = None

# MemPalace Python path
_MEMPALACE_ROOT = os.path.expanduser("~/.openclaw/workspace/mempalace")
_MEMPALACE_VENV = os.path.expanduser("~/.openclaw/workspace/mempalace-venv")
_PALACE_PATH = os.path.expanduser("~/.mempalace/palace")

_MEMPALACE_TOOL_NAMES = (
    "mempalace_status",
    "mempalace_search",
    "mempalace_add_drawer",
    "mempalace_check_duplicate",
    "mempalace_delete_drawer",
    "mempalace_reconnect",
    "mempalace_get_taxonomy",
    "mempalace_list_drawers",
    "mempalace_list_rooms",
    "mempalace_list_wings",
    "mempalace_kg_stats",
    "mempalace_kg_query",
)


def _ensure_routing_package_on_path() -> None:
    """Expose the hermes_mempalace_routing checkout to the host import path."""
    candidates: list[Path] = []
    env_root = os.environ.get("HERMES_MEMPALACE_ROUTING_ROOT")
    if env_root:
        candidates.append(Path(env_root).expanduser())
    candidates.append(Path.home() / "workspace" / "hermes_mempalace_routing")
    # Any ancestor directory may be a workspace root that also contains
    # ``hermes_mempalace_routing`` (companion clone / symlinked layout).
    try:
        here = Path(__file__).resolve()
        for p in here.parents:
            cand = p / "hermes_mempalace_routing"
            if cand not in candidates:
                candidates.append(cand)
    except Exception:
        pass

    for candidate in candidates:
        try:
            if candidate.is_dir():
                inner = candidate / "hermes_mempalace_routing"
                if inner.is_dir() and (inner / "__init__.py").is_file():
                    root = str(candidate)
                    if root not in sys.path:
                        sys.path.insert(0, root)
                    return
        except Exception:
            continue


_ensure_routing_package_on_path()


def _default_routing_base_dir(hermes_home: str | None = None) -> Path:
    base = Path(hermes_home).expanduser() if hermes_home else Path.home() / ".hermes"
    return base / "mempalace-routing"


def _build_mempalace_tool_bindings(tool_timeout: float = 10.0) -> dict[str, Callable[..., Any]]:
    """Bind the host MCP wrappers expected by hermes_mempalace_routing."""
    try:
        from tools.mcp_tool import _make_tool_handler
    except Exception:
        return {}
    return {
        name: _make_tool_handler("mempalace", name, tool_timeout)
        for name in _MEMPALACE_TOOL_NAMES
    }


def _build_routing_hooks(config: dict | None = None, *, hermes_home: str | None = None):
    if HermesHostHooks is None or HermesMemPalaceRoutingConfig is None or HermesMemPalaceRoutingPlugin is None:
        return None
    cfg = config or {}
    base_dir = Path(cfg.get("routing_base_dir") or _default_routing_base_dir(hermes_home))
    routing_cfg = HermesMemPalaceRoutingConfig(
        base_dir=base_dir,
        storage_backend=cfg.get("routing_storage_backend", "sqlite"),
        memory_backend=cfg.get("memory_backend", "local"),
        mempalace_enabled=bool(cfg.get("mempalace_enabled", False)),
        mempalace_fail_open=bool(cfg.get("mempalace_fail_open", True)),
        mempalace_resume_on_start=bool(cfg.get("mempalace_resume_on_start", True)),
        mempalace_recall_on_every_query=bool(cfg.get("mempalace_recall_on_every_query", True)),
        mempalace_duplicate_threshold=float(cfg.get("mempalace_duplicate_threshold", 0.92)),
        mempalace_allow_duplicate_supersede=bool(cfg.get("mempalace_allow_duplicate_supersede", False)),
        mempalace_default_wing_strategy=cfg.get("mempalace_default_wing_strategy", "active_project"),
        mempalace_default_room_strategy=cfg.get("mempalace_default_room_strategy", "fact_type_and_project"),
        mempalace_include_legacy_local_envelopes=bool(cfg.get("mempalace_include_legacy_local_envelopes", False)),
        mempalace_fallback_local_write=bool(cfg.get("mempalace_fallback_local_write", False)),
        disable_builtin_durable_memory=bool(cfg.get("disable_builtin_durable_memory", False)),
    )
    if "routing_enabled" in cfg:
        routing_cfg.enabled = bool(cfg.get("routing_enabled"))
    tools = _build_mempalace_tool_bindings(float(cfg.get("mempalace_tool_timeout", 10.0)))
    plugin = HermesMemPalaceRoutingPlugin(routing_cfg, mempalace_tools=tools)
    return HermesHostHooks(plugin)


def _classify_turn_content(user_content: str, assistant_content: str) -> tuple[str, str, list[str]]:
    combined = f"{user_content}\n{assistant_content}".lower()
    summary = (user_content or assistant_content or "").strip().splitlines()[0][:160]
    if any(marker in combined for marker in ("traceback", "stacktrace", "syntaxerror", "exception", "error:", "stack trace")):
        return "errors", "stacktrace", ["auto_ingest", "runtime_error"]
    if any(marker in combined for marker in ("decided", "decision", "choose", "choose to", "going with", "settled on")):
        return "decisions", "note", ["auto_ingest", "decision"]
    return "scratch", "note", ["auto_ingest"]


def _ensure_mempalace_on_path():
    """Add MemPalace to sys.path if not already there."""
    if _MEMPALACE_ROOT not in sys.path:
        sys.path.insert(0, _MEMPALACE_ROOT)


class MemPalaceMemoryProvider:
    """MemPalace memory provider for Hermes."""

    def __init__(self, config: dict | None = None):
        self._config = config or {}
        self._initialized = False
        self._drawer_count = 0
        self._wing_summary = ""
        self._wake_up_context = ""
        self._routing_hooks = None
        self._hermes_home = None
        self._routing_plugin = None
        self._resume_wakeup_payload = {}
        self._resume_attempted = False
        self._resume_status = "skipped"
        self._resume_error = ""

    @property
    def name(self) -> str:
        return "mempalace"

    def is_available(self) -> bool:
        """Check if MemPalace MCP server is configured and palace exists."""
        # Check if palace directory exists
        if not os.path.isdir(_PALACE_PATH):
            return False
        # Check if chroma.sqlite3 exists (palace has been initialized)
        chroma_path = os.path.join(_PALACE_PATH, "chroma.sqlite3")
        if not os.path.exists(chroma_path):
            return False
        return True

    def initialize(self, session_id: str, **kwargs) -> None:
        """Build wake-up context from palace data (no chromadb needed)."""
        try:
            self._initialized = True
            self._hermes_home = kwargs.get("hermes_home")
            self._routing_hooks = _build_routing_hooks(self._config, hermes_home=self._hermes_home)
            self._routing_plugin = getattr(self._routing_hooks, "plugin", None)
            self._resume_wakeup_payload = {}
            self._resume_attempted = False
            self._resume_status = "skipped"
            self._resume_error = ""
            self._build_wake_up_context()
            if self._routing_hooks is not None and bool(self._config.get("mempalace_resume_on_start", True)):
                try:
                    self._resume_attempted = True
                    active_project = kwargs.get("active_project") or kwargs.get("agent_workspace") or self._config.get("active_project") or self._config.get("agent_workspace")
                    wake_query = kwargs.get("session_title") or kwargs.get("task_hint") or session_id or "session wake"
                    self._resume_wakeup_payload = self._routing_hooks.session_wake_or_resume(
                        query=str(wake_query),
                        active_project=active_project,
                        task_hint=kwargs.get("task_hint") or self._config.get("task_hint"),
                    )
                    self._resume_status = "succeeded"
                except Exception as wake_err:
                    logger.debug(f"MemPalace session wake/resume failed: {wake_err}")
                    self._resume_wakeup_payload = {}
                    self._resume_status = "failed-open"
                    self._resume_error = str(wake_err)
            elif self._routing_hooks is None:
                self._resume_status = "skipped"
            else:
                self._resume_status = "skipped"
            logger.info(
                f"MemPalace memory provider initialized: {self._drawer_count} drawers"
            )
        except Exception as e:
            logger.warning(f"MemPalace memory provider init failed: {e}")
            self._initialized = False

    def _build_wake_up_context(self) -> str:
        """Build compact wake-up context from palace SQLite data."""
        try:
            import sqlite3

            # Read wing/room counts from ChromaDB metadata
            chroma_path = os.path.join(_PALACE_PATH, "chroma.sqlite3")
            wings = {}
            total = 0

            if os.path.exists(chroma_path):
                conn = sqlite3.connect(chroma_path)
                c = conn.cursor()
                try:
                    # ChromaDB stores metadata in embedding_metadata table
                    c.execute(
                        "SELECT string_value, COUNT(*) FROM embedding_metadata "
                        "WHERE key='wing' GROUP BY string_value"
                    )
                    for wing, count in c.fetchall():
                        if wing:
                            wings[wing] = count
                            total += count
                except Exception:
                    pass
                finally:
                    conn.close()

            self._drawer_count = total
            wing_parts = sorted(wings.items(), key=lambda x: -x[1])
            self._wing_summary = ", ".join(f"{w}({c})" for w, c in wing_parts[:8])

            # Get recent diary entries
            recent_diary = self._get_recent_diary()

            # Build wake-up context (~400-600 tokens)
            lines = [
                "# MemPalace Wake-Up",
                f"{total} drawers in {len(wings)} wings: {self._wing_summary}",
            ]

            if recent_diary:
                lines.append("")
                lines.append("## Recent Activity")
                for entry in recent_diary[:3]:
                    topic = entry.get("topic", "")
                    content = entry.get("content", "")[:120]
                    date = entry.get("date", "")
                    lines.append(f"- [{date}] {topic}: {content}")

            lines.append("")
            lines.append(
                "Use mempalace_search for semantic search, "
                "mempalace_kg_query for entity relationships."
            )

            self._wake_up_context = "\n".join(lines)
            return self._wake_up_context

        except Exception as e:
            logger.warning(f"MemPalace wake-up build failed: {e}")
            return ""

    def _get_recent_diary(self) -> list:
        """Read recent diary entries from the palace."""
        try:
            kg_path = os.path.expanduser("~/.mempalace/knowledge_graph.sqlite3")
            if not os.path.exists(kg_path):
                return []

            import sqlite3

            conn = sqlite3.connect(kg_path)
            conn.row_factory = sqlite3.Row
            c = conn.cursor()

            # Check if diary table exists
            c.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='agent_diaries'"
            )
            if not c.fetchone():
                conn.close()
                return []

            c.execute(
                "SELECT agent_name, topic, content, timestamp "
                "FROM agent_diaries ORDER BY timestamp DESC LIMIT 5"
            )
            entries = [dict(row) for row in c.fetchall()]
            conn.close()
            return entries
        except Exception:
            return []

    def system_prompt_block(self) -> str:
        """Return wake-up context for system prompt injection."""
        if not self._initialized or not self._wake_up_context:
            # Fallback: try to build it now
            if not self._initialized:
                self.initialize("")
            if not self._wake_up_context:
                return "# MemPalace\nPalace connected. Use mempalace_search to find memories."

        wake_lines = [self._wake_up_context]
        if self._resume_wakeup_payload:
            status = self._resume_wakeup_payload.get("mempalace_status") or {}
            resume_hits = self._resume_wakeup_payload.get("resume_envelopes") or []
            wake_lines.append("\n## Session Resume")
            if isinstance(status, dict) and status.get("ok") is False and status.get("error"):
                wake_lines.append(f"- status: {status.get('error')}")
            else:
                wake_lines.append("- status: connected")
            wake_lines.append(f"- cached resume hits: {len(resume_hits)}")
        return "\n".join(wake_lines)

    def memory_status(self) -> Dict[str, str]:
        """Return a compact runtime status snapshot for operator-visible startup logs."""
        mem_config = self._config or {}
        backend = str(mem_config.get("memory_backend", "local") or "local").strip() or "local"
        tools_bound = bool(getattr(self._routing_plugin, "bound_tools", None))
        if not tools_bound and self._routing_hooks is not None:
            plugin = getattr(self._routing_hooks, "plugin", None)
            tools_bound = bool(getattr(plugin, "bound_tools", None))

        return {
            "memory_backend": backend,
            "builtin_durable_memory": "disabled" if bool(mem_config.get("disable_builtin_durable_memory", False) or backend == "mempalace_first") else "enabled",
            "mempalace_tools": "bound" if tools_bound else "absent",
            "resume_on_start": "enabled" if bool(mem_config.get("mempalace_resume_on_start", True)) else "disabled",
            "resume_status": self._resume_status if self._resume_attempted or self._resume_status != "skipped" else "skipped",
            "legacy_local_overlap": "on" if bool(mem_config.get("mempalace_include_legacy_local_envelopes", False)) else "off",
        }

    def prefetch(self, query: str, *, session_id: str = "") -> str:
        """Search palace for relevant context before each turn.

        If the routing package is available, use the new host hook so the host
        app exercises the same pre-model path as hermes_mempalace_routing.
        Falls back to the legacy semantic search path otherwise.
        """
        if not self._initialized or not query or len(query) < 10:
            return ""

        if self._routing_hooks is not None:
            try:
                payload = self._routing_hooks.pre_model_context_assembly(
                    query=query,
                    total_tokens=int(self._config.get("routing_total_tokens", 8192)),
                    active_project=self._config.get("active_project") or self._config.get("agent_workspace"),
                    mode=self._config.get("routing_mode", "debugging"),
                )
                rendered = ""
                if isinstance(payload, dict):
                    rendered = str(payload.get("rendered_block") or "").strip()
                if rendered:
                    return rendered
            except Exception as e:
                logger.debug(f"MemPalace routing pre-model hook failed: {e}")

        try:
            import subprocess

            result = subprocess.run(
                [
                    os.path.join(_MEMPALACE_VENV, "bin", "python"),
                    "-c",
                    f"""
import sys
sys.path.insert(0, '{_MEMPALACE_ROOT}')
from mempalace.searcher import search_memories
results = search_memories(query={query!r}, palace_path='{_PALACE_PATH}', n_results=3)
import json
print(json.dumps(results or []))
""",
                ],
                capture_output=True,
                text=True,
                timeout=5,
            )

            if result.returncode != 0 or not result.stdout.strip():
                return ""

            import json

            results = json.loads(result.stdout.strip())

            lines = []
            for r in results:
                text = r.get("text", "")[:200]
                wing = r.get("wing", "?")
                room = r.get("room", "?")
                if text:
                    lines.append(f"[{wing}/{room}] {text}")

            if lines:
                return "## Relevant Memories\n" + "\n".join(lines)
            return ""

        except Exception as e:
            logger.debug(f"MemPalace prefetch failed: {e}")
            return ""

    def sync_turn(
        self, user_content: str, assistant_content: str, *, session_id: str = ""
    ) -> None:
        """Write a post-turn record.

        Prefer the new routing hook when available so raw artifacts are stored
        exactly; otherwise fall back to the legacy diary entry writer.
        """
        if self._routing_hooks is not None:
            try:
                room, fact_type, tags = _classify_turn_content(user_content, assistant_content)
                summary = (assistant_content or user_content or "").strip().splitlines()[0][:240]
                raw_text = f"USER:\n{user_content}\n\nASSISTANT:\n{assistant_content}"
                self._routing_hooks.post_turn_artifact_ingestion(
                    turn_id=session_id or datetime.now().strftime("%Y%m%d_%H%M%S"),
                    room=room,
                    fact_type=fact_type,
                    summary=summary or "post-turn artifact",
                    raw_text=raw_text,
                    route_tags=tags,
                    conflict_key=None,
                    pinned=False,
                )
                logger.debug("MemPalace routing post-turn hook wrote raw artifact")
                return
            except Exception as e:
                logger.debug(f"MemPalace routing post-turn hook failed: {e}")

        if len(user_content) + len(assistant_content) < 100:
            return

        import random

        if random.random() > 0.2:
            return

        try:
            import subprocess

            today = datetime.now().strftime("%Y-%m-%d")
            topic = user_content[:50].replace("\n", " ").strip()
            entry = (
                f"SESSION:{today}|{topic}|"
                f"user:{len(user_content)}chars|asst:{len(assistant_content)}chars"
            )

            subprocess.run(
                [
                    os.path.join(_MEMPALACE_VENV, "bin", "python"),
                    "-c",
                    f"""
import sys
sys.path.insert(0, '{_MEMPALACE_ROOT}')
from mempalace.knowledge_graph import KnowledgeGraph
kg = KnowledgeGraph()
kg.add_diary_entry(agent_name='Jupiter', topic='auto-save', content={entry!r})
""",
                ],
                capture_output=True,
                text=True,
                timeout=10,
            )
            logger.debug("MemPalace auto-diary wrote")
        except Exception as e:
            logger.debug(f"MemPalace sync_turn failed: {e}")

    def get_tool_schemas(self) -> List[Dict[str, Any]]:
        """No custom tools — MCP handles all MemPalace tools."""
        return []

    def handle_tool_call(
        self, tool_name: str, arguments: Dict[str, Any]
    ) -> Any:
        """No custom tools to handle."""
        return {"error": "Use MCP mempalace_* tools directly"}

    # Optional hooks
    def on_session_end(self, messages: list) -> None:
        """Write session summary diary entry."""
        if not self._initialized:
            return
        try:
            _ensure_mempalace_on_path()
            from mempalace.knowledge_graph import KnowledgeGraph

            kg = KnowledgeGraph()
            today = datetime.now().strftime("%Y-%m-%d")
            turn_count = len([m for m in messages if m.get("role") == "user"])
            entry = f"SESSION:{today}|ended|{turn_count} turns"
            kg.add_diary_entry(
                agent_name="Jupiter",
                topic="session-end",
                content=entry,
            )
        except Exception:
            pass

    def on_pre_compress(self, messages: list) -> str:
        """Extract key context before compression."""
        if not self._initialized:
            return ""
        # Return the last few user messages as a summary
        user_msgs = [
            m.get("content", "")[:100]
            for m in messages
            if m.get("role") == "user"
        ][-3:]
        if user_msgs:
            return "Pre-compress context: " + " | ".join(user_msgs)
        return ""

    def shutdown(self) -> None:
        """Clean up."""
        self._initialized = False


def register(ctx):
    """Plugin registration entry point — called by Hermes plugin loader."""
    ctx.register_memory_provider(MemPalaceMemoryProvider())
