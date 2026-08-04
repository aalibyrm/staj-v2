# Architecture Decisions

| ID | Decision | Status | Reason/evidence |
|---|---|---|---|
| ADR-001 | Angular 17+ standalone, strict, route-level lazy loading | ACCEPTED | PDF requirement |
| ADR-002 | Feature-based layered architecture; no UI direct data access | ACCEPTED | PDF requirement |
| ADR-003 | Signals for state/derived values; RxJS for async flows | ACCEPTED | PDF requirement |
| ADR-004 | Rule-based explainable recommendation; no real AI dependency | ACCEPTED | PDF scope |
| ADR-005 | npm package manager | ACCEPTED | No lockfile exists, so Phase 00 default applies. Alternatives: pnpm, Yarn, Bun. Consequences: `package-lock.json` is canonical and gates use `npm`. Accepted 2026-08-04. |
| ADR-006 | Angular CDK primitives plus project-owned custom UI | ACCEPTED | Supports UI-SPEC tokens and reusable accessible shell/table/drawer/form patterns without copying screenshot styling. Alternatives: themed Angular Material, custom Angular only. Consequences: CDK provides behavior; shared project components own visual language. Accepted 2026-08-04. |
| ADR-007 | Cytoscape.js outcome graph | ACCEPTED | Supports hundreds of nodes, layouts, zoom, fit, focus, filtering, and selection. Alternatives: D3 modules, custom SVG. Consequences: dependency is deferred until the outcome-graph packet and requires an accessible list alternative. Accepted 2026-08-04. |
| ADR-008 | Apache ECharts analytics charts | ACCEPTED | Covers dense analytics and lazy rendering. Alternatives: Chart.js, custom SVG. Consequences: dependency is deferred until the analytics packet; every chart requires textual/table equivalence. Accepted 2026-08-04. |
| ADR-009 | Vitest with Angular TestBed | ACCEPTED | Fast unit/component execution with Angular-native TestBed coverage. Alternatives: Karma/Jasmine, Jest/TestBed. Consequences: bootstrap exposes deterministic `npm test` and later integration tests use real observable flows. Accepted 2026-08-04. |
| ADR-010 | Native IndexedDB storage adapter with injectable in-memory fallback | ACCEPTED | Preserves ordered durable replay without a runtime storage dependency and remains deterministic in tests. Alternatives: Dexie, localStorage. Consequences: adapter owns schema/versioning and falls back explicitly when IndexedDB is unavailable. Accepted 2026-08-04. |
| ADR-011 | GitHub repository `aalibyrm/staj-v2`, branch `main`; one verified packet per commit/push | ACCEPTED | User instruction; safe traceable delivery |
| ADR-012 | Mechanical commits use Luna Low `adaptive-committer`; no force push/history rewrite | ACCEPTED | Token savings and Git safety |
| ADR-013 | Eight generated UI screens are accepted as visual direction; PDF/domain rules override images | ACCEPTED | User instruction; avoids UI ambiguity without changing acceptance criteria |
| ADR-014 | UI references stored as optimized 1280x800 WebP; one image per UI packet | ACCEPTED | Lower repository and image-context cost; screen briefs preserve semantics |
| ADR-015 | Original project PDF retained under `docs/source/`; normalized requirement files used in daily packets | ACCEPTED | Self-contained audit trail with progressive disclosure |
| ADR-016 | Greenfield Angular repository | ACCEPTED | Inspection found no `package.json`, Angular workspace files, lockfile, or `src/`. Alternative: normalize an existing project. Consequences: P00-W01 creates the strict standalone workspace in place without replacing harness files. Accepted 2026-08-04. |

New decisions require ID, status, reason, alternatives, consequences, and date/commit when known.
