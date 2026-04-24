from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
import os
import subprocess
import sys
import textwrap

from plugins.memory import mempalace as mempalace_mod
from plugins.memory.mempalace import MemPalaceMemoryProvider


class _FakeRoutingConfig:
    def __init__(self, base_dir: Path, storage_backend: str = "sqlite", **kwargs) -> None:
        self.base_dir = base_dir
        self.storage_backend = storage_backend
        self.enabled = kwargs.get("enabled", True)
        self.kwargs = kwargs


class _FakeRoutingPlugin:
    created = []

    def __init__(self, config: _FakeRoutingConfig, mempalace_tools=None) -> None:
        self.config = config
        self.bound_tools = dict(mempalace_tools or {})
        self._mempalace = SimpleNamespace(tooling_ready=lambda: bool(self.bound_tools))
        _FakeRoutingPlugin.created.append(self)


class _FakeHostHooks:
    created = []

    def __init__(self, plugin) -> None:
        self.plugin = plugin
        self.prefetch_calls = []
        self.ingestion_calls = []
        self.resume_calls = []
        _FakeHostHooks.created.append(self)

    @classmethod
    def from_config(cls, config: _FakeRoutingConfig) -> "_FakeHostHooks":
        return cls(config)

    def install_into(self, host, *, overwrite: bool = True):
        return host

    def session_wake_or_resume(self, *, query: str, active_project=None, task_hint=None):
        self.resume_calls.append(
            {
                "query": query,
                "active_project": active_project,
                "task_hint": task_hint,
            }
        )
        return {
            "mempalace_status": {"ok": True},
            "resume_envelopes": [{"memory_id": "resume-1"}],
            "resume_error": None,
        }

    def pre_model_context_assembly(self, *, query: str, total_tokens: int, active_project=None, mode: str):
        self.prefetch_calls.append(
            {
                "query": query,
                "total_tokens": total_tokens,
                "active_project": active_project,
                "mode": mode,
            }
        )
        return {"rendered_block": "[MemPalace routed evidence]\n1. room=errors\n   summary=bridge ok"}

    def post_turn_artifact_ingestion(
        self,
        *,
        turn_id: str,
        room: str,
        fact_type: str,
        summary: str,
        raw_text: str,
        route_tags: list[str] | None = None,
        conflict_key=None,
        pinned: bool = False,
    ):
        self.ingestion_calls.append(
            {
                "turn_id": turn_id,
                "room": room,
                "fact_type": fact_type,
                "summary": summary,
                "raw_text": raw_text,
                "route_tags": route_tags,
                "conflict_key": conflict_key,
                "pinned": pinned,
            }
        )
        return {
            "memory_id": "mem_123",
            "provenance_artifact_ids": ["art_123"],
        }


