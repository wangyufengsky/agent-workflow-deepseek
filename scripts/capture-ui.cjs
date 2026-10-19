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

async function capture(window, url, file, options = {}) {
  const { waitMs = 2600, expect = [], theme } = options;
  await window.loadURL(`${base}${url}`);
  await sleep(waitMs);
  const text = await window.webContents.executeJavaScript('document.body.innerText');
  if (typeof text !== 'string' || text.trim().length < 20) {
    throw new Error(`UI smoke: ${url} rendered an empty page`);
  }
  for (const phrase of expect) {
    if (!text.includes(phrase)) throw new Error(`UI smoke: ${url} is missing expected text: ${phrase}`);
  }
  if (theme !== undefined) {
    const actual = await window.webContents.executeJavaScript('document.documentElement.dataset.theme');
    if (actual !== theme) throw new Error(`UI smoke: ${url} theme expected ${theme}, got ${String(actual)}`);
  }
  const image = await window.webContents.capturePage();
  writeFileSync(join(evidenceDir, file), image.toPNG());
  console.log(`[smoke] ${url} ok (${expect.join('/') || 'render'}) → evidence/${file}`);
}

async function smokeDatabaseForm(window) {
  await window.loadURL(`${base}/databases`);
  await sleep(2200);
  const opened = await window.webContents.executeJavaScript(`(() => {
    const button = [...document.querySelectorAll('button')].find((item) => item.textContent && item.textContent.includes('添加连接'));
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!opened) throw new Error('UI smoke: 添加只读连接 button not found');
  await sleep(500);
  const focused = await window.webContents.executeJavaScript(`(() => {
    const input = document.querySelector('#db-name');
    if (!input) return false;
    input.focus();
    return document.activeElement === input;
  })()`);
  if (!focused) throw new Error('UI smoke: 连接名称 input not focusable');
  // A full Spring datasource URL pasted into the host field must be split.
  const hostFocused = await window.webContents.executeJavaScript(`(() => { const input = document.querySelector('#db-host'); if (!input) return false; input.focus(); return true; })()`);
  if (!hostFocused) throw new Error('UI smoke: 主机 input not found');
  window.webContents.insertText('jdbc:mysql://127.0.0.1:3306/opencode_workflow_test?connectionTimeZone=UTC&forceConnectionTimeZoneToSession=true');
  await sleep(350);
  const split = await window.webContents.executeJavaScript(`({
    type: document.querySelector('#db-type')?.value ?? '',
    host: document.querySelector('#db-host')?.value ?? '',
    port: document.querySelector('#db-port')?.value ?? '',
    database: document.querySelector('#db-database')?.value ?? ''
  })`);
  if (split.type !== 'mysql' || split.host !== '127.0.0.1' || split.port !== '3306' || split.database !== 'opencode_workflow_test') {
    throw new Error(`UI smoke: JDBC URL was not split (${JSON.stringify(split)})`);
  }
  await window.webContents.executeJavaScript(`document.querySelector('#db-name')?.focus()`);
  for (let index = 0; index < 5; index += 1) {
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'a' });
    window.webContents.sendInputEvent({ type: 'char', keyCode: 'a' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'a' });
    await sleep(80);
  }
  await sleep(300);
  const state = await window.webContents.executeJavaScript(`({ value: document.querySelector('#db-name')?.value ?? '', active: document.activeElement?.id ?? '' })`);
  if (state.value !== 'aaaaa' || state.active !== 'db-name') {
    throw new Error(`UI smoke: database form lost focus/input (${JSON.stringify(state)})`);
  }
  console.log('[smoke] /databases drawer typing ok (aaaaa, focus kept)');
}

async function smokeProjectPicker(window) {
  await window.loadURL(`${base}/projects`);
  await sleep(2200);
  const opened = await window.webContents.executeJavaScript(`(() => {
    const button = [...document.querySelectorAll('button')].find((item) => item.textContent && item.textContent.trim() === '登记项目');
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!opened) throw new Error('UI smoke: 登记项目 button not found');
  await sleep(400);
  const pickerOpened = await window.webContents.executeJavaScript(`(() => {
    const button = [...document.querySelectorAll('button')].find((item) => item.textContent && item.textContent.includes('选择文件夹'));
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!pickerOpened) throw new Error('UI smoke: 选择文件夹 button not found');
  await sleep(900);
  const state = await window.webContents.executeJavaScript(`({
    dialog: [...document.querySelectorAll('[role="dialog"]')].some((node) => node.getAttribute('aria-label') === '选择项目文件夹'),
    home: [...document.querySelectorAll('button')].some((item) => item.textContent && item.textContent.includes('主目录')),
    rows: [...document.querySelectorAll('[role="dialog"] .list-row')].length
  })`);
  if (!state.dialog || !state.home) throw new Error(`UI smoke: folder picker did not open (${JSON.stringify(state)})`);
  await window.webContents.executeJavaScript(`(() => { const close = document.querySelector('[role="dialog"] button[aria-label="关闭对话框"]'); if (close) close.click(); return true; })()`);
  console.log(`[smoke] /projects folder picker ok (entries=${String(state.rows)})`);
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
    await capture(window, '/', 'ui-home-deepseek.png', { expect: ['工作区', '主页'], theme: 'deepseek' });
    await capture(window, '/tasks', 'ui-tasks-deepseek.png', { expect: ['任务列表'] });
    await capture(window, `/requirement/${seeded.taskId}`, 'ui-requirement-canvas.png', { expect: ['需求'] });
    await capture(window, `/tasks/${seeded.taskId}`, 'ui-task-canvas.png', { expect: ['执行面板', '开始执行'] });
    await capture(window, '/start', 'ui-start.png', { expect: ['开始任务'] });
    await capture(window, '/git', 'ui-git.png', { expect: ['Git'] });
    await capture(window, '/settings', 'ui-settings.png', { expect: ['设置'] });
    await capture(window, '/settings?section=model', 'ui-settings-model.png', { expect: ['模型与执行', '职责模型', '添加模型', 'OpenCode 可执行文件'] });
    await capture(window, '/?theme=warm', 'ui-home-warm.png', { expect: ['工作区'], theme: 'warm' });
    await capture(window, '/?theme=spdb', 'ui-home-spdb.png', { expect: ['工作区'], theme: 'spdb' });
    await capture(window, '/?theme=github-white', 'ui-home-github-white.png', { expect: ['工作区'], theme: 'github-white' });
    await smokeDatabaseForm(window);
    await smokeProjectPicker(window);
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
