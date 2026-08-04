# Architecture Decisions

| ID | Decision | Status | Reason/evidence |
|---|---|---|---|
| ADR-001 | Angular 17+ standalone, strict, route-level lazy loading | ACCEPTED | PDF requirement |
| ADR-002 | Feature-based layered architecture; no UI direct data access | ACCEPTED | PDF requirement |
| ADR-003 | Signals for state/derived values; RxJS for async flows | ACCEPTED | PDF requirement |
| ADR-004 | Rule-based explainable recommendation; no real AI dependency | ACCEPTED | PDF scope |
| ADR-005 | Package manager | PENDING | Infer from lockfile or ask once |
| ADR-006 | UI component strategy | PENDING | Choose before Phase 00 dependencies |
| ADR-007 | Outcome graph strategy | PENDING | Must support hundreds of nodes/filter/focus |
| ADR-008 | Chart strategy | PENDING | Must support lazy rendering/accessibility |
| ADR-009 | Component/integration test approach | PENDING | Must cover at least two main flows |
| ADR-010 | Offline queue storage adapter | PENDING | Must support ordered replay and testability |
| ADR-011 | GitHub repository `aalibyrm/staj-v2`, branch `main`; one verified packet per commit/push | ACCEPTED | User instruction; safe traceable delivery |
| ADR-012 | Mechanical commits use Luna Low `adaptive-committer`; no force push/history rewrite | ACCEPTED | Token savings and Git safety |
| ADR-013 | Eight generated UI screens are accepted as visual direction; PDF/domain rules override images | ACCEPTED | User instruction; avoids UI ambiguity without changing acceptance criteria |
| ADR-014 | UI references stored as optimized 1280x800 WebP; one image per UI packet | ACCEPTED | Lower repository and image-context cost; screen briefs preserve semantics |
| ADR-015 | Original project PDF retained under `docs/source/`; normalized requirement files used in daily packets | ACCEPTED | Self-contained audit trail with progressive disclosure |

New decisions require ID, status, reason, alternatives, consequences, and date/commit when known.
