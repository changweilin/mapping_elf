# Localization Matrix

Mapping Elf currently targets:

- `zh-TW`: source/fallback language
- `en`: English
- `ja`: Japanese
- `ko`: Korean
- `fr`: French
- `de`: German
- `es`: Spanish
- `it`: Italian

## Coverage Rules

- UI labels, buttons, settings, modal labels, notifications, and empty states should cover all supported languages.
- Domain terms should be consistent:
  - waypoint: a route control point selected or imported by the user
  - intermediate point: generated interval point along a route
  - route: planned or imported path
  - pace: speed/time model used for route estimates
  - calibration: user-provided track-based pace adjustment
- Keep units unchanged unless the app already has unit conversion for that context.
- Prefer short button labels. Longer explanations belong in help/instruction content.

## Audit Method

- Inspect `LANGUAGES` for supported codes.
- Inspect each `STRINGS`, `PHRASES`, and WMO entry for missing language properties.
- For dynamic text, inspect `translatePattern` rather than adding many one-off strings.
- Check attributes separately from text nodes because `translateElementAttributes` stores originals in `dataset`.
