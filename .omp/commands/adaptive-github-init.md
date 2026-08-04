---
name: adaptive-github-init
description: Safely connect this project to aalibyrm/staj-v2, create the initial harness commit, and push main.
---

Follow `AGENTS.md` and read `docs/project/GIT-WORKFLOW.md`, `MANIFEST.md`, `docs/project/STATE.md`, and `docs/project/HANDOFF.md`.

Expected repository:

- remote: `origin`
- URL: `https://github.com/aalibyrm/staj-v2.git`
- branch: `main`

Inspect only first. Then:

1. Confirm Git is installed.
2. Initialize Git only if `.git` is absent.
3. Set current branch to `main`.
4. Add `origin` when absent. If present with another URL, stop and report; do not silently replace it.
5. Confirm `user.name` and `user.email` exist. If absent, stop with exact commands user must run.
6. Check remote state with `git ls-remote origin` and `git fetch origin main` when the branch exists.
7. If remote contains history not present locally, stop. Never overwrite or auto-merge.
8. Verify harness using the platform script.
9. Delegate one `initial` task to `adaptive-committer`. Allowed paths come from `MANIFEST.md`, plus `.gitignore` and `MANIFEST.md`.
10. Commit message: `chore(harness): initialize adaptive education workflow [P00-W00]`.
11. Push to `origin/main` and set upstream.
12. Update `STATE.md` and `HANDOFF.md` with remote, branch, and commit only after push succeeds. If those state updates occur after the first commit, create one small follow-up docs commit through `adaptive-committer`.

Do not start Angular bootstrap in this turn.
