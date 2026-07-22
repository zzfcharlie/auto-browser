import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = __dirname;
const INDEX_FILE = path.join(CACHE_DIR, 'index.json');

export class CacheManager {
  constructor() {
    this.index = this.loadIndex();
  }

  loadIndex() {
    if (fs.existsSync(INDEX_FILE)) {
      return JSON.parse(fs.readFileSync(INDEX_FILE, 'utf-8'));
    }
    return {};
  }

  saveIndex() {
    fs.writeFileSync(INDEX_FILE, JSON.stringify(this.index, null, 2));
  }

  // 查找缓存：URL pattern 匹配
  findCache(url) {
    for (const [site, pages] of Object.entries(this.index)) {
      for (const [pageName, pageData] of Object.entries(pages)) {
        try {
          if (new RegExp(pageData.urlPattern).test(url)) {
            return { site, pageName, ...pageData };
          }
        } catch (e) {
          // invalid regex, skip
        }
      }
    }
    return null;
  }

  // 保存地图
  saveMap(site, pageName, urlPattern, map) {
    const mapDir = path.join(CACHE_DIR, 'maps', site);
    fs.mkdirSync(mapDir, { recursive: true });
    const mapFile = `maps/${site}/${pageName}.json`;
    fs.writeFileSync(path.join(CACHE_DIR, mapFile), JSON.stringify(map, null, 2));

    // 更新索引
    if (!this.index[site]) this.index[site] = {};
    this.index[site][pageName] = {
      urlPattern,
      mapFile,
      lastBuild: new Date().toISOString(),
      elementCount: map.elements.length,
      scripts: this.index[site][pageName]?.scripts || []
    };
    this.saveIndex();
    console.log(`[Cache] Saved map: ${mapFile} (${map.elements.length} elements)`);
  }

  // 保存脚本
  saveScript(site, pageName, scriptName, code) {
    const scriptDir = path.join(CACHE_DIR, 'scripts', site);
    fs.mkdirSync(scriptDir, { recursive: true });
    const scriptFile = `scripts/${site}/${scriptName}.mjs`;
    fs.writeFileSync(path.join(CACHE_DIR, scriptFile), code);

    // 更新索引
    if (!this.index[site]) this.index[site] = {};
    if (!this.index[site][pageName]) {
      this.index[site][pageName] = { scripts: [] };
    }
    if (!this.index[site][pageName].scripts.includes(scriptName)) {
      this.index[site][pageName].scripts.push(scriptName);
    }
    this.saveIndex();
    console.log(`[Cache] Saved script: ${scriptFile}`);
    return scriptFile;
  }

  // 读取地图
  getMap(cacheEntry) {
    const mapFile = path.join(CACHE_DIR, cacheEntry.mapFile);
    if (fs.existsSync(mapFile)) {
      return JSON.parse(fs.readFileSync(mapFile, 'utf-8'));
    }
    return null;
  }

  // 检查缓存是否过期（默认 7 天）
  isExpired(cacheEntry, maxAgeMs = 7 * 24 * 60 * 60 * 1000) {
    if (!cacheEntry.lastBuild) return true;
    return Date.now() - new Date(cacheEntry.lastBuild).getTime() > maxAgeMs;
  }

  // 失效缓存
  invalidate(site, pageName) {
    if (this.index[site]?.[pageName]) {
      delete this.index[site][pageName];
      this.saveIndex();
      console.log(`[Cache] Invalidated: ${site}/${pageName}`);
    }
  }

  // 列出所有缓存
  list() {
    const result = [];
    for (const [site, pages] of Object.entries(this.index)) {
      for (const [pageName, pageData] of Object.entries(pages)) {
        result.push({ site, pageName, ...pageData });
      }
    }
    return result;
  }

  // 清空缓存
  clear() {
    this.index = {};
    this.saveIndex();
    // 删除 maps 和 scripts 目录内容
    const mapsDir = path.join(CACHE_DIR, 'maps');
    const scriptsDir = path.join(CACHE_DIR, 'scripts');
    if (fs.existsSync(mapsDir)) fs.rmSync(mapsDir, { recursive: true, force: true });
    if (fs.existsSync(scriptsDir)) fs.rmSync(scriptsDir, { recursive: true, force: true });
    fs.mkdirSync(path.join(mapsDir), { recursive: true });
    fs.mkdirSync(path.join(scriptsDir), { recursive: true });
    console.log('[Cache] Cleared all cache');
  }
}
