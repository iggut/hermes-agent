import subprocess
import sys

import hermes_cli.main as main


def test_run_update_import_safety_probe_uses_core_import_check(monkeypatch):
    calls = []

    def fake_run(cmd, cwd=None, capture_output=None, text=None):
        calls.append(
            {
                "cmd": cmd,
                "cwd": cwd,
                "capture_output": capture_output,
                "text": text,
            }
        )
        return subprocess.CompletedProcess(cmd, 0, stdout="ok\n", stderr="")

    monkeypatch.setattr(main.subprocess, "run", fake_run)

    result = main._run_update_import_safety_probe()

    assert result.returncode == 0
    assert calls == [
        {
            "cmd": [
                sys.executable,
                "-c",
                "import hermes_cli.main; import hermes_cli.config; import hermes_cli.gateway",
            ],
            "cwd": main.PROJECT_ROOT,
            "capture_output": True,
            "text": True,
        }
    ]


def test_print_update_brick_warning_includes_recovery_commands(capsys):
    main._print_update_brick_warning(
        "post-update import probe failed",
        origin_url="git@github.com:iggut/hermes-agent.git",
        current_branch="main",
        stash_ref="refs/stash@{0}",
    )

    out = capsys.readouterr().out
    assert "Update safety check failed" in out
    assert "post-update import probe failed" in out
    assert "Active branch: main" in out
    assert "Origin remote: git@github.com:iggut/hermes-agent.git" in out
    assert "Local changes preserved in stash: refs/stash@{0}" in out
    assert "hermes doctor" in out
    assert "hermes status" in out
    assert "git status --short" in out
    assert "git log --oneline --decorate --graph --max-count=8 --all" in out
    assert "git remote -v" in out
