---
name: adaptive-next
description: Execute and verify the next incomplete work packet in the active phase, including one-screen UI guidance when assigned.
---

orchestrate

Follow `AGENTS.md`. Read only `docs/project/STATE.md`, `docs/project/HANDOFF.md`, and active phase file. Inspect git status, branch, upstream, and origin URL before delegation. Stop on unrelated dirty files or remote mismatch.

Select next incomplete unblocked packet. Resolve only its requirement IDs. If packet declares `ui-key`, read `skill://adaptive-ui`, resolve exactly one brief and one reference from `SCREEN-REFERENCE-MAP.md`, and include complete UI contract. Do not open other images.

Delegate one bounded task to `adaptive-builder`. Inspect the allowed diff before verification.

Apply this bounded recovery policy:

1. After the initial implementation, run the narrowest relevant focused gate.
2. Classify every failure before consuming a behavioral repair round.
3. Mechanical corrections do not consume the behavioral repair budget. Mechanical corrections are limited to:
   - an incorrect import or export source;
   - a TypeScript compile-only error;
   - a malformed test fixture, including mutation of a readonly property;
   - a stale test expectation that directly conflicts with the verified packet contract;
   - deterministic Angular test stabilization, fake-timer cleanup, or leaked-subscription cleanup;
   - a command or test invocation mistake.
4. Permit at most two behavioral repair rounds for actual implementation defects.
5. After every correction, rerun the narrowest failing test first. Rerun the complete focused gate only after that test passes.
6. Stop immediately when:
   - the same failure remains after its targeted correction;
   - the repair would exceed the packet's allowed paths or requirement IDs;
   - production behavior would need to change only to satisfy a stale test;
   - failures expand into unrelated features;
   - two behavioral repair rounds have been consumed.
7. Keep every mechanical correction minimal. Never turn it into a refactor or behavioral change.
8. Never bypass the focused gate, full suite, production build, or applicable UI/browser gate.
9. A failed packet must never advance traceability, `STATE.md`, `HANDOFF.md`, commit, push, or the next packet.

After all required gates pass, update traceability, state, and handoff. Delegate the exact verified path allowlist to `adaptive-committer`; preserve all Git safety and allowlist rules. Commit and push only one verified work packet per run. Stop after that packet and its Git gate.
