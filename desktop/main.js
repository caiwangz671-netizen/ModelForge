if (process.env.ELECTRON_RUN_AS_NODE === '1' && process.env.MODELFORGE_ELECTRON_RELAUNCHED !== '1') {
  const { spawnSync } = require('child_process');

  const relaunchEnv = {
    ...process.env,
    MODELFORGE_ELECTRON_RELAUNCHED: '1',
  };
  delete relaunchEnv.ELECTRON_RUN_AS_NODE;

  const relaunch = spawnSync(process.execPath, [__dirname], {
    env: relaunchEnv,
    stdio: 'inherit',
  });

  if (relaunch.error) {
    console.error('Failed to relaunch Electron without ELECTRON_RUN_AS_NODE:', relaunch.error);
    process.exit(1);
  }

  process.exit(relaunch.status ?? 0);
}

const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const net = require('net');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { startComputerHelperServer } = require('./computer-helper');

const BACKEND_PORT = process.env.BACKEND_PORT || '18000';
const DEFAULT_OLLAMA_HOST = 'http://127.0.0.1:11434';
const RAW_OLLAMA_HOST = process.env.OLLAMA_HOST || DEFAULT_OLLAMA_HOST;
const AUTO_START_OLLAMA = (process.env.MODELFORGE_AUTOSTART_OLLAMA || 'true').toLowerCase() !== 'false';
const OLLAMA_STARTUP_TIMEOUT_MS = Number(process.env.MODELFORGE_OLLAMA_STARTUP_TIMEOUT_MS || 20000);

let backendProcess;
let mainWindow;
let computerHelper;
let reusingExistingBackend = false;

function registerDesktopIpcHandlers() {
  ipcMain.handle('desktop:pick-directories', async (event, options = {}) => {
    const sourceWindow = BrowserWindow.fromWebContents(event.sender) || mainWindow || undefined;
    const allowMultiple = Boolean(options && typeof options === 'object' && options.multiple);
    const result = await dialog.showOpenDialog(sourceWindow, {
      title: 'Select Folder',
      defaultPath: app.getPath('home'),
      properties: [
        'openDirectory',
        'createDirectory',
        'dontAddToRecent',
        ...(allowMultiple ? ['multiSelections'] : []),
      ],
    });
    if (result.canceled) {
      return [];
    }
    return Array.isArray(result.filePaths) ? result.filePaths : [];
  });
}

