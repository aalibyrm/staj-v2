# Phase 08 - Hardening and Delivery

## Requirement groups

All AC, EVAL-01..07, DEL-01..07, unresolved TECH items.

## Work packets

### P08-W01 - Acceptance matrix sweep

Run each AC scenario; mark evidence path/test. No prose-only verification for critical rules.

### P08-W02 - Error/state sweep

Every main route demonstrates empty, slow, error, retry, unauthorized, and responsive behavior as applicable. Use screen briefs, not all images, for route-level checks.

### P08-W03 - Accessibility sweep

Keyboard, focus, ARIA, non-color state, dialog focus return, timer/autosave announcements. Verify chart/heatmap alternatives and exam-session live regions.

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
