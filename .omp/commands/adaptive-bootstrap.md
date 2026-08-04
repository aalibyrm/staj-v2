---
name: adaptive-bootstrap
description: Inspect or create the project, settle Phase 00 decisions including UI strategy, and execute the first bounded work packet.
---

orchestrate

Read `skill://adaptive-platform` once, then follow `AGENTS.md`.

Before implementation, verify Git is connected to `origin` at `https://github.com/aalibyrm/staj-v2.git`, branch `main`, and working tree has no uncommitted harness setup. If not connected, stop and direct user to `/adaptive-github-init`.

Read:
- `docs/project/STATE.md`
- `docs/project/HANDOFF.md`
- `docs/plans/ROADMAP.md`
- `docs/plans/PHASE-00-bootstrap.md`
- `docs/ui/README.md` only to confirm reference-pack presence; do not open images

Inspect repository without editing first. Determine greenfield vs existing Angular project. Resolve Phase 00 decision gate from existing files. UI strategy must support `docs/ui/UI-SPEC.md` and reusable shell/table/drawer/form primitives; do not choose dependencies from screenshot appearance alone. Ask one grouped question only for decisions that cannot be inferred. Record accepted decisions.

Build one complete P00 packet, delegate it to `adaptive-builder`, inspect diff, run its gate, update state/handoff, then delegate exact verified paths to `adaptive-committer` and push. Do not begin a second packet. Do not open UI images until a packet declares `ui-key`.
