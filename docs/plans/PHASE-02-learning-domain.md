# Phase 02 - Courses, Outcomes, Content, and Learning Paths

## Requirement groups

OUT-01/02, CONTENT-01/02, CMP-01, BR-01, BR-09, ADV-04, AC-01, TECH-09.

## Work packets

### P02-W01 - Models, repository, facade, store

Course, LearningOutcome, ContentItem, LearningPath; normalized entities, selectors, filters, mock CRUD/state transitions.

### P02-W02 - Outcome list and editor

Reactive Forms, publish status, prerequisite selection, domain validation, loading/error/unauthorized states.

### P02-W03 - Cycle detection rule

Pure graph algorithm and tests. Save/publish blocked with actionable cycle path.

### P02-W04 - OutcomeGraph

UI contract:

- `ui-key`: `outcome-map`
- Brief: `docs/ui/screens/02-outcome-map.md`
- Reference: `docs/ui/reference/02-outcome-map.webp`
- Visual scope: graph canvas, filters, selected-node inspector, risky-node list, responsive list alternative

Filter/focus behavior for hundreds of nodes. Editing delegates to facade. Keyboard-accessible controls or equivalent alternative representation.

### P02-W05 - Courses and content access rules

Courses routes, content metadata, level/duration/format/access conditions, server-like list behavior.

### P02-W06 - Explainable learning path

Rule-based ordering from mastery/lock/completion inputs. Every item includes reason. Completed/locked content excluded.

## Exit gate

Cycle cannot save. Large graph remains usable. Learning path changes with inputs and gives reason. Tests pass.
