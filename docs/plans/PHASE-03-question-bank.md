# Phase 03 - Question Bank and Versioning

## Requirement groups

QUESTION-01/02, CMP-02, BR-02, AC-02, TECH-03/05/10/15.

## Work packets

### P03-W01 - Question domain and list

UI contract:

- `ui-key`: `question-bank`
- Brief: `docs/ui/screens/03-question-bank.md`
- Reference: `docs/ui/reference/03-question-bank.webp`
- Visual scope: filter/status bar, question table, selection, inspector preview, pagination

Types, options, correct answer, explanation, tags, difficulty, points, outcome relation, publish state, pagination/filter/search/query params.

### P03-W02 - QuestionEditor

UI guidance: reuse the `question-bank` inspector/form component language recorded after P03-W01. Do not reload the image by default.

Type-specific Reactive Form controls, preview, cross-field/domain validation, accessible errors.

### P03-W03 - Publish and version workflow

Published entity immutable. Edit creates QuestionVersion snapshot/change note and new editable version.

### P03-W04 - Snapshot retention test

Existing exam reference remains on prior question version after a new version is created.

### P03-W05 - Bulk operations and exception states

Tag/status operations with partial-failure reporting, confirm dialog, permission checks, and audit hooks.

## Exit gate

AC-02 proven by automated test. List states and authorization work. Production build passes.
