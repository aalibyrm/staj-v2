---
name: adaptive-ui-review
description: Read-only audit of one implemented screen against its PDF requirements, UI brief, and single reference image.
---

orchestrate

Follow `AGENTS.md`. Screen key argument: `$ARGUMENTS`.

Read `docs/ui/SCREEN-REFERENCE-MAP.md` and resolve exactly one matching key. If key is absent or ambiguous, list valid keys in one line and stop. Read `skill://adaptive-ui`, matching screen brief, matching single reference, active phase, and only directly relevant requirement IDs.

Inspect current route/component/style/test files. Do not edit or commit. Delegate one read-only audit to `adaptive-auditor` with:

- ui-key, brief, reference
- route and visual scope
- relevant requirement IDs
- desktop 1440x900 and narrow 900x1000 targets unless brief says otherwise
- changed/current paths and available build/test commands

Return only ranked blockers/majors/minors and gate results. Do not compare pixels or suggest optional redesign.
