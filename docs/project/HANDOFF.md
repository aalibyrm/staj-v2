# Compact Handoff

- Repository state: `origin -> https://github.com/aalibyrm/staj-v2.git`; branch `main` tracking `origin/main`; P06-W03 delivered in `3d553c3`; P06-W04 verified and pending its own commit/push
- Architecture: P06-W04 adds `models/score-change.models.ts` (frozen `ScoreChangeEntry`, `ScoreChangeError`, mandatory-reason normalization, derived `delta`, evaluation numbers from 2) and `domain/score-change-history.ts` (`appendScoreChange`, `deriveEvaluationCount`, `selectReEvaluationTimeline`, `buildScoreChangeAuditDraft`). `RubricGradingRepository` gained an `@Optional() AuditPort`, per-attempt history, a server `now()` timestamp, `submitScoreChange` through `MockTransport` POST, and `listScoreChanges`. The facade adds `scoreChangeHistory`, `reEvaluationTimeline`, `scoreChangeState`, `previousScoreChangeTotal`, and re-derives `workflowState` from `deriveEvaluationCount`. Rollback stays P06-W05.
- UI direction: the grading screen keeps its verified layout and adds an "Apply score change" trigger, a dedicated standalone `app-score-change-panel` confirmation dialog (own component and styles, extracted so each component stays under the 8.00 kB style error budget), and a newest-first re-evaluation timeline with an explicit empty state.
- Active phase: Phase 06 in progress
- Active packet: none
- Verified evidence: P06-W04 focused gate passed 71/71 across 7 files; full suite passed 466/466 across 42 files; `npx ng build` exits 0 with no error (warning-tier 4.00 kB component-style budgets remain on several pre-existing components). Live gates at 1440x900 and 390x844 as Instructor Demo: whitespace-only reason keeps Confirm disabled, a valid change moved the attempt 0.00 -> 75.00 (+75.00) with the reason whitespace collapsed, status flipped to re-evaluated, the timeline showed evaluation 2 with actor/time/old/new/reason, Escape restored trigger focus, zero horizontal overflow, no console/page errors. Two repair rounds were consumed, both on the component-style budget: byte compression plateaued at 8699 bytes, so the dialog was extracted into its own component.
- Open decisions: none; ADR-007 remains realized as direct `cytoscape@3.34.0`
- Known blocker: none. Optimistic update with rollback (P06-W05) and the audit-log screen (P06-W06) remain.
- Next: commit and push P06-W04, then start P06-W05 optimistic update and rollback

Maximum target size: 30 lines. Replace stale facts.
