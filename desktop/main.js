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

const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const net = require('net');
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { startComputerHelperServer } = require('./computer-helper');

const BACKEND_PORT = process.env.BACKEND_PORT || '18000';
const DEFAULT_OLLAMA_HOST = 'http://127.0.0.1:11434';
const RAW_OLLAMA_HOST = process.env.OLLAMA_HOST || DEFAULT_OLLAMA_HOST;
const AUTO_START_OLLAMA = (process.env.MODELFORGE_AUTOSTART_OLLAMA || 'true').toLowerCase() !== 'false';
const OLLAMA_STARTUP_TIMEOUT_MS = Number(process.env.MODELFORGE_OLLAMA_STARTUP_TIMEOUT_MS || 20000);
const RECOMMENDED_STARTER_MODEL = 'qwen3.5:4b';

let backendProcess;
let backendLogStream;
let backendLogPath;
let mainWindow;
let computerHelper;
let reusingExistingBackend = false;
let ollamaInstallState = {
  status: 'idle',
  launchedAt: null,
  completedAt: null,
  lastError: null,
  command: '',
  background: true,
};

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

  ipcMain.handle('desktop:get-ollama-status', async () => {
    return await getDesktopOllamaStatus();
  });

  ipcMain.handle('desktop:install-ollama', async (event, options = {}) => {
    const background = !options || typeof options !== 'object' || options.background !== false;
    return await startOllamaInstall({ background });
  });

  ipcMain.handle('desktop:open-external', async (event, targetUrl) => {
    if (!targetUrl || typeof targetUrl !== 'string') return false;
    await shell.openExternal(targetUrl);
    return true;
  });
}

function normalizeOllamaHost(rawHost) {
  const host = String(rawHost || '').trim();
  if (!host) return DEFAULT_OLLAMA_HOST;
  if (/^https?:\/\//i.test(host)) return host;
  return `http://${host}`;
}

const OLLAMA_HOST = normalizeOllamaHost(RAW_OLLAMA_HOST);
let runtimeOllamaHost = OLLAMA_HOST;

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
  const candidates = Array.from(new Set([
    normalizeOllamaHost(baseUrl),
    DEFAULT_OLLAMA_HOST,
    'http://localhost:11434',
  ]));

  for (const candidate of candidates) {
    let versionUrl = '';
    let tagsUrl = '';
    try {
      versionUrl = new URL('/api/version', candidate).toString();
      tagsUrl = new URL('/api/tags', candidate).toString();
    } catch {
      continue;
    }

    for (const targetUrl of [versionUrl, tagsUrl]) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 1800);
      try {
        const response = await fetch(targetUrl, { method: 'GET', signal: controller.signal });
        if (response.ok) {
          return { ready: true, host: candidate };
        }
      } catch {
        // Try the next probe.
      } finally {
        clearTimeout(timeout);
      }
    }
  }

  return { ready: false, host: normalizeOllamaHost(baseUrl) };
}

function getOllamaDownloadUrl(platform = process.platform) {
  switch (platform) {
    case 'win32':
      return 'https://ollama.com/download/windows';
    case 'linux':
      return 'https://ollama.com/download/linux';
    case 'darwin':
    default:
      return 'https://ollama.com/download';
  }
}

function getOllamaInstallCommand(platform = process.platform) {
  if (platform === 'win32') {
    return 'powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://ollama.com/install.ps1 | iex"';
  }
  return 'curl -fsSL https://ollama.com/install.sh | sh';
}

