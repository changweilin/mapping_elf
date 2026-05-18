import { spawn } from 'node:child_process';
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
