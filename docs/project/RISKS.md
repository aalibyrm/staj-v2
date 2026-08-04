# Risks

| ID | Risk | Mitigation | Status |
|---|---|---|---|
| R-01 | Project scope too large for one-shot implementation | Phase gates; one verified work packet per turn | OPEN |
| R-02 | Luna Max burns tokens on repeated exploration | Compact handoff; path-bounded tasks; read summaries | OPEN |
| R-03 | Parallel workers duplicate context or conflict | Default concurrency 1; optional profile only for disjoint files | CONTROLLED |
| R-04 | Versioning/autosave rules implemented as UI-only behavior | Pure domain rules, state machines, and automated tests | OPEN |
| R-05 | Demo data too sparse for analytics | Deterministic related seed factory from Phase 00 | OPEN |
| R-06 | Accessibility/performance deferred until end | Add per-phase checks plus final sweep | OPEN |
| R-07 | Library version incompatibility | Record dependency decision; install only after verification | OPEN |
