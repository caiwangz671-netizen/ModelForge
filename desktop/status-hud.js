const { BrowserWindow, screen } = require('electron');

let statusHudWindow = null;

function escapeHtml(raw) {
  return String(raw || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function hudHtml() {
  return `<!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <style>
        :root {
          color-scheme: light;
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
          width: 280px;
          margin: 14px;
          border-radius: 18px;
          background: rgba(7, 18, 36, 0.82);
          border: 1px solid rgba(255, 255, 255, 0.12);
          color: #eff6ff;
          backdrop-filter: blur(16px);
          box-shadow: 0 18px 40px rgba(15, 23, 42, 0.35);
          padding: 12px 14px;
        }
        .eyebrow {
          font-size: 10px;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: rgba(191, 219, 254, 0.82);
        }
        .title {
          margin-top: 6px;
          font-size: 13px;
          font-weight: 700;
          line-height: 1.4;
          color: #ffffff;
        }
        .detail {
          margin-top: 8px;
          font-size: 12px;
          line-height: 1.5;
          color: rgba(226, 232, 240, 0.92);
          white-space: pre-wrap;
          word-break: break-word;
        }
      </style>
    </head>
    <body>
      <div class="hud">
        <div class="eyebrow" id="eyebrow">Computer Use</div>
        <div class="title" id="title">Running</div>
        <div class="detail" id="detail">Waiting for update…</div>
      </div>
      <script>
        window.__updateStatusHud = (payload) => {
          const eyebrow = document.getElementById('eyebrow');
          const title = document.getElementById('title');
          const detail = document.getElementById('detail');
          eyebrow.textContent = payload.eyebrow || 'Computer Use';
          title.textContent = payload.title || '';
          detail.textContent = payload.detail || '';
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
    x: x + width - 308,
    y: y + 20,
    width: 294,
    height: 148,
  });
}

function createStatusHudWindow() {
  const existing = getStatusHudWindow();
  if (existing) {
    return existing;
  }

  const window = new BrowserWindow({
    width: 294,
    height: 148,
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
    eyebrow: escapeHtml(payload.eyebrow || 'Computer Use'),
    title: escapeHtml(payload.title || ''),
    detail: escapeHtml(payload.detail || ''),
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
