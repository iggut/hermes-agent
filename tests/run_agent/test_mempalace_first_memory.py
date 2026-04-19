from __future__ import annotations

import sys
import types
from types import SimpleNamespace

import pytest

sys.modules.setdefault("fire", types.SimpleNamespace(Fire=lambda *a, **k: None))
sys.modules.setdefault("firecrawl", types.SimpleNamespace(Firecrawl=object))
sys.modules.setdefault("fal_client", types.SimpleNamespace())

import run_agent
from plugins.memory import mempalace as mempalace_mod
from plugins.memory.mempalace import MemPalaceMemoryProvider


class _FakeRoutingConfig:
    def __init__(self, base_dir, storage_backend: str = "sqlite", **kwargs) -> None:
        self.base_dir = base_dir
        self.storage_backend = storage_backend
        self.enabled = kwargs.get("enabled", True)
        self.kwargs = kwargs


class _FakeRoutingPlugin:
    created = []

    def __init__(self, config, mempalace_tools=None) -> None:
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

    def install_into(self, host, *, overwrite: bool = True):
        return host

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
        route_tags=None,
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
        return {"memory_id": "mem_123", "provenance_artifact_ids": ["art_123"]}

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


@pytest.fixture(autouse=True)
def _reset_fake_hooks():
    _FakeRoutingPlugin.created.clear()
    _FakeHostHooks.created.clear()
    yield


def test_mempalace_first_disables_builtin_durable_memory_flush(monkeypatch):
    calls = []

    def _unexpected_memory_tool(*args, **kwargs):
        calls.append((args, kwargs))
        raise AssertionError("builtin memory tool should not be invoked when disabled")

    monkeypatch.setattr("tools.memory_tool.memory_tool", _unexpected_memory_tool)

    agent = SimpleNamespace(
        _disable_builtin_durable_memory=True,
        _memory_flush_min_turns=0,
        _memory_store=SimpleNamespace(),
        _memory_enabled=False,
        _user_profile_enabled=False,
        _user_turn_count=99,
        valid_tool_names={"memory"},
        _cached_system_prompt="",
        api_mode="codex_responses",
        quiet_mode=True,
    )

    run_agent.AIAgent.flush_memories(agent, messages=[{"role": "user", "content": "hello"}])

    assert calls == []


def test_mem_pmalace_provider_binds_tools_and_resumes_on_initialize(monkeypatch, tmp_path):
    monkeypatch.setattr(mempalace_mod, "HermesHostHooks", _FakeHostHooks)
    monkeypatch.setattr(mempalace_mod, "HermesMemPalaceRoutingConfig", _FakeRoutingConfig)
    monkeypatch.setattr(mempalace_mod, "HermesMemPalaceRoutingPlugin", _FakeRoutingPlugin)
    monkeypatch.setattr(mempalace_mod, "_build_mempalace_tool_bindings", lambda tool_timeout=10.0: {
        "mempalace_status": lambda: {"ok": True},
        "mempalace_search": lambda: {"ok": True},
    })
    monkeypatch.setattr(MemPalaceMemoryProvider, "_build_wake_up_context", lambda self: setattr(self, "_wake_up_context", "wake"))

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
    plugin = hooks.plugin
    assert set(plugin.bound_tools) == {"mempalace_status", "mempalace_search"}
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

    status = provider.memory_status()
    assert status == {
        "memory_backend": "mempalace_first",
        "builtin_durable_memory": "disabled",
        "mempalace_tools": "bound",
        "resume_on_start": "enabled",
        "resume_status": "succeeded",
        "legacy_local_overlap": "off",
    }

    routed = provider.prefetch("why did the build fail on startup?", session_id="sess-1")
    assert routed.startswith("[MemPalace routed evidence]")
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
