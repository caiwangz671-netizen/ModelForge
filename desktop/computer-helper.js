const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { desktopCapturer, screen, shell, systemPreferences } = require('electron');
const {
  closeControlledBrowser,
  clickControlledBrowserElement,
  getControlledBrowserState,
  goBackControlledBrowser,
  navigateControlledBrowser,
  scrollControlledBrowser,
  sendControlledBrowserKeypress,
  showControlledBrowser,
  typeIntoControlledBrowserElement,
} = require('./controlled-browser');
const {
  hideStatusHud,
  showStatusHud,
  updateStatusHud,
} = require('./status-hud');
const { createDesktopDriver } = require('./platform');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jsonResponse(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1024 * 1024) {
        reject(new Error('Request body too large'));
      }
    });
    req.on('end', () => {
      if (!raw.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function runCommand(command, args, options = {}) {
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 15000;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: { ...process.env, ...(options.env || {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`Command timed out: ${command}`));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 0, stdout, stderr });
    });
  });
}

async function runOsaJavaScript(script, env = {}) {
  return runCommand('osascript', ['-l', 'JavaScript', '-e', script], {
    timeoutMs: 10000,
    env,
  });
}

async function commandAvailable(command, args = ['--version']) {
  try {
    const result = await runCommand(command, args, { timeoutMs: 4000 });
    return result.code === 0;
  } catch {
    return false;
  }
}

function getMainWindow(options = {}) {
  if (!options || typeof options.getMainWindow !== 'function') {
    return null;
  }
  const window = options.getMainWindow();
  if (!window || typeof window.isDestroyed !== 'function' || window.isDestroyed()) {
    return null;
  }
  return window;
}

function getDisplayCoordinateSpace(screenshotWidth = null, screenshotHeight = null) {
  try {
    const primaryDisplay = screen.getPrimaryDisplay();
    const bounds = primaryDisplay?.bounds || { x: 0, y: 0, width: 0, height: 0 };
    const size = primaryDisplay?.size || { width: bounds.width, height: bounds.height };
    const scaleFactor = Number(primaryDisplay?.scaleFactor || 1) || 1;
    return {
      origin_x: Number(bounds.x || 0),
      origin_y: Number(bounds.y || 0),
      display_width: Number(size.width || bounds.width || 0),
      display_height: Number(size.height || bounds.height || 0),
      scale_factor: scaleFactor,
      screenshot_width: Number(screenshotWidth || Math.round((size.width || bounds.width || 0) * scaleFactor)),
      screenshot_height: Number(screenshotHeight || Math.round((size.height || bounds.height || 0) * scaleFactor)),
    };
  } catch {
    return {
      origin_x: 0,
      origin_y: 0,
      display_width: null,
      display_height: null,
      scale_factor: 1,
      screenshot_width: screenshotWidth,
      screenshot_height: screenshotHeight,
    };
  }
}

function scaleCoordinateToDisplay(rawX, rawY, coordinateSpace = {}) {
  const requestedX = Number(rawX || 0);
  const requestedY = Number(rawY || 0);
  const referenceWidth = Number(coordinateSpace.screenshot_width || 0);
  const referenceHeight = Number(coordinateSpace.screenshot_height || 0);
  const displayWidth = Number(coordinateSpace.display_width || 0);
  const displayHeight = Number(coordinateSpace.display_height || 0);
  const scaleFactor = Number(coordinateSpace.scale_factor || 1) || 1;
  const originX = Number(coordinateSpace.origin_x || 0);
  const originY = Number(coordinateSpace.origin_y || 0);

  const scaleX = referenceWidth > 0 && displayWidth > 0
    ? displayWidth / referenceWidth
    : 1 / scaleFactor;
  const scaleY = referenceHeight > 0 && displayHeight > 0
    ? displayHeight / referenceHeight
    : 1 / scaleFactor;

  return {
    requested_x: requestedX,
    requested_y: requestedY,
    actual_x: Math.round(originX + (requestedX * scaleX)),
    actual_y: Math.round(originY + (requestedY * scaleY)),
    scale_x: scaleX,
    scale_y: scaleY,
  };
}

