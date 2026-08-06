# Compact Handoff

- Repository state: `origin -> https://github.com/aalibyrm/staj-v2.git`; branch `main` clean and tracking `origin/main`; P06-W02 delivered in `be696e0`; P06-W03 delivered in `3d553c3` (13 paths, fast-forward `ff23507..3d553c3`)
- Architecture: P06-W03 adds `models/grading-workflow.models.ts` (frozen `GradingWorkflowState`, typed `GradingWorkflowError`), `domain/grading-workflow.ts` (pure status derivation plus `GRADING_WORKFLOW_TRANSITIONS`/`assertWorkflowTransition`), and `domain/grading-access.ts` (`decideGradingAttemptAccess` = authentication, `manage-course` action permission, then `student` data scope, deny-by-default). `RubricGradingFacade` now injects `SessionStore`, decides access against the loaded attempt context, suppresses the payload with an `unauthorized` state on denial, and exposes `accessDecision`/`workflowState`/`workflowStatus`/`isGradable`. The mock fixture maps an attempt id deterministically to a demo-scoped student id. Grading still persists nothing.
- UI direction: `/grading/:attemptId` keeps the P06-W02 layout and adds one `aria-live="polite"` workflow status region in the context card showing a textual status label, `data-workflow-status`, and live `scored / total criteria scored` derived from the rubric form; denied loads render only the shared unauthorized request state.
- Active phase: Phase 06 in progress
- Active packet: none
- Verified evidence: P06-W03 focused gate passed 50/50 across 6 files; full suite passed 445/445 across 41 files; production build succeeded with 8 pre-existing component-style budget warnings and no error. Live gates at 1440x900 and 390x844 as Instructor Demo showed pending 0/3 to partial 1/3 to graded 3/3, an exact total tracking selections, zero horizontal overflow, and no console/page errors. Two behavioral repairs were consumed: an out-of-scope mock fixture student id, and a status region that ignored live form state.
- Open decisions: none; ADR-007 remains realized as direct `cytoscape@3.34.0`
- Known blocker: none. Score-change reason and history, optimistic rollback, and the audit log remain P06-W04-W06.
- Next: start P06-W04 score-change reason and history

Maximum target size: 30 lines. Replace stale facts.
