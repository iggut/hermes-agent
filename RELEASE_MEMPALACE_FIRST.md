# Hermes Agent — MemPalace-First Durable Memory Verification

**Date:** 2026-04-19

This release note records the final verification of the MemPalace-first durable memory integration in the Hermes host app.

## What changed

- Hermes now uses MemPalace as the durable memory backend for host-integrated workflows.
- Built-in durable memory is disabled/bypassed through the no-op shim path.
- Startup/session resume now uses the MemPalace routing hook path.
- Durable recall now comes from MemPalace-backed context assembly.
- Post-turn durable filing is duplicate-aware and checks `mempalace_check_duplicate` before writing drawers.
- Fail-open behavior remains intact if MemPalace is unavailable.

## Verification

Independent verification confirmed that:

- `memory_backend=mempalace_first` is the active host default.
- `disable_builtin_durable_memory=true` is enforced in MemPalace-first mode.
- Required MemPalace tool bindings are present.
- Status/config/operator surfaces reflect MemPalace-first mode.
- The host-app tests covering this path are present and passing.

Final verification outcome: fully met.

## Operator notes

- Hermes transient/session-local memory remains in the host app.
- Durable user/project/session facts are stored in MemPalace drawers.
- If MemPalace is unavailable, Hermes continues chatting and skips durable filing for that turn.

## Verification evidence

- Final smoke-test report: `/tmp/hermes_mempalace_claude_smoke_report.txt`
- Final verification branch: `mempalace-first-final-check`
- Final verification commit: `e0bfb4e04074aa51bb8b5ee953b869c782717540`
