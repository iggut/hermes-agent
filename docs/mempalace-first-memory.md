# MemPalace-first durable memory integration

Hermes can run with MemPalace as the durable memory backend while keeping the live conversation window and tool output transient in the host process.

## Memory split

Transient in Hermes:
- recent conversation turns
- current tool output
- scratch/session-local buffers

Durable in MemPalace:
- user preferences worth remembering
- project decisions
- stable environment facts
- long-lived debugging findings
- session resume evidence
- accepted verbatim excerpts

## Required host config

```yaml
memory:
  memory_backend: mempalace_first
  mempalace_enabled: true
  disable_builtin_durable_memory: true
  mempalace_fail_open: true
  mempalace_resume_on_start: true
  mempalace_include_legacy_local_envelopes: false
```

Recommended defaults:
- `mempalace_duplicate_threshold: 0.92`
- `mempalace_default_wing_strategy: active_project`
- `mempalace_default_room_strategy: fact_type_and_project`
- `mempalace_fallback_local_write: false`

## Startup validation

MemPalace-first is fail-fast at startup.

Startup fails if:
- `memory_backend` is `mempalace_first` but `mempalace_enabled` is false
- `memory_backend` is `mempalace_first` but `disable_builtin_durable_memory` is false
- required MemPalace tool bindings are missing
- duplicate threshold or wing/room strategy values are invalid
- `mempalace_fallback_local_write` is enabled in MemPalace-first mode

Runtime MemPalace outages still fail open: chat continues, durable filing is skipped for that turn.

## Operator verification

Use `hermes status` to confirm the configured memory mode.

Example output:

```text
memory_backend: mempalace_first
builtin_durable_memory: disabled
mempalace_tools: bound
resume_on_start: enabled
legacy_local_overlap: off
```

At chat startup, Hermes also prints a live one-line memory banner that includes the runtime resume result:

```text
🧠 Memory: memory_backend: mempalace_first · builtin_durable_memory: disabled · mempalace_tools: bound · resume_on_start: enabled · resume_status: succeeded · legacy_local_overlap: off
```

## Migration notes

- `mempalace_include_legacy_local_envelopes: true` is migration-only overlap.
- Keep it off after cutover to avoid mixing two durable sources.
- To roll back temporarily, switch `memory_backend` back to `local` and re-enable built-in durable memory.

## What stays in Hermes

- transient conversation context
- tool outputs for the active turn
- session-local scratch state

## What moves to MemPalace

- durable facts
- resume evidence
- stable project memory
- verbatim post-turn artifacts
