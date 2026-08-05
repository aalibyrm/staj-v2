# Compact Handoff

- Repository state: `origin -> https://github.com/aalibyrm/staj-v2.git`; branch `main`; tracking `origin/main`
- Architecture: role/course-scoped QuestionBankRepository now owns immutable list/read/create/update data behind MockTransport; draft/review writes validate normalized common and type-specific payloads, preserve snapshots on failure, and reject stale expected versions or non-editable published/archived entities.
- UI direction: `/question-bank` now integrates a typed QuestionEditor for new and draft/review items with six answer-control families, course-filtered outcomes, accessible validation/focus, live preview, retry/conflict feedback, and immediate saved selection; publish/new-version creation remains P03-W03.
- Active phase: Phase 03 in progress
- Active packet: none
- Verified evidence: P03-W02 focused suite passed 17 tests; full suite passed 156 tests; production build passed; browser gates at 1440x900 and 900x1000 exercised validation focus/ARIA wiring, matching-to-essay switching, essay create, draft rehydration/update, published preview-only behavior, URL selection, and zero horizontal overflow/runtime console errors.
- Open decisions: none for P03-W02; ADR-007 remains realized as direct `cytoscape@3.34.0`
- Known blocker: none; build retains non-fatal component-style budget warnings for `CourseContentCatalogComponent` (5.37 kB), `OutcomeGraphComponent` (7.54 kB), `OutcomeListEditorComponent` (5.71 kB), `QuestionBankComponent` (5.77 kB), and `AppShellComponent` (7.55 kB)
- Next: implement and verify `P03-W03`; do not begin `P03-W04`

Maximum target size: 30 lines. Replace stale facts.
