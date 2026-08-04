---
name: adaptive-ui
description: Implement or audit one adaptive education UI screen from its brief and one reference image without loading the full visual pack.
---

Use only for a work packet containing `ui-key`.

Read in order:

1. `docs/ui/UI-SPEC.md`
2. `docs/ui/SCREEN-REFERENCE-MAP.md`
3. Assigned `docs/ui/screens/*.md`
4. Assigned single `docs/ui/reference/*.webp`
5. `docs/ui/KNOWN-IMAGE-DEVIATIONS.md` only if relevant

PDF behavior and requirement IDs override image content. Match information hierarchy, shell, component language, density, responsive transformation, and accessibility—not pixels or sample data.

Do not open the contact sheet or other screens unless parent explicitly allows it. Use shared UI primitives. Verify desktop plus one narrow viewport, relevant request states, keyboard/focus, and non-color status cues.
