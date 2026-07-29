---
name: deploy
description: Deploy Mapping Elf to GitHub Pages. Trigger when the user wants to build, deploy, check CI status, or debug a broken deployment (blank page, missing assets, 404s).
type: cicd
---

# Mapping Elf — Deploy Reference

Source of truth: `.github/workflows/deploy.yml` + `vite.config.js`. Verify against them before acting — do not trust this file over the code.

## Facts

- **Base path is mode-dependent** (`vite.config.js`, see CLAUDE.md INC-278): `--mode app` → `./` (Capacitor); all other modes → `/mapping_elf/` (web / GitHub Pages).
- **CI pipeline**: push to `main` or `workflow_dispatch` → `npm ci` → `npm run build` → `actions/upload-pages-artifact` → `actions/deploy-pages`. There is **no `gh-pages` branch**; Pages serves the workflow artifact directly.
- **Service worker** is registered in `offlineManager.js` via `import.meta.env.BASE_URL + 'sw.js'`, so it follows the Vite base automatically. Never hard-code `/sw.js` or `./sw.js`.
- **No staging**: `main` deploys straight to the production Pages URL. Test locally with `npm run build:web` + `npm run preview` before pushing.

## Debugging a Broken Deploy

1. **Blank page** → DevTools Console + Network. 404s on assets almost always mean a hard-coded absolute path bypassing the Vite base (INC-278).
2. **Stale page after deploy** → check `public/sw.js` cache versioning (INC-251, gated by `test/cache-versioning.spec.js`). User workaround: hard reload (Ctrl+Shift+R).
3. **Workflow fails on build** → reproduce locally with `npm run build`.
4. Confirm `dist/index.html` asset URLs use the expected base and `dist/sw.js` exists.

## Gotchas

- **Leaflet marker icons**: `main.js` hard-codes unpkg.com icon URLs because Leaflet's default `_getIconUrl` breaks under Vite bundling. Do NOT revert to the default icon setup or local imports.
