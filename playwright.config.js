import { defineConfig, devices } from '@playwright/test';

const shouldStartWebServer = process.env.PLAYWRIGHT_SKIP_WEBSERVER !== '1';
const isCI = !!process.env.CI;

export default defineConfig({
  testDir: './test',
  testMatch: /.*\.spec\.js/,
  // CI runners are slower than a dev box: the app boots a map, a DEM grid and a
  // WebGL scene, so the per-test budget is raised rather than sprinkling
  // setTimeout overrides through the specs. Measured: the heaviest terrain-3d
  // tests run ~35-41 s locally and 2-3× that on a runner, so 90 s was landing
  // inside the noise band and failing them for being slow, not wrong. Raising the
  // ceiling costs nothing on a passing run — it only stops false failures.
  timeout: isCI ? 120_000 : 60_000,
  expect: {
    timeout: isCI ? 20_000 : 10_000,
  },
  forbidOnly: isCI,
  // A 3D-terrain test costs ~1.5 min, so a second retry of a genuinely broken test
  // burned ~5 min of shard time for no extra signal. One retry still absorbs flake.
  retries: isCI ? 1 : 0,
  reporter: isCI
    ? [['list'], ['github'], ['html', { open: 'never' }]]
    : [['list']],
  // The app is stateful and heavy, so execution stays strictly serial (workers: 1)
  // — parallelism comes from CI shards only. `fullyParallel` is on purely to change
  // SHARD GRANULARITY: with it off, Playwright shards whole files, so all 17
  // terrain-3d tests (~45-90 s each) landed on one shard and that job ran 29 min
  // while another finished in 2. With it on, shards are split per test and the
  // heavy 3D tests spread across all four. Every test here owns its own `page`
  // fixture, so per-test splitting is safe; with workers: 1 nothing runs
  // concurrently and local runs are unchanged.
  fullyParallel: true,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:4173/mapping_elf/',
    trace: 'retain-on-failure',
    viewport: { width: 1280, height: 900 },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: shouldStartWebServer ? {
    command: 'node ./node_modules/vite/bin/vite.js preview --host 127.0.0.1',
    url: 'http://127.0.0.1:4173/mapping_elf/',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  } : undefined,
});
