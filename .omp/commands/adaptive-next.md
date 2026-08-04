---
name: adaptive-next
description: Execute and verify the next incomplete work packet in the active phase, including one-screen UI guidance when assigned.
---

orchestrate

Follow `AGENTS.md`. Read only `docs/project/STATE.md`, `docs/project/HANDOFF.md`, and active phase file. Inspect git status, branch, upstream, and origin URL before delegation. Stop on unrelated dirty files or remote mismatch.

Select next incomplete unblocked packet. Resolve only its requirement IDs. If packet declares `ui-key`, read `skill://adaptive-ui`, resolve exactly one brief and one reference from `SCREEN-REFERENCE-MAP.md`, and include complete UI contract. Do not open other images.

Delegate one bounded task to `adaptive-builder`. Inspect diff, run functional checks and UI gate when applicable, allow at most one focused repair, then update traceability/state/handoff. Delegate exact verified paths to `adaptive-committer`; commit and push. Stop after one verified packet and Git gate.