function normalizeOllamaHost(rawHost) {
  const host = String(rawHost || '').trim();
  if (!host) return DEFAULT_OLLAMA_HOST;
  if (/^https?:\/\//i.test(host)) return host;
  return `http://${host}`;
}

const OLLAMA_HOST = normalizeOllamaHost(RAW_OLLAMA_HOST);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function canAutostartOllama(baseUrl) {
  try {
    const hostname = new URL(baseUrl).hostname;
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  } catch {
    return false;
  }
}

async function isOllamaReady(baseUrl = OLLAMA_HOST) {
  let versionUrl = '';
  try {
    versionUrl = new URL('/api/version', baseUrl).toString();
  } catch {
    return false;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);
  try {
    const response = await fetch(versionUrl, { method: 'GET', signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function isBackendReady(port = BACKEND_PORT) {
  let healthUrl = '';
  try {
    healthUrl = new URL(`/api/system/health`, `http://127.0.0.1:${port}`).toString();
  } catch {
    return false;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);
  try {
    const response = await fetch(healthUrl, { method: 'GET', signal: controller.signal });
    if (!response.ok) return false;
    const payload = await response.json().catch(() => null);
    return Boolean(payload && payload.status === 'healthy');
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function isPortBindable(port = Number(BACKEND_PORT), host = '127.0.0.1') {
  return await new Promise((resolve) => {
    const server = net.createServer();

    server.once('error', () => {
      resolve(false);
    });

    server.once('listening', () => {
      server.close(() => resolve(true));
    });

    server.listen(port, host);
  });
}

function spawnDetached(command, args) {
  try {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' });
    child.unref();
    return true;
  } catch (error) {
    console.warn(
      `Failed to launch "${command} ${args.join(' ')}":`,
      error instanceof Error ? error.message : String(error)
    );
    return false;
  }
}

function tryLaunchOllama() {
  let launched = false;

  if (process.platform === 'darwin') {
    launched = spawnDetached('open', ['-g', '-a', 'Ollama']) || launched;
  }

  if (process.platform === 'win32') {
    launched = spawnDetached('cmd', ['/c', 'start', '', 'ollama', 'serve']) || launched;
  } else {
    launched = spawnDetached('ollama', ['serve']) || launched;
  }

  return launched;
}

async function ensureOllamaRunning() {
  if (!AUTO_START_OLLAMA) return;
  if (!canAutostartOllama(OLLAMA_HOST)) return;

  if (await isOllamaReady()) return;

  console.log(`Ollama not detected at ${OLLAMA_HOST}, attempting auto-start...`);
  const launched = tryLaunchOllama();
  if (!launched) {
    console.warn('Unable to auto-start Ollama. Please make sure Ollama is installed and accessible.');
    return;
  }

  const timeoutMs = Number.isFinite(OLLAMA_STARTUP_TIMEOUT_MS)
    ? Math.max(5000, OLLAMA_STARTUP_TIMEOUT_MS)
    : 20000;
  const startAt = Date.now();

  while (Date.now() - startAt < timeoutMs) {
    if (await isOllamaReady()) {
      console.log('Ollama is ready.');
      return;
    }
    await sleep(500);
  }

  await dialog
    .showMessageBox({
      type: 'warning',
      title: 'Ollama 未就绪',
      message:
        'ModelForge 已尝试自动启动 Ollama，但在等待超时内未检测到服务。请检查 Ollama 是否已安装并手动启动后重试。',
    })
    .catch(() => {});
}

function resolveExistingPath(candidates, missingMessage) {
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(`${missingMessage}. Tried:\n${candidates.join('\n')}`);
}

function resolveBackendExecutable() {
  const executableName = process.platform === 'win32' ? 'backend-api.exe' : 'backend-api';

  if (app.isPackaged) {
    return resolveExistingPath(
      [
        path.join(__dirname, 'backend-bin', executableName),
        path.join(__dirname, 'backend', 'dist', 'backend-api', executableName),
        path.join(process.resourcesPath, 'app', 'backend-bin', executableName),
        path.join(process.resourcesPath, 'backend', 'dist', 'backend-api', executableName),
        path.join(process.resourcesPath, 'backend-bin', executableName),
      ],
      'Backend executable not found'
    );
  }

  return path.resolve(__dirname, '..', 'backend', 'dist', 'backend-api', executableName);
}

function resolveFrontendEntry() {
  if (app.isPackaged) {
    return resolveExistingPath(
      [
        path.join(__dirname, 'frontend-dist', 'index.html'),
        path.join(__dirname, 'frontend', 'dist', 'index.html'),
        path.join(process.resourcesPath, 'app', 'frontend-dist', 'index.html'),
        path.join(process.resourcesPath, 'frontend', 'dist', 'index.html'),
      ],
      'Frontend dist not found'
    );
  }

  return path.resolve(__dirname, '..', 'frontend', 'dist', 'index.html');
}

function ensureFileExists(filePath, message) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${message}: ${filePath}`);
  }
}

async function startBackend() {
  const backendExec = resolveBackendExecutable();
  ensureFileExists(backendExec, 'Backend executable not found');

  if (await isBackendReady(BACKEND_PORT)) {
    reusingExistingBackend = true;
    console.log(`Reusing existing backend on port ${BACKEND_PORT}`);
    return;
  }

  if (!(await isPortBindable(Number(BACKEND_PORT)))) {
    throw new Error(
      `Backend port ${BACKEND_PORT} is already in use by another process. Close other ModelForge instances and try again.`
    );
  }

  const userDataDir = app.getPath('userData');
  const dbPath = path.join(userDataDir, 'ollama_studio.db');
  const computerUseDir = path.join(userDataDir, 'computer-use');

  const env = {
    ...process.env,
    BACKEND_HOST: '127.0.0.1',
    BACKEND_PORT,
    OLLAMA_HOST,
    DEBUG: 'false',
    CORS_ORIGINS: 'null,http://localhost:5173,http://localhost:3000',
    DATABASE_URL: `sqlite+aiosqlite:///${dbPath}`,
    MODELFORGE_DESKTOP_MODE: 'true',
    MODELFORGE_COMPUTER_USE_DIR: computerUseDir,
    MODELFORGE_COMPUTER_HELPER_URL: computerHelper?.url || '',
    MODELFORGE_COMPUTER_HELPER_TOKEN: computerHelper?.token || '',
  };

  backendProcess = spawn(backendExec, [], {
    env,
    stdio: 'inherit',
  });

  backendProcess.on('exit', (code, signal) => {
    backendProcess = undefined;
    if (!app.isQuiting) {
      dialog.showErrorBox(
        'Backend Exited',
        `The backend process stopped unexpectedly (code: ${code ?? 'null'}, signal: ${signal ?? 'null'}).`
      );
      app.quit();
    }
  });

  // Wait for the backend to be ready before returning, so createWindow() is
  // only called once the API is actually serving requests.
  const BACKEND_STARTUP_TIMEOUT_MS = 30000;
  const startAt = Date.now();
  while (Date.now() - startAt < BACKEND_STARTUP_TIMEOUT_MS) {
    if (await isBackendReady(BACKEND_PORT)) {
      console.log('Backend is ready.');
      return;
    }
    await sleep(500);
  }
  throw new Error(`Backend did not become ready within ${BACKEND_STARTUP_TIMEOUT_MS / 1000}s. Check logs for details.`);
}

function stopBackend() {
  if (reusingExistingBackend) {
    reusingExistingBackend = false;
    return;
  }
  if (backendProcess && !backendProcess.killed) {
    backendProcess.kill('SIGTERM');
  }
}

async function startComputerHelper() {
  computerHelper = await startComputerHelperServer({
    getMainWindow: () => mainWindow,
  });
  console.log(`Computer helper listening at ${computerHelper.url}`);
}

async function stopComputerHelper() {
  if (!computerHelper) return;
  try {
    await computerHelper.stop();
  } catch (error) {
    console.warn('Failed to stop computer helper cleanly:', error);
  } finally {
    computerHelper = undefined;
  }
}

function createWindow() {
  const frontendEntry = resolveFrontendEntry();
  ensureFileExists(frontendEntry, 'Frontend dist not found');

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.loadFile(frontendEntry);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = undefined;
  });
}

app.isQuiting = false;

const singleInstanceLock = app.requestSingleInstanceLock();

if (!singleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.focus();
  });
  app.whenReady().then(async () => {
    try {
      registerDesktopIpcHandlers();
      console.log('Launch stage: ensureOllamaRunning');
      await ensureOllamaRunning();
      console.log('Launch stage: startComputerHelper');
      await startComputerHelper();
      console.log('Launch stage: startBackend');
      await startBackend();
      console.log('Launch stage: createWindow');
      createWindow();
      console.log('Launch stage: ready');
    } catch (error) {
      console.error('Launch Failed:', error);
      dialog.showErrorBox('Launch Failed', error instanceof Error ? error.message : String(error));
      await stopComputerHelper();
      app.quit();
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });
}

app.on('before-quit', () => {
  app.isQuiting = true;
  stopBackend();
  void stopComputerHelper();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
