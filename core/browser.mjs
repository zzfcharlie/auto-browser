import puppeteer from 'puppeteer-core';
import { ensureChrome } from './launcher.mjs';

const CDP_URL = 'http://127.0.0.1:9222';
const VIEWPORT = { width: 1920, height: 1080 };
const TIMEOUT = 8000;

let _browser = null;

export async function connect({ url = CDP_URL, hostname, viewport = VIEWPORT } = {}) {
  if (_browser && _browser.isConnected()) {
    const pages = await _browser.pages();
    if (hostname) {
      const p = pages.find(p => p.url().includes(hostname));
      if (p) return { browser: _browser, page: p };
    }
    return { browser: _browser, page: pages[0] || await _browser.newPage() };
  }

  // Guarantee a CDP-enabled Chrome exists before connecting.
  // This is what makes a single invocation "just work" on any machine.
  const ready = await ensureChrome({ port: new URL(url).port ? Number(new URL(url).port) : undefined });
  _browser = await puppeteer.connect({ browserURL: ready.browserURL });
  const pages = await _browser.pages();

  let page;
  if (hostname) {
    page = pages.find(p => p.url().includes(hostname));
  }
  if (!page) page = pages[0] || await _browser.newPage();

  await page.setViewport(viewport);
  page.setDefaultTimeout(TIMEOUT);
  return { browser: _browser, page };
}

export async function disconnect() {
  if (_browser) {
    try {
      if (typeof _browser.isConnected === 'function' && _browser.isConnected()) {
        await _browser.disconnect();
      }
    } catch (e) {
      // ignore disconnect errors
    }
    _browser = null;
  }
}

export async function navigate(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
}

export function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