def test_mempalace_provider_uses_host_hooks_for_prefetch_and_sync(monkeypatch, tmp_path: Path) -> None:
    _FakeHostHooks.created.clear()
    _FakeRoutingPlugin.created.clear()
    monkeypatch.setattr(mempalace_mod, "HermesHostHooks", _FakeHostHooks)
    monkeypatch.setattr(mempalace_mod, "HermesMemPalaceRoutingConfig", _FakeRoutingConfig)
    monkeypatch.setattr(mempalace_mod, "HermesMemPalaceRoutingPlugin", _FakeRoutingPlugin)
    monkeypatch.setattr(
        mempalace_mod,
        "_build_mempalace_tool_bindings",
        lambda tool_timeout=10.0: {"mempalace_status": lambda: {"ok": True}},
    )
    monkeypatch.setattr(
        MemPalaceMemoryProvider,
        "_build_wake_up_context",
        lambda self: setattr(self, "_wake_up_context", "wake"),
    )

    provider = MemPalaceMemoryProvider(
        {
            "routing_total_tokens": 4096,
            "routing_mode": "debugging",
            "active_project": "hermes",
            "memory_backend": "mempalace_first",
            "mempalace_enabled": True,
        }
    )
    provider.initialize(session_id="sess-1", hermes_home=str(tmp_path), platform="cli")

    hooks = _FakeHostHooks.created[-1]
    assert set(hooks.plugin.bound_tools) == {"mempalace_status"}
    assert hooks.plugin.config.kwargs["memory_backend"] == "mempalace_first"
    assert hooks.plugin.config.kwargs["mempalace_enabled"] is True
    assert hooks.plugin.config.kwargs["disable_builtin_durable_memory"] is True
    assert hooks.resume_calls == [
        {
            "query": "sess-1",
            "active_project": "hermes",
            "task_hint": None,
        }
    ]

    rendered = provider.system_prompt_block()
    assert "wake" in rendered
    assert "Session Resume" in rendered
    assert "cached resume hits: 1" in rendered

    rendered_prefetch = provider.prefetch("why did the build fail on startup?", session_id="sess-1")
    assert rendered_prefetch.startswith("[MemPalace routed evidence]")
    assert hooks.prefetch_calls == [
        {
            "query": "why did the build fail on startup?",
            "total_tokens": 4096,
            "active_project": "hermes",
            "mode": "debugging",
        }
    ]

    result = provider.sync_turn("user stacktrace", "assistant follow-up", session_id="sess-1")
    assert result is None
    assert hooks.ingestion_calls[0]["turn_id"] == "sess-1"
    assert hooks.ingestion_calls[0]["room"] == "errors"
    assert hooks.ingestion_calls[0]["fact_type"] == "stacktrace"
    assert "USER:\nuser stacktrace" in hooks.ingestion_calls[0]["raw_text"]
    assert "ASSISTANT:\nassistant follow-up" in hooks.ingestion_calls[0]["raw_text"]


def test_routing_path_resolver_prefers_parent_walk_and_logs_source(monkeypatch, tmp_path: Path, caplog) -> None:
    plugin_file = (
        tmp_path
        / "host"
        / "plugins"
        / "memory"
        / "mempalace"
        / "__init__.py"
    )
    plugin_file.parent.mkdir(parents=True, exist_ok=True)
    plugin_file.write_text("# test", encoding="utf-8")

    expected_repo = tmp_path / "host" / "hermes_mempalace_routing"
    package_dir = expected_repo / "hermes_mempalace_routing"
    package_dir.mkdir(parents=True, exist_ok=True)
    (package_dir / "__init__.py").write_text("# package", encoding="utf-8")

    monkeypatch.delenv("HERMES_MEMPALACE_ROUTING_ROOT", raising=False)
    monkeypatch.setattr(mempalace_mod, "__file__", str(plugin_file))
    monkeypatch.setattr(mempalace_mod.Path, "home", lambda: tmp_path / "no-match-home")
    monkeypatch.setattr(mempalace_mod.sys, "path", [])

    with caplog.at_level("INFO", logger=mempalace_mod.logger.name):
        mempalace_mod._ensure_routing_package_on_path()

    assert str(expected_repo) in mempalace_mod.sys.path
    assert "mempalace_routing_path_resolved" in caplog.text
    assert f"path={expected_repo}" in caplog.text
    assert "source=parent_walk" in caplog.text
    assert "package_root_valid=True" in caplog.text


def test_provider_import_loads_routing_package_after_path_resolution(tmp_path: Path) -> None:
    repo = tmp_path / "routing_repo"
    package_dir = repo / "hermes_mempalace_routing"
    package_dir.mkdir(parents=True)
    (package_dir / "__init__.py").write_text(
        textwrap.dedent(
            """
            class HermesHostHooks:
                pass
            class HermesMemPalaceRoutingPlugin:
                pass
            class RoutingConfig:
                pass
            """
        ),
        encoding="utf-8",
    )

    env = os.environ.copy()
    env["HERMES_MEMPALACE_ROUTING_ROOT"] = str(repo)
    env["PYTHONPATH"] = "/home/iggut/.hermes/hermes-agent"
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            "from plugins.memory import mempalace as m; print(m.HermesHostHooks.__name__)",
        ],
        env=env,
        capture_output=True,
        text=True,
        timeout=10,
    )

    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "HermesHostHooks"
