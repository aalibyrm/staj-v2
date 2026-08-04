# Compact Handoff

- Repository state: `origin -> https://github.com/aalibyrm/staj-v2.git`; branch `main`; tracking `origin/main`
- Architecture: canonical role policies feed canMatch guards and the global shell; route-scoped list query Signals use URL as source of truth for search/repeated filters/sort/page
- UI direction: resolved shell plus reusable loading/empty/slow/error/retry/unauthorized surfaces and responsive list controls; `/courses` demonstrates the pattern without domain records
- Active phase: Phase 01
- Active packet: none
- Verified evidence: P01-W04 passed 69 tests for five request states, retry semantics, safe query codec, repeated filters, page reset, URL restoration, and Courses-only integration; build plus 1440x900/390x844 browser query/history gates passed without console/page errors
- Open decisions: none for Phase 00; ADR-005 through ADR-010 and ADR-016 accepted
- Known blocker: none; build emits a non-fatal 6.08 kB component-style budget warning for `AppShellComponent`
- Next: `/adaptive-next` for P01-W05 scoped dataset enforcement

Maximum target size: 30 lines. Replace stale facts.
