---
name: mapping-elf-sub-agent-coordinator
description: Coordinates Mapping Elf skill and sub-agent architecture. Use when creating, updating, routing, or splitting work across Mapping Elf specialist skills or Claude sub-agents, including localization, UI event logic, parameter data stewardship, spatial numeric analysis, market research, core modules, frontend design, verification, review, and deployment.
---

# Sub Agent Coordinator Skill

## Description
This skill coordinates the creation and management of cross-project Sub Agents (Skills). Trigger this skill when the user wants to create a new automation capability, define a new skill, or needs guidance on architecting modular agents according to the Anthropic 9-category framework.
Trigger on: "create a new skill", "build a sub agent", "design a skill", "new automation capability", "architect an agent".

## Category
**Business Automation** (Multi-tool workflow for skill generation and management).

## Mapping Elf Specialist Routing

Use this routing table before assigning or designing Mapping Elf sub-agent work:

- `mapping-elf-i18n-localization`: translations, language coverage, `src/modules/i18n.js`, WMO descriptions, `data-i18n-*`, dynamic translation patterns.
- `mapping-elf-ui-event-logic`: `src/main.js` handlers, `src/modules/mapManager.js` interactions, Leaflet marker behavior, keyboard/touch flows, modal/panel state, localStorage updates caused by UI controls.
- `mapping-elf-parameter-data-steward`: `LS_*_KEY` constants, `DEFAULT_PACE_PARAMS`, saved weather columns, calibration data, `.melmap` state, map-pack import/export compatibility, persistent defaults.
- `mapping-elf-geo-numeric-analysis`: coordinate order, distance, projection, elevation sampling, route ranking, pace formulas, kcal/MET, round-trip mileage, numeric edge cases.
- `mapping-elf-market-research-analysis`: competitor research, user feedback/review mining, SEO keyword datasets, research design, metrics, segmentation, evidence-backed product insights.
- `mapping-elf-core-modules`: broad mapping, weather, pace, route, offline, and parser logic when the work does not fit a narrower specialist.
- `mapping-elf-frontend-design`: visual/UI styling, CSS, responsive layout, z-index, design consistency.
- `mapping-elf-verifier`: browser-level product verification, PWA/offline checks, GPX output checks, blank-page/map-load debugging.
- `review`: code review, diff audit, known anti-pattern checks, regression risk assessment.
- `mapping-elf-deploy`: GitHub Pages build, deploy, CI/deployment diagnosis.

## Cross-Agent Handoff Rules

- Split cross-functional work into bounded subtasks with one owner per file or behavior boundary.
- Include current state, target behavior, relevant files, constraints, and verification expectations in each handoff.
- For localization plus UI behavior, assign copy/key work to `mapping-elf-i18n-localization` and event/state work to `mapping-elf-ui-event-logic`.
- For pace or weather settings, assign data shape/persistence to `mapping-elf-parameter-data-steward` and formulas to `mapping-elf-geo-numeric-analysis`.
- For market findings that imply product changes, ask `mapping-elf-market-research-analysis` for evidence and then hand implementation to the appropriate product specialist.
- Keep `SKILL.md` files in English. User-facing conversation may be in Chinese or another requested language.

## Framework: The 9 Skill Categories (with Examples)
When designing a new skill, categorize it into one of these. Use the positive examples for inspiration and avoid the anti-patterns.

1. **Library & API Reference**: Explain how to correctly use internal/common libraries, CLIs, or SDKs.
   - *Positive Examples*: `billing-lib` (documenting edge cases, footguns), `internal-platform-cli` (subcommands with examples), `frontend-design` (pushing Claude toward company-specific design systems).
   - *Anti-Pattern*: Stating the obvious. Don't teach Claude basic standard coding; focus on information that pushes Claude out of its normal way of thinking.

2. **Product Verification**: Test or verify that code is working, often paired with external tools (Playwright, tmux).
   - *Positive Examples*: `signup-flow-driver` (headless browser with programmatic state assertions), `checkout-verifier` (driving UI with Stripe test cards), `tmux-cli-driver` (interactive CLI testing).
   - *Anti-Pattern*: Relying purely on Claude's visual guessing. Enforce programmatic assertions on state at each step.

3. **Data Fetching & Analysis**: Connect to data and monitoring stacks, fetching data with credentials or specific dashboard IDs.
   - *Positive Examples*: `funnel-query` (table joins, canonical user_ids), `cohort-compare` (flagging statistically significant deltas), `grafana` (datasource UIDs, problem-to-dashboard mappings).

