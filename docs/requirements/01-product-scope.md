# Product Scope

## Purpose

Build an Angular 17+ advanced frontend platform that recommends content/questions from student outcome performance, manages exam sessions, analyzes question quality, and presents learning analytics.

Real AI is not required. Recommendation must be explainable and rule-based.

## Scope expectations

- Outcome/prerequisite map
- Content prerequisites and learning path
- Question bank and versioning
- Exam blueprint and builder
- Timed exam session and answer autosave
- Adaptive recommendations
- Teacher grading and rubric
- Cohort comparison and item analysis
- Audit history
- Complete data flow, business rules, authorization, error handling, and tests
- State machines, bulk operations, exception paths, and transaction history beyond basic CRUD
- Dense, related demo data supporting meaningful reports
- Loading, success, empty, validation, error, retry, and unauthorized states for critical operations

## Roles

| ID | Role | Expected behavior |
|---|---|---|
| ROLE-01 | Student | Uses assigned courses, adaptive study plan, and exam sessions. |
| ROLE-02 | Instructor | Manages content, questions, rubrics, grading, and student progress. |
| ROLE-03 | Measurement Specialist | Reviews item quality, blueprint, difficulty, and discrimination analytics. |
| ROLE-04 | Program Manager | Manages outcome map, program, cohort, and publishing workflows. |
| ROLE-05 | Observer | Read-only reports for authorized cohorts. |
| ROLE-06 | Platform Administrator | Manages roles, permissions, terms, and system parameters. |

## Main modules

### Outcomes and prerequisite map

- Manage outcomes by course, level, and prerequisite relationships in graph view.
- Reject cycles and unpublished linked outcomes where required.

### Content and learning path

- Store outcome, level, duration, format, and access conditions.
- Build a rule-based sequence from strong/weak outcomes.

### Question bank and versioning

- Manage type, choices, correct answer, explanation, tags, difficulty, outcome relation, and points.
- Published questions cannot be edited in place; create a new version.

### Exam blueprint and builder

- Define outcome, difficulty, question-type, and point-distribution constraints.
- Select questions automatically without duplicates and show missing coverage.

### Exam session and autosave

- Handle duration, navigation, marking, autosave, disconnection, reconnection, session token, and one-active-session rule.

### Grading and rubric

- Auto-grade objective questions; grade open responses with rubrics.
- Score changes require reason and preserve re-evaluation history.

### Adaptive recommendation

- Calculate mastery from recent answers, difficulty, and repetition count.
- Every recommendation displays why it was made.

### Learning analytics

- Outcome heatmap, progress trend, item quality metrics, and cohort comparison.
- Minimum cohort rule prevents personal-data disclosure in small groups.

## Routes

- `/learning/dashboard`
- `/courses`
- `/courses/:id/path`
- `/outcomes`
- `/outcomes/map`
- `/question-bank`
- `/questions/:id`
- `/exam-builder`
- `/exams`
- `/exam-session/:token`
- `/grading`
- `/grading/:attemptId`
- `/student/:id/analytics`
- `/cohort-analytics`
- `/item-analysis`
- `/audit-log`

## Required data models

Main models include `id`, `createdAt`, `updatedAt`, `version`, and appropriate status fields. Derived values should come from one computation/selector layer.

| Model | Purpose |
|---|---|
| Course | Course, term, instructor, publish state |
| LearningOutcome | Outcome, level, prerequisites |
| ContentItem | Content type, duration, outcome, access rule |
| LearningPath | Ordered recommendation and reasons |
| Question | Stem, type, point, outcome, version |
| QuestionVersion | Published snapshot and change note |
| ExamBlueprint | Outcome/difficulty/type/point distribution |
| Exam | Duration, rules, questions, publish state |
| ExamSession | Token, start, remaining time, connection, state |
| AnswerDraft | Answer, autosave version, sync state |
| Attempt | Student result, score, state |
| Rubric | Criteria, levels, point descriptions |
| MasteryScore | Outcome mastery and calculation inputs |
| Recommendation | Content/question and explainable reason |
| ItemAnalysis | Difficulty, discrimination, option analysis |
| AuditEvent | Publish, score, session, authorization history |
