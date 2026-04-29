---
name: mapping-elf-i18n-localization
description: Translation and localization workflow for Mapping Elf. Use when adding, reviewing, repairing, or auditing UI strings, language labels, phrase dictionaries, WMO weather descriptions, dynamic translation patterns, data-i18n attributes, or src/modules/i18n.js behavior across zh-TW, en, ja, ko, fr, de, es, and it.
---

# Mapping Elf I18n Localization

## Trigger Criteria

Use this skill for translation coverage, localized copy quality, language switcher behavior, weather text translation, dynamic phrase patterns, or any change touching `src/modules/i18n.js`.

Do not use this skill for CSS layout, event wiring, route math, or market research unless the requested output is localized text.

## Primary Ownership

- `src/modules/i18n.js`
- User-facing strings in `index.html` and `src/main.js`
- `data-i18n`, `data-i18n-title`, `data-i18n-placeholder`, `data-i18n-aria-label`, and `data-i18n-alt`

## Required First Reads

- Read `src/modules/i18n.js` before editing translations.
- Read `references/localization-matrix.md` when adding or auditing language coverage.
- Read `references/dynamic-patterns.md` before changing `translatePattern`, generated labels, weather descriptions, or runtime text.

## Gotchas

- Preserve the original source string as the dictionary key unless the task is explicitly to migrate keys.
- Do not batch-rewrite corrupted-looking CJK text without verifying browser-rendered behavior and source encoding.
- Keep `translatePhrase`, `MutationObserver`, and `data-i18n-*` flows compatible with dynamic DOM updates.
- Every new phrase should either have full language coverage or a documented fallback reason.
- Weather descriptions must remain compatible with `tWmo`, `translateWeatherText`, and `translateWmoDescription`.

## Handoff Format

Report changed string groups, affected languages, fallback choices, and any untranslated entries. If handing off to UI or event agents, include the exact DOM selector or source key that renders the string.

## Verification Checklist

- Confirm `LANGUAGES`, `STRINGS`, `PHRASES`, WMO descriptions, and dynamic patterns remain syntactically valid.
- Search for the new source text and verify it is translated through one path only.
- If product code changed, run the smoke test or request a browser check of language switching.
