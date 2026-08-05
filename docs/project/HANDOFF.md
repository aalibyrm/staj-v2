# Compact Handoff

- Repository state: `origin -> https://github.com/aalibyrm/staj-v2.git`; branch `main`; tracking `origin/main`
- Architecture: QuestionBankRepository now combines scoped immutable list/editor writes, expected-version publish/successor operations, and immutable exam references that resolve retained published QuestionVersion snapshots instead of the current editable entity.
- UI direction: `/question-bank` remains unchanged by P03-W04; the existing inspector publishes draft/review items, displays immutable version history, and creates noted draft successors.
- Active phase: Phase 03 in progress
- Active packet: none
- Verified evidence: P03-W04 focused repository suite passed 7 tests; full suite passed 165 tests; production build passed. Exam references remain pinned to frozen published snapshots after the current entity advances to an incremented draft; invalid and unauthorized references fail without repository mutation.
- Open decisions: none for P03-W04; ADR-007 remains realized as direct `cytoscape@3.34.0`
- Known blocker: none; build retains non-fatal component-style budget warnings for `CourseContentCatalogComponent` (5.37 kB), `OutcomeGraphComponent` (7.54 kB), `OutcomeListEditorComponent` (5.71 kB), `QuestionBankComponent` (5.77 kB), and `AppShellComponent` (7.55 kB)
- Next: implement and verify `P03-W05`; do not begin Phase 04

Maximum target size: 30 lines. Replace stale facts.
