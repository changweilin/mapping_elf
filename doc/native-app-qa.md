# Native App QA Checklist

Created: 2026-05-19

> Management note: execution details stay here, but QA status, blockers, and release priority are centralized in [`../TODO.md`](../TODO.md).

Use this checklist after `npm run android:build:debug` or an iOS simulator/device build. It focuses on native bridge behavior that cannot be fully validated by Web Playwright tests.

## Android Debug Build

- Build command: `npm run android:build:debug`
- Debug AAB command: `npm run android:bundle:debug`
- Release AAB command: `npm run android:bundle:release` after release signing is configured.
- Release signing: copy `android/keystore.properties.example` to ignored `android/keystore.properties` and provide a local upload key before Google Play upload.
- Current verified artifact: `android/app/build/outputs/apk/debug/app-debug.apk`
- Current verified debug AAB: `android/app/build/outputs/bundle/debug/app-debug.aab`
- Current verified release AAB: `android/app/build/outputs/bundle/release/app-release.aab`
- Current app version: `1.0.0` (`versionCode 1`)
- Current verified result: `BUILD SUCCESSFUL` on 2026-05-19
- Local build note: this Windows workspace uses an ignored `android/local.properties` with `sdk.dir=C:\tmp\android-sdk`.

## Local Device Availability Check

- 2026-05-19: `adb devices` returned no connected Android device.
- 2026-05-19: local AVD profile files were present for `Medium_Phone` and `Pixel_7`, but no usable `emulator.exe` was found in the checked Android SDK or Android Studio paths.
- Result: native bridge checks still need a physical Android device or a repaired Android Emulator installation.

## Native Bridge Checks

| Area | Action | Expected result |
| --- | --- | --- |
| App launch | Install and open the debug APK | App opens without a blank screen; map and panels render. |
| Android back | Open export modal, `.melmap` import modal, favorites modal, search results, side panel | Back closes the top active UI first; app exits only after no UI layer remains. |
| External browser | Open Windy from a weather point or map cursor | Windy opens in the system browser, not trapped in the WebView. |
| External links | Open GitHub, feedback, and privacy policy links from the About section | Links open in the system browser; returning to Mapping Elf keeps the current route/map state. |
| File export/share | Export GPX, KML, and `.melmap` | Android share sheet opens with the generated file. |
| File import | Import GPX, KML, and `.melmap` from device storage | Route/state/tile restore behavior matches Web tests. |
| File association | From the OS file manager, open GPX, KML, and `.melmap` with Mapping Elf | Mapping Elf launches or resumes and imports through the same restore modal/route flow as the in-app import button. |
| Location | Tap current-location button | Runtime location permission appears; accepted permission centers the map; denied permission shows a useful message. |
| Network status | Toggle device airplane mode or network | File-management status updates online/offline. |
| Haptics | Long-press or drag waypoint interactions | Device vibration happens where supported; no error where unsupported. |
| Offline tiles | Export/import tile-enabled `.melmap`, then disable network | Cached tiles remain usable for the exported area; tile pack delete and clear-all work. |
| OS backup | Check Android app backup settings where visible | Mapping Elf should not offer OS cloud backup for local route/cache data. |

## Release Readiness Gaps Mirrored In TODO.md

- Android native bridge QA is still blocked locally until a device or emulator is available.
- iOS simulator/device build still needs validation on a Mac/Xcode environment.
- Provider offline tile terms must be rechecked before any public app release.
- Store privacy forms need to be completed from `doc/privacy-data-flow.md`.
- Store disclosure draft exists at `doc/app-store-disclosure-draft.md`; re-check it against the live store forms before release.
- Store listing and asset draft exists at `doc/store-listing-draft.md`; final phone screenshots must be captured from a tested native build.
- `npm audit --omit=dev` currently reports 0 production/runtime vulnerabilities; full `npm audit` still reports dev-tool findings under asset-generation tooling, so review before release instead of applying broad automatic upgrades.
