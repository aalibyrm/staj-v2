---
name: adaptive-review
description: Audit a phase against requirement IDs, UI contracts, and its exit gate. Usage: /adaptive-review 05
---

orchestrate

Follow `AGENTS.md`. Review phase `$1` when supplied; otherwise use active phase from `docs/project/STATE.md`. Read the phase file, relevant requirements, traceability rows, and changed files. Run phase gate commands.

For each screen key explicitly annotated in that phase, read its brief. Open one reference image at a time only when the route is implemented and visual evidence is required. Do not load all phase images into one auditor call. Phase 08 may use `00-contact-sheet.webp` for shell consistency, then individual briefs for defects.

Spawn one `adaptive-auditor` only after defining exact functional/UI scope and checks. Reconcile findings yourself. Update phase status only when all blockers and major findings are cleared. Do not implement unrelated fixes during review.
