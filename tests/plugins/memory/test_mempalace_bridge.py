from __future__ import annotations

from pathlib import Path

from plugins.memory import mempalace as mempalace_mod
from plugins.memory.mempalace import MemPalaceMemoryProvider


class _FakeRoutingConfig:
    def __init__(self, base_dir: Path, storage_backend: str = "sqlite") -> None:
        self.base_dir = base_dir
        self.storage_backend = storage_backend
        self.enabled = True


class _FakeHostHooks:
    created = []

    def __init__(self, config: _FakeRoutingConfig) -> None:
        self.config = config
        self.prefetch_calls = []
        self.ingestion_calls = []
        _FakeHostHooks.created.append(self)

    @classmethod
    def from_config(cls, config: _FakeRoutingConfig) -> "_FakeHostHooks":
        return cls(config)

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
    monkeypatch.setattr(mempalace_mod, "HermesHostHooks", _FakeHostHooks)
    monkeypatch.setattr(mempalace_mod, "HermesMemPalaceRoutingConfig", _FakeRoutingConfig)
    monkeypatch.setattr(MemPalaceMemoryProvider, "_build_wake_up_context", lambda self: setattr(self, "_wake_up_context", "wake"))

    provider = MemPalaceMemoryProvider(
        {
            "routing_total_tokens": 4096,
            "routing_mode": "debugging",
            "active_project": "hermes",
        }
    )
    provider.initialize(session_id="sess-1", hermes_home=str(tmp_path), platform="cli")

    rendered = provider.prefetch("why did the build fail on startup?", session_id="sess-1")
    assert rendered.startswith("[MemPalace routed evidence]")
    assert _FakeHostHooks.created[-1].prefetch_calls == [
        {
            "query": "why did the build fail on startup?",
            "total_tokens": 4096,
            "active_project": "hermes",
            "mode": "debugging",
        }
    ]

    result = provider.sync_turn("user stacktrace", "assistant follow-up", session_id="sess-1")
    assert result is None
    assert _FakeHostHooks.created[-1].ingestion_calls[0]["turn_id"] == "sess-1"
    assert _FakeHostHooks.created[-1].ingestion_calls[0]["room"] == "errors"
    assert _FakeHostHooks.created[-1].ingestion_calls[0]["fact_type"] == "stacktrace"
    assert "USER:\nuser stacktrace" in _FakeHostHooks.created[-1].ingestion_calls[0]["raw_text"]
    assert "ASSISTANT:\nassistant follow-up" in _FakeHostHooks.created[-1].ingestion_calls[0]["raw_text"]
