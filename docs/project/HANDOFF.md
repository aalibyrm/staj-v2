# Compact Handoff

- Repository state: `origin -> https://github.com/aalibyrm/staj-v2.git`; branch `main`; tracking `origin/main`
- Architecture: canonical route/action/data policies feed a guarded feature root; learning-domain UI is isolated behind a facade over MockTransport-backed repository workflows and a normalized immutable Signals store with computed filters/selectors
- UI direction: `general-overview` shell remains verified; Phase 02 outcome editor and outcome-map UI are not started
- Active phase: Phase 02
- Active packet: none
- Verified evidence: P02-W01 focused repository/store suite passed 8 tests; full suite passed 85 tests; production build passed; immutable Course, LearningOutcome, ContentItem, and LearningPath CRUD/list/reference failures, normalized state, filters/sorts, request states, failed-write preservation, and stale-load protection are implemented
- Open decisions: none for Phase 02; ADR-007 Cytoscape dependency remains deferred until P02-W04
- Known blocker: none; build emits the existing non-fatal 7.55 kB component-style budget warning for `AppShellComponent`
- Next: `/adaptive-next` for `P02-W02`

Maximum target size: 30 lines. Replace stale facts.
