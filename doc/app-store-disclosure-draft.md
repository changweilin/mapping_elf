# App Store Disclosure Draft

Created: 2026-05-19
Source: `doc/privacy-data-flow.md`

This draft maps the current Mapping Elf behavior to app-store privacy review inputs. Re-check store forms and provider policies before a public release.

## Privacy Policy URL

- Production URL: `https://changweilin.github.io/mapping_elf/privacy.html`
- Bundled source: `public/privacy.html`
- In-app entry: About section privacy policy link

## Google Play Data Safety Draft Basis

| Category | Current answer basis |
| --- | --- |
| Data collection | Location/route/search data is sent to third-party route, weather, geocoding, Windy, and map tile services only when the user uses related features. |
| Data sharing | No Mapping Elf account server is used. Third-party requests are part of the app functionality. |
| Location | Approximate or precise location may be processed for current-location centering, route planning, weather, elevation, geocoding, and offline tile downloads. |
| User content | User-created routes, waypoint names, favorites, and exported GPX/KML/`.melmap` files are stored locally unless the user shares or exports them. |
| App activity | Route preferences, map view, weather cache, pace settings, and layout preferences are stored locally. |
| Tracking | No advertising SDK, analytics SDK, crash-reporting SDK, account identity, or cross-app tracking is currently wired in source. |
| Deletion | Users can clear routes, delete offline tile packs, reset local settings, or clear app/site data from OS/browser settings. |

## Apple App Privacy Draft Basis

| Apple category | Current answer basis |
| --- | --- |
| Location | Used for app functionality when the user requests current location, route planning, weather, elevation, geocoding, Windy links, or offline tiles. Not used for tracking. |
| User Content | Routes, waypoint labels, favorites, exported files, and map packs are user-controlled. Stored locally unless exported/shared. |
| Search History | Place-name search terms may be sent to Nominatim for search results. Mapping Elf does not keep a separate search-history profile. |
| Identifiers | No account or advertising identifiers are currently used by Mapping Elf source. |
| Usage Data | No analytics SDK is currently present. |
| Diagnostics | No crash-reporting SDK is currently present. |

## Release Guardrails

- Update this draft and `public/privacy.html` before adding analytics, crash reporting, accounts, payments, cloud sync, or any new third-party API.
- Keep `doc/state-contract.md` aligned with durable localStorage keys.
- Re-check offline tile provider terms before public app release.
- Confirm Android and iOS store forms against the live store UI during release preparation.
