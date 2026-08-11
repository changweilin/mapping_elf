import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const viteBin = path.join(repoRoot, 'node_modules', 'vite', 'bin', 'vite.js');
const playwrightCli = path.join(repoRoot, 'node_modules', '@playwright', 'test', 'cli.js');
const previewUrl = 'http://127.0.0.1:4173/mapping_elf/';
const args = process.argv.slice(2);

function waitForUrl(url, timeoutMs = 30_000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => {
        if (Date.now() - startedAt > timeoutMs) {
          reject(new Error(`Timed out waiting for ${url}`));
          return;
        }
        setTimeout(attempt, 250);
      });
      req.setTimeout(1000, () => {
        req.destroy();
      });
    };
    attempt();
  });
}

function runChild(commandArgs, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, commandArgs, {
      cwd: repoRoot,
      stdio: 'inherit',
      ...options,
    });
    child.on('exit', (code, signal) => {
      resolve(code ?? (signal ? 1 : 0));
    });
  });
}

// `vite preview` serves the PRE-BUILT dist/ — it never rebuilds. Silently
// testing the previous build has cost real debugging time, so say so loudly.
function warnIfDistIsStale() {
  const distEntry = path.join(repoRoot, 'dist', 'index.html');
  if (!fs.existsSync(distEntry)) {
    console.warn('\n[preview] dist/ is missing — run `npm run build:web` first.\n');
    return;
  }
  const builtAt = fs.statSync(distEntry).mtimeMs;
  let newestSource = 0;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else newestSource = Math.max(newestSource, fs.statSync(full).mtimeMs);
    }
  };
  walk(path.join(repoRoot, 'src'));
  newestSource = Math.max(newestSource, fs.statSync(path.join(repoRoot, 'index.html')).mtimeMs);
  if (newestSource > builtAt) {
    const ageMin = Math.round((newestSource - builtAt) / 60_000);
    console.warn(`\n[preview] dist/ is ${ageMin} min older than src/ — you are testing a STALE bundle.`);
    console.warn('[preview] run `npm run build:web` first (test-only edits need no rebuild).\n');
  }
}

warnIfDistIsStale();

const preview = spawn(process.execPath, [viteBin, 'preview', '--host', '127.0.0.1'], {
  cwd: repoRoot,
  stdio: ['ignore', 'ignore', 'inherit'],
});

let exitCode = 1;
try {
  await waitForUrl(previewUrl);
  exitCode = await runChild([playwrightCli, 'test', ...args], {
    env: {
      ...process.env,
      PLAYWRIGHT_SKIP_WEBSERVER: '1',
    },
  });
} finally {
  if (!preview.killed) {
    preview.kill();
  }
}

process.exit(exitCode);
