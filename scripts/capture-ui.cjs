const { app, BrowserWindow } = require('electron');
const { spawn } = require('node:child_process');
const { execFileSync } = require('node:child_process');
const { mkdirSync, rmSync, writeFileSync } = require('node:fs');
const { join, resolve } = require('node:path');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('force-device-scale-factor', '1');

const root = resolve(__dirname, '..');
const dataDir = join(root, '.tmp', 'ui-data');
const demoProject = join(root, '.tmp', 'demo-project');
const evidenceDir = join(root, 'evidence');
const port = 5288;
const base = `http://127.0.0.1:${port}`;

const sleep = (ms) => new Promise((resolveWait) => setTimeout(resolveWait, ms));
const requestKey = (prefix) => `req_${prefix}${Math.random().toString(36).slice(2, 21)}`;

async function waitForHealth(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
    } catch {
      // not ready
    }
    await sleep(200);
  }
  throw new Error('server did not become healthy');
}

async function api(path, options = {}) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
    signal: AbortSignal.timeout(60000),
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  if (!response.ok) throw new Error(`${options.method ?? 'GET'} ${path} ${response.status}: ${text.slice(0, 300)}`);
  return body;
}

function prepareDemoRepo() {
  rmSync(demoProject, { recursive: true, force: true });
  mkdirSync(join(demoProject, 'src'), { recursive: true });
  mkdirSync(join(demoProject, 'db'), { recursive: true });
  writeFileSync(join(demoProject, 'README.md'), '# 订单服务\n\n退款单查询与导出服务。\n', 'utf8');
  writeFileSync(join(demoProject, 'src', 'refund-query.js'), 'export function listRefunds() {\n  return [];\n}\n', 'utf8');
  writeFileSync(join(demoProject, 'db', 'schema.sql'), 'CREATE TABLE refund_order (id BIGINT PRIMARY KEY);\n', 'utf8');
  const git = (args) => execFileSync('git', args, { cwd: demoProject, stdio: 'pipe' });
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 'demo@example.com']);
  git(['config', 'user.name', 'Demo']);
  git(['add', '.']);
  git(['commit', '-qm', 'feat: initialize refund service']);
  writeFileSync(join(demoProject, 'src', 'refund-query.js'), 'export function listRefunds(filter) {\n  return filter?.status ?? [];\n}\n', 'utf8');
  git(['add', '.']);
  git(['commit', '-qm', 'feat: support refund status filter']);
}

async function seed() {
  rmSync(dataDir, { recursive: true, force: true });
  prepareDemoRepo();
  const project = await api('/api/projects', {
    method: 'POST',
    body: JSON.stringify({ requestKey: requestKey('prj'), name: '订单服务', rootPath: demoProject, description: '退款单查询与导出（演示数据）' }),
  });
  const projectId = project.data.resource.project.id;
  const task1 = await api('/api/tasks', {
    method: 'POST',
    body: JSON.stringify({
      requestKey: requestKey('task'),
      projectId,
      title: '退款单按状态与日期筛选并导出',
      requirementText:
        'R1 退款单列表支持按状态与日期范围筛选。\nR2 筛选结果支持导出 CSV，字段包含退款单号、状态、金额、创建时间。\nC1 只读退款单数据，不允许修改订单。\n验收：筛选条件、分页与导出结果一致，导出内容与页面一致。',
      methodId: 'method.requirement-development',
    }),
  });
  const taskId = task1.data.resource.task.id;
  const skeleton = await api(`/api/tasks/${taskId}/plan/skeleton`, {
    method: 'POST',
    body: JSON.stringify({ requestKey: requestKey('skel'), confirmUseSkeleton: true }),
  });
  const plan = skeleton.data.resource.plan;
  await api(`/api/tasks/${taskId}/plan/confirm`, {
    method: 'POST',
    body: JSON.stringify({ requestKey: requestKey('conf'), planRevisionId: plan.id, expectedRevisionNumber: plan.revisionNumber, confirmPlan: true }),
  });
  await api(`/api/tasks/${taskId}/workspace/prepare`, {
    method: 'POST',
    body: JSON.stringify({ requestKey: requestKey('prep'), expectedPlanRevisionNumber: plan.revisionNumber, expectedBaseRef: 'main', confirmPrepare: true }),
  });
  const task2 = await api('/api/tasks', {
    method: 'POST',
    body: JSON.stringify({
      requestKey: requestKey('task'),
      projectId,
      title: '会员积分体系重构',
      requirementText: 'R1 会员积分规则集中配置。\nR2 历史积分流水可追溯。\n验收：规则变更不影响历史流水。',
      methodId: 'method.requirement-development',
    }),
  });
  return { projectId, taskId, task2Id: task2.data.resource.task.id };
}

async function capture(window, url, file, waitMs = 2600) {
  await window.loadURL(`${base}${url}`);
  await sleep(waitMs);
  const image = await window.webContents.capturePage();
  writeFileSync(join(evidenceDir, file), image.toPNG());
  console.log(`[capture] ${url} → evidence/${file}`);
}

async function main() {
  mkdirSync(evidenceDir, { recursive: true });
  let server;
  try {
    try {
      const existing = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(800) });
      if (existing.ok) throw new Error(`port ${port} already has a server`);
    } catch (error) {
      if (error instanceof Error && error.message.includes('already has a server')) throw error;
    }
    server = spawn(process.execPath, [join(root, '.build', 'server', 'main.mjs')], {
      cwd: root,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        AGENT_WORKFLOW_ROOT: root,
        AGENT_WORKFLOW_DATA_DIR: dataDir,
        AGENT_WORKFLOW_PORT: String(port),
        AGENT_WORKFLOW_HOST: '127.0.0.1',
        AGENT_WORKFLOW_DISABLE_OPENCODE: '1',
        AGENT_WORKFLOW_WEB_DIST: join(root, 'apps', 'web', 'dist'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    server.stdout.on('data', (chunk) => process.stdout.write(`[server] ${chunk}`));
    server.stderr.on('data', (chunk) => process.stderr.write(`[server] ${chunk}`));
    await waitForHealth();
    const seeded = await seed();
    console.log('[capture] seeded', JSON.stringify(seeded));

    const window = new BrowserWindow({
      width: 1440,
      height: 900,
      show: false,
      webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false },
    });
    await capture(window, '/', 'ui-home-deepseek.png');
    await capture(window, '/tasks', 'ui-tasks-deepseek.png');
    await capture(window, `/requirement/${seeded.taskId}`, 'ui-requirement-canvas.png');
    await capture(window, `/tasks/${seeded.taskId}`, 'ui-task-canvas.png');
    await capture(window, '/start', 'ui-start.png');
    await capture(window, '/git', 'ui-git.png');
    await capture(window, '/settings', 'ui-settings.png');
    await capture(window, '/?theme=warm', 'ui-home-warm.png');
    await capture(window, '/?theme=spdb', 'ui-home-spdb.png');
    await capture(window, '/?theme=github-white', 'ui-home-github-white.png');
    window.destroy();
  } finally {
    server?.kill('SIGTERM');
    await sleep(500);
    server?.kill('SIGKILL');
    app.quit();
  }
}

app.whenReady().then(() => {
  main().catch((error) => {
    console.error('[capture] failed', error);
    process.exitCode = 1;
    app.quit();
  });
});
