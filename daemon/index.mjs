// --- auto-browser Daemon ---
// Inspired by bb-browser's daemon pattern.
// A background HTTP server that maintains persistent CDP connection
// and handles concurrent requests from CLI or MCP clients.

import http from 'http';
import { connect, disconnect, navigate } from '../core/browser.mjs';
import { buildMap } from '../core/map.mjs';
import { detectFramework } from '../detector/index.mjs';
import * as network from '../core/network.mjs';
import { loadBuiltInAdapters, listAdapters, runAdapter } from '../site/loader.mjs';
import { CacheManager } from '../cache/manager.mjs';

const DEFAULT_PORT = 19824;
const DEFAULT_HOST = '127.0.0.1';

let _server = null;
let _daemonState = {
  running: false,
  browser: null,
  pages: {},      // tabId -> { page, url, title, created }
  tabCounter: 0,
  startedAt: null,
  cache: new CacheManager(),
};

// --- Tab management ---

function assignTabId() {
  return (++_daemonState.tabCounter).toString(36);
}

async function ensureConnected() {
  if (!_daemonState.browser || !_daemonState.browser.isConnected()) {
    const { browser, page } = await connect();
    _daemonState.browser = browser;
    const tabId = assignTabId();
    _daemonState.pages[tabId] = {
      page,
      url: '',
      title: 'new tab',
      created: new Date().toISOString(),
    };
    return tabId;
  }
  // Return first available tab
  const existing = Object.entries(_daemonState.pages);
  if (existing.length > 0) return existing[0][0];

  const page = await _daemonState.browser.newPage();
  const tabId = assignTabId();
  _daemonState.pages[tabId] = { page, url: '', title: 'new tab', created: new Date().toISOString() };
  return tabId;
}

function getPage(tabId) {
  const entry = _daemonState.pages[tabId];
  if (!entry) throw new Error(`Tab ${tabId} not found. Use 'tab list' to see available tabs.`);
  return entry.page;
}

// --- HTTP API ---

function jsonResponse(res, data, status = 200) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(data));
}

function errorResponse(res, message, hint = '', status = 400) {
  jsonResponse(res, { error: { message, hint } }, status);
}

