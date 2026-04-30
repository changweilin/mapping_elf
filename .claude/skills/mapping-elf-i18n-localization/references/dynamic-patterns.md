# Dynamic Pattern Rules

Use `translatePattern` only when the text is generated with variable data such as counts, waypoint numbers, filenames, coordinates, or status details.

## Preferred Pattern Shape

- Match the smallest stable source phrase.
- Capture only the dynamic value.
- Return localized templates through the existing helper pattern such as `withNum` or `phraseWithText`.
- Keep fallback behavior unchanged when no pattern matches.

## Guardrails

- Do not add broad regular expressions that match unrelated route, weather, or file messages.
- Do not translate user-generated names, imported filenames, coordinates, or numeric units except the surrounding label.
- Preserve leading and trailing whitespace through the existing helper flow.
- Verify that a generated translation is recognized by `isKnownTranslation` so MutationObserver updates do not overwrite it incorrectly.