function commandSucceeds(command, args, extraOptions = {}) {
  try {
    const result = spawnSync(command, args, {
      stdio: 'ignore',
      timeout: 2000,
      windowsHide: true,
      ...extraOptions,
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

function detectOllamaInstalled() {
  if (process.platform === 'darwin') {
    const appCandidates = [
      '/Applications/Ollama.app',
      path.join(app.getPath('home'), 'Applications', 'Ollama.app'),
    ];
    if (appCandidates.some((candidate) => fs.existsSync(candidate))) {
      return true;
    }
    if (commandSucceeds('open', ['-Ra', 'Ollama'])) {
      return true;
    }
    return commandSucceeds('ollama', ['--version']);
  }

  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || '';
    const programFiles = process.env.ProgramFiles || '';
    const candidates = [
      path.join(localAppData, 'Programs', 'Ollama', 'Ollama.exe'),
      path.join(programFiles, 'Ollama', 'Ollama.exe'),
    ].filter(Boolean);
    if (candidates.some((candidate) => fs.existsSync(candidate))) {
      return true;
    }
    return commandSucceeds('where', ['ollama']);
  }

  return commandSucceeds('which', ['ollama']);
}

function updateOllamaInstallState(nextState) {
  ollamaInstallState = {
    ...ollamaInstallState,
    ...nextState,
  };
}

async function getDesktopOllamaStatus() {
  const probe = await isOllamaReady(runtimeOllamaHost);
  if (probe.ready) {
    runtimeOllamaHost = probe.host;
  }

  const installed = detectOllamaInstalled();
  if ((probe.ready || installed) && ollamaInstallState.status === 'installing') {
    updateOllamaInstallState({
      status: 'completed',
      completedAt: Date.now(),
      lastError: null,
    });
  }

  return {
    platform: process.platform,
    installed,
    running: probe.ready,
    host: probe.host || runtimeOllamaHost,
    install_state: ollamaInstallState.status,
    install_started_at: ollamaInstallState.launchedAt,
    install_completed_at: ollamaInstallState.completedAt,
    install_command: getOllamaInstallCommand(process.platform),
    download_url: getOllamaDownloadUrl(process.platform),
    recommended_model: RECOMMENDED_STARTER_MODEL,
    background: Boolean(ollamaInstallState.background),
    last_error: ollamaInstallState.lastError,
  };
}

function startMacOllamaInstall(command) {
  const escapedCommand = command.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return spawnDetached('osascript', [
    '-e',
    `tell application "Terminal" to do script "${escapedCommand}"`,
    '-e',
    'tell application "Terminal" to activate',
  ]);
}

function startWindowsOllamaInstall(command) {
  return spawnDetached('cmd', ['/c', 'start', '', 'powershell', '-NoExit', '-ExecutionPolicy', 'Bypass', '-Command', command]);
}

function startLinuxOllamaInstall(command) {
  const terminalCandidates = [
    ['x-terminal-emulator', ['-e', `bash -lc '${command.replace(/'/g, `'\\''`)}'`]],
    ['gnome-terminal', ['--', 'bash', '-lc', command]],
    ['konsole', ['-e', 'bash', '-lc', command]],
    ['xfce4-terminal', ['-e', `bash -lc '${command.replace(/'/g, `'\\''`)}'`]],
    ['xterm', ['-e', `bash -lc '${command.replace(/'/g, `'\\''`)}'`]],
  ];

  for (const [binary, args] of terminalCandidates) {
    if (spawnDetached(binary, args)) {
      return true;
    }
  }
  return false;
}

async function startOllamaInstall(options = {}) {
  const background = options.background !== false;
  const command = getOllamaInstallCommand(process.platform);

  updateOllamaInstallState({
    status: 'installing',
    launchedAt: Date.now(),
    completedAt: null,
    lastError: null,
    command,
    background,
  });

  let launched = false;
  if (process.platform === 'darwin') {
    launched = startMacOllamaInstall(command);
  } else if (process.platform === 'win32') {
    launched = startWindowsOllamaInstall('irm https://ollama.com/install.ps1 | iex');
  } else {
    launched = startLinuxOllamaInstall(command);
  }

  if (!launched) {
    updateOllamaInstallState({
      status: 'failed',
      lastError: 'Failed to launch the Ollama installer command.',
    });
  }

  return await getDesktopOllamaStatus();
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
    const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
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

function windowsOllamaLaunchCandidates() {
  const localAppData = process.env.LOCALAPPDATA || '';
  const candidates = [];

  if (localAppData) {
    const installedExe = path.join(localAppData, 'Programs', 'Ollama', 'Ollama.exe');
    candidates.push(['cmd', ['/c', 'start', '', installedExe]]);
  }

  candidates.push(['cmd', ['/c', 'start', '', 'ollama', 'app']]);
  candidates.push(['cmd', ['/c', 'start', '', 'ollama', 'serve']]);
  return candidates;
}

function tryLaunchOllama() {
  if (process.platform === 'darwin') {
    return spawnDetached('open', ['-g', '-a', 'Ollama']);
  }

  if (process.platform === 'win32') {
    for (const [command, args] of windowsOllamaLaunchCandidates()) {
      if (spawnDetached(command, args)) {
        return true;
      }
    }
    return false;
  }

  return spawnDetached('ollama', ['serve']);
}

async function ensureOllamaRunning() {
  if (!AUTO_START_OLLAMA) return;
  if (!canAutostartOllama(OLLAMA_HOST)) return;

  const initialCheck = await isOllamaReady(runtimeOllamaHost);
  if (initialCheck.ready) {
    runtimeOllamaHost = initialCheck.host;
    return;
  }

  console.log(`Ollama not detected at ${runtimeOllamaHost}, attempting auto-start...`);
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
    const probe = await isOllamaReady(runtimeOllamaHost);
    if (probe.ready) {
      runtimeOllamaHost = probe.host;
      console.log(`Ollama is ready at ${runtimeOllamaHost}.`);
      return;
    }
    await sleep(500);
  }

  if (!detectOllamaInstalled()) {
    console.warn('Ollama is not installed yet. First-launch onboarding will guide the installation.');
    return;
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

function closeBackendLogStream() {
  if (!backendLogStream) return;
  try {
    backendLogStream.end();
  } catch {
    // Ignore close failures during shutdown.
  } finally {
    backendLogStream = undefined;
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
  const envFilePath = path.join(userDataDir, '.env');
  const computerUseDir = path.join(userDataDir, 'computer-use');
  const logDir = path.join(userDataDir, 'logs');

  fs.mkdirSync(userDataDir, { recursive: true });
  fs.mkdirSync(computerUseDir, { recursive: true });
  fs.mkdirSync(logDir, { recursive: true });

  backendLogPath = path.join(logDir, 'backend.log');
  closeBackendLogStream();
  backendLogStream = fs.createWriteStream(backendLogPath, { flags: 'a' });

  const env = {
    ...process.env,
    BACKEND_HOST: '127.0.0.1',
    BACKEND_PORT,
    OLLAMA_HOST: runtimeOllamaHost,
    DEBUG: 'false',
    CORS_ORIGINS: 'null,http://localhost:5173,http://localhost:3000',
    DATABASE_URL: `sqlite+aiosqlite:///${dbPath}`,
    MODELFORGE_STATE_DIR: userDataDir,
    MODELFORGE_ENV_FILE: envFilePath,
    MODELFORGE_COMPUTER_USE_DIR: computerUseDir,
    MODELFORGE_COMPUTER_HELPER_URL: computerHelper?.url || '',
    MODELFORGE_COMPUTER_HELPER_TOKEN: computerHelper?.token || '',
  };

  backendProcess = spawn(backendExec, [], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  backendLogStream.write(`\n[${new Date().toISOString()}] Starting backend executable: ${backendExec}\n`);
  backendProcess.stdout?.pipe(backendLogStream, { end: false });
  backendProcess.stderr?.pipe(backendLogStream, { end: false });

  backendProcess.on('exit', (code, signal) => {
    backendProcess = undefined;
    closeBackendLogStream();
    if (!app.isQuitting) {
      dialog.showErrorBox(
        'Backend Exited',
        `The backend process stopped unexpectedly (code: ${code ?? 'null'}, signal: ${signal ?? 'null'}).\n\nLog: ${backendLogPath || 'unavailable'}`
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
  throw new Error(
    `Backend did not become ready within ${BACKEND_STARTUP_TIMEOUT_MS / 1000}s. Check logs for details: ${backendLogPath || 'unavailable'}`
  );
}

function stopBackend() {
  if (reusingExistingBackend) {
    reusingExistingBackend = false;
    return;
  }
  if (backendProcess && !backendProcess.killed) {
    backendProcess.kill('SIGTERM');
    return;
  }
  closeBackendLogStream();
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

app.isQuitting = false;

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
  app.isQuitting = true;
  stopBackend();
  void stopComputerHelper();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
