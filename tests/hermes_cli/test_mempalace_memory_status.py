"""Tests for MemPalace-first memory status surfaces."""

from types import SimpleNamespace


def _patch_common_status_deps(monkeypatch, status_mod, tmp_path):
    import hermes_cli.auth as auth_mod

    monkeypatch.setattr(status_mod, "get_env_path", lambda: tmp_path / ".env", raising=False)
    monkeypatch.setattr(status_mod, "get_hermes_home", lambda: tmp_path, raising=False)
    monkeypatch.setattr(status_mod, "get_env_value", lambda name: "", raising=False)
    monkeypatch.setattr(auth_mod, "get_nous_auth_status", lambda: {}, raising=False)
    monkeypatch.setattr(auth_mod, "get_codex_auth_status", lambda: {}, raising=False)
    monkeypatch.setattr(
        status_mod.subprocess,
        "run",
        lambda *args, **kwargs: SimpleNamespace(stdout="inactive\n", returncode=3),
    )


def test_describe_memory_mode_reports_live_runtime_status(monkeypatch):
    from hermes_cli import config as config_mod

    monkeypatch.setattr(
        "plugins.memory.mempalace._build_mempalace_tool_bindings",
        lambda tool_timeout=10.0: {"mempalace_status": lambda: {"ok": True}},
    )

    status = config_mod.describe_memory_mode(
        {
            "memory": {
                "memory_backend": "mempalace_first",
                "mempalace_enabled": True,
                "disable_builtin_durable_memory": True,
                "mempalace_resume_on_start": True,
                "mempalace_include_legacy_local_envelopes": False,
            }
        },
        runtime={
            "mempalace_tools": "bound",
            "resume_attempted": True,
            "resume_status": "succeeded",
        },
    )

    assert status == {
        "memory_backend": "mempalace_first",
        "builtin_durable_memory": "disabled",
        "mempalace_tools": "bound",
        "resume_on_start": "enabled",
        "resume_status": "succeeded",
        "legacy_local_overlap": "off",
    }


def test_show_status_reports_mempalace_first_memory_surface(monkeypatch, capsys, tmp_path):
    from hermes_cli import status as status_mod

    _patch_common_status_deps(monkeypatch, status_mod, tmp_path)
    monkeypatch.setattr(status_mod, "load_config", lambda: {
        "model": {"default": "anthropic/claude-sonnet-4", "provider": "anthropic"},
        "memory": {
            "memory_backend": "mempalace_first",
            "mempalace_enabled": True,
            "disable_builtin_durable_memory": True,
            "mempalace_resume_on_start": True,
            "mempalace_include_legacy_local_envelopes": False,
        },
    }, raising=False)
    monkeypatch.setattr(status_mod, "resolve_requested_provider", lambda requested=None: "anthropic", raising=False)
    monkeypatch.setattr(status_mod, "resolve_provider", lambda requested=None, **kwargs: "anthropic", raising=False)
    monkeypatch.setattr(status_mod, "provider_label", lambda provider: "Anthropic", raising=False)
    monkeypatch.setattr(
        "plugins.memory.mempalace._build_mempalace_tool_bindings",
        lambda tool_timeout=10.0: {
            "mempalace_status": lambda: {"ok": True},
            "mempalace_search": lambda: {"ok": True},
            "mempalace_add_drawer": lambda: {"ok": True},
            "mempalace_check_duplicate": lambda: {"ok": True},
            "mempalace_delete_drawer": lambda: {"ok": True},
            "mempalace_reconnect": lambda: {"ok": True},
            "mempalace_get_taxonomy": lambda: {"ok": True},
            "mempalace_list_drawers": lambda: {"ok": True},
            "mempalace_list_rooms": lambda: {"ok": True},
            "mempalace_list_wings": lambda: {"ok": True},
            "mempalace_kg_stats": lambda: {"ok": True},
            "mempalace_kg_query": lambda: {"ok": True},
        },
    )

    status_mod.show_status(SimpleNamespace(all=False, deep=False))

    out = capsys.readouterr().out
    assert "◆ Memory" in out
    assert "memory_backend: mempalace_first" in out
    assert "builtin_durable_memory: disabled" in out
    assert "mempalace_tools: bound" in out
    assert "resume_on_start: enabled" in out
    assert "legacy_local_overlap: off" in out
