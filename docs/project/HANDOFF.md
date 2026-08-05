# Compact Handoff

- Repository state: `origin -> https://github.com/aalibyrm/staj-v2.git`; branch `main`; tracking `origin/main`
- Architecture: ExamBuilderFacade owns seed-derived outcome choices, immutable target/current coverage Signals, and deterministic comparison; pure comparison preserves target order, appends unexpected current keys, and reports exact count/point deltas without mutating inputs.
- UI direction: `/exams/new` is now a guarded lazy screen following the assigned `exam-builder` brief/reference: four-step header, primary target/current matrix, subordinate disclosed constraint editor, validation/settings side column, non-color status/reasons, and controlled narrow table scrolling. P04-W03 owns automatic selection and the question pool.
- Active phase: Phase 04 in progress
- Active packet: none
- Verified evidence: P04-W02 focused model/facade/component/route suite passed 33 tests; full suite passed 207 tests; production build passed. Browser gates at 1440x900 and 900x1000 verified missing-coverage reasons, matrix-first hierarchy, editor update announcement, responsive single-column flow, controlled matrix scroll, zero page overflow/runtime console errors, and student denial.
- Open decisions: none for P04-W02; ADR-007 remains realized as direct `cytoscape@3.34.0`
- Known blocker: none; build retains non-fatal component-style budget warnings for `CourseContentCatalogComponent` (5.37 kB), `OutcomeGraphComponent` (7.54 kB), `OutcomeListEditorComponent` (5.71 kB), `QuestionBankComponent` (7.76 kB), and `AppShellComponent` (7.55 kB)
- Next: implement and verify `P04-W03`; do not begin `P04-W04`

Maximum target size: 30 lines. Replace stale facts.
