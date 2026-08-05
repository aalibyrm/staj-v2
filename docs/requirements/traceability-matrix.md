# Traceability Matrix

Status values: `TODO`, `IN_PROGRESS`, `VERIFIED`, `BLOCKED`, `N/A`.

| ID | Requirement | Planned phase | Status | Evidence |
|---|---|---|---|---|
| SCOPE-01 | Platform purpose and explainable rule-based recommendation | P07 | TODO | - |
| SCOPE-02 | Cross-cutting data flow, rules, authorization, errors, tests | P00-P08 | TODO | - |
| SCOPE-03 | Dense related demo data | P00/P08 | IN_PROGRESS | P00-W05: deterministic relational seed foundation provides 3 terms, 6 courses, 6 roles, 36 outcomes, 12 cohorts, and 120 students; feature/report records remain later phases. |
| ROLE-01 | Student behavior and access | P01/P08 | IN_PROGRESS | P01-W01-W05: Student session, guarded learning routes/menu, and policy-filtered own course/cohort/student rows verified with unrelated rows absent; later learning behavior remains. |
| ROLE-02 | Instructor behavior and access | P01/P08 | IN_PROGRESS | P01-W01-W05: Instructor assignment/action policy, guarded teaching routes/menu, and exact assigned course/cohort/three-student dataset verified without unrelated learners; later teaching behavior remains. |
| ROLE-03 | Measurement Specialist behavior and access | P01/P08 | IN_PROGRESS | P01-W01-W05: Measurement assessment/analytics policy, guarded routes/menu, and canonically granted course row verified; later analysis behavior remains. |
| ROLE-04 | Program Manager behavior and access | P01/P08 | IN_PROGRESS | P01-W01-W05: Program policy, guarded routes/menu, and exact course/cohort dataset verified with all student rows excluded; later program workflows remain. |
| ROLE-05 | Observer behavior and access | P01/P08 | IN_PROGRESS | P01-W01-W05: Observer read-only policy, guarded reporting routes/menu, and one authorized cohort row with explicit read-only access verified; later reports remain. |
| ROLE-06 | Platform Administrator behavior and access | P01/P08 | IN_PROGRESS | P01-W01-W05: Platform-only policy, guarded dashboard/audit menu, and fail-closed zero-row learning dataset verified without arbitrary domain mutation; later administration behavior remains. |
| OUT-01 | Outcome graph management | P02 | VERIFIED | P02-W01-W04/P02-REV: immutable cycle-safe workflows plus guarded lazy list/editor and interactive graph/list views support filters, selection, prerequisite editing, dependents, related content, course-scoped unique codes, and the brief's authorized map roles. |
| OUT-02 | Cycle and unpublished dependency validation | P02 | VERIFIED | P02-W01-W03: repository references plus editor-side same-course/non-self/published-prerequisite checks and deterministic repository-level cycle rejection with an actionable closed path verified. |
| CONTENT-01 | Content metadata and access conditions | P02 | VERIFIED | P02-W01/W05/P02-REV: immutable metadata plus repository-side public/enrollment/outcome/role/availability enforcement, explicit management mode, server-filtered catalog, and fail-closed list/direct reads verified. |
| CONTENT-02 | Rule-based learning sequence | P02 | VERIFIED | P02-W01/W06/P02-REV: immutable path contracts/CRUD plus deterministic weakest-first recommendation, structured weak/strong/new-content reasons, semantic tie-breaks, completed/locked exclusion, and inspector consumption verified. |
| QUESTION-01 | Question types, answers, tags, difficulty, outcome relation | P03 | TODO | - |
| QUESTION-02 | Published question versioning | P03 | TODO | - |
| BLUEPRINT-01 | Blueprint distributions and constraints | P04 | TODO | - |
| BLUEPRINT-02 | Automatic selection and missing coverage | P04 | TODO | - |
| SESSION-01 | Timed navigation, marking, autosave, reconnect | P05 | TODO | - |
| SESSION-02 | Token and one-active-session rule | P05 | TODO | - |
| GRADING-01 | Objective and rubric grading | P06 | TODO | - |
| GRADING-02 | Score reason and re-evaluation history | P06 | TODO | - |
| ADAPT-01 | Mastery computation from answers/difficulty/repetition | P07 | TODO | - |
| ADAPT-02 | Recommendation reason | P07 | TODO | - |
| ANALYTICS-01 | Heatmap, trend, item metrics, cohort comparison | P07 | TODO | - |
| ANALYTICS-02 | Minimum cohort privacy rule | P07 | TODO | - |
| TECH-01 | See 02-architecture-and-technical.md TECH-01 | P00-P08 | VERIFIED | Phase 00 exit review: Angular 20.3 standalone strict workspace, 32 tests, production build, architecture tree, and live startup smoke passed 2026-08-04. |
| TECH-02 | See 02-architecture-and-technical.md TECH-02 | P00-P08 | IN_PROGRESS | P00-W04/P02-W01: immutable global state and normalized learning-domain feature state use readonly Signals/computed selectors; typed async CRUD/list workflows use RxJS and stale responses cannot replace newer loads. Other feature stores remain. |
| TECH-03 | See 02-architecture-and-technical.md TECH-03 | P00-P08 | TODO | - |
| TECH-04 | See 02-architecture-and-technical.md TECH-04 | P00-P08 | VERIFIED | Phase 00 exit review: deterministic mock latency, service failure, unauthorized, conflict, and selective retry scenarios remain covered in the 32-test passing suite. |
| TECH-05 | See 02-architecture-and-technical.md TECH-05 | P00-P08 | IN_PROGRESS | P01-W04/P01-REV: reusable search, repeated multi-filter, sort, page, reset, malformed-input normalization, and history restoration round-trip through URL state; server-backed pagination/list simulation remains feature work. |
| TECH-06 | See 02-architecture-and-technical.md TECH-06 | P00-P08 | IN_PROGRESS | P01-W01-W05/P01-REV: deny-by-default route/action/data policies feed root and child canMatch guards, capability menus, and immutable pre-render row filtering; malformed runtime data targets deny without throwing. Real feature action enforcement remains later. |
| TECH-07 | See 02-architecture-and-technical.md TECH-07 | P00-P08 | TODO | - |
| TECH-08 | See 02-architecture-and-technical.md TECH-08 | P00-P08 | TODO | - |
| TECH-09 | See 02-architecture-and-technical.md TECH-09 | P00-P08 | IN_PROGRESS | P02-W01/W02/W04/W05/P02-REV: normalized keyed state, memoized tracked filters, lazy routes, batched graph replacement, bounded one-hop graph focus/restore, server-like content requests, stale cancellation, and bounded catalog rows verified; later large feature lists remain. |
| TECH-10 | See 02-architecture-and-technical.md TECH-10 | P00-P08 | IN_PROGRESS | P00/P01/P02/P02-REV: 138 passing tests cover foundations, authorization/scope, repository/store/editor behavior, cycle and recommendation rules, graph/catalog request states, fail-closed content access, route loading, and failed-write preservation; later business rules remain. |
| TECH-11 | See 02-architecture-and-technical.md TECH-11 | P00-P08 | TODO | - |
| TECH-12 | See 02-architecture-and-technical.md TECH-12 | P00-P08 | IN_PROGRESS | P01-W03/W04/P01-REV/P02-W02/W04/W05/P02-REV: shell and learning screens provide keyboard-native controls, focus/live feedback, graph focus/restore, ARIA request semantics, non-color cues, and semantic alternatives; later feature screens remain. |
| TECH-13 | See 02-architecture-and-technical.md TECH-13 | P00-P08 | IN_PROGRESS | P01-W03/W04/P01-REV/P02-W04/W05/P02-REV: reference-aligned shell and learning screens passed 1440x900 desktop plus 390x844 narrow gates; the reviewed outcome map had no narrow page overflow and defaulted to its list alternative. |
| TECH-14 | See 02-architecture-and-technical.md TECH-14 | P00-P08 | VERIFIED | P01-W02/P01-REV/P02-REV: eager public denial remains outside the protected lazy boundary; root/child map policies agree for instructor, program manager, and platform administrator while unrelated roles remain denied. |
| TECH-15 | See 02-architecture-and-technical.md TECH-15 | P00-P08 | IN_PROGRESS | P01-W04/P01-REV/P02-W04/W05/P02-REV: URL-source-of-truth state covers shared lists, OutcomeGraph, and catalog filters; valid graph course deep links survive async reference-data loading and invalid values canonicalize without feedback loops. |
| CMP-01 | See 02-architecture-and-technical.md CMP-01 | P02-P07 | VERIFIED | P02-W03/W04/P02-REV: OutcomeGraph renders real directed relations, mirrors selection in an accessible table/inspector, bounds focus to a one-hop neighborhood, edits through the facade with expected-version protection, and surfaces cycle/conflict failures. |
| CMP-02 | See 02-architecture-and-technical.md CMP-02 | P02-P07 | TODO | - |
| CMP-03 | See 02-architecture-and-technical.md CMP-03 | P02-P07 | TODO | - |
| CMP-04 | See 02-architecture-and-technical.md CMP-04 | P02-P07 | TODO | - |
| CMP-05 | See 02-architecture-and-technical.md CMP-05 | P02-P07 | TODO | - |
| CMP-06 | See 02-architecture-and-technical.md CMP-06 | P02-P07 | TODO | - |
| CMP-07 | See 02-architecture-and-technical.md CMP-07 | P02-P07 | TODO | - |
| CMP-08 | See 02-architecture-and-technical.md CMP-08 | P02-P07 | TODO | - |
| BR-01 | See 03-business-rules.md BR-01 | P02-P07 | VERIFIED | P02-W03: pure deterministic graph validation and repository create/update enforcement reject self, disconnected, and multi-node prerequisite cycles before mutation with a closed path. |
| BR-02 | See 03-business-rules.md BR-02 | P02-P07 | TODO | - |
| BR-03 | See 03-business-rules.md BR-03 | P02-P07 | TODO | - |
| BR-04 | See 03-business-rules.md BR-04 | P02-P07 | TODO | - |
| BR-05 | See 03-business-rules.md BR-05 | P02-P07 | TODO | - |
| BR-06 | See 03-business-rules.md BR-06 | P02-P07 | TODO | - |
| BR-07 | See 03-business-rules.md BR-07 | P02-P07 | TODO | - |
| BR-08 | See 03-business-rules.md BR-08 | P02-P07 | TODO | - |
| BR-09 | See 03-business-rules.md BR-09 | P02-P07 | VERIFIED | P02-W06: completed and locked content IDs are removed before recommendation ranking, cannot reappear through mastery priority, and remaining entries are renumbered contiguously. |
| BR-10 | See 03-business-rules.md BR-10 | P02-P07 | TODO | - |
| BR-11 | See 03-business-rules.md BR-11 | P02-P07 | TODO | - |
| ADV-01 | See 03-business-rules.md ADV-01 | P02/P04/P05/P07 | TODO | - |
| ADV-02 | See 03-business-rules.md ADV-02 | P02/P04/P05/P07 | TODO | - |
| ADV-03 | See 03-business-rules.md ADV-03 | P02/P04/P05/P07 | TODO | - |
| ADV-04 | See 03-business-rules.md ADV-04 | P02/P04/P05/P07 | VERIFIED | P02-W04/P02-REV: computed filters, stable tracking, batched lifecycle-lazy Cytoscape updates, bounded one-hop focus/restore, zoom/fit controls, and a semantic list alternative preserve operation for large outcome sets. |
| ADV-05 | See 03-business-rules.md ADV-05 | P02/P04/P05/P07 | TODO | - |
| ADV-06 | See 03-business-rules.md ADV-06 | P02/P04/P05/P07 | TODO | - |
| AC-01 | See 04-acceptance-and-delivery.md AC-01 | P02-P08 | VERIFIED | P02-W03: prospective outcome writes are cycle-checked before entity/course mutation; cyclic saves/publishes return a validation error with the ordered closed outcome-code path. |
| AC-02 | See 04-acceptance-and-delivery.md AC-02 | P02-P08 | TODO | - |
| AC-03 | See 04-acceptance-and-delivery.md AC-03 | P02-P08 | TODO | - |
| AC-04 | See 04-acceptance-and-delivery.md AC-04 | P02-P08 | TODO | - |
| AC-05 | See 04-acceptance-and-delivery.md AC-05 | P02-P08 | TODO | - |
| AC-06 | See 04-acceptance-and-delivery.md AC-06 | P02-P08 | TODO | - |
| AC-07 | See 04-acceptance-and-delivery.md AC-07 | P02-P08 | TODO | - |
| AC-08 | See 04-acceptance-and-delivery.md AC-08 | P02-P08 | TODO | - |
| AC-09 | See 04-acceptance-and-delivery.md AC-09 | P02-P08 | VERIFIED | P01-W05/P01-REV: live role switching produced exact Student 3, Instructor 5, Measurement 1, Program Manager 2, Observer 1 read-only, and Administrator 0 datasets; denied IDs/text stayed absent, malformed scope targets failed closed, and direct routes remained guarded. |
| AC-10 | See 04-acceptance-and-delivery.md AC-10 | P02-P08 | TODO | - |
| AC-11 | See 04-acceptance-and-delivery.md AC-11 | P02-P08 | IN_PROGRESS | P01-W02-W04/P01-REV: reusable loading, empty, slow, error/retry, and unauthorized patterns plus responsive public denial, scoped dashboard, and Courses empty-state demonstrations passed 1440x900/390x844 gates without console/page errors; main feature screens remain later. |
| AC-12 | See 04-acceptance-and-delivery.md AC-12 | P02-P08 | TODO | - |
| AC-13 | See 04-acceptance-and-delivery.md AC-13 | P02-P08 | TODO | - |
| AC-14 | See 04-acceptance-and-delivery.md AC-14 | P02-P08 | VERIFIED | Phase 00 exit review: production build passed at 227.95 kB initial size; live startup redirected correctly with no console/page errors. |
| DEL-01 | See 04-acceptance-and-delivery.md DEL-01 | P08 | IN_PROGRESS | P00-W01: npm workspace and canonical lockfile prepared in the tracked Git repository; final delivery remains P08. |
| DEL-02 | See 04-acceptance-and-delivery.md DEL-02 | P08 | TODO | - |
| DEL-03 | See 04-acceptance-and-delivery.md DEL-03 | P08 | TODO | - |
| DEL-04 | See 04-acceptance-and-delivery.md DEL-04 | P08 | IN_PROGRESS | P00-W05: immutable related seed catalog establishes report-useful cohort/course/outcome density; attempts, mastery, item metrics, and final demo density remain later phases/P08. |
| DEL-05 | See 04-acceptance-and-delivery.md DEL-05 | P08 | TODO | - |
| DEL-06 | See 04-acceptance-and-delivery.md DEL-06 | P08 | TODO | - |
| DEL-07 | See 04-acceptance-and-delivery.md DEL-07 | P08 | TODO | - |
