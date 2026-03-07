const { buildLocalOcrHealth, extractOcrText } = require('./common');

function createMacDriver(context = {}) {
  const {
    fs,
    os,
    path,
    shell,
    systemPreferences,
    captureDesktopImageToFile,
    getDisplayCoordinateSpace,
    runCommand,
    runOsaJavaScript,
    scaleCoordinateToDisplay,
    withMainWindowTemporarilyHidden,
  } = context;

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

  async function captureSnapshot(filePath, includeOcr, options = {}) {
    const capture = await captureDesktopImageToFile(filePath, options);
    if (!capture.ok) {
      return capture;
    }

    const ocrText = await extractOcrText(context, filePath, includeOcr);

    return {
      ...capture,
      ocr_text: ocrText,
      summary: ocrText ? ocrText.slice(0, 800) : 'Screenshot captured',
    };
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

  async function openApp(appName) {
    const result = await runCommand('open', ['-a', appName], { timeoutMs: 10000 });
    return {
      ok: result.code === 0,
      app_name: appName,
      error: result.code === 0 ? null : (result.stderr.trim() || 'Failed to open application'),
    };
  }

  async function createHealthPayload() {
    const [ocr, accessibilityTrusted, screenRecordingAvailable] = await Promise.all([
      buildLocalOcrHealth(context, 'darwin'),
      probeAccessibility(),
      probeScreenRecording(),
    ]);
    return {
      ok: true,
      platform: 'darwin',
      desktop_available: true,
      snapshot_available: true,
      controlled_browser_available: true,
      coordinate_space: getDisplayCoordinateSpace(),
      ocr,
      permissions: {
        accessibility: accessibilityTrusted,
        screen_recording: screenRecordingAvailable,
      },
    };
  }

  async function requestPermissions() {
    try {
      systemPreferences.isTrustedAccessibilityClient(true);
    } catch {
      // Ignore if unavailable.
    }

    try {
      await shell.openExternal(
        'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
      );
    } catch {
      try {
        await shell.openExternal('x-apple.systempreferences:com.apple.preference.security');
      } catch {
        // Ignore if unavailable.
      }
    }

    const [accessibility, screen_recording] = await Promise.all([
      probeAccessibility(),
      probeScreenRecording(),
    ]);
    return { ok: true, permissions: { accessibility, screen_recording } };
  }

  return {
    platform: 'darwin',
    createHealthPayload,
    captureSnapshot,
    queryState,
    postMouseClick,
    postScroll,
    postType,
    postKeypress,
    openApp,
    requestPermissions,
  };
}

module.exports = {
  createMacDriver,
};
