# Git and GitHub Workflow

## Repository

- Remote name: `origin`
- Remote URL: `https://github.com/aalibyrm/staj-v2.git`
- Primary branch: `main`
- History policy: no force push, no automatic rebase, no automatic merge conflict resolution

## Ownership

- `adaptive-builder`: application code/tests only; never stage, commit, push, pull, merge, or change remotes.
- Sol: verifies diff and gates; selects exact paths and commit message.
- `adaptive-committer`: Luna Low mechanical Git worker; stages only Sol-approved paths, commits once, pushes safely.

## Commit cadence

1. Initial harness setup: one commit and push.
2. Each verified work packet: one commit and push.
3. Failed or partially verified packet: no commit.
4. Phase audit findings are committed only after fixes pass verification.

## Commit message

Format:

```text
<type>(<scope>): <imperative summary> [<packet-id>]
```

Allowed types: `feat`, `fix`, `test`, `refactor`, `docs`, `chore`.

Examples:

```text
chore(harness): initialize adaptive education workflow [P00-W00]
feat(core): bootstrap Angular application shell [P00-W01]
fix(exam-session): preserve queued answers after reconnect [P05-W04]
test(grading): cover rubric score recalculation [P06-W03]
```

## Commit gate

Commit only when all are true:

- Sol verified allowed paths.
- Relevant tests/checks passed.
- Requirement IDs and state files reflect verified reality.
- No unrelated staged file exists.
- No secret or generated output is included.

## Push failure

On non-fast-forward, authentication, branch-protection, or network failure:

- keep local commit;
- do not force push;
- record blocker in `docs/project/STATE.md` and `HANDOFF.md`;
- stop current turn.
