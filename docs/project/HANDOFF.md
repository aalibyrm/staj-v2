# Compact Handoff

- Repository state: `origin -> https://github.com/aalibyrm/staj-v2.git`; branch `main`; tracking `origin/main`
- Architecture: guarded lazy question-bank routing now feeds a role-scoped repository/facade; immutable typed question entities are derived from canonical course/outcome seed references, with normalized server-like query, status counts, bounded pagination, and stale-request cancellation.
- UI direction: `/question-bank` provides the assigned read-only P03-W01 list slice: URL-stable search/filter/sort/page/selection, status counts, semantic table selection, request states, and a type-aware inspector; the P03-W02 editor/version dialog remains intentionally out of scope.
- Active phase: Phase 03 in progress
- Active packet: none
- Verified evidence: P03-W01 focused suite passed 21 tests; full suite passed 150 tests; production build passed; `/question-bank` passed 1440x900 and 900x1000 browser gates with 10 bounded rows, pagination, selection deep-link/inspector behavior, no horizontal overflow, and no runtime console warning/error.
- Open decisions: none for P03-W01; ADR-007 remains realized as direct `cytoscape@3.34.0`
- Known blocker: none; build retains non-fatal component-style budget warnings for `CourseContentCatalogComponent` (5.37 kB), `OutcomeGraphComponent` (7.54 kB), `OutcomeListEditorComponent` (5.71 kB), `QuestionBankComponent` (5.77 kB), and `AppShellComponent` (7.55 kB)
- Next: implement and verify `P03-W02`; do not begin `P03-W03`

Maximum target size: 30 lines. Replace stale facts.
