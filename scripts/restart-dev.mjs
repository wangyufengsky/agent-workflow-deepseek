#!/usr/bin/env node
/**
 * Restart the local dev stack (server + Vite) and deploy the latest web build.
 *
 * Usage:
 *   npm run dev:restart
 *   AGENT_WORKFLOW_DATA_DIR=.tmp/view-data AGENT_WORKFLOW_PORT=5177 npm run dev:restart
 *
 * The server is started detached with logs in .tmp/dev.log, so it survives the
 * invoking shell. Existing listeners on the server/web ports are stopped first.
 */
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, openSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const serverPort = Number(process.env.AGENT_WORKFLOW_PORT ?? 5177);
const webPort = Number(process.env.AGENT_WORKFLOW_WEB_PORT ?? 5173);
const dataDir = resolve(root, process.env.AGENT_WORKFLOW_DATA_DIR ?? '.data');
const host = process.env.AGENT_WORKFLOW_HOST ?? '127.0.0.1';
const logPath = join(root, '.tmp', 'dev.log');

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

function listeners(port) {
  try {
    return execFileSync('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' })
      .split('\n').map((line) => Number(line.trim())).filter((pid) => Number.isInteger(pid) && pid > 1);
  } catch {
    return [];
  }
}

function processGroup(pid) {
  try {
    return Number(execFileSync('ps', ['-o', 'pgid=', '-p', String(pid)], { encoding: 'utf8' }).trim());
  } catch {
    return undefined;
  }
}

async function stopPort(port) {
  const pids = listeners(port);
  if (pids.length === 0) return;
  const groups = new Set(pids.map(processGroup).filter((group) => group !== undefined && group > 1));
  for (const pid of pids) { try { process.kill(pid, 'SIGTERM'); } catch {} }
  for (const group of groups) { try { process.kill(-group, 'SIGTERM'); } catch {} }
  await sleep(1500);
  for (const pid of listeners(port)) { try { process.kill(pid, 'SIGKILL'); } catch {} }
  for (const group of groups) { try { process.kill(-group, 'SIGKILL'); } catch {} }
}

async function waitFor(predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if (await predicate()) return; } catch {}
    await sleep(400);
  }
  throw new Error(`${label} did not become ready within ${String(timeoutMs)}ms`);
}

await stopPort(serverPort);
await stopPort(webPort);
console.log(`[restart] stopped listeners on :${String(serverPort)} and :${String(webPort)}`);

console.log('[restart] building web assets for the server-served UI…');
execFileSync('npm', ['run', 'build:web'], { cwd: root, stdio: 'inherit' });

mkdirSync(join(root, '.tmp'), { recursive: true });
const logFd = openSync(logPath, 'a');
const env = { ...process.env, AGENT_WORKFLOW_DATA_DIR: dataDir, AGENT_WORKFLOW_PORT: String(serverPort) };
delete env.AGENT_WORKFLOW_DISABLE_OPENCODE;
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn('npm', ['run', 'dev'], { cwd: root, env, detached: true, stdio: ['ignore', logFd, logFd] });
child.unref();
console.log(`[restart] started dev stack pid=${String(child.pid)} data=${dataDir} log=${logPath}`);

await waitFor(async () => {
  const response = await fetch(`http://${host}:${String(serverPort)}/api/health`, { signal: AbortSignal.timeout(1000) });
  return response.ok;
}, 60_000, 'server health');
await waitFor(async () => {
  const response = await fetch(`http://${host}:${String(serverPort)}/api/opencode/status`, { signal: AbortSignal.timeout(2000) });
  if (!response.ok) return false;
  const body = await response.json();
  return body.data?.status?.state === 'ready';
}, 90_000, 'managed OpenCode');

const status = await (await fetch(`http://${host}:${String(serverPort)}/api/opencode/status`)).json();
const info = status.data.status;
console.log(`[restart] ready · ui=http://${host}:${String(serverPort)} · vite=http://${host}:${String(webPort)}`);
console.log(`[restart] opencode=${String(info.state)} v${String(info.version)} managed=${String(info.managed)} mcp=${String(info.mcp.connected)} tools=${String(info.mcp.tools)} sessions=${String(info.sessions)}/${String(info.maxSessions)} (total ${String(info.totalSessions)})`);
