// --- Site Adapter Loader ---
// Inspired by bb-browser's site command pattern.
// Each site adapter is a JS module that exports a function:
//   export default async function(page, params) => data
//
// The adapter runs inside the browser via page.evaluate() with full
// cookie/auth access, then returns structured JSON data.
// No building page map, no clicking around — just eval + fetch.

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REGISTRY_DIR = path.join(__dirname, 'registry');

// --- Built-in adapters registry ---
const builtInAdapters = {};

export async function loadBuiltInAdapters() {
  const registryDir = REGISTRY_DIR;
  if (!fs.existsSync(registryDir)) return {};

  const files = fs.readdirSync(registryDir).filter(f => f.endsWith('.mjs'));
  for (const file of files) {
    try {
      const filePath = path.join(registryDir, file);
      // Use file:// URL for Windows compatibility
      const fileUrl = new URL('file://' + (process.platform === 'win32' ? '/' : '') + filePath.replace(/\\/g, '/')).href;
      const mod = await import(fileUrl);
      const name = path.basename(file, '.mjs');
      builtInAdapters[name] = mod.default || mod;
    } catch (e) {
      console.error(`[Site] Failed to load adapter ${file}: ${e.message}`);
    }
  }
  return builtInAdapters;
}

/**
 * List available site adapters.
 */
export function listAdapters() {
  const result = [];
  for (const [name, adapter] of Object.entries(builtInAdapters)) {
    result.push({
      name,
      description: adapter.description || '',
      params: adapter.params || [],
      examples: adapter.examples || [],
    });
  }
  return result;
}

/**
 * Run a site adapter.
 * @param {Page} page - Puppeteer page
 * @param {string} adapterName - e.g. 'github-search', 'arxiv-search'
 * @param {object} params - adapter-specific parameters
 */
export async function runAdapter(page, adapterName, params = {}) {
  const adapter = builtInAdapters[adapterName];
  if (!adapter) {
    throw new Error(`Unknown adapter: ${adapterName}. Available: ${Object.keys(builtInAdapters).join(', ')}`);
  }

  const adapterFn = typeof adapter === 'function' ? adapter : adapter.execute;
  if (!adapterFn) {
    throw new Error(`Adapter ${adapterName} has no executable function.`);
  }

  return adapterFn(page, params);
}

/**
 * Run arbitrary JavaScript in page context and return result.
 * The core primitive: eval JS inside your real browser session.
 */
export async function evalInPage(page, jsCode, args = {}) {
  return page.evaluate(({ code, ...rest }) => {
    return eval(code);
  }, { code: jsCode, ...args });
}

/**
 * Fetch from URL using page's cookies/auth (runs inside browser context).
 */
export async function fetchAsPage(page, url, options = {}) {
  const { method = 'GET', headers = {}, body } = options;

  return page.evaluate(async ({ url, method, headers, body }) => {
    const opts = { method, headers, credentials: 'include' };
    if (body) opts.body = body;
    const resp = await fetch(url, opts);

    const contentType = resp.headers.get('content-type') || '';
    let data;
    if (contentType.includes('application/json')) {
      data = await resp.json();
    } else {
      data = await resp.text();
    }

    return {
      status: resp.status,
      statusText: resp.statusText,
      headers: Object.fromEntries(resp.headers.entries()),
      data,
    };
  }, { url, method, headers, body });
}
