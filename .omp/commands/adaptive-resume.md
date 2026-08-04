---
name: adaptive-resume
description: Resume safely from compact project state and the current repository diff.
---

orchestrate

Follow `AGENTS.md`. Read `docs/project/STATE.md`, `docs/project/HANDOFF.md`, and inspect git status/diff. Verify handoff claims against repository evidence. If an unfinished packet exists, continue or re-issue only that packet. Otherwise run the next packet process. Do not reread all requirements. Stop after one verified packet.
