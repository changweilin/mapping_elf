---
name: deploy
description: Deploy Mapping Elf to GitHub Pages. Trigger when the user wants to build, deploy, check CI status, or debug a broken deployment (blank page, missing assets, 404s).
type: cicd
---

# Mapping Elf — Deploy Reference

## Stack

- **Build**: Vite (`npm run build` → `dist/`)
- **Deploy**: GitHub Actions → GitHub Pages (`gh-pages` branch)
- **Workflow file**: `.github/workflows/deploy.yml`

## Build

```bash
npm run build
```

Output in `dist/`. Always verify:
- `dist/index.html` — asset paths must be **relative** (e.g., `./assets/...`), NOT absolute (`/assets/...`)
- Service worker registration path must also be relative

The `vite.config.js` sets `base: './'` to enforce relative paths. If this is ever changed or removed, GitHub Pages deployments will show a blank page.

## Critical: Relative Asset Paths

GitHub Pages serves from a subdirectory (`/<repo-name>/`), not from root. Absolute paths like `/assets/main.js` resolve to the domain root and 404.

Fix: ensure `vite.config.js` has:
```js
export default defineConfig({
  base: './',
  // ...
})
```

If you see a blank page after deploy, check browser DevTools → Network tab for 404s on `/assets/...` (missing base).

## Service Worker

Registered in `main.js` or via `offlineManager.js`. The registration path must be relative:
```js
navigator.serviceWorker.register('./sw.js')  // correct
navigator.serviceWorker.register('/sw.js')   // wrong on subdirectory deploys
```

## GitHub Actions Workflow

Manual trigger via `workflow_dispatch` or push to `main`. Check status:
```bash
gh run list --workflow=deploy.yml --limit=5
gh run view <run-id>
```

If the workflow fails on the build step, run `npm run build` locally first to reproduce.

## Debugging a Broken Deploy

1. Open browser DevTools → Console + Network tabs
2. Check for 404s — usually an asset path issue (see above)
3. Check if `dist/index.html` references `./assets/` or `/assets/`
4. Check if `sw.js` is present in `dist/`
5. Run `gh run list` to see if the latest action succeeded

## Gotchas

- **Leaflet marker icons**: Leaflet's default icons use `_getIconUrl` which doesn't work with Vite bundling. The fix in `main.js` hard-codes unpkg.com URLs — do NOT revert to the default Leaflet icon setup.
- **Cache busting**: After deploying, users may see stale cached pages. The service worker should handle this, but for a forced refresh instruct users to do hard reload (Ctrl+Shift+R).
- **No staging environment**: Changes go directly to the GitHub Pages production URL. Test locally with `npm run preview` before pushing.
