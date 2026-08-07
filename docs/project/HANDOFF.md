# Compact Handoff

- Repository state: `origin -> https://github.com/aalibyrm/staj-v2.git`; branch `main` tracking `origin/main`; Phase 06 closed at `09feccb` (`P06-REV`); `P07-W01` verified and pending its own commit/push.
- Architecture: `features/analytics` starts here. `models/mastery.models.ts` holds frozen `MasteryAttempt`/`MasteryOutcomeScore`, `MASTERY_BANDS`, typed `MasteryError` codes, and `masteryBandFor`. `domain/mastery-calculation.ts` is a pure documented selector layer: `MASTERY_DEFAULTS`, validated `resolveMasteryOptions`, `selectOutcomeMastery`, `selectOutcomeMasteryById`, and `selectMasteryByOutcomeId`. It imports only types from question-bank and learning-domain and pulls in no Angular, RxJS, transport, or storage.
- Formula (ADR-017): newest 10 attempts per outcome, ordered by `answeredAt` desc then `questionId` asc; weight = `1/(1+0.15*rank)` x difficulty (easy 0.8, medium 1, hard 1.3) x `0.5^priorSightingsOfSameQuestion`; score = weighted mean of `earnedFraction`, clamped and rounded to 4 decimals; bands developing/approaching/proficient/advanced at 0.4/0.6/0.85 with boundaries in the higher band; an outcome with at least one attempt is measured even at zero credit.
- Seam for P07-W02: `selectMasteryByOutcomeId` returns only measured outcomes and is type-assignable to `LearningPathRecommendationInput.masteryByOutcomeId` with no cast, so the existing `recommendLearningPath` in `features/learning-domain/models/learning-path-recommendation.ts` consumes it directly and its unmeasured branch still applies to outcomes with no attempts.
- Active phase: Phase 07 in progress; no UI packet has started yet
- Active packet: none
- Verified evidence: P07-W01 focused gate passed 34/34 across 2 files; full suite passed 549/549 across 48 files; `npx ng build` exits 0 with no error. Tests cover difficulty weighting being observable, recency order flipping the score across 0.5, repetition damping reporting a nonzero penalty while distinct questions report 0, the 10-attempt window separating `attemptCount` from `consideredCount`, deterministic tie-breaks, band boundaries at 0.4/0.6/0.85, every validation code, unmutated inputs, frozen outputs, and cast-free assignability to `LearningPathRecommendationInput`. No repair round was consumed. No browser gate applies: this packet adds no route or component.
- Open decisions: none; ADR-007 remains realized as direct `cytoscape@3.34.0`
- Known blocker: none. Remaining Phase 07 packets: W02 recommendation engine, W03 learning dashboard (`ui-key: general-overview`), W04 student analytics (`ui-key: analytics`), W05 cohort privacy, W06 item analysis, W07 performance dataset.
- Next: commit and push P07-W01, then start P07-W02 recommendation engine

Maximum target size: 30 lines. Replace stale facts.
