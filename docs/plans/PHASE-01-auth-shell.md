# Phase 01 - Identity, Authorization, Shell, and Common States

## Requirement groups

ROLE-01..06, TECH-05, TECH-06, TECH-12..15, AC-09, AC-11.

## Work packets

### P01-W01 - Session, role, permission model

- Demo accounts for six roles.
- Session signal store and permission policy functions.
- Route, action, and data-scope decisions are separately testable.

### P01-W02 - Guards and lazy feature access

- Route guards prevent unauthorized route and bundle access.
- Redirect/unauthorized page and return-url behavior.

### P01-W03 - Application shell and role switcher

UI contract:

- `ui-key`: `general-overview`
- Brief: `docs/ui/screens/01-general-overview.md`
- Reference: `docs/ui/reference/01-general-overview.webp`
- Visual scope: global sidebar, top bar, page frame, responsive shell; dashboard business widgets remain placeholders

- Responsive navigation and role-aware menus.
- Keyboard/focus baseline and non-color status cues.

### P01-W04 - Reusable request/list states

UI guidance: reuse `general-overview` shell decisions from `HANDOFF.md`; do not reload image unless Sol records missing visual evidence.

- Loading, empty, slow, error, retry, unauthorized components/patterns.
- Query-param synchronization for search/filter/sort/page.

### P01-W05 - Data-scope demonstration

- One student/instructor/program/observer scenario proves row-level filtering.
- Unit/component tests prevent unauthorized data leakage.

## Exit gate

Role switching changes routes, actions, and visible dataset. Direct URL access is protected. Required tests pass.
