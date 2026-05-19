# Store Listing Draft

Created: 2026-05-19
Last updated: 2026-05-19

This draft prepares Mapping Elf for Google Play internal testing and later App Store review. Re-check the live store forms before submission because store asset rules can change.

## App Identity

- App name: Mapping Elf
- Android package: `com.mappingelf.app`
- Android version: `versionCode 1`, `versionName "1.0.0"`
- Privacy policy URL: `https://changweilin.github.io/mapping_elf/privacy.html`
- Support/contact entry: in-app feedback link in the About section

## Android Build Status

- Debug APK: `android/app/build/outputs/apk/debug/app-debug.apk`
- Debug AAB: `android/app/build/outputs/bundle/debug/app-debug.aab`
- Release AAB draft: `android/app/build/outputs/bundle/release/app-release.aab`
- Release signing: copy `android/keystore.properties.example` to ignored `android/keystore.properties`, provide the real upload key, then rebuild `npm run android:bundle:release` before uploading to Google Play.

## Google Play Listing Draft

- App category: Maps & Navigation
- Tags to consider: maps, navigation, weather, hiking, cycling, route planning, offline maps
- Short description: Plan GPX/KML routes with weather, elevation, and offline map packs.

### Full Description

Mapping Elf helps hikers, cyclists, and trip planners turn routes into practical field plans. Build routes from waypoints, import GPX/KML tracks, compare elevation and pace, and check weather along the route before you go.

Use map layers, weather cards, Windy links, and offline `.melmap` packs to keep route context together. Routes, preferences, favorites, and map packs stay on the device unless you export or share them.

Core features:

- Import and export GPX, KML, and `.melmap` route packs.
- Plan walking, cycling, driving, and hiking routes with elevation and pace estimates.
- Review route weather by waypoint and time.
- Save map tiles into route packs for offline reference.
- Open external weather and support links in the system browser.

### Traditional Chinese Description

Mapping Elf 是給登山、騎行與行程規劃使用的路線工具。你可以用地圖點選 waypoint、匯入 GPX/KML 軌跡、查看高度與配速，並在出發前檢查沿途天氣。

App 保留手機 Web 版的操作邏輯，並加上原生 App 的檔案匯入匯出、分享、定位、外部瀏覽器與 Android 返回鍵支援。`.melmap` 可以把路線、偏好與離線圖磚打包保存，方便日後還原。

主要功能：

- 匯入與匯出 GPX、KML、`.melmap`。
- 規劃步行、騎行、開車與登山路線。
- 查看高度剖面、時間、配速與熱量估算。
- 依 waypoint 與時間檢查天氣資訊。
- 匯出含離線圖磚的地圖包。

## App Store Listing Draft

- Primary category: Navigation
- Secondary category to consider: Travel
- Keywords draft: route planner,GPX,KML,hiking,cycling,weather,elevation,offline maps,map pack
- Subtitle draft: Route weather and GPX planning

## Asset Inventory

| Asset | Path | Size | Status |
| --- | --- | --- | --- |
| Google Play app icon | `assets/store/google-play-icon.png` | 512 x 512 PNG | Ready draft |
| Google Play feature graphic | `assets/store/google-play-feature-graphic.png` | 1024 x 500 PNG | Ready draft |
| App icon source | `assets/icon-only.png` | 1024 x 1024 PNG | Source asset |
| Android icon/splash outputs | `android/app/src/main/res/` | generated densities | Ready draft |
| Promo square images | `assets/promos/promo-*.png` | 1254 x 1254 PNG | Marketing/social draft, not a substitute for phone screenshots |

## Screenshot Plan

Capture final phone screenshots after Android device/emulator QA so the images reflect the native app behavior, not only the browser shell.

Recommended screenshot set:

- Route planning with two or more waypoints and the side panel visible.
- GPX/KML import result with route, elevation, and waypoint list.
- Weather table or weather card with a selected waypoint.
- `.melmap` export/import or offline tile pack management.

Current blocker: no connected Android device was visible through ADB on 2026-05-19, and no usable local `emulator.exe` was found in the checked Android SDK/Android Studio paths.

## Privacy And Disclosure Inputs

- Privacy data inventory: `doc/privacy-data-flow.md`
- Store disclosure draft: `doc/app-store-disclosure-draft.md`
- Bundled privacy page: `public/privacy.html`
- No account, advertising SDK, analytics SDK, crash-reporting SDK, or payment flow is currently wired in source.
- Third-party requests are part of explicit app functionality: route calculation, elevation, weather, geocoding, Windy links, map tiles, and feedback/about links.
- Android cloud backup is disabled in the manifest so local route/preferences data is not automatically backed up by the OS.

## Submission Checklist

1. Configure the real Android upload keystore in ignored `android/keystore.properties`.
2. Rebuild `npm run android:bundle:release` and upload the rebuilt AAB to Google Play internal testing.
3. Install the app on a real Android device or emulator and complete `doc/native-app-qa.md`.
4. Capture final phone screenshots from the tested build.
5. Verify the published privacy policy URL after GitHub Pages deployment.
6. Re-check offline tile provider terms before public release.
7. Complete Apple iOS build and screenshots on a Mac/Xcode environment before TestFlight.

## Official References Checked

- Google Play app preview asset requirements: <https://support.google.com/googleplay/android-developer/answer/9866151>
- Apple App Store screenshot specifications: <https://developer.apple.com/help/app-store-connect/reference/screenshot-specifications>
