# Phase 04 - Exam Blueprint and Publishing

## Requirement groups

BLUEPRINT-01/02, CMP-03, BR-02/03, ADV-03, AC-03.

## Work packets

### P04-W01 - Blueprint model and constraint editor

Outcome, difficulty, type, count/point distribution; Reactive Form and domain validators.

### P04-W02 - Constraint comparison panel

UI contract:

- `ui-key`: `exam-builder`
- Brief: `docs/ui/screens/04-exam-builder.md`
- Reference: `docs/ui/reference/04-exam-builder.webp`
- Visual scope: stepper, blueprint matrix, validation summary, settings panel shell

Target/current distribution, missing/excess coverage, clear non-color indicators.

### P04-W03 - Automatic selection algorithm

Deterministic, no duplicate question, attempts all constraints, returns selected set plus unmet reasons. Pure tests cover insufficient bank.

### P04-W04 - Exam draft/version/publish workflow

UI guidance: reuse P04-W02 exam-builder decisions; focus on state/validation behavior, not re-reading the image.

Duration, rules, question-version snapshots, publish status, immutable published exam.

### P04-W05 - Publish gate and audit

Cannot publish until blueprint valid. Confirm and audit event on publish/version override.

## Exit gate

Auto-selection never duplicates. Missing coverage is explicit. Invalid blueprint cannot publish. Tests pass.
