# Delivery Roadmap

Each `/adaptive-next` turn completes at most one verified work packet.

| Phase | Name | Exit gate |
|---|---|---|
| 00 | Bootstrap and core platform | Angular app runs; architecture skeleton, mock transport, test baseline, decisions recorded |
| 01 | Identity, authorization, shell, common states | Role-safe shell matches global UI direction; authorization demonstrated with tests |
| 02 | Courses, outcomes, content, learning path | Cycle prevention and explainable path generation verified |
| 03 | Question bank and versioning | Published edit creates version; old snapshot preserved |
| 04 | Blueprint and exams | Constraint coverage and publish gate verified; no duplicate auto-selection |
| 05 | Session, timer, autosave, offline/conflict | Disconnect/reconnect and stale-version conflict tests pass; late answer rejected |
| 06 | Grading, rubric, audit | Objective/rubric totals, reason rule, history, rollback/audit verified |
| 07 | Recommendation and analytics | Mastery-driven reasons and cohort privacy threshold verified |
| 08 | Hardening and delivery | Production build, critical tests, responsive/a11y states, cross-screen visual consistency, README/demo complete |

## Rule

Do not start the next phase while the current phase has blocker requirements. A requirement may be deferred only with a recorded decision, reason, target phase, and no broken dependency.

## UI rule

Only packets annotated with `ui-key` open a reference image. Each such packet uses one brief and one WebP; later behavior packets reuse recorded decisions instead of reloading the image.
