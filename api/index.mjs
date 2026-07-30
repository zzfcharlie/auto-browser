import puppeteer from 'puppeteer-core';
import { buildMap, injectOverlay, removeOverlay } from '../core/map.mjs';
import { detectFramework } from '../detector/index.mjs';
import { CacheManager } from '../cache/manager.mjs';
import * as network from '../core/network.mjs';
import { waitForSelector, waitForText, waitForUrl, waitForDomStable } from '../core/wait.mjs';
import { diffMaps } from '../core/diff.mjs';
import { ensureChrome } from '../core/launcher.mjs';

const CDP_URL = 'http://127.0.0.1:9222';
const sleep = ms => new Promise(r => setTimeout(r, ms));

export class AutoBrowser {
  constructor(options = {}) {
    this.cdpUrl = options.cdpUrl || CDP_URL;
    this.browser = null;
    this.page = null;
    this.cache = new CacheManager();
  }

  async connect(hostname) {
    // Guarantee a CDP-enabled Chrome exists before connecting so a single
    // invocation works on any machine (auto-launch dedicated profile if needed).
    const portStr = new URL(this.cdpUrl).port;
    const ready = await ensureChrome({ port: portStr ? Number(portStr) : undefined });
    this.browser = await puppeteer.connect({ browserURL: ready.browserURL });
    const pages = await this.browser.pages();
    
    if (hostname) {
      this.page = pages.find(p => p.url().includes(hostname));
    }
    if (!this.page) {
      this.page = pages[0] || await this.browser.newPage();
    }
    
    await this.page.setViewport({ width: 1920, height: 1080 });
    return { browser: this.browser, page: this.page };
  }

  async disconnect() {
    if (this.browser) {
      try {
        if (typeof this.browser.isConnected === 'function' && this.browser.isConnected()) {
          await this.browser.disconnect();
        }
      } catch (e) {
        // ignore disconnect errors
      }
      this.browser = null;
      this.page = null;
    }
  }

  async navigate(url) {
    if (!this.page) throw new Error('Not connected. Call connect() first.');
    await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(500);
  }

  async buildMap(options = {}) {
    if (!this.page) throw new Error('Not connected. Call connect() first.');
    return buildMap(this.page, options);
  }

  async detectFramework() {
    if (!this.page) throw new Error('Not connected. Call connect() first.');
    return detectFramework(this.page);
  }

  async waitForSelector(selector, options = {}) { return waitForSelector(this.page, selector, options); }
  async waitForText(text, options = {}) { return waitForText(this.page, text, options); }
  async waitForUrl(pattern, options = {}) { return waitForUrl(this.page, pattern, options); }
  async waitForDomStable(options = {}) { return waitForDomStable(this.page, options); }
  async diffMaps(previous, options = {}) {
    return diffMaps(previous, await this.buildMap(options));
  }

  async injectOverlay(elements) {
    if (!this.page) throw new Error('Not connected. Call connect() first.');
    return injectOverlay(this.page, elements);
  }

  async removeOverlay() {
    if (!this.page) throw new Error('Not connected. Call connect() first.');
    return removeOverlay(this.page);
  }

  // 智能执行：先查缓存，未命中则建图
  async smartExecute(url, intent) {
    await this.navigate(url);
    
    // 查缓存
    const cached = this.cache.findCache(this.page.url());
    if (cached && !this.cache.isExpired(cached)) {
      console.log(`[Cache Hit] ${cached.site}/${cached.pageName}`);
      return { cached: true, entry: cached };
    }

    // 未命中，建图
    console.log(`[Cache Miss] Building map...`);
    const map = await this.buildMap({ compress: true });
    const framework = await this.detectFramework();
    
    // 保存缓存
    const site = new URL(url).hostname.replace('www.', '');
    const pageName = this.page.url().split('/').pop() || 'index';
    this.cache.saveMap(site, pageName, this.page.url(), map);
    
    return { cached: false, map, framework };
  }

  // Network capture
  async startNetworkCapture(options = {}) {
    return network.startCapture(this.page, options);
  }

  async stopNetworkCapture() {
    return network.stopCapture(this.page);
  }

  async getAllResponseBodies() {
    return network.getAllResponseBodies(this.page);
  }

  getCapturedRequests() {
    return network.getCapturedRequests();
  }

  async captureNavigation(url, options = {}) {
    return network.captureNavigation(this.page, url, options);
  }

  // 获取当前页面
  getPage() {
    return this.page;
  }

  // 获取缓存管理器
  getCache() {
    return this.cache;
  }
}
