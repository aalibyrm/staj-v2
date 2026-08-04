# Phase 00 - Bootstrap and Core Platform

## Objective

Create or normalize the Angular 17+ standalone project and establish architecture, mock infrastructure, testing, and realistic seed-data foundations.

## Decision gate

Record in `DECISIONS.md` before dependency installation:

- Existing vs greenfield repository
- Package manager from lockfile; default npm only when none exists
- UI component strategy compatible with `docs/ui/UI-SPEC.md` and shared shell/table/drawer/form patterns
- Graph rendering strategy
- Chart rendering strategy
- Test runner/component-test approach
- Browser storage choice for offline answer queue

Sol may infer from an existing repository. Otherwise ask one grouped question with recommendations and cost.

## Work packets

### P00-W01 - Repository bootstrap

- Create/validate Angular 17+ standalone strict project, routing, styles, Git baseline.
- Add only accepted dependencies. Screenshot appearance alone cannot justify a dependency.
- Establish scripts for start, build, test.
- Gate: dependency install, unit-test smoke, production build.

### P00-W02 - Layered folder and route skeleton

- Create core/shared/feature structure.
- Add lazy route placeholders for all required routes without full feature implementation.
- Components do not access data source directly.
- Gate: route compilation and navigation smoke.

### P00-W03 - Mock transport and errors

- Mock request/response abstraction.
- Deterministic controls for latency, service error, unauthorized, conflict, retry.
- Central error mapping and notifications contract.
- Unit tests for scenario controls.

### P00-W04 - State, storage, observability foundation

- Global signal/event pattern.
- Storage adapters with in-memory fallback.
- Audit/telemetry/notification contracts.
- No feature business logic yet.

### P00-W05 - Seed-data foundation

- Related IDs, terms, courses, roles, cohorts, students, outcomes.
- Deterministic seed factory suitable for later reports.
- Avoid isolated placeholder records.

## Exit gate

- Project starts and production build passes.
- Test command passes.
- Architecture tree exists.
- Mock failures can be selected deterministically in tests.
- Decisions and first evidence rows updated.
