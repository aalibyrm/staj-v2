# Phase 05 - Exam Session, Timer, Autosave, Offline, and Conflict

## Requirement groups

SESSION-01/02, CMP-04/05, BR-04/05/06, ADV-01/02/05, AC-04/05/10.

## Work packets

### P05-W01 - Session state machine and token rule

Created/active/disconnected/reconnecting/submitted/expired/terminated; one active session per student+exam; invalid transition tests.

### P05-W02 - Reference-time timer

Server/reference offset model, deadline selector, inactive-tab/device-clock resilience, warning and expiry behavior.

### P05-W03 - Exam navigation and answer drafts

UI contract:

- `ui-key`: `exam-session`
- Brief: `docs/ui/screens/05-exam-session.md`
- Reference: `docs/ui/reference/05-exam-session.webp`
- Visual scope: student header, question navigator, question/answer area, summary/actions, responsive collapse

Navigation, mark-for-review, answer state, late-answer rejection, accessibility/focus behavior.

### P05-W04 - Autosave protocol

UI guidance: reuse P05-W03 layout; add saving/saved/error and aria-live status from screen brief without reloading image.

Versioned AnswerDraft, saving/saved/error states, retry policy, deterministic mock delays/errors.

### P05-W05 - Offline queue and ordered replay

UI guidance: apply offline/reconnecting queue states from screen brief and `UI-SPEC.md`; no image read by default.

Storage-backed queue, reconnect detection/event stream, ordered idempotent synchronization, data-loss tests.

### P05-W06 - Multi-tab/version conflict

Stale version returns conflict. UI explains local/server choices; never silently overwrites.

### P05-W07 - Integration flow

Start session -> answer -> disconnect -> queue -> reconnect -> sync -> submit/expire. Component/integration test.

## Exit gate

AC-04/05 automated. Conflict and offline states visible. No client-clock trust. Critical tests pass.