async function withMainWindowTemporarilyHidden(options, operation) {
  const window = getMainWindow(options);
  if (!window || !window.isVisible() || window.isMinimized()) {
    return await operation();
  }

  try {
    window.hide();
    await sleep(180);
    return await operation();
  } finally {
    const restoreWindow = getMainWindow(options);
    if (!restoreWindow) {
      return;
    }
    try {
      if (typeof restoreWindow.showInactive === 'function') {
        restoreWindow.showInactive();
      } else {
        restoreWindow.show();
      }
      await sleep(120);
    } catch {
      // Best-effort restore only.
    }
  }
}

async function captureDesktopImageToFile(filePath, options = {}) {
  return await withMainWindowTemporarilyHidden(options, async () => {
    await fsp.mkdir(path.dirname(filePath), { recursive: true });

    const primaryDisplay = screen.getPrimaryDisplay();
    const bounds = primaryDisplay?.bounds || {};
    const size = primaryDisplay?.size || {};
    const scaleFactor = Number(primaryDisplay?.scaleFactor || 1) || 1;
    const targetWidth = Math.max(
      1,
      Math.round((Number(size.width || bounds.width || 0) || 1) * scaleFactor),
    );
    const targetHeight = Math.max(
      1,
      Math.round((Number(size.height || bounds.height || 0) || 1) * scaleFactor),
    );

    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: {
        width: targetWidth,
        height: targetHeight,
      },
      fetchWindowIcons: false,
    });

    const primaryDisplayId = String(primaryDisplay?.id ?? '');
    const selectedSource = sources.find((source) => String(source.display_id || '') === primaryDisplayId)
      || sources[0];

    if (!selectedSource || !selectedSource.thumbnail || selectedSource.thumbnail.isEmpty()) {
      return { ok: false, error: 'Failed to capture screenshot' };
    }

    const pngBuffer = selectedSource.thumbnail.toPNG();
    await fsp.writeFile(filePath, pngBuffer);

    const imageSize = typeof selectedSource.thumbnail.getSize === 'function'
      ? selectedSource.thumbnail.getSize()
      : { width: targetWidth, height: targetHeight };

    return {
      ok: true,
      file_path: filePath,
      width: Number(imageSize.width || targetWidth),
      height: Number(imageSize.height || targetHeight),
      coordinate_space: getDisplayCoordinateSpace(imageSize.width, imageSize.height),
      summary: 'Screenshot captured',
      app_window_hidden_during_capture: true,
      source_id: selectedSource.id,
      display_id: selectedSource.display_id || primaryDisplayId,
    };
  });
}

const desktopDriver = createDesktopDriver({
  fs,
  fsp,
  os,
  path,
  screen,
  shell,
  systemPreferences,
  captureDesktopImageToFile,
  commandAvailable,
  getDisplayCoordinateSpace,
  runCommand,
  runOsaJavaScript,
  scaleCoordinateToDisplay,
  withMainWindowTemporarilyHidden,
});

async function captureSnapshot(filePath, includeOcr, options = {}) {
  return desktopDriver.captureSnapshot(filePath, includeOcr, options);
}

async function queryState(options = {}) {
  return desktopDriver.queryState(options);
}

async function postMouseClick(x, y, coordinateSpace = {}, options = {}) {
  return desktopDriver.postMouseClick(x, y, coordinateSpace, options);
}

async function postScroll(deltaX, deltaY, options = {}) {
  return desktopDriver.postScroll(deltaX, deltaY, options);
}

async function postType(text, options = {}) {
  return desktopDriver.postType(text, options);
}

async function postKeypress(key, modifiers, options = {}) {
  return desktopDriver.postKeypress(key, modifiers, options);
}