4. **Business Process & Team Automation**: Automate repetitive workflows into one command.
   - *Positive Examples*: `standup-post` (aggregating ticket/GitHub/Slack activity into a formatted post), `create-ticket` (enforcing valid enum schemas and pinging reviewers), `weekly-recap` (merged PRs + closed tickets).
   - *Anti-Pattern*: Statelessness. Failing to use log files (e.g., `standups.log`) to help the model stay consistent and reflect on previous executions across runs.

5. **Code Scaffolding & Templates**: Generate framework boilerplate combined with composable scripts.
   - *Positive Examples*: `new-workflow` (scaffolding handlers with annotations), `new-migration` (template plus common gotchas), `create-app` (pre-wired auth, logging, and deploy configs).

6. **Code Quality & Review**: Enforce code quality and review code inside the org using deterministic tools.
   - *Positive Examples*: `adversarial-review` (spawning a fresh-eyes subagent to critique, iterate until nitpicks), `code-style` (enforcing styles Claude misses by default), `testing-practices` (instructions on how/what to test).

7. **CI/CD & Deployment**: Fetch, push, and deploy code, often referencing other skills to collect data.
   - *Positive Examples*: `babysit-pr` (retries flaky CI, resolves merge conflicts, enables auto-merge), `deploy-service` (smoke test, gradual rollout, auto-rollback), `cherry-pick-prod` (isolated worktree, PR template).

8. **Runbooks**: Take a symptom (Slack thread, alert, error signature), walk through multi-tool investigations, produce structured reports.
   - *Positive Examples*: `service-debugging` (mapping symptoms -> tools -> query patterns), `oncall-runner` (fetching alerts, checking suspects), `log-correlator` (pulling matching logs by request ID).

9. **Infrastructure Operations**: Routine maintenance and operational procedures, especially destructive actions requiring guardrails.
   - *Positive Examples*: `resource-orphans` (finding orphans, Slack post, soak period, user confirmation, cleanup), `dependency-management` (approval workflow), `cost-investigation` (identifying specific buckets/queries for billing spikes).

## Core Design Principles & Best Practices
Follow these 9 advanced tips:
1. **Don't State the Obvious**: Focus on project-specific nuances (e.g., specific design tastes, internal wrappers) rather than default LLM programming knowledge.
2. **Build a Gotchas Section**: Maintain a high-signal section for common failure points. Update this over time as Claude hits new edge cases.
3. **Progressive Disclosure**: A skill is a folder, not just a markdown file. Split details into sub-files (e.g., `references/api.md` or `assets/template.md`) and point Claude to read them when appropriate.
4. **Avoid Railroading Claude**: Describe goals and intent. Give Claude the information it needs but provide the flexibility to adapt to the situation, rather than overly rigid step-by-step constraints.
5. **Description = Trigger**: The description field is NOT a summary. It is scanned by Claude to decide "is there a skill for this request?". Be highly specific about *when* to trigger it.
6. **Think through the Setup**: Use `config.json` for user-specific settings (e.g., Slack channels). If the config isn't set, instruct Claude to use the `AskUserQuestion` tool. Don't annoy the user repeatedly.
7. **Persistent Memory**: Store execution logs or JSON data in `${CLAUDE_PLUGIN_DATA}` so Claude can read its own history (e.g., knowing what changed since yesterday) without data wiping on upgrades.
8. **Store Scripts & Generate Code**: Provide helper scripts/libraries so Claude spends its turns on composition and analysis rather than reconstructing boilerplate.
9. **On-Demand Hooks**: Use session-scoped hooks (e.g., `/careful` blocking `rm -rf` on prod, or `/freeze` blocking edits outside a directory) for opinionated safety.

## Protocol: Bilingual File Setup
Every skill created MUST include:
`SKILL.md`: **Strictly English** (unless it's a dedicated text-processing skill for another language).

## Gotchas
- **Language Leakage**: Do NOT let Chinese content bleed into `SKILL.md` unless the specific task (e.g., localizing UI) requires it.
- **Over-Scaffolding**: Avoid creating a single massive file; if a skill grows complex, split it immediately into sub-files in the directory.
- **Config Handling**: Always check if `config.json` exists before asking the user; don't annoy them with repeated setup questions.
- **Trigger Precision**: Vague descriptions lead to unwanted triggers. Be specific about when this skill is the "best tool for the job".
