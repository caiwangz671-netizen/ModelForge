const path = require('path');
const { pathToFileURL } = require('url');
const { BrowserWindow } = require('electron');

const CONTROLLED_BROWSER_PARTITION = 'persist:modelforge-controlled-browser';
const CONTROLLED_BROWSER_TITLE = 'ModelForge Browser';

let controlledBrowserWindow = null;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getControlledBrowserWindow() {
  if (
    controlledBrowserWindow
    && typeof controlledBrowserWindow.isDestroyed === 'function'
    && !controlledBrowserWindow.isDestroyed()
  ) {
    return controlledBrowserWindow;
  }
  controlledBrowserWindow = null;
  return null;
}

function normalizeUrl(rawUrl) {
  const next = String(rawUrl || '').trim();
  if (!next) {
    throw new Error('URL is required');
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(next)) {
    return next;
  }
  if (path.isAbsolute(next)) {
    return pathToFileURL(next).toString();
  }
  return `https://${next}`;
}

function createControlledBrowserWindow() {
  const existing = getControlledBrowserWindow();
  if (existing) {
    return existing;
  }

  const window = new BrowserWindow({
    width: 1360,
    height: 920,
    minWidth: 960,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    title: CONTROLLED_BROWSER_TITLE,
    backgroundColor: '#ffffff',
    webPreferences: {
      partition: CONTROLLED_BROWSER_PARTITION,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  window.on('closed', () => {
    if (controlledBrowserWindow === window) {
      controlledBrowserWindow = null;
    }
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url) {
      void navigateControlledBrowser(url, { show: true, focus: true });
    }
    return { action: 'deny' };
  });

  controlledBrowserWindow = window;
  return window;
}

async function waitForPageLoad(webContents, timeoutMs = 15000) {
  if (!webContents || webContents.isDestroyed()) {
    throw new Error('Controlled browser webContents is unavailable');
  }
  if (!webContents.isLoadingMainFrame()) {
    return;
  }

  await new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      webContents.removeListener('did-finish-load', onDone);
      webContents.removeListener('did-stop-loading', onDone);
      webContents.removeListener('did-fail-load', onFail);
    };
    const onDone = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const onFail = (_event, _errorCode, errorDescription) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(errorDescription || 'Controlled browser failed to load'));
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(`Controlled browser load timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    webContents.once('did-finish-load', onDone);
    webContents.once('did-stop-loading', onDone);
    webContents.once('did-fail-load', onFail);
  });
}

function browserSummary(window) {
  if (!window || window.isDestroyed()) {
    return {
      ok: false,
      visible: false,
      title: '',
      url: '',
      error: 'Controlled browser window is unavailable',
    };
  }
  return {
    ok: true,
    visible: window.isVisible(),
    focused: window.isFocused(),
    title: window.getTitle() || window.webContents.getTitle() || CONTROLLED_BROWSER_TITLE,
    url: window.webContents.getURL() || '',
  };
}

async function showControlledBrowser(focus = true) {
  const window = createControlledBrowserWindow();
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
  return browserSummary(window);
}

async function closeControlledBrowser() {
  const window = getControlledBrowserWindow();
  if (!window) {
    return { ok: true, closed: false };
  }
  window.close();
  return { ok: true, closed: true };
}

const BROWSER_AUTOMATION_BOOTSTRAP = `
(() => {
  if (window.__mfBrowserAutomation) {
    return true;
  }

  const loginPattern = /(登录|登 录|登入|sign in|log in|验证码|verification code|two-factor|2fa|sms code|password|密码)/i;
  const checkoutPattern = /(结算|提交订单|去支付|立即购买|checkout|place order|payment)/i;

  function isVisible(el) {
    if (!(el instanceof HTMLElement)) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || '1') === 0) {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width >= 8 && rect.height >= 8 && rect.bottom >= 0 && rect.right >= 0
      && rect.top <= window.innerHeight && rect.left <= window.innerWidth;
  }

  function textOf(el) {
    const aria = (el.getAttribute('aria-label') || '').trim();
    const title = (el.getAttribute('title') || '').trim();
    const placeholder = ('placeholder' in el ? String(el.placeholder || '').trim() : '');
    const value = ('value' in el ? String(el.value || '').trim() : '');
    const text = String(el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
    return [aria, title, placeholder, value, text].filter(Boolean).join(' ').trim();
  }

  function selectorPath(el) {
    const parts = [];
    let current = el;
    while (current && current.nodeType === 1 && parts.length < 6) {
      let part = current.tagName.toLowerCase();
      if (current.id) {
        part += '#' + current.id.replace(/[^a-zA-Z0-9_-]/g, '');
        parts.unshift(part);
        break;
      }
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter((item) => item.tagName === current.tagName);
        if (siblings.length > 1) {
          part += ':nth-of-type(' + (siblings.indexOf(current) + 1) + ')';
        }
      }
      parts.unshift(part);
      current = current.parentElement;
    }
    return parts.join(' > ');
  }

  function ensureAutomationId(el, index) {
    if (!el.dataset.mfAutomationId) {
      const base = selectorPath(el).slice(0, 180).replace(/"/g, '');
      el.dataset.mfAutomationId = 'mf-' + index + '-' + base;
    }
    return el.dataset.mfAutomationId;
  }

  function collectInteractiveElements() {
    const selector = [
      'a[href]',
      'button',
      'input',
      'textarea',
      'select',
      '[role="button"]',
      '[role="link"]',
      '[contenteditable="true"]',
      'summary',
    ].join(',');

    const nodes = Array.from(document.querySelectorAll(selector));
    const seen = new Set();
    const items = [];

    for (const node of nodes) {
      if (!(node instanceof HTMLElement) || !isVisible(node)) {
        continue;
      }
      const rect = node.getBoundingClientRect();
      const label = textOf(node);
      const key = selectorPath(node);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      items.push({
        id: ensureAutomationId(node, items.length),
        tag: node.tagName.toLowerCase(),
        role: node.getAttribute('role') || '',
        type: node.getAttribute('type') || '',
        text: label.slice(0, 240),
        placeholder: 'placeholder' in node ? String(node.placeholder || '') : '',
        href: node instanceof HTMLAnchorElement ? (node.href || '') : '',
        bbox: {
          x: Math.round(rect.left),
          y: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
      });
    }

    return items.slice(0, 80);
  }

  function collectState() {
    const text = String(document.body?.innerText || '').replace(/\\s+/g, ' ').trim();
    const elements = collectInteractiveElements();
    const passwordVisible = Array.from(document.querySelectorAll('input[type="password"]')).some((el) => isVisible(el));
    const loginRequired = passwordVisible || loginPattern.test(text);
    const checkoutVisible = checkoutPattern.test(text);
    return {
      ok: true,
      title: document.title || '',
      url: window.location.href,
      text_excerpt: text.slice(0, 4000),
      elements,
      login_required: loginRequired,
      checkout_visible: checkoutVisible,
      login_reason: passwordVisible
        ? 'Visible password field detected'
        : (loginRequired ? 'Login or verification language detected on the page' : ''),
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        scroll_x: window.scrollX,
        scroll_y: window.scrollY,
      },
    };
  }

  function findById(id) {
    return document.querySelector('[data-mf-automation-id="' + String(id).replace(/"/g, '') + '"]');
  }

  function elementInfo(id) {
    const el = findById(id);
    if (!(el instanceof HTMLElement)) {
      return { ok: false, error: 'Element not found' };
    }
    el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    const rect = el.getBoundingClientRect();
    return {
      ok: true,
      id,
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute('type') || '',
      text: textOf(el).slice(0, 240),
      bbox: {
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
      point: {
        x: Math.round(rect.left + rect.width / 2),
        y: Math.round(rect.top + rect.height / 2),
      },
    };
  }

  function focusElement(id) {
    const el = findById(id);
    if (!(el instanceof HTMLElement)) {
      return { ok: false, error: 'Element not found' };
    }
    el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    el.focus();
    return {
      ok: true,
      id,
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute('type') || '',
      sensitive: Boolean(
        el instanceof HTMLInputElement
        && (
          el.type === 'password'
          || loginPattern.test(textOf(el))
          || /password|current-password|one-time-code/i.test(String(el.autocomplete || ''))
        )
      ),
    };
  }

  function setElementValue(id, text, clearFirst) {
    const el = findById(id);
    if (!(el instanceof HTMLElement)) {
      return { ok: false, error: 'Element not found' };
    }
    el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    el.focus();
    const nextValue = String(text ?? '');
    const clear = Boolean(clearFirst);

    if (
      el instanceof HTMLInputElement
      || el instanceof HTMLTextAreaElement
      || el instanceof HTMLSelectElement
    ) {
      const type = String(el.type || '').toLowerCase();
      const metaText = textOf(el);
      const sensitive = type === 'password'
        || /password|current-password|one-time-code/i.test(String(el.autocomplete || ''))
        || loginPattern.test(metaText);
      if (sensitive) {
        return { ok: false, error: 'Sensitive browser field requires user takeover', sensitive: true };
      }

      const proto = el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : (el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype);
      const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
      const valueToSet = clear ? nextValue : (String(el.value || '') + nextValue);
      if (descriptor && typeof descriptor.set === 'function') {
        descriptor.set.call(el, valueToSet);
      } else {
        el.value = valueToSet;
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return {
        ok: true,
        id,
        tag: el.tagName.toLowerCase(),
        type,
        text_length: nextValue.length,
        sensitive: false,
      };
    }

    if (el.isContentEditable) {
      el.textContent = clear ? nextValue : ((el.textContent || '') + nextValue);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return {
        ok: true,
        id,
        tag: el.tagName.toLowerCase(),
        type: 'contenteditable',
        text_length: nextValue.length,
        sensitive: false,
      };
    }

    return { ok: false, error: 'Element does not accept text input' };
  }

  window.__mfBrowserAutomation = {
    collectState,
    elementInfo,
    focusElement,
    setElementValue,
  };
  return true;
})();
`;

async function ensureBrowserAutomation(window) {
  if (!window || window.isDestroyed()) {
    throw new Error('Controlled browser window is unavailable');
  }
  await waitForPageLoad(window.webContents);
  await window.webContents.executeJavaScript(BROWSER_AUTOMATION_BOOTSTRAP, true);
}

async function navigateControlledBrowser(url, options = {}) {
  const window = createControlledBrowserWindow();
  const nextUrl = normalizeUrl(url);
  const show = options.show !== false;
  const focus = options.focus !== false;

  await window.loadURL(nextUrl);
  await waitForPageLoad(window.webContents);
  await ensureBrowserAutomation(window);

  if (show) {
    await showControlledBrowser(focus);
  }

  return {
    ...browserSummary(window),
    navigated: true,
  };
}

async function getControlledBrowserState(options = {}) {
  const window = getControlledBrowserWindow();
  if (!window) {
    return { ok: false, error: 'Controlled browser is not open' };
  }
  if (options.focus === true) {
    await showControlledBrowser(true);
  }
  await ensureBrowserAutomation(window);
  const state = await window.webContents.executeJavaScript(
    'window.__mfBrowserAutomation.collectState()',
    true,
  );
  return {
    ...browserSummary(window),
    ...state,
  };
}

async function getBrowserElementInfo(elementId) {
  const window = getControlledBrowserWindow();
  if (!window) {
    return { ok: false, error: 'Controlled browser is not open' };
  }
  await ensureBrowserAutomation(window);
  return window.webContents.executeJavaScript(
    `window.__mfBrowserAutomation.elementInfo(${JSON.stringify(String(elementId || ''))})`,
    true,
  );
}

async function clickControlledBrowserElement(elementId) {
  const window = getControlledBrowserWindow();
  if (!window) {
    return { ok: false, error: 'Controlled browser is not open' };
  }
  await ensureBrowserAutomation(window);
  const info = await getBrowserElementInfo(elementId);
  if (!info || info.ok !== true || !info.point) {
    return {
      ok: false,
      error: (info && info.error) || 'Browser element is unavailable',
    };
  }

  window.webContents.sendInputEvent({
    type: 'mouseDown',
    x: Number(info.point.x),
    y: Number(info.point.y),
    button: 'left',
    clickCount: 1,
  });
  window.webContents.sendInputEvent({
    type: 'mouseUp',
    x: Number(info.point.x),
    y: Number(info.point.y),
    button: 'left',
    clickCount: 1,
  });

  await sleep(220);
  if (window.webContents.isLoadingMainFrame()) {
    await waitForPageLoad(window.webContents, 15000);
  }

  return {
    ...browserSummary(window),
    ok: true,
    element: info,
  };
}

async function typeIntoControlledBrowserElement(elementId, text, clear = true) {
  const window = getControlledBrowserWindow();
  if (!window) {
    return { ok: false, error: 'Controlled browser is not open' };
  }
  await ensureBrowserAutomation(window);
  const result = await window.webContents.executeJavaScript(
    `window.__mfBrowserAutomation.setElementValue(${JSON.stringify(String(elementId || ''))}, ${JSON.stringify(String(text || ''))}, ${clear ? 'true' : 'false'})`,
    true,
  );
  return {
    ...browserSummary(window),
    ...(result || { ok: false, error: 'Browser typing returned no result' }),
  };
}

function normalizeBrowserKey(key) {
  const next = String(key || '').trim();
  if (!next) return '';
  const lookup = {
    enter: 'Enter',
    return: 'Enter',
    tab: 'Tab',
    space: 'Space',
    escape: 'Escape',
    esc: 'Escape',
    backspace: 'Backspace',
    delete: 'Delete',
    arrowleft: 'Left',
    left: 'Left',
    arrowright: 'Right',
    right: 'Right',
    arrowup: 'Up',
    up: 'Up',
    arrowdown: 'Down',
    down: 'Down',
  };
  return lookup[next.toLowerCase()] || next;
}

function normalizeBrowserModifiers(modifiers) {
  if (!Array.isArray(modifiers)) {
    return [];
  }
  return modifiers
    .map((item) => String(item || '').trim().toLowerCase())
    .filter(Boolean)
    .map((item) => {
      if (item === 'cmd' || item === 'command' || item === 'meta') return 'meta';
      if (item === 'ctrl' || item === 'control') return 'control';
      if (item === 'alt' || item === 'option') return 'alt';
      if (item === 'shift') return 'shift';
      return '';
    })
    .filter(Boolean);
}

async function sendControlledBrowserKeypress(key, modifiers = []) {
  const window = getControlledBrowserWindow();
  if (!window) {
    return { ok: false, error: 'Controlled browser is not open' };
  }
  const keyCode = normalizeBrowserKey(key);
  if (!keyCode) {
    return { ok: false, error: 'Key is required' };
  }
  const nextModifiers = normalizeBrowserModifiers(modifiers);
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers: nextModifiers });
  if (keyCode.length === 1) {
    window.webContents.sendInputEvent({ type: 'char', keyCode, modifiers: nextModifiers });
  }
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers: nextModifiers });
  await sleep(120);
  return {
    ...browserSummary(window),
    ok: true,
    key: keyCode,
    modifiers: nextModifiers,
  };
}

async function scrollControlledBrowser(deltaX = 0, deltaY = 0) {
  const window = getControlledBrowserWindow();
  if (!window) {
    return { ok: false, error: 'Controlled browser is not open' };
  }
  await ensureBrowserAutomation(window);
  await window.webContents.executeJavaScript(
    `window.scrollBy({ left: ${Number(deltaX) || 0}, top: ${Number(deltaY) || 0}, behavior: 'auto' }); true;`,
    true,
  );
  await sleep(120);
  return {
    ...browserSummary(window),
    ok: true,
    delta_x: Number(deltaX) || 0,
    delta_y: Number(deltaY) || 0,
  };
}

async function goBackControlledBrowser() {
  const window = getControlledBrowserWindow();
  if (!window) {
    return { ok: false, error: 'Controlled browser is not open' };
  }
  if (!window.webContents.canGoBack()) {
    return { ...browserSummary(window), ok: false, error: 'Controlled browser cannot go back' };
  }
  window.webContents.goBack();
  await waitForPageLoad(window.webContents, 15000);
  return {
    ...browserSummary(window),
    ok: true,
    navigated: true,
  };
}

module.exports = {
  closeControlledBrowser,
  clickControlledBrowserElement,
  getControlledBrowserState,
  navigateControlledBrowser,
  scrollControlledBrowser,
  sendControlledBrowserKeypress,
  showControlledBrowser,
  typeIntoControlledBrowserElement,
};
