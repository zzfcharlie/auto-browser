import puppeteer from 'puppeteer-core';
import { buildMap, injectOverlay, removeOverlay } from '../core/map.mjs';
import { detectFramework } from '../detector/index.mjs';
import { CacheManager } from '../cache/manager.mjs';
import * as network from '../core/network.mjs';

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
    this.browser = await puppeteer.connect({ browserURL: this.cdpUrl });
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
    if (this.browser && this.browser.isConnected()) {
      await this.browser.disconnect();
      this.browser = null;
      this.page = null;
    }
  }

  async navigate(url) {
    if (!this.page) throw new Error('Not connected. Call connect() first.');
    await this.page.goto(url, { waitUntil: 'networkidle0', timeout: 15000 });
    await sleep(2000);
  }

  async buildMap(options = {}) {
    if (!this.page) throw new Error('Not connected. Call connect() first.');
    return buildMap(this.page, options);
  }

  async detectFramework() {
    if (!this.page) throw new Error('Not connected. Call connect() first.');
    return detectFramework(this.page);
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
