# Business Rules and Advanced Scenarios

## Mandatory business rules

| ID | Rule |
|---|---|
| BR-01 | Outcome prerequisite graph cannot contain a cycle. |
| BR-02 | Published question or exam cannot be edited directly; create a new version. |
| BR-03 | Exam cannot publish until blueprint targets are met. |
| BR-04 | A student cannot open multiple active sessions for the same exam. |
| BR-05 | Exam duration derives from synchronized reference time, not client clock. |
| BR-06 | Stale autosave never silently overwrites a newer answer; show conflict. |
| BR-07 | Objective score follows configured correct answer and partial-credit rules. |
| BR-08 | Rubric score change requires a reason. |
| BR-09 | Recommendation excludes completed or locked content. |
| BR-10 | Cohort report below minimum student count hides individual comparison. |
| BR-11 | Publish, score change, session termination, and override create audit events. |

## Advanced scenarios

| ID | Scenario |
|---|---|
| ADV-01 | During disconnection, queue answers locally and synchronize in order after reconnect. |
| ADV-02 | If two tabs change the same answer, explain the version conflict to the user. |
| ADV-03 | Blueprint auto-selection attempts all constraints without reusing a question. |
| ADV-04 | Outcome graph remains usable with hundreds of nodes through filtering and focus view. |
| ADV-05 | Timer is unaffected by inactive tab or device-clock changes. |
| ADV-06 | Large-data analytics use memoization and lazy chart rendering. |

## State-machine expectation

Critical entities need explicit states and valid transitions, not scattered booleans. At minimum cover:

- Question/exam draft -> published -> versioned/archived
- Exam session created -> active -> disconnected/reconnecting -> submitted/expired/terminated
- Answer draft local -> saving -> saved/offline/conflict/error
- Grading pending -> partially graded -> graded -> re-evaluated
- Recommendation eligible -> suggested -> completed/locked/excluded

Invalid transitions must produce a domain error and user-facing feedback.
