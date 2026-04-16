# Mapping Elf Verifier & Runbooks

## Description
This skill provides operational runbooks and product verification procedures. Mapping Elf is a PWA that heavily relies on Client-Side logic, meaning unit tests often miss browser-level edge cases (Service Worker caches, IndexedDB state).

## Verification Runbooks

### 1. Verifying PWA / Offline Functionality
- **Check Cache Name**: Look in `sw.js` for the current cache version. If static assets changed, ensure the cache name was bumped.
- **Check `offlineManager.js`**: Verify that downloading tiles successfully writes to IndexedDB (`localforage`).
- **Simulating Offline**: Use the browser dev-tools via a headless driver, or instruct the user explicitly how to test: "Open Chrome DevTools -> Application -> Service Workers -> Check 'Offline' and reload." Ensure no Unhandled Promise Rejections occur.

### 2. Validating Brouter Execution
- Brouter operates via an API or locally. Verify the coordinates passed to the profile logic are `[lng, lat]` vs `[lat, lng]` (Leaflet vs GeoJSON mismatch is the #1 bug).

### 3. GPX Output Validation
- To verify a GPX export change, verify the XML structure. Ensure interval points contain the `<type>mel:interval</type>` tag correctly. Ensure XML is well-formed.

## Debugging Workflow
1. If the user reports "Blank Page on Load": Check `console.error` regarding `import` statements and Vite build paths.
2. If the user reports "Map Not Loading": Check Nominatim / OSM rate limits or offline mode toggle.
