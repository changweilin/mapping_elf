# Native App QA Checklist

Created: 2026-05-19

Use this checklist after `npm run android:build:debug` or an iOS simulator/device build. It focuses on native bridge behavior that cannot be fully validated by Web Playwright tests.

## Android Debug Build

- Build command: `npm run android:build:debug`
- Current verified artifact: `android/app/build/outputs/apk/debug/app-debug.apk`
- Current verified result: `BUILD SUCCESSFUL` on 2026-05-19
- Local build note: this Windows workspace uses an ignored `android/local.properties` with `sdk.dir=C:\tmp\android-sdk`.

## Native Bridge Checks

| Area | Action | Expected result |
| --- | --- | --- |
| App launch | Install and open the debug APK | App opens without a blank screen; map and panels render. |
| Android back | Open export modal, `.melmap` import modal, favorites modal, search results, side panel | Back closes the top active UI first; app exits only after no UI layer remains. |
| External browser | Open Windy from a weather point or map cursor | Windy opens in the system browser, not trapped in the WebView. |
| External links | Open GitHub, feedback, and privacy policy links from the About section | Links open in the system browser; returning to Mapping Elf keeps the current route/map state. |
| File export/share | Export GPX, KML, and `.melmap` | Android share sheet opens with the generated file. |
| File import | Import GPX, KML, and `.melmap` from device storage | Route/state/tile restore behavior matches Web tests. |
| Location | Tap current-location button | Runtime location permission appears; accepted permission centers the map; denied permission shows a useful message. |
| Network status | Toggle device airplane mode or network | File-management status updates online/offline. |
| Haptics | Long-press or drag waypoint interactions | Device vibration happens where supported; no error where unsupported. |
| Offline tiles | Export/import tile-enabled `.melmap`, then disable network | Cached tiles remain usable for the exported area; tile pack delete and clear-all work. |

## Release Readiness Gaps

- iOS simulator/device build still needs validation on a Mac/Xcode environment.
- Provider offline tile terms must be rechecked before any public app release.
- Store privacy forms need to be completed from `doc/privacy-data-flow.md`.
- Store disclosure draft exists at `doc/app-store-disclosure-draft.md`; re-check it against the live store forms before release.
- `npm audit` currently reports dependency findings; review before release instead of applying automatic broad upgrades.
