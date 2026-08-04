# Phase 07 - Adaptive Recommendation and Analytics

## Requirement groups

ADAPT-01/02, ANALYTICS-01/02, CMP-07/08, BR-09/10, ADV-06, AC-07/08/10.

## Work packets

### P07-W01 - Mastery calculation

One pure calculation/selector layer using recent answers, difficulty, and repetition. Document formula and boundaries; unit tests.

### P07-W02 - Recommendation engine

Rule-based ranking, eligibility, completed/locked exclusion, stable reason codes and human explanation.

### P07-W03 - Learning dashboard and reason card

UI contract:

- `ui-key`: `general-overview`
- Brief: `docs/ui/screens/01-general-overview.md`
- Reference: `docs/ui/reference/01-general-overview.webp`
- Visual scope: real dashboard widgets inside previously established shell; role/data-scope variants

Adaptive plan, weak/strong outcomes, RecommendationReasonCard, all request states.

### P07-W04 - Student analytics

UI contract:

- `ui-key`: `analytics`
- Brief: `docs/ui/screens/07-analytics.md`
- Reference: `docs/ui/reference/07-analytics-recommendations.webp`
- Visual scope: filters, KPI cards, trend, heatmap/table alternative, recommendation panel

MasteryHeatmap, progress trend, memoized selectors, lazy chart rendering.

### P07-W05 - Cohort analytics and privacy

UI guidance: reuse P07-W04 layout. Add privacy-threshold blocked state and scoped tables without reloading image.

Minimum cohort threshold before any individual comparison. Tests cover threshold boundary and data scope.

### P07-W06 - Item analysis

Difficulty, discrimination, option analysis with filters/query params and role permissions.

### P07-W07 - Performance dataset

Dense related records; measure selectors/render behavior and avoid eager chart work.

## Exit gate

Mastery input changes recommendation. Every recommendation has reason. Privacy boundary test passes. Performance safeguards present.
