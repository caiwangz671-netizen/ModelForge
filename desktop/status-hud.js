const { BrowserWindow, screen } = require('electron');

let statusHudWindow = null;

function toText(raw) {
  return String(raw || '');
}

function hudHtml() {
  return `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <style>
        :root {
          color-scheme: dark;
          font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif;
        }
        html, body {
          margin: 0;
          width: 100%;
          height: 100%;
          overflow: hidden;
          background: transparent;
        }
        body {
          display: flex;
          align-items: flex-start;
          justify-content: flex-end;
          padding: 0;
        }
        .hud {
          --accent: rgba(96, 165, 250, 0.92);
          width: 388px;
          margin: 14px;
          border-radius: 24px;
          border: 1px solid rgba(255, 255, 255, 0.12);
          background:
            radial-gradient(circle at top left, rgba(56, 189, 248, 0.18), transparent 32%),
            linear-gradient(180deg, rgba(5, 12, 25, 0.96), rgba(2, 7, 18, 0.94));
          color: #eff6ff;
          backdrop-filter: blur(18px);
          box-shadow:
            0 22px 60px rgba(2, 6, 23, 0.5),
            inset 0 1px 0 rgba(255, 255, 255, 0.05);
          padding: 14px 15px 15px;
        }
        .hud.tone-success { --accent: rgba(52, 211, 153, 0.92); }
        .hud.tone-warning { --accent: rgba(251, 191, 36, 0.95); }
        .hud.tone-error { --accent: rgba(251, 113, 133, 0.95); }
        .hud.tone-running { --accent: rgba(34, 211, 238, 0.95); }
        .hud.tone-neutral { --accent: rgba(148, 163, 184, 0.92); }
        .eyebrow-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }
        .eyebrow {
          font-size: 10px;
          letter-spacing: 0.22em;
          text-transform: uppercase;
          color: rgba(191, 219, 254, 0.84);
        }
        .pulse {
          width: 9px;
          height: 9px;
          border-radius: 999px;
          background: var(--accent);
          box-shadow: 0 0 16px var(--accent);
          flex-shrink: 0;
        }
        .title {
          margin-top: 10px;
          font-size: 19px;
          font-weight: 700;
          line-height: 1.2;
          color: #ffffff;
        }
        .subtitle {
          margin-top: 6px;
          font-size: 12px;
          line-height: 1.55;
          color: rgba(226, 232, 240, 0.92);
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .chips {
          margin-top: 12px;
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }
        .chip {
          display: none;
          align-items: center;
          min-height: 24px;
          padding: 0 10px;
          border-radius: 999px;
          border: 1px solid rgba(255, 255, 255, 0.1);
          background: rgba(255, 255, 255, 0.06);
          color: rgba(226, 232, 240, 0.94);
          font-size: 11px;
          line-height: 1;
          letter-spacing: 0.01em;
          white-space: nowrap;
          max-width: 100%;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .chip.primary {
          border-color: color-mix(in srgb, var(--accent) 42%, rgba(255,255,255,0.1));
          background: color-mix(in srgb, var(--accent) 16%, rgba(255,255,255,0.04));
          color: white;
        }
        .detail {
          margin-top: 12px;
          border-radius: 18px;
          border: 1px solid rgba(255, 255, 255, 0.08);
          background: rgba(3, 9, 20, 0.56);
          padding: 10px 11px;
          font-size: 12px;
          line-height: 1.6;
          color: rgba(241, 245, 249, 0.96);
          white-space: pre-wrap;
          word-break: break-word;
          min-height: 40px;
        }
        .stats {
          margin-top: 12px;
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 8px;
        }
        .stat {
          display: none;
          min-width: 0;
          border-radius: 16px;
          border: 1px solid rgba(255, 255, 255, 0.08);
          background: rgba(255, 255, 255, 0.05);
          padding: 8px 10px;
        }
        .stat-label {
          font-size: 9px;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          color: rgba(148, 163, 184, 0.86);
        }
        .stat-value {
          margin-top: 4px;
          font-size: 12px;
          line-height: 1.45;
          color: rgba(248, 250, 252, 0.96);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .footer {
          margin-top: 12px;
          border-top: 1px solid rgba(255, 255, 255, 0.08);
          padding-top: 10px;
          display: none;
        }
        .footer-label {
          font-size: 10px;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          color: rgba(148, 163, 184, 0.86);
        }
        .footer-text {
          margin-top: 5px;
          font-size: 11px;
          line-height: 1.55;
          color: rgba(226, 232, 240, 0.9);
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
      </style>
    </head>
    <body>
      <div class="hud tone-running" id="hud">
        <div class="eyebrow-row">
          <div class="eyebrow" id="eyebrow">Computer Use</div>
          <div class="pulse" id="pulse"></div>
        </div>
        <div class="title" id="title">Executing</div>
        <div class="subtitle" id="subtitle">Waiting for task context…</div>
        <div class="chips" id="chips">
          <div class="chip primary" id="chipPrimary"></div>
          <div class="chip" id="chipSecondary"></div>
        </div>
        <div class="stats" id="stats">
          <div class="stat" id="stat0">
            <div class="stat-label" id="stat0Label"></div>
            <div class="stat-value" id="stat0Value"></div>
          </div>
          <div class="stat" id="stat1">
            <div class="stat-label" id="stat1Label"></div>
            <div class="stat-value" id="stat1Value"></div>
          </div>
          <div class="stat" id="stat2">
            <div class="stat-label" id="stat2Label"></div>
            <div class="stat-value" id="stat2Value"></div>
          </div>
          <div class="stat" id="stat3">
            <div class="stat-label" id="stat3Label"></div>
            <div class="stat-value" id="stat3Value"></div>
          </div>
        </div>
        <div class="detail" id="detail">Waiting for update…</div>
        <div class="footer" id="footerWrap">
          <div class="footer-label">Latest Signal</div>
          <div class="footer-text" id="footer"></div>
        </div>
      </div>
      <script>
        function setText(id, value, { hideWhenEmpty = false } = {}) {
          const node = document.getElementById(id);
          if (!node) return;
          const text = typeof value === 'string' ? value : '';
          node.textContent = text;
          if (hideWhenEmpty) {
            node.style.display = text ? 'inline-flex' : 'none';
          }
        }

        function setStat(index, item) {
          const wrap = document.getElementById('stat' + index);
          const label = document.getElementById('stat' + index + 'Label');
          const value = document.getElementById('stat' + index + 'Value');
          if (!wrap || !label || !value) return;
          const hasContent = item && (item.label || item.value);
          wrap.style.display = hasContent ? 'block' : 'none';
          label.textContent = hasContent ? String(item.label || '') : '';
          value.textContent = hasContent ? String(item.value || '') : '';
        }

        window.__updateStatusHud = (payload) => {
          const hud = document.getElementById('hud');
          const footerWrap = document.getElementById('footerWrap');
          const subtitle = document.getElementById('subtitle');
          const detail = document.getElementById('detail');
          const stats = Array.isArray(payload.stats) ? payload.stats.slice(0, 4) : [];

          setText('eyebrow', payload.eyebrow || 'Computer Use');
          setText('title', payload.title || '');
          setText('subtitle', payload.subtitle || '');
          setText('detail', payload.detail || '');
          setText('chipPrimary', payload.chip_primary || '', { hideWhenEmpty: true });
          setText('chipSecondary', payload.chip_secondary || '', { hideWhenEmpty: true });
          setText('footer', payload.footer || '');

          const tone = typeof payload.tone === 'string' && payload.tone ? payload.tone : 'running';
          hud.className = 'hud tone-' + tone;
          subtitle.style.display = payload.subtitle ? 'block' : 'none';
          detail.style.display = payload.detail ? 'block' : 'none';
          footerWrap.style.display = payload.footer ? 'block' : 'none';
          for (let index = 0; index < 4; index += 1) {
            setStat(index, stats[index]);
          }
        };
      </script>
    </body>
  </html>`;
}

