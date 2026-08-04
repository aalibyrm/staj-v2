# Phase 06 - Grading, Rubric, Re-evaluation, and Audit

## Requirement groups

GRADING-01/02, CMP-06, BR-07/08/11, AC-06/10/12/13, TECH-07.

## Work packets

### P06-W01 - Objective scoring rules

Correct answer and partial-credit rule; pure scoring functions and tests.

### P06-W02 - Rubric model and RubricGrader

UI contract:

- `ui-key`: `rubric-grading`
- Brief: `docs/ui/screens/06-rubric-grading.md`
- Reference: `docs/ui/reference/06-rubric-grading.webp`
- Visual scope: response preview, rubric matrix, total/feedback, grading sidebar, responsive criterion cards

Criteria/levels/comments, total selector, Reactive Form validation, keyboard/focus behavior.

### P06-W03 - Grading workflow

Pending/partial/graded/re-evaluated states; permission/data scope; attempt detail route.

### P06-W04 - Score-change reason and history

Mandatory reason, old/new value, actor/time, re-evaluation timeline.

### P06-W05 - Optimistic update and rollback

Simulated failure restores prior score and notifies user. Test success and rollback.

### P06-W06 - Audit log

UI contract:

- `ui-key`: `audit-log`
- Brief: `docs/ui/screens/08-audit-log.md`
- Reference: `docs/ui/reference/08-audit-log.webp`
- Visual scope: filters, summary, audit table, read-only detail drawer, pagination/export

Filterable by type/user/time/target; readable old/new values; query-param state.

## Exit gate

Rubric total correct. Reason cannot be bypassed. Rollback and audit events verified.
