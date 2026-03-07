const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { screen, shell, systemPreferences } = require('electron');
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

async function probeAccessibility() {
  try {
    return Boolean(systemPreferences.isTrustedAccessibilityClient(false));
  } catch {
    return false;
  }
}

async function probeScreenRecording() {
  try {
    const status = systemPreferences.getMediaAccessStatus('screen');
    return status === 'granted';
  } catch {
    const tempFile = path.join(os.tmpdir(), `modelforge-screen-probe-${Date.now()}.png`);
    try {
      const result = await runCommand('screencapture', ['-x', '-t', 'png', tempFile], { timeoutMs: 5000 });
      return result.code === 0 && fs.existsSync(tempFile);
    } catch {
      return false;
    } finally {
      fs.rmSync(tempFile, { force: true });
    }
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

async function captureSnapshot(filePath, includeOcr, options = {}) {
  return await withMainWindowTemporarilyHidden(options, async () => {
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    const capture = await runCommand('screencapture', ['-x', '-t', 'png', filePath], { timeoutMs: 10000 });
    if (capture.code !== 0) {
      return { ok: false, error: capture.stderr.trim() || 'Failed to capture screenshot' };
    }

    let width = null;
    let height = null;
    try {
      const sizeResult = await runCommand('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', filePath], { timeoutMs: 5000 });
      const widthMatch = sizeResult.stdout.match(/pixelWidth:\s+(\d+)/);
      const heightMatch = sizeResult.stdout.match(/pixelHeight:\s+(\d+)/);
      width = widthMatch ? Number(widthMatch[1]) : null;
      height = heightMatch ? Number(heightMatch[1]) : null;
    } catch {
      width = null;
      height = null;
    }

    let ocrText = '';
    const ocrAvailable = await commandAvailable('tesseract');
    if (includeOcr && ocrAvailable) {
      try {
        const ocrResult = await runCommand('tesseract', [filePath, 'stdout', '--psm', '6'], { timeoutMs: 20000 });
        if (ocrResult.code === 0) {
          ocrText = ocrResult.stdout.trim();
        }
      } catch {
        ocrText = '';
      }
    }

    return {
      ok: true,
      file_path: filePath,
      width,
      height,
      coordinate_space: getDisplayCoordinateSpace(width, height),
      ocr_text: ocrText,
      summary: ocrText ? ocrText.slice(0, 800) : 'Screenshot captured',
      app_window_hidden_during_capture: true,
    };
  });
}

async function queryState(options = {}) {
  return await withMainWindowTemporarilyHidden(options, async () => {
    try {
      const accessibilityTrusted = await probeAccessibility();
      if (!accessibilityTrusted) {
        return {
          ok: false,
          error: 'Accessibility permission is required to read UI state',
          focused: {
            role: '',
            title: '',
            description: '',
            placeholder: '',
            value: '',
          },
        };
      }
      const result = await runOsaJavaScript(`
        const se = Application('System Events');
        const proc = se.applicationProcesses.whose({ frontmost: true })[0];
        let appName = '';
        let windowTitle = '';
        try { appName = proc.name(); } catch (e) {}
        try { windowTitle = proc.windows[0].name(); } catch (e) {}
        console.log(JSON.stringify({
          ok: true,
          frontmost_app: appName,
          window_title: windowTitle,
          focused: {
            role: '',
            title: '',
            description: '',
            placeholder: '',
            value: ''
          }
        }));
      `);
      if (result.code !== 0) {
        return { ok: false, error: result.stderr.trim() || 'Failed to read UI state' };
      }
      const output = String(result.stdout || result.stderr || '').trim();
      if (!output) {
        return { ok: false, error: 'UI state script returned no output' };
      }
      const parsed = JSON.parse(output);
      if (!parsed || typeof parsed !== 'object') {
        return { ok: false, error: 'UI state script returned invalid JSON' };
      }
      if (parsed.ok !== true) {
        return {
          ok: false,
          error: typeof parsed.error === 'string' && parsed.error.trim()
            ? parsed.error
            : 'Failed to read UI state',
        };
      }
      return parsed;
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
}

async function postMouseClick(x, y, coordinateSpace = {}, options = {}) {
  return await withMainWindowTemporarilyHidden(options, async () => {
    const resolvedSpace = {
      ...getDisplayCoordinateSpace(),
      ...(coordinateSpace && typeof coordinateSpace === 'object' ? coordinateSpace : {}),
    };
    const resolvedPoint = scaleCoordinateToDisplay(x, y, resolvedSpace);
    const result = await runOsaJavaScript(`
      ObjC.import('ApplicationServices');
      const point = $.CGPointMake(${Number(resolvedPoint.actual_x)}, ${Number(resolvedPoint.actual_y)});
      const down = $.CGEventCreateMouseEvent(null, $.kCGEventLeftMouseDown, point, $.kCGMouseButtonLeft);
      const up = $.CGEventCreateMouseEvent(null, $.kCGEventLeftMouseUp, point, $.kCGMouseButtonLeft);
      $.CGEventPost($.kCGHIDEventTap, down);
      $.CGEventPost($.kCGHIDEventTap, up);
      console.log('ok');
    `);
    return {
      ok: result.code === 0,
      x: resolvedPoint.actual_x,
      y: resolvedPoint.actual_y,
      requested_x: resolvedPoint.requested_x,
      requested_y: resolvedPoint.requested_y,
      coordinate_space: resolvedSpace,
      coordinate_scale: {
        x: resolvedPoint.scale_x,
        y: resolvedPoint.scale_y,
      },
      error: result.code === 0 ? null : (result.stderr.trim() || 'Failed to click'),
    };
  });
}

async function postScroll(deltaX, deltaY, options = {}) {
  return await withMainWindowTemporarilyHidden(options, async () => {
    const result = await runOsaJavaScript(`
      ObjC.import('ApplicationServices');
      const event = $.CGEventCreateScrollWheelEvent(
        null,
        $.kCGScrollEventUnitLine,
        2,
        ${Number(deltaY)},
        ${Number(deltaX)}
      );
      $.CGEventPost($.kCGHIDEventTap, event);
      console.log('ok');
    `);
    return {
      ok: result.code === 0,
      delta_x: deltaX,
      delta_y: deltaY,
      error: result.code === 0 ? null : (result.stderr.trim() || 'Failed to scroll'),
    };
  });
}

async function postType(text, options = {}) {
  return await withMainWindowTemporarilyHidden(options, async () => {
    const result = await runOsaJavaScript(`
      const se = Application('System Events');
      se.keystroke(${JSON.stringify(String(text))});
      console.log('ok');
    `);
    return {
      ok: result.code === 0,
      text_length: String(text).length,
      error: result.code === 0 ? null : (result.stderr.trim() || 'Failed to type text'),
    };
  });
}

async function postKeypress(key, modifiers, options = {}) {
  return await withMainWindowTemporarilyHidden(options, async () => {
    const modifierTokens = Array.isArray(modifiers)
      ? modifiers
        .map((value) => String(value).trim().toLowerCase())
        .filter(Boolean)
        .map((value) => {
          if (value === 'cmd' || value === 'command') return 'command down';
          if (value === 'ctrl' || value === 'control') return 'control down';
          if (value === 'alt' || value === 'option') return 'option down';
          if (value === 'shift') return 'shift down';
          return null;
        })
        .filter(Boolean)
      : [];
    const result = await runOsaJavaScript(`
      const se = Application('System Events');
      const key = ${JSON.stringify(String(key || '').toLowerCase())};
      const modifiers = ${JSON.stringify(modifierTokens)};
      const keyCodes = {
        enter: 36,
        return: 36,
        tab: 48,
        space: 49,
        escape: 53,
        esc: 53,
        left: 123,
        right: 124,
        down: 125,
        up: 126,
        delete: 51,
        backspace: 51
      };
      if (Object.prototype.hasOwnProperty.call(keyCodes, key)) {
        se.keyCode(keyCodes[key], { using: modifiers });
      } else {
        se.keystroke(key, { using: modifiers });
      }
      console.log('ok');
    `);
    return {
      ok: result.code === 0,
      key,
      modifiers: modifierTokens,
      error: result.code === 0 ? null : (result.stderr.trim() || 'Failed to press key'),
    };
  });
}

async function openUrl(url) {
  const result = await runCommand('open', [url], { timeoutMs: 10000 });
  return {
    ok: result.code === 0,
    url,
    error: result.code === 0 ? null : (result.stderr.trim() || 'Failed to open URL'),
  };
}

async function openApp(appName) {
  const result = await runCommand('open', ['-a', appName], { timeoutMs: 10000 });
  return {
    ok: result.code === 0,
    app_name: appName,
    error: result.code === 0 ? null : (result.stderr.trim() || 'Failed to open application'),
  };
}

async function createHealthPayload() {
  const [ocrAvailable, accessibilityTrusted, screenRecordingAvailable] = await Promise.all([
    commandAvailable('tesseract'),
    probeAccessibility(),
    probeScreenRecording(),
  ]);
  return {
    ok: true,
    desktop_available: true,
    controlled_browser_available: true,
    coordinate_space: getDisplayCoordinateSpace(),
    ocr: {
      available: ocrAvailable,
      recommended: 'Tesseract OCR',
      install_hint: 'brew install tesseract',
    },
    permissions: {
      accessibility: accessibilityTrusted,
      screen_recording: screenRecordingAvailable,
    },
  };
}

async function requestPermissions() {
  // Accessibility: passing true opens System Preferences if not already trusted.
  try {
    systemPreferences.isTrustedAccessibilityClient(true);
  } catch {
    // Non-macOS or API unavailable — ignore.
  }

  // Screen Recording: must be granted manually; open the system pane directly.
  try {
    await shell.openExternal(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
    );
  } catch {
    // Fallback: open the top-level Privacy & Security pane.
    try {
      await shell.openExternal('x-apple.systempreferences:com.apple.preference.security');
    } catch {
      // Ignore on non-macOS.
    }
  }

  // Re-probe and return fresh permission state.
  const [accessibility, screen_recording] = await Promise.all([
    probeAccessibility(),
    probeScreenRecording(),
  ]);
  return { ok: true, permissions: { accessibility, screen_recording } };
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
