# Pre-App Optimization Progress

Created: 2026-05-18
Last updated: 2026-05-19
Source plan: `doc/pre-app-optimization-plan.md`

## Execution Order

| Sprint | Scope | Status | Remaining verification |
| --- | --- | --- | --- |
| Sprint 1 | Build mode, platform adapter, external platform calls, export channel split | Complete | Keep covered by regular build and smoke/import-export tests. |
| Sprint 2 | Import/export round-trip tests, state contract, reset/import behavior | Complete | Keep covered by import/export and numeric regression tests. |
| Sprint 3 | Error states, mobile UI QA, safe area, WebView differences | Needs device QA | Android device/emulator bridge checks; iOS Mac/Xcode validation. |
| Sprint 4 | Long-route performance, request cancellation guards, offline strategy, privacy data flow | Needs release-readiness review | Provider terms, real-device offline tiles, privacy/store review, dependency audit. |
| App deployment Phase 6 prep | Privacy policy entry and store disclosure draft | Complete for draft stage | Final store-form review and published GitHub Pages verification. |

## Completed Scope Summary

Completed details have been cleaned out of this progress file. High-level completed coverage now includes:

- Web/App build split and Capacitor sync helpers.
- Platform adapter plus native plugin bridges for browser, files/share, location, haptics, network status, and Android back handling.
- Import/export round-trip coverage for GPX, KML, and `.melmap`.
- State contract, privacy inventory, offline tile strategy, provider guard, tile-pack index, and offline pack management.
- Mobile UI, request-race, stale-result, long-route, numeric, chunk, and smoke regression coverage.
- Android debug build verification with `android/app/build/outputs/apk/debug/app-debug.apk`.
- In-app privacy policy entry, bundled `public/privacy.html`, native external-link routing, and `doc/app-store-disclosure-draft.md`.

## Remaining Work

1. Install `android/app/build/outputs/apk/debug/app-debug.apk` on an Android device or emulator and run the native bridge checklist in `doc/native-app-qa.md`.
2. Validate Android real-device behavior for app launch, back button, external browser, file export/share, file import, location permission, network status, haptics, and offline tiles.
3. Profile native WebView behavior on a real Android device now that the debug APK compiles.
4. Validate iOS on a Mac/Xcode environment, including safe area, file import/export, external links, and TestFlight readiness.
5. Re-check offline tile provider terms before any public app release.
6. Verify the published privacy policy URL after GitHub Pages deployment and reconcile `doc/app-store-disclosure-draft.md` with the live Google Play/App Store privacy forms.
7. Review `npm audit` findings manually before release; avoid automatic broad upgrades unless the impact is understood.

## Reference Docs

- `doc/native-app-qa.md`
- `doc/offline-tile-strategy.md`
- `doc/privacy-data-flow.md`
- `doc/app-store-disclosure-draft.md`
- `doc/app-deployment-plan.md`
