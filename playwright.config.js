import { defineConfig, devices } from '@playwright/test';

const shouldStartWebServer = process.env.PLAYWRIGHT_SKIP_WEBSERVER !== '1';
const isCI = !!process.env.CI;

export default defineConfig({
  testDir: './test',
  testMatch: /.*\.spec\.js/,
  // CI runners are slower than a dev box: the app boots a map, a DEM grid and a
  // WebGL scene, so the per-test budget is raised rather than sprinkling
  // setTimeout overrides through the specs.
  timeout: isCI ? 90_000 : 45_000,
  expect: {
    timeout: isCI ? 20_000 : 10_000,
  },
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  reporter: isCI
    ? [['list'], ['github'], ['html', { open: 'never' }]]
    : [['list']],
  // The app is stateful and heavy; parallelism comes from CI shards, not workers.
  fullyParallel: false,
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
