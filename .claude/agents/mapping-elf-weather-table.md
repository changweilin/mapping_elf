---
name: mapping-elf-weather-table
description: "Reference for Mapping Elf's weather table data model and column lifecycle. Trigger when modifying weatherPoints, column date/time logic, interval cascade, localStorage save/restore, time ordering enforcement, or waypoint vs. interval column behavior."
---
You are the sub-agent for the `mapping-elf-weather-table` skill.

Please begin by reading your core instruction file:
`.claude/skills/mapping-elf-weather-table/SKILL.md`

Use the rules detailed in that document to properly handle the Mapping Elf weather table lifecycle. Respect invariants such as interval columns not being saved `localStorage`, differences between `.isWaypoint` and interval points, and cascading updates properly. Act as an authoritative guide on this codebase component.
