const { buildLocalOcrHealth, extractOcrText } = require('./common');

const WHEEL_DELTA = 120;

function createWindowsDriver(context = {}) {
  const {
    captureDesktopImageToFile,
    commandAvailable,
    getDisplayCoordinateSpace,
    runCommand,
    scaleCoordinateToDisplay,
    withMainWindowTemporarilyHidden,
  } = context;

  let powerShellCommandPromise = null;
  let desktopProbePromise = null;

  function toPowerShellString(value) {
    return `'${String(value ?? '').replace(/'/g, "''")}'`;
  }

  function buildWin32Prelude() {
    return `
if (-not ('ModelForgeWin32' -as [type])) {
  Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class ModelForgeWin32 {
  [DllImport("user32.dll", SetLastError=true)]
  public static extern bool SetCursorPos(int X, int Y);

  [DllImport("user32.dll", SetLastError=true)]
  public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);

  [DllImport("user32.dll", SetLastError=true)]
  public static extern IntPtr GetForegroundWindow();

  [DllImport("user32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);

  [DllImport("user32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern int GetWindowTextLength(IntPtr hWnd);

  [DllImport("user32.dll", SetLastError=true)]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
"@
}
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
`;
  }

  async function resolvePowerShellCommand() {
    if (!powerShellCommandPromise) {
      powerShellCommandPromise = (async () => {
        if (await commandAvailable('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.ToString()'])) {
          return 'powershell.exe';
        }
        if (await commandAvailable('pwsh', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.ToString()'])) {
          return 'pwsh';
        }
        return null;
      })();
    }
    return await powerShellCommandPromise;
  }

  async function runPowerShellScript(script, timeoutMs = 10000) {
    const command = await resolvePowerShellCommand();
    if (!command) {
      return {
        ok: false,
        code: 127,
        stdout: '',
        stderr: 'PowerShell is unavailable in this runtime',
      };
    }

    const encodedScript = Buffer.from(String(script), 'utf16le').toString('base64');
    try {
      const args = [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
      ];
      if (command === 'powershell.exe') {
        args.push('-STA');
      }
      args.push('-EncodedCommand', encodedScript);
      const result = await runCommand(
        command,
        args,
        { timeoutMs },
      );
      return { ok: result.code === 0, ...result };
    } catch (error) {
      return {
        ok: false,
        code: 1,
        stdout: '',
        stderr: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async function probeDesktopAutomation() {
    if (!desktopProbePromise) {
      desktopProbePromise = (async () => {
        const command = await resolvePowerShellCommand();
        if (!command) {
          return { ok: false, error: 'PowerShell is unavailable in this runtime' };
        }
        const result = await runPowerShellScript(`
${buildWin32Prelude()}
Add-Type -AssemblyName System.Windows.Forms
[void][ModelForgeWin32]::GetForegroundWindow()
'ok'
        `, 8000);
        if (result.code === 0) {
          return { ok: true };
        }
        return {
          ok: false,
          error: result.stderr.trim() || 'Desktop automation prerequisites are unavailable',
        };
      })();
    }
    return await desktopProbePromise;
  }

  function escapeSendKeysText(text) {
    return Array.from(String(text ?? '')).map((character) => {
      if (character === '\r') return '';
      if (character === '\n') return '{ENTER}';
      if (character === '\t') return '{TAB}';
      if (character === '{') return '{{}';
      if (character === '}') return '{}}';
      if ('+^%~()[]'.includes(character)) return `{${character}}`;
      return character;
    }).join('');
  }

  function normalizeWheelDelta(value) {
    const numeric = Number(value || 0);
    if (!Number.isFinite(numeric) || numeric === 0) {
      return 0;
    }
    if (Math.abs(numeric) >= WHEEL_DELTA) {
      return Math.trunc(numeric);
    }
    return Math.trunc(numeric * WHEEL_DELTA);
  }

  function normalizeSendKeysToken(key) {
    const normalized = String(key || '').trim().toLowerCase();
    if (!normalized) {
      return '';
    }

    const namedTokens = {
      enter: '{ENTER}',
      return: '{ENTER}',
      tab: '{TAB}',
      space: ' ',
      escape: '{ESC}',
      esc: '{ESC}',
      left: '{LEFT}',
      right: '{RIGHT}',
      up: '{UP}',
      down: '{DOWN}',
      delete: '{DELETE}',
      del: '{DELETE}',
      backspace: '{BACKSPACE}',
      home: '{HOME}',
      end: '{END}',
      pageup: '{PGUP}',
      pagedown: '{PGDN}',
      insert: '{INSERT}',
      f1: '{F1}',
      f2: '{F2}',
      f3: '{F3}',
      f4: '{F4}',
      f5: '{F5}',
      f6: '{F6}',
      f7: '{F7}',
      f8: '{F8}',
      f9: '{F9}',
      f10: '{F10}',
      f11: '{F11}',
      f12: '{F12}',
    };

    if (namedTokens[normalized]) {
      return namedTokens[normalized];
    }

    return escapeSendKeysText(key);
  }

  function buildSendKeysChord(key, modifiers = []) {
    const keyToken = normalizeSendKeysToken(key);
    if (!keyToken) {
      return '';
    }

    const modifierPrefix = Array.isArray(modifiers)
      ? modifiers
        .map((value) => String(value).trim().toLowerCase())
        .filter(Boolean)
        .map((value) => {
          if (value === 'cmd' || value === 'command' || value === 'ctrl' || value === 'control') return '^';
          if (value === 'alt' || value === 'option') return '%';
          if (value === 'shift') return '+';
          return '';
        })
        .join('')
      : '';

    return `${modifierPrefix}${keyToken}`;
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
      const result = await runPowerShellScript(`
${buildWin32Prelude()}
Add-Type -AssemblyName UIAutomationClient
$handle = [ModelForgeWin32]::GetForegroundWindow()
$processId = 0
[void][ModelForgeWin32]::GetWindowThreadProcessId($handle, [ref]$processId)
$windowLength = [ModelForgeWin32]::GetWindowTextLength($handle)
$builder = New-Object System.Text.StringBuilder ($windowLength + 1)
[void][ModelForgeWin32]::GetWindowText($handle, $builder, $builder.Capacity)
$processName = ''
if ($processId -gt 0) {
  try {
    $processName = (Get-Process -Id $processId -ErrorAction Stop).ProcessName
  } catch {
    $processName = ''
  }
}
$focused = @{
  role = ''
  title = ''
  description = ''
  placeholder = ''
  value = ''
}
try {
  $focusedElement = [System.Windows.Automation.AutomationElement]::FocusedElement
  if ($null -ne $focusedElement) {
    $focused.role = [string]$focusedElement.Current.ControlType.ProgrammaticName
    $focused.title = [string]$focusedElement.Current.Name
    $focused.description = [string]$focusedElement.Current.HelpText
    $focused.placeholder = [string]$focusedElement.Current.ItemStatus
    try {
      $valuePattern = $focusedElement.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
      if ($null -ne $valuePattern) {
        $focused.value = [string]$valuePattern.Current.Value
      }
    } catch {
      $focused.value = ''
    }
  }
} catch {
}
@{
  ok = $true
  frontmost_app = $processName
  window_title = $builder.ToString()
  focused = $focused
} | ConvertTo-Json -Compress -Depth 4
      `, 10000);

      if (result.code !== 0) {
        return { ok: false, error: result.stderr.trim() || 'Failed to read UI state' };
      }

      try {
        const parsed = JSON.parse(String(result.stdout || '').trim() || '{}');
        return parsed && typeof parsed === 'object'
          ? parsed
          : { ok: false, error: 'UI state script returned invalid JSON' };
      } catch {
        return {
          ok: false,
          error: String(result.stdout || result.stderr || '').trim() || 'UI state script returned invalid JSON',
        };
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
      const result = await runPowerShellScript(`
${buildWin32Prelude()}
[void][ModelForgeWin32]::SetCursorPos(${Number(resolvedPoint.actual_x)}, ${Number(resolvedPoint.actual_y)})
Start-Sleep -Milliseconds 25
[ModelForgeWin32]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
[ModelForgeWin32]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
'ok'
      `, 10000);

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
      const normalizedX = normalizeWheelDelta(deltaX);
      const normalizedY = normalizeWheelDelta(deltaY);
      const result = await runPowerShellScript(`
${buildWin32Prelude()}
if (${normalizedY} -ne 0) {
  [ModelForgeWin32]::mouse_event(0x0800, 0, 0, [uint32]([int]${normalizedY}), [UIntPtr]::Zero)
}
if (${normalizedX} -ne 0) {
  [ModelForgeWin32]::mouse_event(0x01000, 0, 0, [uint32]([int]${normalizedX}), [UIntPtr]::Zero)
}
'ok'
      `, 10000);

      return {
        ok: result.code === 0,
        delta_x: deltaX,
        delta_y: deltaY,
        applied_delta_x: normalizedX,
        applied_delta_y: normalizedY,
        error: result.code === 0 ? null : (result.stderr.trim() || 'Failed to scroll'),
      };
    });
  }

  async function postType(text, options = {}) {
    return await withMainWindowTemporarilyHidden(options, async () => {
      const clipboardPayload = String(text ?? '');
      const sendKeysPayload = escapeSendKeysText(text);
      const result = await runPowerShellScript(`
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName PresentationCore
$ok = $false
$errorMessage = $null
$clipboardRestored = $false
$hadClipboardText = $false
$previousClipboardText = $null
try {
  try {
    $previousClipboardText = Get-Clipboard -Raw -Format Text -ErrorAction Stop
    $hadClipboardText = $true
  } catch {
    $hadClipboardText = $false
  }

  Set-Clipboard -Value ${toPowerShellString(clipboardPayload)}
  [System.Windows.Forms.SendKeys]::SendWait('^v')
  Start-Sleep -Milliseconds 40
  $ok = $true
} catch {
  try {
    [System.Windows.Forms.SendKeys]::SendWait(${toPowerShellString(sendKeysPayload)})
    Start-Sleep -Milliseconds 40
    $ok = $true
  } catch {
    $errorMessage = $_.Exception.Message
  }
} finally {
  try {
    if ($hadClipboardText) {
      Set-Clipboard -Value $previousClipboardText
    }
    $clipboardRestored = $true
  } catch {
    $clipboardRestored = $false
  }
}
@{
  ok = $ok
  clipboard_restored = $clipboardRestored
  error = $errorMessage
} | ConvertTo-Json -Compress
      `, 10000);

      let payload = null;
      try {
        payload = JSON.parse(String(result.stdout || '').trim() || '{}');
      } catch {
        payload = null;
      }
      return {
        ok: result.code === 0 && payload?.ok === true,
        text_length: String(text ?? '').length,
        clipboard_restored: Boolean(payload?.clipboard_restored),
        error: result.code === 0
          ? (payload?.ok === true ? null : (String(payload?.error || '').trim() || 'Failed to type text'))
          : (result.stderr.trim() || 'Failed to type text'),
      };
    });
  }

  async function postKeypress(key, modifiers, options = {}) {
    return await withMainWindowTemporarilyHidden(options, async () => {
      const chord = buildSendKeysChord(key, modifiers);
      if (!chord) {
        return { ok: false, error: 'Key is required' };
      }

      const result = await runPowerShellScript(`
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait(${toPowerShellString(chord)})
Start-Sleep -Milliseconds 25
'ok'
      `, 10000);

      return {
        ok: result.code === 0,
        key,
        modifiers: Array.isArray(modifiers) ? modifiers : [],
        error: result.code === 0 ? null : (result.stderr.trim() || 'Failed to press key'),
      };
    });
  }

  async function openApp(appName) {
    const result = await runPowerShellScript(`
try {
  Start-Process -FilePath ${toPowerShellString(appName)}
  @{ ok = $true; app_name = ${toPowerShellString(appName)}; error = $null } | ConvertTo-Json -Compress
} catch {
  try {
    Start-Process -FilePath 'cmd.exe' -ArgumentList @('/c', 'start', '', ${toPowerShellString(appName)})
    @{ ok = $true; app_name = ${toPowerShellString(appName)}; error = $null; fallback = 'cmd-start' } | ConvertTo-Json -Compress
  } catch {
    @{ ok = $false; app_name = ${toPowerShellString(appName)}; error = $_.Exception.Message } | ConvertTo-Json -Compress
  }
}
    `, 15000);

    if (result.code !== 0) {
      return {
        ok: false,
        app_name: appName,
        error: result.stderr.trim() || 'Failed to open application',
      };
    }

    try {
      return JSON.parse(String(result.stdout || '').trim() || '{}');
    } catch {
      return {
        ok: false,
        app_name: appName,
        error: String(result.stdout || result.stderr || '').trim() || 'Failed to open application',
      };
    }
  }

  async function createHealthPayload() {
    const [ocr, desktopProbe] = await Promise.all([
      buildLocalOcrHealth(context, 'win32'),
      probeDesktopAutomation(),
    ]);
    const desktopAvailable = desktopProbe?.ok === true;
    return {
      ok: true,
      platform: 'win32',
      desktop_available: desktopAvailable,
      snapshot_available: true,
      controlled_browser_available: true,
      coordinate_space: getDisplayCoordinateSpace(),
      ocr,
      permissions: {
        accessibility: desktopAvailable ? true : null,
        screen_recording: desktopAvailable ? true : null,
      },
      limitations: desktopAvailable
        ? []
        : [String(desktopProbe?.error || 'Native desktop input automation is unavailable in this runtime.')],
    };
  }

  return {
    platform: 'win32',
    createHealthPayload,
    captureSnapshot,
    queryState,
    postMouseClick,
    postScroll,
    postType,
    postKeypress,
    openApp,
    requestPermissions: async () => ({
      ok: true,
      permissions: {
        accessibility: true,
        screen_recording: true,
      },
      skipped: true,
    }),
  };
}

module.exports = {
  createWindowsDriver,
};
