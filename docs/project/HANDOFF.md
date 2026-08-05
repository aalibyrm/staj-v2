# Compact Handoff

- Repository state: `origin -> https://github.com/aalibyrm/staj-v2.git`; branch `main`; tracking `origin/main`
- Architecture: ExamRepository now owns authorized immutable exam draft/current/history state over MockTransport, mandatory expected-version writes, normalized settings, complete pinned QuestionVersion snapshots, exact-coverage publication validation, and same-identity versioned successors; ExamBuilderFacade keeps async workflow/request state behind Signals/RxJS.
- UI direction: `/exams/new` preserves the established matrix-first four-step layout while adding truthful pinned-selection, Reactive Form settings, draft/publish readiness, immutable history/successor controls, and accessible workflow feedback. P04-W05 owns publish confirmation and audit behavior.
- Active phase: Phase 04 in progress
- Active packet: none
- Verified evidence: P04-W04 focused model/repository/facade/component suite passed 16 tests; full suite passed 223 tests; production build passed. Browser gates at 1440x900 and 900x1000 verified guarded instructor access, initial missing coverage, valid draft save/success feedback, invalid settings blocking, disabled publish, matrix-first hierarchy, controlled table scroll, zero page overflow, and zero runtime console warnings/errors.
- Open decisions: none for P04-W04; ADR-007 remains realized as direct `cytoscape@3.34.0`
- Known blocker: none; build retains non-fatal component-style budget warnings for `CourseContentCatalogComponent` (5.37 kB), `OutcomeGraphComponent` (7.54 kB), `OutcomeListEditorComponent` (5.71 kB), `QuestionBankComponent` (7.76 kB), `ExamBuilderComponent` (5.19 kB), and `AppShellComponent` (7.55 kB)
- Next: implement and verify `P04-W05`; do not begin Phase 05

Maximum target size: 30 lines. Replace stale facts.
