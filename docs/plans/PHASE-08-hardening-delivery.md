# Phase 08 - Hardening and Delivery

## Requirement groups

All AC, EVAL-01..07, DEL-01..07, unresolved TECH items.

## Work packets

### P08-W01 - Acceptance matrix sweep

Run each AC scenario; mark evidence path/test. No prose-only verification for critical rules.

### P08-W02 - Error/state sweep

Requirement: `AC-11` only.

The initial focused gate passes 161/161 tests, but production inspection found real retry/slow-state gaps. Preserve the current uncommitted changes in:

- `src/app/core/routing/app-routes.spec.ts`
- `src/app/shared/components/common-patterns.spec.ts`
- `src/app/features/question-bank/components/question-bank.component.spec.ts`
- `src/app/features/exam-builder/components/exam-builder.component.spec.ts`
- `src/app/features/grading/components/rubric-grader.component.spec.ts`

Do not commit P08-W02 until every repair below and the closure gate pass. Later repairs may add assertions to these files, but must not discard or rewrite their verified AC-11 coverage merely to satisfy production.

#### P08-W02-R01 - Question bank retry and slow state

Status: `COMPLETE` — unchanged-query retry, revision-safe slow state, stale-data clearing, and timer cleanup verified by the R01 focused gate (36/36 tests across 2 files). Remains intentionally uncommitted until P08-W02-R09.

Fix identical-request retry: `QuestionBankComponent.retryLoad()` must reissue the last request rather than feed the same key back through `distinctUntilChanged`. Add a deterministic slow transition that clears on success, empty, error, unauthorized, cancellation, and destruction; retain stale-row clearing and retry recovery.

Exact allowlist:

- `src/app/features/question-bank/models/question.models.ts`
- `src/app/features/question-bank/data-access/question-bank.facade.ts`
- `src/app/features/question-bank/data-access/question-bank.facade.spec.ts`
- `src/app/features/question-bank/components/question-bank.component.ts`
- `src/app/features/question-bank/components/question-bank.component.spec.ts`

Focused gate:

`npx ng test --watch=false --include=src/app/features/question-bank/data-access/question-bank.facade.spec.ts --include=src/app/features/question-bank/components/question-bank.component.spec.ts`

#### P08-W02-R02 - Learning-domain slow-state plumbing

Status: `COMPLETE` — shared `slow` status, request-id guard, and independent per-resource 400 ms timer lifecycle verified by the R02 focused gate (8/8 tests). Remains intentionally uncommitted until P08-W02-R09.

Add `slow` to the shared learning-domain request state and a revision-safe timer lifecycle in the facade/store. No route markup changes in this packet.

Exact allowlist:

- `src/app/features/learning-domain/state/learning-domain.store.ts`
- `src/app/features/learning-domain/state/learning-domain.store.spec.ts`
- `src/app/features/learning-domain/data-access/learning-domain.facade.ts`

Focused gate:

`npx ng test --watch=false --include=src/app/features/learning-domain/state/learning-domain.store.spec.ts`

#### P08-W02-R03 - Course catalog route states

Status: `COMPLETE` — shared slow rendering/retry, blocking-state precedence, stale-row hiding, loading distinction, and authorized-empty behavior verified by the R03 focused gate (11/11 tests). One test-fixture union omission required a mechanical correction. Remains intentionally uncommitted until P08-W02-R09.

Render the shared slow state on `/courses`; preserve loading, authorized empty, service error/retry, unauthorized, stale-row clearing, and responsive behavior.

Exact allowlist:

- `src/app/features/learning-domain/components/course-content-catalog.component.ts`
- `src/app/features/learning-domain/components/course-content-catalog.component.html`
- `src/app/features/learning-domain/components/course-content-catalog.component.spec.ts`

Focused gate:

`npx ng test --watch=false --include=src/app/features/learning-domain/components/course-content-catalog.component.spec.ts`

#### P08-W02-R04 - Outcome list and graph route states

Status: `COMPLETE` — shared slow rendering/retry, load-state precedence, stale-data hiding, authorized empty, and graph/list alternatives verified by the R04 focused gate (26/26 tests across 2 files). Two nonexistent request-state modifier assertions required one mechanical correction. Remains intentionally uncommitted until P08-W02-R09.

Render the shared slow state on `/outcomes` and `/outcomes/map`; preserve loading, empty, service error/retry, unauthorized, graph/list alternatives, stale-data clearing, and responsive behavior.

Exact allowlist:

- `src/app/features/learning-domain/components/outcome-list-editor.component.ts`
- `src/app/features/learning-domain/components/outcome-list-editor.component.spec.ts`
- `src/app/features/learning-domain/components/outcome-graph.component.ts`
- `src/app/features/learning-domain/components/outcome-graph.component.html`
- `src/app/features/learning-domain/components/outcome-graph.component.spec.ts`

Focused gate:

