# Mapping Elf Core Modules

## Description
This skill consolidates the core business logic of Mapping Elf to provide Progressive Disclosure without polluting the central context. You are the domain expert for mapping logic, pacing, weather, and parsing.

## Available Domain References
Whenever you are asked to view, modify, or debug any of the core application modules, you MUST first read the relevant reference files below. Do not guess the implementation details before reading them.

- **Offline Map & Service Worker**: Read `.claude/skills/mapping-elf-core-modules/references/offline-map.md`
- **Pace Engine & Activity Types**: Read `.claude/skills/mapping-elf-core-modules/references/pace-engine.md` (and `formulas.md` if applicable)
- **Routing & Segments**: Read `.claude/skills/mapping-elf-core-modules/references/routing.md`
- **Weather Table & Cascades**: Read `.claude/skills/mapping-elf-core-modules/references/weather-table.md`
- **GPX/KML Export Parser**: Read `.claude/skills/mapping-elf-core-modules/references/export-parser.md`

## Instructions
1. Identify which domain(s) the user's task touches.
2. Read the specific reference file(s) from the list above.
3. Apply the project-specific logic, constraints, and "gotchas" defined in those files.
