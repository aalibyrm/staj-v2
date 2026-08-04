# Acceptance, Evaluation, and Delivery

## Acceptance criteria

| ID | Criterion |
|---|---|
| AC-01 | Outcome graph blocks saving a cyclic prerequisite. |
| AC-02 | Editing a published question creates a new version; existing exams retain old snapshot. |
| AC-03 | Blueprint constraints and missing coverage are clear. |
| AC-04 | Autosave resumes after disconnection without data loss. |
| AC-05 | Reference-time timer ends correctly and rejects late answers. |
| AC-06 | Rubric scores calculate total correctly. |
| AC-07 | Recommendations change with mastery and show reasons. |
| AC-08 | Reports below cohort privacy threshold hide detail. |
| AC-09 | Role and data scope apply at student/instructor/program levels. |
| AC-10 | Critical autosave, grading, and recommendation tests pass. |
| AC-11 | Main screens demonstrate responsive, empty, slow, error, and unauthorized states. |
| AC-12 | Critical actions require confirmation and mandatory reason when applicable. |
| AC-13 | Audit shows type, user, time, target, and readable old/new values. |
| AC-14 | Production build succeeds with no critical console error. |

## Evaluation weights

| ID | Category | Points |
|---|---|---:|
| EVAL-01 | Functional depth | 18 |
| EVAL-02 | Architecture and state management | 15 |
| EVAL-03 | Business rules and data integrity | 15 |
| EVAL-04 | Advanced scenarios | 12 |
| EVAL-05 | UI/UX and accessibility | 12 |
| EVAL-06 | Testing, error handling, performance | 13 |
| EVAL-07 | Delivery discipline | 15 |

## Delivery requirements

| ID | Requirement |
|---|---|
| DEL-01 | Deliver a Git repository or clean source package. |
| DEL-02 | README includes purpose, roles, setup, run/test commands, architecture decisions, and demo accounts. |
| DEL-03 | Demo video shows main workflow, role differences, at least one error/rollback, report screen, and audit history. |
| DEL-04 | Demo dataset is realistic, related, and dense enough for reports. |
| DEL-05 | No secrets, unnecessary logs, unused files, unfinished screens, or unexplained hard-coded rules. |
| DEL-06 | Known gaps and technical decisions are documented briefly. |
| DEL-07 | Critical operations include confirmation and required reason where applicable. |