function getStatusHudWindow() {
  if (
    statusHudWindow
    && typeof statusHudWindow.isDestroyed === 'function'
    && !statusHudWindow.isDestroyed()
  ) {
    return statusHudWindow;
  }
  statusHudWindow = null;
  return null;
}

function positionHudWindow(window) {
  const display = screen.getPrimaryDisplay();
  const { width } = display.workAreaSize;
  const { x, y } = display.workArea;
  window.setBounds({
    x: x + width - 388,
    y: y + 20,
    width: 402,
    height: 286,
  });
}

function createStatusHudWindow() {
  const existing = getStatusHudWindow();
  if (existing) {
    return existing;
  }

  const window = new BrowserWindow({
    width: 402,
    height: 286,
    frame: false,
    transparent: true,
    show: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    alwaysOnTop: true,
    hasShadow: false,
    roundedCorners: true,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  window.setIgnoreMouseEvents(true, { forward: true });
  positionHudWindow(window);
  window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(hudHtml())}`);
  window.on('closed', () => {
    if (statusHudWindow === window) {
      statusHudWindow = null;
    }
  });
  statusHudWindow = window;
  return window;
}

async function showStatusHud(payload = {}) {
  const window = createStatusHudWindow();
  if (!window.webContents.isLoading()) {
    await updateStatusHud(payload);
  } else {
    window.webContents.once('did-finish-load', () => {
      void updateStatusHud(payload);
    });
  }
  window.showInactive();
  return { ok: true, visible: true };
}

async function updateStatusHud(payload = {}) {
  const window = createStatusHudWindow();
  const nextPayload = {
    eyebrow: toText(payload.eyebrow || 'Computer Use'),
    title: toText(payload.title || ''),
    subtitle: toText(payload.subtitle || ''),
    detail: toText(payload.detail || ''),
    chip_primary: toText(payload.chip_primary || ''),
    chip_secondary: toText(payload.chip_secondary || ''),
    footer: toText(payload.footer || ''),
    stats: Array.isArray(payload.stats) ? payload.stats.slice(0, 4).map((item) => ({
      label: toText(item?.label || ''),
      value: toText(item?.value || ''),
    })) : [],
    tone: toText(payload.tone || 'running'),
  };
  if (window.webContents.isLoading()) {
    await new Promise((resolve) => window.webContents.once('did-finish-load', resolve));
  }
  await window.webContents.executeJavaScript(
    `window.__updateStatusHud(${JSON.stringify(nextPayload)}); true;`,
    true,
  );
  return { ok: true, visible: window.isVisible() };
}

async function hideStatusHud() {
  const window = getStatusHudWindow();
  if (!window) {
    return { ok: true, visible: false };
  }
  window.hide();
  return { ok: true, visible: false };
}

module.exports = {
  hideStatusHud,
  showStatusHud,
  updateStatusHud,
};
