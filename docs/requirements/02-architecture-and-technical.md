# Architecture and Technical Requirements

## Required architecture

Feature-based and layered. UI components do not access data sources directly. State, business rules, mapping, and side effects live in facade/repository/use-case layers.

```text
src/app/
  core/
    api/             mock transport, interceptors, error mapping
    auth/            session, role, permissions, guards
    state/           global signals and event bus
    storage/         cache, IndexedDB/local storage adapters
    observability/   audit, telemetry, notifications
  shared/
    components/      table, dialog, filters, timeline, charts
    directives/      permission, debounce, visibility
    validators/      cross-field and domain validators
    utils/           mapper, formatter, rule helpers
  features/adaptive-learning/
    pages/
    components/
    data-access/     facade, repository, API adapters
    state/           feature store, selectors, effects
    models/          entity, dto, enum, filter models
    *.routes.ts
  app.config.ts
  app.routes.ts
```

The harness may split `adaptive-learning` into multiple feature folders when it preserves this layering and route-level lazy loading.

## Technical requirements

| ID | Requirement |
|---|---|
| TECH-01 | Angular 17+ with standalone components. |
| TECH-02 | Angular Signals for state; correct RxJS operators for asynchronous flows. |
| TECH-03 | Reactive Forms with cross-field, async, and domain validators. |
| TECH-04 | Mock API simulates latency, error, unauthorized, conflict, and retry. |
| TECH-05 | Lists simulate server pagination, sorting, multi-filter, and search. |
| TECH-06 | Authorization at route, action, and data-scope levels; not button hiding only. |
| TECH-07 | Optimistic updates roll back and notify on failure. |
| TECH-08 | At least one real-time flow using WebSocket/SSE simulation or RxJS event stream. |
| TECH-09 | Large lists use lazy loading, trackBy, memoized selectors, and virtual scroll when needed. |
| TECH-10 | Unit tests for critical facades, stores/reducers, validators, and business rules. |
| TECH-11 | Component/integration tests for at least two main user flows. |
| TECH-12 | Keyboard operation, focus management, ARIA labels, and non-color status cues. |
| TECH-13 | Responsive desktop, tablet, and narrow-screen layouts. |
| TECH-14 | Route-level lazy loading and no unauthorized feature-bundle access. |
| TECH-15 | Table/chart/report filter state shareable through URL query parameters. |

## Shared components

| ID | Component | Responsibility |
|---|---|---|
| CMP-01 | OutcomeGraph | Edit prerequisite relations and show cycles. |
| CMP-02 | QuestionEditor | Type-specific fields, preview, and validation. |
| CMP-03 | BlueprintConstraintPanel | Compare target and current distributions. |
| CMP-04 | ExamTimer | Safe timer based on synchronized reference time. |
| CMP-05 | AutosaveIndicator | Saving, saved, offline, conflict, error states. |
| CMP-06 | RubricGrader | Criterion scoring, comments, total calculation. |
| CMP-07 | MasteryHeatmap | Outcome/time mastery visualization. |
| CMP-08 | RecommendationReasonCard | Inputs and decision rationale. |
