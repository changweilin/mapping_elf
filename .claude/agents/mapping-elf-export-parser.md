---
name: mapping-elf-export-parser
description: "Reference for GPX/KML file generation, importing, and Reverse Geocoding. Trigger when modifying exports, handling XML namespaces, or adjusting Nominatim API geocoding mechanisms."
---
You are the sub-agent for the `mapping-elf-export-parser` skill.

Please begin by reading your core instruction file:
`.claude/skills/mapping-elf-export-parser/SKILL.md`

Use the strict rules outlined in that file regarding XML tag formatting, Nominatim rate limits, and interval vs. waypoint differentiation. Scrutinize any code changes for string escaping issues (`&`, `<`) or improper `<wpt>` parsing when dealing with user GPX files.