`npx ng test --watch=false --include=src/app/features/learning-domain/components/outcome-list-editor.component.spec.ts --include=src/app/features/learning-domain/components/outcome-graph.component.spec.ts`

#### P08-W02-R05 - Exam builder load states

Add revision-safe slow state and retry for current-exam loading on `/exams/new` and `/exams/:id/edit`. Render load loading/slow/error/retry/unauthorized separately from automatic-selection states; retain the existing automatic-selection empty/error/retry/denial coverage.

Status: `COMPLETE` - dedicated revision-safe current-exam loading/slow/error/retry/unauthorized states, `/exams/new` draft reset, stale-data clearing, timer/destruction cleanup, and stale write/selection invalidation verified by the R05 focused gate (28/28 tests across 2 files). One malformed unauthorized fixture required a mechanical correction; one diff-discovered pending-write overwrite defect required a behavioral repair. Remains intentionally uncommitted until P08-W02-R09.

Next: P08-W02-R06 only. Preserve all current dirty work; do not start R07 or commit P08-W02 before R09 passes.

Exact allowlist:

- `src/app/features/exam-builder/models/exam.models.ts`
- `src/app/features/exam-builder/data-access/exam-builder.facade.ts`
- `src/app/features/exam-builder/data-access/exam-builder.facade.spec.ts`
- `src/app/features/exam-builder/components/exam-builder.component.ts`
- `src/app/features/exam-builder/components/exam-builder.component.spec.ts`

Focused gate:

`npx ng test --watch=false --include=src/app/features/exam-builder/data-access/exam-builder.facade.spec.ts --include=src/app/features/exam-builder/components/exam-builder.component.spec.ts`

#### P08-W02-R06 - Exam session slow state

Add a revision-safe slow transition for `/exam-session/:token`; preserve loading, empty, service error/retry, unauthorized without retry, autosave states, terminal locking, and stale-session clearing.

Status: `COMPLETE` - revision-safe 400 ms slow transition, exact-token retry, non-retryable unauthorized/invalid-token handling, stale-session clearing, and terminal/cancellation/supersession/destruction cleanup verified by the R06 focused gate (35/35 tests in 1 file). One nested-observable test fixture required a mechanical correction. Remains intentionally uncommitted until P08-W02-R09.

Next: P08-W02-R07 only. Preserve all current dirty work; do not start R08 or commit P08-W02 before R09 passes.

Exact allowlist:

- `src/app/features/exam-session/data-access/exam-session.facade.ts`
- `src/app/features/exam-session/components/exam-session.component.ts`
- `src/app/features/exam-session/components/exam-session.component.spec.ts`

Focused gate:

`npx ng test --watch=false --include=src/app/features/exam-session/components/exam-session.component.spec.ts`

#### P08-W02-R07 - Grading slow state

Add a revision-safe slow transition for `/grading/:attemptId`; preserve empty, service error/retry, unauthorized without retry, stale-form clearing, and recovered grading state.

Status: `COMPLETE` - revision-safe 400 ms slow transition, normalized attempt/options retry, non-retryable unauthorized/invalid handling, stale-form clearing, recovered grading application, and terminal/cancellation/supersession/clear/destruction cleanup verified by the R07 focused gate (35/35 tests across 2 files). One missing test type import required a mechanical correction. Remains intentionally uncommitted until P08-W02-R09.

Next: P08-W02-R08 only. Preserve all current dirty work; do not start R09 closure or commit P08-W02 before R08 passes.

Exact allowlist:

- `src/app/features/grading/data-access/rubric-grading.facade.ts`
- `src/app/features/grading/data-access/rubric-grading.facade.spec.ts`
- `src/app/features/grading/components/rubric-grader.component.ts`
- `src/app/features/grading/components/rubric-grader.component.spec.ts`

Focused gate:

`npx ng test --watch=false --include=src/app/features/grading/data-access/rubric-grading.facade.spec.ts --include=src/app/features/grading/components/rubric-grader.component.spec.ts`

#### P08-W02-R08 - Audit-log slow state

Add a revision-safe slow transition for `/audit-log`; preserve loading, empty, service error/retry, unauthorized without retry, redaction, stale-record clearing, and responsive table behavior.

Status: `COMPLETE` - revision-safe 400 ms slow transition, exact-query retry, non-retryable unauthorized/terminal handling, stale-record/detail clearing, redaction preservation, and timer cleanup on terminal/cancellation/supersession/destruction verified by the R08 focused gate (19/19 tests across 2 files). One filter-mismatched test fixture required a mechanical correction. Remains intentionally uncommitted until P08-W02-R09.

Next: P08-W02-R09 closure only. Preserve all current dirty work; run every declared R09 gate before finalizing or committing P08-W02.

Exact allowlist:

- `src/app/features/audit/data-access/audit-log.facade.ts`
- `src/app/features/audit/data-access/audit-log.facade.spec.ts`
- `src/app/features/audit/components/audit-log.component.ts`
- `src/app/features/audit/components/audit-log.component.spec.ts`

