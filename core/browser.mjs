import puppeteer from 'puppeteer-core';

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

  _browser = await puppeteer.connect({ browserURL: url });
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
  if (_browser && _browser.isConnected()) {
    await _browser.disconnect();
    _browser = null;
  }
}

export async function navigate(page, url) {
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 15000 });
}

export function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
