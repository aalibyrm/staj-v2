# Compact Handoff

- Repository state: `origin -> https://github.com/aalibyrm/staj-v2.git`; branch `main`; tracking `origin/main`
- Architecture: ExamRepository now owns authorized immutable draft/current/history state over MockTransport, exact pinned-snapshot coverage gates, expected-version writes, and post-success `exam.publish`/`exam.override` AuditPort events with persisted timestamps and readable version transitions; failures never audit.
- UI direction: `/exams/new` preserves the matrix-first workflow and now gates publication behind a labelled immutable-action confirmation with post-render focus, Escape/cancel focus restoration, and repeat-submit locking. Published-version overrides keep the normalized change note as mandatory reason.
- Active phase: Phase 04 in progress
- Active packet: none
- Verified evidence: P04-W05 focused repository/facade/component suite passed 18 tests; full suite passed 229 tests; production build passed. Browser gates at 1440x900 and 900x1000 verified invalid-disabled gating, labelled/described confirmation, real post-render dialog focus, Escape/cancel trigger-focus restoration, controlled matrix scroll, zero page overflow, and zero runtime console warnings/errors.
- Open decisions: none for P04-W05; ADR-007 remains realized as direct `cytoscape@3.34.0`
- Known blocker: none; build retains non-fatal component-style budget warnings for `CourseContentCatalogComponent` (5.37 kB), `OutcomeGraphComponent` (7.54 kB), `OutcomeListEditorComponent` (5.71 kB), `QuestionBankComponent` (7.76 kB), `ExamBuilderComponent` (5.86 kB), and `AppShellComponent` (7.55 kB)
- Next: run independent Phase 04 review; do not begin Phase 05

Maximum target size: 30 lines. Replace stale facts.
