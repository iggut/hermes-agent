"""Tests for /upa and /upw upstream-sync slash commands."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path
from unittest.mock import MagicMock


def _git(cwd: Path, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run([
        "git",
        *args,
    ], cwd=cwd, text=True, capture_output=True, check=True)


class TestUpstreamSyncSlashCommands:
    def test_commands_are_registered(self):
        from hermes_cli.commands import resolve_command

        upa = resolve_command("upa")
        upw = resolve_command("upw")

        assert upa is not None and upa.name == "upa" and upa.cli_only is True
        assert upw is not None and upw.name == "upw" and upw.cli_only is True

    def test_upa_sync_uses_default_model_to_resolve_merge_conflicts(self, tmp_path, monkeypatch):
        from cli import HermesCLI
        import cli as cli_module

        origin_bare = tmp_path / "origin.git"
        upstream_bare = tmp_path / "upstream.git"
        seed_repo = tmp_path / "seed"
        work_repo = tmp_path / "hermes-agent"
        upstream_work = tmp_path / "upstream-work"

        _git(tmp_path, "init", "--bare", origin_bare.name)
        _git(tmp_path, "init", "--bare", upstream_bare.name)

        seed_repo.mkdir()
        _git(seed_repo, "init", "-b", "main")
        _git(seed_repo, "config", "user.name", "Hermes Test")
        _git(seed_repo, "config", "user.email", "hermes@example.com")
        (seed_repo / "conflict.txt").write_text("base\n", encoding="utf-8")
        _git(seed_repo, "add", "conflict.txt")
        _git(seed_repo, "commit", "-m", "base commit")
        _git(seed_repo, "remote", "add", "origin", str(origin_bare))
        _git(seed_repo, "remote", "add", "upstream", str(upstream_bare))
        _git(seed_repo, "push", "origin", "main")
        _git(seed_repo, "push", "upstream", "main")

        _git(tmp_path, "clone", "-b", "main", str(origin_bare), work_repo.name)
        _git(work_repo, "config", "user.name", "Hermes Test")
        _git(work_repo, "config", "user.email", "hermes@example.com")
        _git(work_repo, "remote", "add", "upstream", str(upstream_bare))

        _git(tmp_path, "clone", "-b", "main", str(upstream_bare), upstream_work.name)
        _git(upstream_work, "config", "user.name", "Hermes Test")
        _git(upstream_work, "config", "user.email", "hermes@example.com")
        (upstream_work / "conflict.txt").write_text("base\nupstream version\n", encoding="utf-8")
        _git(upstream_work, "commit", "-am", "upstream change")
        _git(upstream_work, "push", "origin", "main")

        (work_repo / "conflict.txt").write_text("base\nlocal version\n", encoding="utf-8")
        _git(work_repo, "commit", "-am", "local change")

        captured = {}

        class FakeAIAgent:
            def __init__(self, **kwargs):
                captured["kwargs"] = kwargs

            def run_conversation(self, prompt):
                captured["prompt"] = prompt
                return {
                    "final_response": json.dumps(
                        {
                            "files": [
                                {
                                    "path": "conflict.txt",
                                    "content": "base\nlocal version\nupstream version\n",
                                }
                            ]
                        }
                    )
                }

        cli_module.AIAgent = FakeAIAgent
        cli_module.__file__ = str(work_repo / "cli.py")

        cli = HermesCLI.__new__(HermesCLI)
        cli.model = "default-model"
        cli.api_key = None
        cli.base_url = None
        cli.provider = None
        cli.api_mode = None
        cli.acp_command = None
        cli.acp_args = []
        cli.console = MagicMock()
        cli._console_print = MagicMock()

        cli._handle_upstream_sync_command("upa")

        assert "FILE: conflict.txt" in captured["prompt"]
        assert "<<<<<<< HEAD" in captured["prompt"]
        assert "upstream/main" in captured["prompt"]
        assert (work_repo / "conflict.txt").read_text(encoding="utf-8") == (
            "base\nlocal version\nupstream version\n"
        )
        assert _git(origin_bare, "rev-parse", "main").stdout.strip() == _git(work_repo, "rev-parse", "HEAD").stdout.strip()
        cli._console_print.assert_called_once()
