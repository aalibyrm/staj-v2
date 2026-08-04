---
name: adaptive-platform
description: Plan, implement, and verify the PDF-defined Angular adaptive education platform using phase files, requirement IDs, UI briefs, and one-screen visual references.
---

Use project harness, not a one-shot build.

1. Read `docs/project/STATE.md`, `HANDOFF.md`, then active phase.
2. Resolve only referenced requirement IDs from `docs/requirements/`.
3. Sol creates one bounded work packet and delegates application edits to `adaptive-builder`.
4. If packet has `ui-key`, read `skill://adaptive-ui`; assign one brief and one reference image.
5. Sol inspects diff and runs functional/UI gates. One focused repair maximum before replanning.
6. Update traceability/state only after evidence passes; then commit/push through `adaptive-committer`.

Never collapse layers: components -> facade/use-case -> repository/mock transport. Keep Signals for state/derived values, RxJS for async flows, Reactive Forms for forms. Preserve role/data scope, versioning, autosave conflict, reference-time timer, audit, privacy threshold, and explainable recommendation rules.

UI references define hierarchy and design direction only. PDF/domain behavior wins. Do not load the full image pack for one task.
