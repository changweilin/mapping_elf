---
name: mapping-elf-sub-agent-coordinator
description: Coordinates Mapping Elf skill and sub-agent architecture. Use when creating, updating, routing, or splitting work across Mapping Elf specialist skills or Claude sub-agents, including localization, UI event logic, parameter data stewardship, spatial numeric analysis, market research, core modules, frontend design, verification, review, and deployment.
---

# Sub Agent Coordinator Skill

Coordinates creation, maintenance, and routing of Mapping Elf skills/sub-agents. Trigger on: "create a new skill", "build a sub agent", "design a skill", "route this work", "new automation capability".

## Mapping Elf Specialist Routing

- `mapping-elf-i18n-localization`: translations, language coverage, `src/modules/i18n.js`, WMO descriptions, `data-i18n-*`, dynamic translation patterns.
- `mapping-elf-ui-event-logic`: `src/main.js` handlers, `src/modules/mapManager.js` interactions, Leaflet marker behavior, keyboard/touch flows, modal/panel state, localStorage updates caused by UI controls.
- `mapping-elf-parameter-data-steward`: `LS_*_KEY` constants, `stateKeys.js` registry, `DEFAULT_PACE_PARAMS`, saved weather columns, calibration data, `.melmap` state, map-pack import/export compatibility.
- `mapping-elf-geo-numeric-analysis`: coordinate order, distance, projection, elevation sampling, route ranking, pace formulas, kcal/MET, round-trip mileage, numeric edge cases.
- `mapping-elf-market-research-analysis`: competitor research, review mining, SEO keywords, research design, metrics, segmentation, evidence-backed product insights.
- `mapping-elf-core-modules`: broad mapping/weather/pace/route/offline/parser logic when no narrower specialist fits.
- `mapping-elf-frontend-design`: visual styling, CSS, responsive layout, z-index, design consistency.
- `mapping-elf-verifier`: browser-level verification, PWA/offline checks, GPX output checks, blank-page/map-load debugging.
- `review`: code review, diff audit, known anti-pattern checks, regression risk.
- `mapping-elf-deploy`: GitHub Pages build/deploy/CI diagnosis.

## Cross-Agent Handoff Rules

- Split cross-functional work into bounded subtasks: one owner per file or behavior boundary.
- Every handoff includes: current state, target behavior, relevant files, constraints, verification expectations.
- Localization + UI behavior → copy/keys to `i18n-localization`, event/state to `ui-event-logic`.
- Pace/weather settings → data shape and persistence to `parameter-data-steward`, formulas to `geo-numeric-analysis`.
- Market findings implying product changes → evidence from `market-research-analysis`, implementation to the matching product specialist.

## Skill Design Principles

Memory-hierarchy rules live in CLAUDE.md §5 (CLAUDE.md = macro principles; SKILL.md = domain rules + gotchas; references/ = deep detail). When designing or refactoring a skill:

1. **Don't state the obvious** — capture only project-specific knowledge that changes Claude's default behavior; delete anything a competent model already knows.
2. **Description = trigger** — the frontmatter description is scanned to decide "is there a skill for this?"; be specific about *when*, not *what*.
3. **Progressive disclosure** — a skill is a folder; push deep detail into `references/*` and point to it. Split files that grow past a few screens.
4. **Gotchas over procedures** — maintain a high-signal Gotchas section from real failures; describe goals and constraints, not rigid step-by-step rails.
5. **Single source of truth** — never copy lists that live in code (`stateKeys.js`, `deploy.yml`, formulas); reference them. Copies go stale and then lie.
6. **English SKILL.md** — keep `SKILL.md` files in English (unless the skill itself processes another language). User-facing conversation may be in Chinese.
