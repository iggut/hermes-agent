# MemPalace-First Durable Memory

Hermes host-integrated workflows now use MemPalace as the durable memory backend.

This setup is designed to work together with the companion [hermes_mempalace_routing](https://github.com/iggut/hermes_mempalace_routing) repository, which provides the MemPalace-aware routing layer that builds memory envelopes, preserves provenance, and injects evidence-backed context into Hermes prompts.

What stays in Hermes:
- recent live conversation window
- current tool outputs
- active-task scratch / session-local working buffer

What moves to MemPalace:
- user preferences worth remembering
- project decisions
- long-lived debugging findings
- stable environment facts
- session resume facts
- accepted transcript/artifact excerpts

Boundary terms:
- wing
- room
- drawer
- verbatim content

Operational notes:
- MemPalace is the durable source of truth.
- Hermes' built-in durable memory path is bypassed via the no-op shim.
- Startup/session wake-resume uses the MemPalace routing hook path.
- Durable recall uses MemPalace-backed context assembly.
- Post-turn filing is duplicate-aware and checks `mempalace_check_duplicate` before insertions.
- Fail-open behavior remains intact if MemPalace is unavailable.

See also:
- `docs/mempalace-first-memory.md`
- `RELEASE_MEMPALACE_FIRST.md`
