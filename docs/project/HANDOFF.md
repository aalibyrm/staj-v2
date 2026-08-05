# Compact Handoff

- Repository state: `origin -> https://github.com/aalibyrm/staj-v2.git`; branch `main`; tracking `origin/main`
- Architecture: QuestionBankRepository now supports scoped immutable list/editor/version/reference behavior plus independent expected-version bulk tag/status mutations with deterministic partial results and success-only optional AuditPort events; the facade refreshes the active query through Signals/RxJS.
- UI direction: `/question-bank` adds keyboard-native row selection, current-page select-all, bulk action controls, an accessible confirmation dialog with focus restoration, and non-color per-item failure reporting while retaining failed rows for retry.
- Active phase: Phase 03 complete
- Active packet: none
- Verified evidence: P03-W05 focused suites passed 27 tests; full suite passed 171 tests; production build passed. Browser gates at 1440x900 and 900x1000 exercised cancel/confirm, mixed immutable/editable partial failure, failed-row retention, dialog focus entry/return, live feedback, internal table scrolling, zero page overflow, and zero console warnings/errors.
- Open decisions: none for P03-W05; ADR-007 remains realized as direct `cytoscape@3.34.0`
- Known blocker: none; build retains non-fatal component-style budget warnings for `CourseContentCatalogComponent` (5.37 kB), `OutcomeGraphComponent` (7.54 kB), `OutcomeListEditorComponent` (5.71 kB), `QuestionBankComponent` (6.90 kB), and `AppShellComponent` (7.55 kB)
- Next: begin Phase 04 with its first incomplete unblocked packet

Maximum target size: 30 lines. Replace stale facts.
