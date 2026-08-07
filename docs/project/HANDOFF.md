# Compact Handoff

- Repository state: `origin -> https://github.com/aalibyrm/staj-v2.git`; branch `main` clean and tracking `origin/main`; P06-W04 delivered in `db4f59b`; P06-W05 delivered in `b6e6f97` (9 paths)
- Architecture: P06-W05 makes the score change optimistic. `domain/score-change-history.ts` adds `PendingScoreChange`, `selectOptimisticTimeline`, `deriveOptimisticEvaluationCount`, and a `pending` flag on `ReEvaluationTimelineItem`. The facade injects an optional `NotificationPort`, holds `pendingScoreChange`/`lastNotification`, exposes `displayedScoreTotal` (optimistic) beside `previousScoreChangeTotal` (last persisted), captures the prior history before writing the pending change, and on failure clears pending, restores that exact history, and notifies once through a guarded `notify` call. The repository was not touched and still never persists on failure.
- UI direction: the grading screen marks the in-flight timeline item `Applying…` without a timestamp, follows the optimistic total and workflow status while pending, and on failure shows an assertive `role="alert"` with the mapped message plus a Retry button that reopens the confirmation dialog. No new CSS was added; the grader style block stays at 7884 bytes against the 8192-byte error budget.
- Active phase: Phase 06 in progress
- Active packet: none
- Verified evidence: P06-W05 focused gate passed 84/84 across 7 files; full suite passed 479/479 across 42 files; `npx ng build` exits 0 with no error. Live gates at 1440x900 and 390x844 as Instructor Demo: an in-flight change showed `Applying…` with status re-evaluated, a simulated `service-error` restored the empty history and the graded status with the assertive Retry alert and the live message `Score change failed. The previous total was restored.`, Retry reopened the dialog, and the retried change persisted at 0.00 to 75.00 with the pending marker gone and a real timestamp. Zero horizontal overflow, no console/page errors. No repair round was consumed.
- Open decisions: none; ADR-007 remains realized as direct `cytoscape@3.34.0`
- Known blocker: none. The audit-log screen (P06-W06) is the last Phase 06 packet.
- Next: start P06-W06 audit log screen

Maximum target size: 30 lines. Replace stale facts.
