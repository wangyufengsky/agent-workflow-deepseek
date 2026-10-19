#!/usr/bin/env node
/**
 * scripts/test-e2e.mjs — offline end-to-end smoke for the built Web + HTTP server.
 *
 * What it proves (no network, no model, no Electron):
 *   1. `apps/web/dist` builds (or is present with --skip-build);
 *   2. the real server boots from `packages/server/src/main.ts` with an isolated
 *      temporary data dir and managed OpenCode disabled;
 *   3. `/api/health`, `/api/bootstrap` answer valid JSON with the expected shape;
 *   4. `/` serves the built SPA shell (200 text/html);
 *   5. unknown `GET /api/*` returns JSON 404 (not the SPA HTML fallback);
 *   6. the process shuts down cleanly and the temp data dir is removed.
 *
 * Usage:
 *   node scripts/test-e2e.mjs                 # build web, then boot + assert
 *   node scripts/test-e2e.mjs --skip-build    # reuse an existing apps/web/dist (CI)
 *   node scripts/test-e2e.mjs --keep-data     # keep the temp data dir for debugging
 *   AGENT_WORKFLOW_E2E_TIMEOUT_MS=90000 node scripts/test-e2e.mjs
 *
 * Exit code 0 only when every assertion passes; 1 on any failure/timeout.
 * Intended for `npm run test:e2e` and the offline GitHub Actions job.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ARGS = new Set(process.argv.slice(2));
const SKIP_BUILD = ARGS.has('--skip-build');
const KEEP_DATA = ARGS.has('--keep-data');
const BOOT_TIMEOUT_MS = Number(process.env.AGENT_WORKFLOW_E2E_TIMEOUT_MS ?? 90_000);
const SERVER_TAIL = 120;
const WEB_DIST = join(ROOT, 'apps', 'web', 'dist');
const WEB_INDEX = join(WEB_DIST, 'index.html');

if (ARGS.has('--help') || ARGS.has('-h')) {
  console.log('usage: node scripts/test-e2e.mjs [--skip-build] [--keep-data]');
  process.exit(0);
}

const log = (...parts) => console.log('[test-e2e]', ...parts);
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function buildWeb() {
  if (SKIP_BUILD) {
    log('skip build (--skip-build)');
  } else {
    log('building web: npm run build:web');
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const result = spawnSync(npm, ['run', 'build:web'], {
      cwd: ROOT,
      stdio: 'inherit',
      env: process.env,
      shell: process.platform === 'win32',
    });
    if (result.error !== undefined) throw result.error;
    assert(result.status === 0, `npm run build:web failed (exit ${String(result.status)})`);
  }
  assert(existsSync(WEB_INDEX), `missing ${WEB_INDEX}; run npm run build:web or drop --skip-build`);
}

function startServer(dataDir) {
  const child = spawn(process.execPath, ['--import', 'tsx', 'packages/server/src/main.ts'], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      AGENT_WORKFLOW_ROOT: ROOT,
      AGENT_WORKFLOW_DATA_DIR: dataDir,
      AGENT_WORKFLOW_HOST: '127.0.0.1',
      AGENT_WORKFLOW_PORT: '0', // OS-assigned loopback port; parsed from stdout
      AGENT_WORKFLOW_DISABLE_OPENCODE: '1',
      AGENT_WORKFLOW_DEBUG: '',
      NODE_ENV: 'test',
    },
  });
  const tail = [];
  const record = (stream, chunk) => {
    for (const line of String(chunk).split(/\r?\n/)) {
      if (line.trim() === '') continue;
      tail.push(`[server:${stream}] ${line}`);
      if (tail.length > SERVER_TAIL) tail.shift();
    }
  };
  child.stdout.on('data', (chunk) => record('out', chunk));
  child.stderr.on('data', (chunk) => record('err', chunk));
  return { child, tail };
}

async function waitForListening(server, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (server.child.exitCode !== null) {
      throw new Error(`server exited before listening (exit ${String(server.child.exitCode)})`);
    }
    for (const line of server.tail) {
      const match = /listening on (http:\/\/[^\s]+)/.exec(line);
      if (match !== null) return match[1];
    }
    await sleep(150);
  }
  throw new Error(`server did not print its listening URL within ${String(timeoutMs)}ms`);
}

async function waitForHealth(baseUrl, server, timeoutMs) {
  const started = Date.now();
  let lastError = 'no response';
  while (Date.now() - started < timeoutMs) {
    if (server.child.exitCode !== null) {
      throw new Error(`server exited while waiting for /api/health (exit ${String(server.child.exitCode)})`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return response;
      lastError = `HTTP ${String(response.status)}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(200);
  }
  throw new Error(`/api/health not ready within ${String(timeoutMs)}ms (${lastError})`);
}

async function getJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { response, text, json };
}

async function runAssertions(baseUrl, dataDir) {
  const health = await getJson(`${baseUrl}/api/health`);
  assert(health.response.status === 200, `/api/health status ${String(health.response.status)}`);
  assert(health.json?.status === 'ok', `/api/health payload invalid: ${health.text.slice(0, 200)}`);
  assert(typeof health.json?.version === 'string' && health.json.version.length > 0, '/api/health missing version');
  log(`health ok (version ${String(health.json.version)})`);

  const bootstrap = await getJson(`${baseUrl}/api/bootstrap`);
  assert(bootstrap.response.status === 200, `/api/bootstrap status ${String(bootstrap.response.status)}`);
  assert(bootstrap.json?.data?.app?.name === 'Agent Workflow', '/api/bootstrap missing app.name');
  assert(bootstrap.json?.data?.data?.dataDir === dataDir, '/api/bootstrap did not report the isolated data dir');
  assert(Array.isArray(bootstrap.json?.data?.projects), '/api/bootstrap missing projects[]');
  log('bootstrap ok (isolated data dir)');

  const home = await fetch(`${baseUrl}/`, { signal: AbortSignal.timeout(10_000) });
  const homeText = await home.text();
  const homeType = home.headers.get('content-type') ?? '';
  assert(home.status === 200, `home status ${String(home.status)}`);
  assert(homeType.includes('text/html'), `home content-type ${homeType} (expected text/html)`);
  assert(homeText.includes('<div id="root">'), 'home HTML is not the built SPA shell');
  assert(/assets\/[^"]+\.js/.test(homeText), 'home HTML does not reference a built JS bundle');
  log('built SPA shell served (200 text/html)');

  const notFound = await getJson(`${baseUrl}/api/not-a-real-route`);
  const notFoundType = notFound.response.headers.get('content-type') ?? '';
  assert(notFound.response.status === 404, `unknown API GET status ${String(notFound.response.status)} (expected 404)`);
  assert(notFoundType.includes('application/json'), `unknown API GET content-type ${notFoundType} (expected JSON)`);
  assert(notFound.json?.error?.code === 'NOT_FOUND', 'unknown API GET did not return error.code=NOT_FOUND');
  log('unknown API GET returns JSON 404 (no SPA fallback)');
}

async function stopServer(server) {
  const child = server.child;
  if (child.exitCode !== null) return;
  const exited = new Promise((resolveExit) => child.once('exit', resolveExit));
  child.kill('SIGTERM');
  const graceful = await Promise.race([exited.then(() => true), sleep(10_000).then(() => false)]);
  if (!graceful) {
    child.kill('SIGKILL');
    await Promise.race([exited, sleep(3_000)]);
  }
}

const dataDir = mkdtempSync(join(tmpdir(), 'agent-workflow-e2e-'));
let server;
let failed = false;
try {
  buildWeb();
  log(`starting server (data dir ${dataDir})`);
  server = startServer(dataDir);
  const baseUrl = await waitForListening(server, BOOT_TIMEOUT_MS);
  log(`server listening on ${baseUrl}`);
  await waitForHealth(baseUrl, server, BOOT_TIMEOUT_MS);
  await runAssertions(baseUrl, dataDir);
  log('PASS: web build + server boot + health/bootstrap/home/404 contract');
} catch (error) {
  failed = true;
  console.error(`[test-e2e] FAIL: ${error instanceof Error ? error.message : String(error)}`);
  if (server !== undefined && server.tail.length > 0) {
    console.error('[test-e2e] server output (tail):');
    for (const line of server.tail) console.error(`  ${line}`);
  }
  process.exitCode = 1;
} finally {
  if (server !== undefined) await stopServer(server).catch(() => undefined);
  if (KEEP_DATA) {
    log(`kept data dir: ${dataDir}`);
  } else {
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
if (!failed) log('done');
