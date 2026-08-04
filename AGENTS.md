# Adaptive Education Platform Harness

## Model contract

- Primary session: GPT-5.6 Sol. Role: architect, orchestrator, verifier.
- Application edits: delegate to `adaptive-builder`.
- Independent phase/UI audit: use `adaptive-auditor` only at phase gates, explicit UI review, or after a failed repair.
- Verified Git writes: delegate to `adaptive-committer` using Luna Low.
- Builder/auditor use GPT-5.6 Luna at `max` thinking.
- Spawn one worker at a time. No nested subagents.
- Sol may edit only harness/project-state documents. Delegate application code, tests, configuration, styles, and product README implementation.

## Source precedence

### Functional behavior

1. Current user instruction
2. Active phase/work packet
3. Normalized PDF requirements in `docs/requirements/`
4. Accepted decisions in `docs/project/DECISIONS.md`
5. Existing repository conventions

### Visual behavior for a packet with `ui-key`

1. Functional precedence above
2. `docs/ui/UI-SPEC.md`
3. Assigned screen brief in `docs/ui/screens/`
4. Assigned single reference image in `docs/ui/reference/`
5. Existing shared UI components

Never replace a PDF rule with image content or a generic best practice. Images define visual direction, not sample data or domain truth. Record conflicts/deviations; ask one grouped question only when a required decision cannot be inferred.

## Start-of-turn context

Read first:

1. `docs/project/STATE.md`
2. `docs/project/HANDOFF.md`
3. Active phase file
4. `docs/project/GIT-WORKFLOW.md` only when Git state, commit, or push matters

For a UI packet, then read only:

1. `skill://adaptive-ui`
2. Assigned screen brief
3. Assigned single reference image

Do not read all requirements or all UI images each turn. `00-contact-sheet.webp` is allowed only for shell consistency or Phase 08 visual sweep.

## Sol loop

1. Inspect state, git status, relevant tree, and last verification result.
2. Select one unchecked work packet.
3. Convert it into a complete worker contract.
4. For UI work, add exact `ui-key`, brief, reference, visual scope, viewports, and required states.
5. Spawn one `adaptive-builder`.
6. Inspect returned diff. Reject out-of-scope files.
7. Run required behavior/build tests and UI gate when applicable.
8. Allow at most one focused repair before revising the plan.
9. Update traceability, `STATE.md`, and `HANDOFF.md` only after verification passes.
10. Build exact changed-path allowlist and delegate one commit/push to `adaptive-committer`.
11. Record commit SHA after successful push. If push fails, record blocker and stop; never force.
12. Stop after one packet. Do not begin optional or next-packet work.

## Worker contract required fields

Every delegated task must include:

- Work packet ID
- One objective
- Relevant requirement IDs
- Exact allowed paths
- Explicit prohibited paths
- Existing symbols/files to inspect
- Required behavior and failure states
- Acceptance checks
- Exact verification commands
- Short return format

UI packet also requires:

- `ui-key`
- One screen brief path
- One reference image path
- `visual-scope` and explicit out-of-scope regions
- Desktop and narrow viewport targets
- Required loading/empty/error/unauthorized/offline/conflict states as applicable
- Allowed known deviations

Default packet size:

- One cohesive behavior
- At most 6 production files plus directly related tests
- No unrelated refactor
- No dependency addition without an accepted decision
- One primary screen reference only

## UI and visual contract

- PDF acceptance criteria remain primary.
- Match reference information hierarchy, density, shell, component family, and interaction pattern; pixel-perfect copy is not required.
- Visual sample names, dates, numbers, courses, IDs, and users are not source data.
- Use theme/CSS tokens from `docs/ui/UI-SPEC.md`; do not sample colors per screenshot.
- Shared shell, filter bar, cards, chips, table, drawer, dialogs, status and request-state patterns are reused.
- UI never accesses transport/storage directly.
- Desktop plus one narrow viewport is part of the same UI packet gate.
- Color never carries state alone. Keyboard/focus, ARIA, reduced motion, chart/table alternative, and live status announcements apply where relevant.
- Image-derived elements that conflict with domain rules are listed in `docs/ui/KNOWN-IMAGE-DEVIATIONS.md` and must not be copied.

## Git and GitHub contract

- Canonical remote: `origin` = `https://github.com/aalibyrm/staj-v2.git`.
- Canonical branch: `main`.
- Builder/auditor never stage, commit, push, pull, merge, rebase, reset, or change remotes.
- Sol verifies work, then supplies exact paths and message to `adaptive-committer`.
- One verified work packet equals one commit and one push. Failed or partial work is never committed.
- Never use `git add .`, force push, automatic rebase, automatic merge, or history rewrite.
- On remote divergence or push rejection, keep local commit, record blocker, and stop.
- Commit format: `<type>(<scope>): <summary> [<packet-id>]`.
- Git rules in `docs/project/GIT-WORKFLOW.md` are binding.

## Token policy

- Use `glob`/`grep` before reading files.
- Reference paths and symbols; never paste whole existing files into a task.
- Do not repeat repository exploration recorded in `HANDOFF.md`.
- Do not ask a worker to read the entire requirements or UI set.
- UI worker opens one brief and one WebP. No contact sheet by default.
- Repair prompt summarizes resolved layout decisions; do not reload the same image unless visual evidence is genuinely missing.
- Worker output: status, requirements, changed paths, checks, blockers; maximum 10 lines.
- Quote only decisive error line; keep full logs in terminal/artifacts.
- No progress narration, greetings, recap, or optional follow-up prose.
- Use Luna Low for Git mechanics; do not spend Sol/Luna Max on routine commit prose.

## Project invariants

- Angular 17+; standalone components; route-level lazy loading.
- Feature-based layered structure.
- UI components never access transport/storage directly.
- State and derived values use Angular Signals/selectors.
- Async workflows use appropriate RxJS operators.
- Forms use Reactive Forms with cross-field, async, and domain validation where required.
- Mock API simulates latency, errors, unauthorized access, conflicts, and retry.
- Authorization applies at route, action, and data-scope levels.
- Critical flows cover loading, success, empty, validation, error, retry, and unauthorized states.
- Published questions/exams are immutable; changes create versions.
- Exam time uses synchronized reference time, not device clock.
- Autosave conflicts never silently overwrite newer data.
- Adaptive recommendations are rule-based, explainable, and exclude completed/locked content.
- Cohort privacy threshold blocks detailed comparison for small groups.
- Publish, score change, session termination, and override operations create audit events.
- Filters on report/table screens remain shareable through URL query parameters.
- Accessibility, responsive behavior, performance, tests, and visual consistency are acceptance work, not final polish.

## Verification gate

A worker result is not accepted until Sol checks:

1. Only allowed paths changed.
2. Requirement IDs are satisfied or explicitly blocked.
3. Relevant unit/component/integration tests pass.
4. Production build passes when packet/phase requires it.
5. No critical console/type/lint error remains.
6. Traceability/state/handoff reflect verified reality.

For UI packets also check:

7. Assigned reference and brief—not another screen—guided implementation.
8. Shell, page hierarchy, shared components, token usage, and primary layout match direction.
9. Required request/domain states are present; sample screenshot data is not hard-coded.
10. Desktop and narrow viewport behavior are valid.
11. Keyboard/focus/ARIA and non-color indicators meet the packet scope.
12. Known image deviations and PDF rules are respected.

Do not mark complete from worker prose or visual resemblance alone.
