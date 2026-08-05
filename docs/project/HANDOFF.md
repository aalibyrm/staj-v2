# Compact Handoff

- Repository state: `origin -> https://github.com/aalibyrm/staj-v2.git`; branch `main`; tracking `origin/main`
- Architecture: ExamBuilderFacade owns immutable target/current comparison; P04-W03 adds pure six-decimal fixed-point automatic selection over pinned published question versions, with deterministic memoized simultaneous-constraint search, stable-question grouping, safe non-exceeding pruning, and exhaustive structured deficits for the best partial result.
- UI direction: `/exams/new` remains the guarded lazy exam-builder screen with a four-step header, target/current matrix, subordinate constraint editor, validation/settings regions, non-color status/reasons, and controlled narrow table scrolling. P04-W04 owns exam draft/version/publish state using these established decisions.
- Active phase: Phase 04 in progress
- Active packet: none
- Verified evidence: P04-W03 focused domain suite passed 9 tests; full suite passed 216 tests; production build passed. Exact and non-greedy feasible selection, insufficient-bank deficits, input-order independence, stable-question de-duplication across versions, malformed/unmatched filtering, decimal precision, deterministic partial ranking, deep output immutability, and unchanged inputs are covered.
- Open decisions: none for P04-W03; ADR-007 remains realized as direct `cytoscape@3.34.0`
- Known blocker: none; build retains non-fatal component-style budget warnings for `CourseContentCatalogComponent` (5.37 kB), `OutcomeGraphComponent` (7.54 kB), `OutcomeListEditorComponent` (5.71 kB), `QuestionBankComponent` (7.76 kB), and `AppShellComponent` (7.55 kB)
- Next: implement and verify `P04-W04`; do not begin `P04-W05`

Maximum target size: 30 lines. Replace stale facts.