async function handleCommand(method, params = {}) {
  switch (method) {

    // --- Daemon control ---
    case 'daemon/status':
      return {
        running: _daemonState.running,
        startedAt: _daemonState.startedAt,
        connected: _daemonState.browser?.isConnected() || false,
        tabs: Object.entries(_daemonState.pages).map(([id, p]) => ({
          id, url: p.url, title: p.title, created: p.created
        })),
      };

    case 'daemon/stop':
      await disconnectAll();
      return { stopped: true };

    // --- Tab management ---
    case 'tab/list':
      return {
        tabs: Object.entries(_daemonState.pages).map(([id, p]) => ({
          id, url: p.url, title: p.title, created: p.created
        }))
      };

    case 'tab/new': {
      const page = await _daemonState.browser.newPage();
      const tabId = assignTabId();
      _daemonState.pages[tabId] = { page, url: '', title: 'new tab', created: new Date().toISOString() };
      return { tab: tabId };
    }

    case 'tab/close': {
      const { tab } = params;
      const entry = _daemonState.pages[tab];
      if (!entry) throw new Error(`Tab ${tab} not found`);
      await entry.page.close();
      delete _daemonState.pages[tab];
      return { closed: tab };
    }

    // --- Navigation ---
    case 'navigate/open': {
      const tabId = params.tab || await ensureConnected();
      const page = getPage(tabId);
      await navigate(page, params.url);
      _daemonState.pages[tabId].url = page.url();
      _daemonState.pages[tabId].title = await page.title();
      return { tab: tabId, url: page.url(), title: await page.title() };
    }

    case 'navigate/back': {
      const tabId = params.tab || (await ensureConnected());
      const page = getPage(tabId);
      await page.goBack({ waitUntil: 'networkidle0' });
      _daemonState.pages[tabId].url = page.url();
      _daemonState.pages[tabId].title = await page.title();
      return { tab: tabId, url: page.url() };
    }

    case 'navigate/reload': {
      const tabId = params.tab || (await ensureConnected());
      const page = getPage(tabId);
      await page.reload({ waitUntil: 'networkidle0' });
      return { tab: tabId, reloaded: true };
    }

    // --- Observation ---
    case 'observe/snap': {
      const tabId = params.tab || (await ensureConnected());
      const page = getPage(tabId);
      const map = await buildMap(page, { compress: true });
      return {
        tab: tabId,
        title: map.title,
        url: map.url,
        viewport: map.viewport,
        elementCount: map.elements.length,
        elements: map.elements.slice(0, 100),
      };
    }

    case 'observe/screenshot': {
      const tabId = params.tab || (await ensureConnected());
      const page = getPage(tabId);
      const buffer = await page.screenshot({ type: 'jpeg', quality: 80 });
      return {
        tab: tabId,
        screenshot: buffer.toString('base64'),
        format: 'jpeg',
      };
    }

    case 'observe/eval': {
      const tabId = params.tab || (await ensureConnected());
      const page = getPage(tabId);
      const result = await page.evaluate(params.code);
      return { tab: tabId, result };
    }

    case 'observe/get': {
      const tabId = params.tab || (await ensureConnected());
      const page = getPage(tabId);
      const value = await page.evaluate((attr) => {
        if (attr === 'url') return location.href;
        if (attr === 'title') return document.title;
        if (attr === 'html') return document.documentElement.outerHTML.slice(0, 50000);
        if (attr === 'text') return document.body.innerText.slice(0, 50000);
        return document[attr];
      }, params.attr);
      return { tab: tabId, [params.attr]: value };
    }

    // --- Interaction ---
    case 'interact/click': {
      const tabId = params.tab || (await ensureConnected());
      const page = getPage(tabId);
      const { x, y, selector, ref } = params;

      if (x && y) {
        await page.mouse.click(x, y);
      } else if (selector) {
        const el = await page.$(selector);
        if (!el) throw new Error(`Element not found: ${selector}`);
        await el.click();
      } else {
        throw new Error('Provide x/y coordinates or a CSS selector');
      }
      await new Promise(r => setTimeout(r, 500));
      return { tab: tabId, clicked: true };
    }

    case 'interact/fill': {
      const tabId = params.tab || (await ensureConnected());
      const page = getPage(tabId);
      const { selector, value } = params;
      if (!selector) throw new Error('Provide a CSS selector');
      await page.click(selector);
      await page.keyboard.selectAll();
      await page.keyboard.press('Delete');
      await page.keyboard.type(value, { delay: 10 });
      return { tab: tabId, filled: true };
    }

    case 'interact/type': {
      const tabId = params.tab || (await ensureConnected());
      const page = getPage(tabId);
      await page.keyboard.type(params.text, { delay: 10 });
      return { tab: tabId };
    }

    case 'interact/scroll': {
      const tabId = params.tab || (await ensureConnected());
      const page = getPage(tabId);
      const { x = 0, y = 0 } = params;
      await page.evaluate((sx, sy) => window.scrollTo(sx, sy), x, y);
      return { tab: tabId, scrolledTo: { x, y } };
    }

    // --- Framework detection ---
    case 'detect': {
      const tabId = params.tab || (await ensureConnected());
      const page = getPage(tabId);
      const result = await detectFramework(page);
      return { tab: tabId, ...result };
    }

    // --- Network capture ---
    case 'network/start': {
      const tabId = params.tab || (await ensureConnected());
      const page = getPage(tabId);
      const session = await network.startCapture(page, {
        withBody: params.withBody || false,
        filterPatterns: params.filter ? [params.filter] : [],
      });
      return { tab: tabId, capturing: true };
    }

    case 'network/stop': {
      const tabId = params.tab || (await ensureConnected());
      const page = getPage(tabId);
      const count = await network.stopCapture(page);
      const requests = network.getCapturedRequests();
      if (params.withBody) {
        await network.getAllResponseBodies(page);
      }
      return { tab: tabId, count, requests };
    }

    case 'network/requests': {
      return { requests: network.getCapturedRequests() };
    }

    case 'network/clear': {
      network.clearCapturedRequests();
      return { cleared: true };
    }

    // --- Site adapters ---
    case 'site/list': {
      const adapters = listAdapters();
      return { adapters, count: adapters.length };
    }

    case 'site/run': {
      const { adapter, ...rest } = params;
      if (!adapter) throw new Error('Provide adapter name');
      const tabId = params.tab || (await ensureConnected());
      const page = getPage(tabId);

      const siteParams = { ...rest };
      delete siteParams.tab;
      delete siteParams.adapter;

      const result = await runAdapter(page, adapter, siteParams);
      return { tab: tabId, adapter, result };
    }

    // --- Page map ---
    case 'map': {
      const tabId = params.tab || (await ensureConnected());
      const page = getPage(tabId);
      const map = await buildMap(page, { compress: params.compress !== false });
      return { tab: tabId, ...map };
    }

    case 'map/detect': {
      const tabId = params.tab || (await ensureConnected());
      const page = getPage(tabId);
      const fw = await detectFramework(page);
      return { tab: tabId, ...fw };
    }

    default:
      throw new Error(`Unknown method: ${method}`);
  }
}

