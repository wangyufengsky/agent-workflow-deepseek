import { exportArtifact } from './artifact-export.ts';
import { writeFile } from 'node:fs/promises';
import type { ArtifactExportRequest } from '@agent-workflow/shared';
import electron from 'electron';
import type { BrowserWindow as ElectronBrowserWindow } from 'electron';

const { app, BrowserWindow, dialog, ipcMain, shell } = electron;
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..', '..');
const dataDir = process.env.AGENT_WORKFLOW_DATA_DIR ?? join(app.getPath('userData'), 'data');
const devUrl = process.env.AGENT_WORKFLOW_DEV_URL;
const preferredPort = Number(process.env.AGENT_WORKFLOW_PORT ?? 5288);
let trustedBaseUrl: string | undefined;
let serverProcess: ChildProcess | undefined;
let mainWindow: ElectronBrowserWindow | undefined;

async function waitForServer(url: string, timeoutMs = 30000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(1500) });
      if (response.ok) return true;
    } catch {
      // Not up yet.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 300));
  }
  return false;
}

async function startServer(): Promise<string> {
  const serverUrl = `http://127.0.0.1:${preferredPort}`;
  if (await waitForServer(serverUrl, 1200)) return serverUrl;
  const entry = join(repoRoot, '.build', 'server', 'main.mjs');
  if (!existsSync(entry)) throw new Error(`服务端构建不存在：${entry}，请先运行 npm run build:server`);
  serverProcess = spawn(process.execPath, [entry], {
    cwd: repoRoot,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      AGENT_WORKFLOW_ROOT: repoRoot,
      AGENT_WORKFLOW_DATA_DIR: dataDir,
      AGENT_WORKFLOW_PORT: String(preferredPort),
      AGENT_WORKFLOW_HOST: '127.0.0.1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  serverProcess.stdout?.on('data', (chunk: Buffer) => process.stdout.write(`[server] ${chunk.toString()}`));
  serverProcess.stderr?.on('data', (chunk: Buffer) => process.stderr.write(`[server] ${chunk.toString()}`));
  if (!(await waitForServer(serverUrl))) throw new Error('本地服务启动超时');
  return serverUrl;
}

async function createWindow(): Promise<void> {
  const url = devUrl ?? (await startServer());
  trustedBaseUrl = url;
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#0a0a0a',
    title: 'Agent Workflow',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 18 },
    webPreferences: {
      preload: join(import.meta.dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(({ url: target }: { url: string }) => {
    if (target.startsWith('https://')) void shell.openExternal(target);
    return { action: 'deny' };
  });
  const targetUrl = url + (process.env.AGENT_WORKFLOW_START_PATH ?? '');
  await mainWindow.loadURL(targetUrl);
  const capturePath = process.env.AGENT_WORKFLOW_CAPTURE;
  if (capturePath !== undefined) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 2500));
    const image = await mainWindow.webContents.capturePage();
    const { writeFileSync } = await import('node:fs');
    writeFileSync(capturePath, image.toPNG());
    console.log(`[agent-workflow] captured ${capturePath}`);
    app.quit();
    return;
  }
  mainWindow.on('closed', () => {
    mainWindow = undefined;
  });
}

ipcMain.handle('workflow:exportArtifact', async (event, input: ArtifactExportRequest) => {
  if (!mainWindow || !trustedBaseUrl || event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame || new URL(event.senderFrame.url).origin !== new URL(trustedBaseUrl).origin) return { status: 'unsupported' };
  return exportArtifact(input, {
    baseUrl: trustedBaseUrl,
    fetch,
    choosePath: async (filename) => {
      const result = await dialog.showSaveDialog(mainWindow!, { defaultPath: filename, title: '保存产物' });
      return result.canceled ? undefined : result.filePath;
    },
    write: (path, bytes) => writeFile(path, bytes),
  });
});

ipcMain.handle('workflow:openExternal', async (_event, url: unknown) => {
  if (typeof url !== 'string' || !/^https?:\/\//.test(url)) return false;
  await shell.openExternal(url);
  return true;
});

ipcMain.handle('workflow:revealInFileManager', async (_event, target: unknown) => {
  if (typeof target !== 'string') return false;
  const resolved = resolve(target);
  if (!resolved.startsWith(resolve(dataDir))) return false;
  shell.showItemInFolder(resolved);
  return true;
});

ipcMain.handle('workflow:pickDirectory', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
  return result.canceled ? undefined : result.filePaths[0];
});

app.whenReady().then(async () => {
  try {
    await createWindow();
  } catch (error) {
    dialog.showErrorBox('Agent Workflow 启动失败', error instanceof Error ? error.message : String(error));
    app.quit();
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (serverProcess !== undefined && serverProcess.exitCode === null) {
    serverProcess.kill('SIGTERM');
    serverProcess = undefined;
  }
});