async function openUrl(url) {
  try {
    await shell.openExternal(url);
    return {
      ok: true,
      url,
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      url,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function openApp(appName) {
  return desktopDriver.openApp(appName);
}

async function createHealthPayload() {
  return desktopDriver.createHealthPayload();
}

async function requestPermissions() {
  return desktopDriver.requestPermissions();
}

async function hideMainWindow(options = {}) {
  const window = getMainWindow(options);
  if (!window) {
    return { ok: true, visible: false };
  }
  try {
    window.hide();
    return { ok: true, visible: false };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function showMainWindow(options = {}, focus = false) {
  const window = getMainWindow(options);
  if (!window) {
    return { ok: true, visible: false };
  }
  try {
    if (window.isMinimized()) {
      window.restore();
    }
    if (focus) {
      window.show();
      window.focus();
    } else if (typeof window.showInactive === 'function') {
      window.showInactive();
    } else {
      window.show();
    }
    return { ok: true, visible: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function routeRequest(req, body, options = {}) {
  if (req.method === 'GET' && req.url === '/health') {
    return createHealthPayload();
  }
  if (req.method === 'POST' && req.url === '/snapshot') {
    return captureSnapshot(String(body.file_path || ''), body.include_ocr !== false, options);
  }
  if (req.method === 'POST' && req.url === '/query-state') {
    return queryState(options);
  }
  if (req.method === 'POST' && req.url === '/click') {
    return postMouseClick(
      Number(body.x || 0),
      Number(body.y || 0),
      body.coordinate_space,
      options,
    );
  }
  if (req.method === 'POST' && req.url === '/scroll') {
    return postScroll(Number(body.delta_x || 0), Number(body.delta_y || 0), options);
  }
  if (req.method === 'POST' && req.url === '/type') {
    return postType(String(body.text || ''), options);
  }
  if (req.method === 'POST' && req.url === '/keypress') {
    return postKeypress(String(body.key || ''), body.modifiers, options);
  }
  if (req.method === 'POST' && req.url === '/open-url') {
    return openUrl(String(body.url || ''));
  }
  if (req.method === 'POST' && req.url === '/open-app') {
    return openApp(String(body.app_name || ''));
  }
  if (req.method === 'POST' && req.url === '/request-permissions') {
    return requestPermissions();
  }
  if (req.method === 'POST' && req.url === '/hide-main-window') {
    return hideMainWindow(options);
  }
  if (req.method === 'POST' && req.url === '/show-main-window') {
    return showMainWindow(options, Boolean(body.focus));
  }
  if (req.method === 'POST' && req.url === '/browser/navigate') {
    return navigateControlledBrowser(String(body.url || ''), {
      show: body.show !== false,
      focus: body.focus !== false,
    });
  }
  if (req.method === 'POST' && req.url === '/browser/show') {
    return showControlledBrowser(body.focus !== false);
  }
  if (req.method === 'POST' && req.url === '/browser/close') {
    return closeControlledBrowser();
  }
  if (req.method === 'POST' && req.url === '/browser/state') {
    return getControlledBrowserState({ focus: body.focus === true });
  }
  if (req.method === 'POST' && req.url === '/browser/click') {
    return clickControlledBrowserElement(String(body.element_id || ''));
  }
  if (req.method === 'POST' && req.url === '/browser/type') {
    return typeIntoControlledBrowserElement(
      String(body.element_id || ''),
      String(body.text || ''),
      body.clear !== false,
    );
  }
  if (req.method === 'POST' && req.url === '/browser/keypress') {
    return sendControlledBrowserKeypress(String(body.key || ''), body.modifiers);
  }
  if (req.method === 'POST' && req.url === '/browser/scroll') {
    return scrollControlledBrowser(Number(body.delta_x || 0), Number(body.delta_y || 0));
  }
  if (req.method === 'POST' && req.url === '/browser/back') {
    return goBackControlledBrowser();
  }
  if (req.method === 'POST' && req.url === '/hud/show') {
    return showStatusHud(body);
  }
  if (req.method === 'POST' && req.url === '/hud/update') {
    return updateStatusHud(body);
  }
  if (req.method === 'POST' && req.url === '/hud/hide') {
    return hideStatusHud();
  }
  return { ok: false, error: 'Route not found' };
}

async function startComputerHelperServer(options = {}) {
  const token = crypto.randomBytes(24).toString('hex');
  const server = http.createServer(async (req, res) => {
    try {
      const authHeader = String(req.headers.authorization || '');
      if (authHeader !== `Bearer ${token}`) {
        jsonResponse(res, 401, { ok: false, error: 'Unauthorized' });
        return;
      }

      const body = req.method === 'POST' ? await readJsonBody(req) : {};
      const payload = await routeRequest(req, body, options);
      const statusCode = payload.ok === false && payload.error === 'Route not found' ? 404 : 200;
      jsonResponse(res, statusCode, payload);
    } catch (error) {
      jsonResponse(res, 500, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to determine computer helper address');
  }

  return {
    server,
    token,
    url: `http://127.0.0.1:${address.port}`,
    async stop() {
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}

module.exports = {
  startComputerHelperServer,
};
