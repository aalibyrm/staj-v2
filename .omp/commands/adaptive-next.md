---
name: adaptive-next
description: Execute and verify the next incomplete work packet in the active phase, including one-screen UI guidance when assigned.
---

orchestrate

Follow `AGENTS.md`. Read only `docs/project/STATE.md`, `docs/project/HANDOFF.md`, and active phase file. Inspect git status, branch, upstream, and origin URL before delegation. Stop on unrelated dirty files or remote mismatch.

Select next incomplete unblocked packet. Resolve only its requirement IDs. If packet declares `ui-key`, read `skill://adaptive-ui`, resolve exactly one brief and one reference from `SCREEN-REFERENCE-MAP.md`, and include complete UI contract. Do not open other images.

Delegate one bounded task to `adaptive-builder`. Inspect the allowed diff before verification.

Apply this bounded recovery policy:

1. Track corrections per exact failure signature.
2. After the initial implementation, run the narrowest relevant focused gate and classify every failure before consuming a behavioral repair round.
3. Mechanical corrections do not consume the behavioral repair budget. Mechanical corrections are limited to:
   - an incorrect import or export source;
   - a TypeScript compile-only error;
   - a malformed test fixture, including mutation of a readonly property;
   - a stale test expectation that directly conflicts with the verified packet contract;
   - deterministic Angular test stabilization, fake-timer cleanup, or leaked-subscription cleanup;
   - a command or test invocation mistake.
4. Allow at most two mechanical corrections for the same failure signature, and require new diagnostic evidence before the second. Keep each mechanical correction minimal; never turn it into a refactor or behavioral change.
5. Permit at most two behavioral repair rounds globally per packet for actual implementation defects.
6. When the same failure remains after its first targeted correction, do not stop immediately. Collect new diagnostic evidence from the narrowest failing test; inspect runtime state, rendered output, mocks, pending asynchronous work, compiler output, and the changed diff as applicable; then permit one second targeted correction based on that evidence.
7. Stop for that failure signature when:
   - it remains after two targeted corrections;
   - the second correction would repeat the first approach without new evidence;
   - the required change exceeds the packet's allowed paths or requirement IDs;
   - production behavior would change only to satisfy a stale test.
8. Stop when failures expand into unrelated features or the packet's global limit of two behavioral repair rounds has been consumed.
9. After every correction, rerun only the narrowest failing test first. Rerun the complete focused gate only after that test passes.
10. Never bypass the focused gate, full suite, production build, or applicable UI/browser gate.
11. While any required gate is red, never update traceability, `STATE.md`, `HANDOFF.md`, commit, push, or advance to the next packet.

After all required gates pass, update traceability, state, and handoff. Delegate the exact verified path allowlist to `adaptive-committer`; preserve all Git safety and allowlist rules. Commit and push only one verified work packet per run. Stop after that packet and its Git gate.
