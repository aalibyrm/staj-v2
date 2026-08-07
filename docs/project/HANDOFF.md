# Compact Handoff

- Repository state: `origin -> https://github.com/aalibyrm/staj-v2.git`; branch `main` tracking `origin/main`; P06-W06 delivered in `a36c35d`; `P06-REV` exit review verified and pending its own commit/push. Phase 06 is COMPLETE.
- Architecture: Phase 06 delivers objective + rubric scoring (pure selectors), grading workflow status, route/action/data-scope enforcement on `/grading/:attemptId`, mandatory-reason score changes with immutable history, optimistic apply with exact rollback and notification, and the append-only audit log at `/audit-log` wired as `AuditPort` in `app.config.ts`. P06-REV added a facade-level blank-reason guard before any optimistic write, the missing `from:`/`to:` date facet in `audit-log-query.ts`, and `audit-log.repository.spec.ts` covering the `record()` to `list()` seam.
- UI direction: `/grading/:attemptId` now shows the persisted total beside the working total (so a rollback is visible on the score card), exam title and course in the context card, and a selected rubric level distinguished from hover by border and font weight, not colour alone. `/audit-log` keeps the P06-W06 layout and gains day-bounded date filter options derived from loaded records. Grader style block 7979 B, audit-log 3596 B, both under the 8192 B error budget.
- Active phase: Phase 06 complete; Phase 07 not started
- Active packet: none
- Verified evidence: `P06-REV` phase gate re-run after repairs — full suite 515/515 across 46 files, `npx ng build` exit 0 with zero errors and 8 pre-existing warning-tier style budgets. One `adaptive-auditor` pass returned 0 blockers, 3 MAJOR, 5 MINOR; all 3 MAJOR and 5 MINOR are cleared. Live re-verification: a facade call with a whitespace-only reason produced 0 repository calls, null pending, and an error state; the score card showed `PERSISTED TOTAL 0.00` beside `EXACT TOTAL 75.00`; the context card listed exam and course; a selected level rendered weight 700 with a primary border versus 400 and a neutral border; audit date filters moved 24 records to 15 for `from:2025-05-05` and to exactly 1 for `from`+`to`+`category:publish`, with `from:not-a-date` ignored.
- Open decisions: none; ADR-007 remains realized as direct `cytoscape@3.34.0`
- Known blocker: none. Phase 06 exit gate satisfied: rubric total correct, reason cannot be bypassed at model, facade, or UI level, rollback restores the prior score, and audit events are recorded and visible.
- Next: start Phase 07 recommendation and analytics

Maximum target size: 30 lines. Replace stale facts.