Focused gate:

`npx ng test --watch=false --include=src/app/features/audit/data-access/audit-log.facade.spec.ts --include=src/app/features/audit/components/audit-log.component.spec.ts`

#### P08-W02-R09 - Route-state closure gate

No production repair is planned for `/learning/dashboard`, `/student/:id/analytics`, `/cohort-analytics`, or `/item-analysis`: their facades and components already implement loading, slow, empty, error/retry, and unauthorized states. Placeholder-only routes have no asynchronous/data-scope state contract. Verify all implemented main routes, retain the five initial modified specs, run the complete focused AC-11 gate, then run desktop/narrow browser gates, the full suite, and production build. Only after every gate passes may traceability, state, and handoff be finalized and one P08-W02 commit be pushed.

Status: `COMPLETE` — R01-R08 plus closure repairs provide revision-safe loading/slow/error/retry/empty/unauthorized behavior without stale state across every implemented main route. The final focused gate passed 252/252 tests across 19 files; the complete suite passed 640/640 tests across 55 files; `npx ng build` passed with a 350.00 kB initial bundle and only existing component-style budget warnings. Live checks covered 13 implemented routes at 1440x900 and 390x844 with no horizontal overflow or console/page errors, narrow keyboard focus, exam-session autosave, and role-denial recovery. Closure required three stale-callback/write behavioral repairs, one component-style-budget behavioral repair, and three minimal test-fixture mechanical corrections.

Focused gate:

`npx ng test --watch=false --include=src/app/core/routing/app-routes.spec.ts --include=src/app/shared/components/common-patterns.spec.ts --include=src/app/features/question-bank/components/question-bank.component.spec.ts --include=src/app/features/question-bank/data-access/question-bank.facade.spec.ts --include=src/app/features/exam-builder/components/exam-builder.component.spec.ts --include=src/app/features/exam-builder/data-access/exam-builder.facade.spec.ts --include=src/app/features/grading/components/rubric-grader.component.spec.ts --include=src/app/features/grading/data-access/rubric-grading.facade.spec.ts --include=src/app/features/adaptive-learning/data-access/scoped-data.facade.spec.ts --include=src/app/features/learning-domain/components/course-content-catalog.component.spec.ts --include=src/app/features/learning-domain/components/outcome-list-editor.component.spec.ts --include=src/app/features/learning-domain/components/outcome-graph.component.spec.ts --include=src/app/features/learning-domain/state/learning-domain.store.spec.ts --include=src/app/features/analytics/components/student-analytics.component.spec.ts --include=src/app/features/analytics/components/cohort-analytics.component.spec.ts --include=src/app/features/analytics/components/item-analysis.component.spec.ts --include=src/app/features/exam-session/components/exam-session.component.spec.ts --include=src/app/features/audit/components/audit-log.component.spec.ts --include=src/app/features/audit/data-access/audit-log.facade.spec.ts`

Required final gates:

- Desktop and 390x844 browser checks for implemented main routes and state recovery; no horizontal overflow or console/page errors.
- `npx ng test --watch=false`
- `npx ng build`

### P08-W03 - Accessibility sweep

Keyboard, focus, ARIA, non-color state, dialog focus return, timer/autosave announcements. Verify chart/heatmap alternatives and exam-session live regions.

Status: `COMPLETE` — shared request states announce atomically; narrow navigation and audit detail contain keyboard focus and restore it on Escape; grading exposes dialog trigger state and focus return; exam timer, autosave, conflict, navigator, and live status retain meaningful ARIA semantics; analytics heatmap/trend alternatives expose captions, scoped headers, numeric values, and text states. The focused gate passed 72/72 tests across 6 files, the complete suite passed 641/641 tests across 55 files, and `npx ng build` passed with a 350.45 kB initial bundle and only existing component-style budget warnings. Live checks at 1440x900 and 390x844 passed without horizontal overflow or console/page errors.

### P08-W04 - Performance sweep

Lazy routes, trackBy, memoized selectors, virtual scroll where needed, lazy charts, large graph/list checks.

### P08-W05 - Integration tests

At least two main flows; include autosave and grading or recommendation critical paths.

### P08-W06 - README and demo accounts

Purpose, roles, setup, commands, architecture decisions, demo credentials, scenario controls, test commands.

### P08-W07 - Demo and technical note

Demo script/video checklist: main workflow, role differences, rollback/error, report, audit. Known gaps and decisions.

### P08-W08 - Clean release

UI contract:

- Reference: `docs/ui/reference/00-contact-sheet.webp`
- Visual scope: cross-screen shell/component consistency only; route details use individual briefs

No secrets, unused files, unnecessary logs, unfinished screens, unexplained hard-coded rule. Production build and console check.

## Exit gate

All blockers cleared or explicitly accepted by user. Production build and critical tests pass. Traceability has evidence. Delivery docs complete.
