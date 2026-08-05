# Compact Handoff

- Repository state: `origin -> https://github.com/aalibyrm/staj-v2.git`; branch `main`; tracking `origin/main`
- Architecture: ExamBuilderFacade now resolves bounded, scoped published QuestionVersion candidates through QuestionBankRepository, invokes deterministic selection, and atomically pins retained snapshots with stale-request protection. ExamRepository enforces expected-version and all-course data scope before transport, mutation, or audit; `/exams/:id/edit` reuses the guarded workflow.
- UI direction: `/exams/new` retains the matrix-first workflow with reachable automatic selection, exact unmet reasons, selected snapshot pool, retry states, and guarded confirmation. Instructor, measurement specialist, and program manager routes are aligned; published successors require an accessible nonblank change note.
- Active phase: Phase 04 complete
- Active packet: none
- Verified evidence: P04-REV focused Phase 04 suite passed 69 tests; final full suite passed 237 tests; production build passed. Browser gates at 1440x900 and 900x1000 verified program-manager automatic partial selection with retained snapshot pool and exact deficits, guarded edit loading/error, student denial, controlled matrix overflow, and zero page overflow.
- Open decisions: none for Phase 04; ADR-007 remains realized as direct `cytoscape@3.34.0`
- Known blocker: none; durable audit persistence/history remains Phase 06. Build retains non-fatal component-style budget warnings for `CourseContentCatalogComponent` (5.37 kB), `OutcomeGraphComponent` (7.54 kB), `OutcomeListEditorComponent` (5.71 kB), `QuestionBankComponent` (7.76 kB), `ExamBuilderComponent` (5.86 kB), and `AppShellComponent` (7.55 kB)
- Next: prepare Phase 05 plan and requirement packets; Phase 05 implementation has not started

Maximum target size: 30 lines. Replace stale facts.