async function disconnectAll() {
  if (Object.keys(_daemonState.pages).length > 0) {
    for (const entry of Object.values(_daemonState.pages)) {
      try { await entry.page.close(); } catch {}
    }
    _daemonState.pages = {};
  }
  await disconnect();
  _daemonState.browser = null;
}

// --- Start daemon ---

export async function startDaemon(options = {}) {
  const port = options.port || DEFAULT_PORT;
  const host = options.host || DEFAULT_HOST;

  if (_server) {
    console.log(`[Daemon] Already running on ${host}:${port}`);
    return { port, host };
  }

  // Pre-load adapters
  await loadBuiltInAdapters();

  // Connect to browser
  await ensureConnected();

  _daemonState.running = true;
  _daemonState.startedAt = new Date().toISOString();

  _server = http.createServer(async (req, res) => {
    // CORS
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      res.end();
      return;
    }

    // POST /command — JSON-RPC style
    if (req.method === 'POST' && req.url === '/command') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          const { method, params } = JSON.parse(body);
          const result = await handleCommand(method, params);
          jsonResponse(res, { result });
        } catch (e) {
          const status = e.message.includes('not found') || e.message.includes('Provide') ? 400 : 500;
          errorResponse(res, e.message, '', status);
        }
      });
      return;
    }

    // GET /status
    if (req.url === '/status') {
      jsonResponse(res, await handleCommand('daemon/status'));
      return;
    }

    // GET / — help
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(`auto-browser daemon v1.0.0
Running on http://${host}:${port}

Endpoints:
  POST /command   - { method, params }
  GET  /status    - daemon status

Available methods:
  daemon/status, daemon/stop
  tab/list, tab/new, tab/close
  navigate/open, navigate/back, navigate/reload
  observe/snap, observe/screenshot, observe/eval, observe/get
  interact/click, interact/fill, interact/type, interact/scroll
  detect, map, map/detect
  network/start, network/stop, network/requests, network/clear
  site/list, site/run
`);
  });

  return new Promise((resolve, reject) => {
    _server.listen(port, host, () => {
      console.log(`[Daemon] Started on http://${host}:${port}`);
      resolve({ port, host });
    });
    _server.on('error', (e) => {
      console.error(`[Daemon] Failed to start: ${e.message}`);
      reject(e);
    });
  });
}

export function stopDaemon() {
  return new Promise(async (resolve) => {
    if (!_server) {
      _daemonState.running = false;
      resolve({ stopped: false, reason: 'not running' });
      return;
    }
    await disconnectAll();
    _server.close(() => {
      _server = null;
      _daemonState.running = false;
      console.log('[Daemon] Stopped');
      resolve({ stopped: true });
    });
    // Force close after 3s
    setTimeout(() => {
      if (_server) {
        _server.closeAllConnections?.();
        _server = null;
        _daemonState.running = false;
        resolve({ stopped: true, forced: true });
      }
    }, 3000);
  });
}

export function getDaemonStatus() {
  return { ..._daemonState, serverRunning: !!_server };
}
