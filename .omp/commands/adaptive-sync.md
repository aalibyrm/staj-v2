---
name: adaptive-sync
description: Commit and push the current verified packet without starting new implementation work.
---

Follow `AGENTS.md` and `docs/project/GIT-WORKFLOW.md`.

Read `docs/project/STATE.md` and `docs/project/HANDOFF.md`. Inspect Git status and last verification evidence. Do not edit application code and do not start a worker.

If current changes are not fully verified, stop and list the missing gate. Otherwise build an exact path allowlist, choose a conventional commit message containing the active packet ID, and delegate one `packet` task to `adaptive-committer`.

After successful push, record the commit SHA in `STATE.md` and `HANDOFF.md`. If recording produces a new change, include those files in the same commit when possible; otherwise make one bounded follow-up `docs(state)` commit. Stop after synchronization.
