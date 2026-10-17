#!/usr/bin/env node
// One-command local setup + run:  npm start   (add `-- --reset` to reload fresh DEMO data)
// Uses only Node built-ins so it works before `npm install`. Never touches production.
import { execSync, spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reset = process.argv.includes('--reset');
const c = { b: (s) => `\x1b[1m${s}\x1b[0m`, g: (s) => `\x1b[32m${s}\x1b[0m`, r: (s) => `\x1b[31m${s}\x1b[0m`, d: (s) => `\x1b[2m${s}\x1b[0m` };
const step = (s) => console.log(`\n${c.b('▸')} ${s}`);
const ok = (s) => console.log(`  ${c.g('✓')} ${s}`);
function fail(msg, hint) {
  console.error(`\n${c.r('✗')} ${msg}`);
  if (hint) console.error(`  ${hint}`);
  process.exit(1);
}
const run = (cmd, opts = {}) => execSync(cmd, { cwd: root, stdio: 'inherit', ...opts });
const quiet = (cmd) => spawnSync(cmd, { cwd: root, shell: true, encoding: 'utf8' });
// Something is listening if a connection succeeds on IPv4 or IPv6 (Vite binds ::1 on macOS).
const canConnect = (port, host) =>
  new Promise((resolve) => {
    const s = net.connect({ port, host, timeout: 500 });
    s.once('connect', () => (s.destroy(), resolve(true)));
    s.once('error', () => resolve(false));
    s.once('timeout', () => (s.destroy(), resolve(false)));
  });
const portInUse = async (port) => (await canConnect(port, '127.0.0.1')) || (await canConnect(port, '::1'));

console.log(c.b('\n5 Diamonds Tournament Baseball: local setup'));

// 1. Prerequisites
step('Checking prerequisites');
const major = Number(process.versions.node.split('.')[0]);
if (major < 22) fail(`Node ${process.versions.node} found; Node 22 or newer is required.`, 'Install from https://nodejs.org (LTS).');
ok(`Node ${process.versions.node}`);
if (quiet('docker --version').status !== 0) fail('Docker is not installed.', 'Install Docker Desktop: https://www.docker.com/products/docker-desktop/');
if (quiet('docker info').status !== 0) fail('Docker is installed but not running.', 'Open Docker Desktop, wait until it says "running", then try again.');
ok('Docker is running');
for (const [port, what] of [[5173, 'web'], [4000, 'API']]) {
  if (await portInUse(port)) fail(`Port ${port} (${what}) is already in use. Is the site already running?`, `Stop the other process (or close its terminal) and run npm start again.`);
}

// 2. Dependencies
step('Installing dependencies');
if (!existsSync(path.join(root, 'node_modules', '.package-lock.json'))) run('npm install --no-audit --no-fund');
else ok('Already installed (run `npm install` yourself after pulling changes)');

// 3. Environment file
step('Preparing .env');
const envPath = path.join(root, '.env');
if (!existsSync(envPath)) {
  copyFileSync(path.join(root, '.env.example'), envPath);
  const secret = randomBytes(32).toString('base64');
  writeFileSync(envPath, readFileSync(envPath, 'utf8').replace(/^AUTH_SECRET=.*$/m, `AUTH_SECRET=${secret}`));
  ok('Created .env with a random AUTH_SECRET');
} else ok('.env already exists (left unchanged)');

// 4. Database
step('Starting PostgreSQL (Docker)');
run('docker compose up -d db', { stdio: 'pipe' });
let ready = false;
for (let i = 0; i < 60 && !ready; i++) {
  ready = quiet('docker compose exec -T db pg_isready -U fivediamonds').status === 0;
  if (!ready) await new Promise((r) => setTimeout(r, 1000));
}
if (!ready) fail('Database did not become ready in 60 seconds.', 'Check Docker Desktop, or run `docker compose logs db`.');
ok('Database ready on localhost:5442');

step('Applying migrations');
run('npm run db:migrate --silent');

// 5. DEMO data: seed on first run only, unless --reset
const count = quiet(`docker compose exec -T db psql -U fivediamonds -d fivediamonds -tAc "select count(*) from tournaments"`);
const empty = count.status !== 0 || Number(count.stdout.trim()) === 0;
if (empty || reset) {
  step(reset ? 'Resetting DEMO data (--reset)' : 'Loading DEMO data (first run)');
  run('npm run db:seed --silent');
} else {
  step('DEMO data');
  ok('Keeping your existing local data (use `npm start -- --reset` for a fresh copy)');
}

// 6. Run
console.log(`
${c.b('Ready.')} Starting the site. Leave this window open; press ${c.b('Ctrl+C')} to stop.

  Website   ${c.b('http://localhost:5173')}
  Sign in   any DEMO account below, password ${c.b('demo-password-2026')}
            admin@ · director@ · scorekeeper@ · editor@ · coach1@ … coach3@demo.5diamonds.invalid
  Emails    ${c.d('http://localhost:5173/api/dev/mailbox?to=<address>')}  (nothing is really sent)
`);

const dev = spawn('npm', ['run', 'dev'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
// Open the browser once the web server answers.
(async () => {
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      const res = await fetch('http://localhost:5173/api/health');
      if (res.ok) {
        const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start ""' : 'xdg-open';
        if (!process.env.NO_BROWSER) quiet(`${opener} http://localhost:5173`);
        return;
      }
    } catch {}
  }
})();
const stop = () => dev.kill('SIGINT');
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
dev.on('exit', (code) => {
  console.log(c.d('\nStopped. The database keeps running in Docker (stop it with `npm run db:down`).'));
  process.exit(code ?? 0);
});
