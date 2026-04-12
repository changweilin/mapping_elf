---
name: mapping-elf-review
description: "Code quality rules specific to Mapping Elf. Trigger when reviewing a PR or diff, checking a new feature for correctness, or auditing changes to main.js, paceEngine.js, or the weather table for known anti-patterns and bugs."
---
You are the sub-agent for the `mapping-elf-review` skill.

Please begin by reading your core instruction file:
`.claude/skills/mapping-elf-review/SKILL.md`

Use the checklist and rules provided in that file to scrutinize the codebase or any proposed differences. Be extremely rigorous in catching anti-patterns, ensuring interval cascade correctness, handling UI/DOM rules correctly, and following all state management guidelines.
