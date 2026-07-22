# Auto-Browser 设计文档

> 日期：2026-07-22
> 状态：待实施

---

## 一、项目目标

构建通用浏览器自动化框架，支持：
1. **自动检测** 网站使用的 UI 组件库（Element Plus / Ant Design / MUI）
2. **统一 API** 操作不同 UI 框架的表单
3. **缓存复用** 地图 + 脚本持久化，最小化 token 消耗
4. **可视化调试** 建图时 overlay 标注元素序号

---

## 二、架构总览

```
auto-browser/
├── core/                    # 框架无关底层
│   ├── browser.mjs          # CDP 连接、tab 管理、导航
│   ├── dom.mjs              # 通用 DOM 查询
│   ├── interact.mjs         # CDP 坐标点击、键盘输入、滚动
│   └── map.mjs              # 7 层元素检测 + 地图压缩
│
├── detector/                # UI 框架自动检测
│   └── index.mjs            # 扫描页面特征 → 返回框架名
│
├── adapters/                # UI 框架适配器
│   ├── element-plus.mjs     # Element Plus 选择器 + 交互逻辑
│   ├── ant-design.mjs       # Ant Design 适配
│   ├── mui.mjs              # Material UI 适配
│   └── generic.mjs          # 兜底：原生 HTML 表单
│
├── api/                     # 语义化 API（对外唯一入口）
│   └── index.mjs            # AutoBrowser 类
│
├── cache/                   # 缓存层
│   ├── manager.mjs          # 缓存读写、过期检查
│   ├── maps/                # 页面地图 JSON
│   └── scripts/             # 操作脚本 .mjs
│
├── cli/                     # CLI 工具
│   └── index.mjs            # auto-browser map / run / cache
│
└── SKILL.md                 # OpenChrome Skill 文档
```

---

## 三、核心模块设计

### 3.1 core/map.mjs — 7 层元素检测

```js
export async function buildMap(page, options = {}) {
  const raw = await page.evaluate(() => {
    const elements = [];
    const seen = new Set();

    function addEl(el, source) {
      const rect = el.getBoundingClientRect();
      if (rect.width < 5 || rect.height < 5) return;
      const text = el.textContent.trim().slice(0, 60) 
                || el.getAttribute('aria-label') 
                || el.getAttribute('title') || '';
      const key = `${Math.round(rect.x)}|${Math.round(rect.y)}|${Math.round(rect.width)}|${Math.round(rect.height)}`;
      if (seen.has(key)) return;
      seen.add(key);
      elements.push({
        tag: el.tagName, text, source,
        cls: el.className.toString().slice(0, 60),
        role: el.getAttribute('role') || '',
        href: el.getAttribute('href') || '',
        rect: { x: Math.round(rect.x), y: Math.round(rect.y), 
                w: Math.round(rect.width), h: Math.round(rect.height) }
      });
    }

    // Layer 1-7 检测策略...
    return { url: location.href, title: document.title, elements };
  });

  return options.compress ? compressMap(raw) : raw;
}
```

### 3.2 地图压缩

```js
export function compressMap(map) {
  return {
    url: map.url,
    title: map.title,
    elements: map.elements
      .filter(el => el.text.length >= 2)           // 去掉空文本
      .filter(el => el.rect.y >= 0 && el.rect.y < 2000)  // 去掉视口外
      .filter((el, i, arr) => {                     // 去重：同位置保留 priority 高的
        const dup = arr.findIndex(e => 
          e.rect.x === el.rect.x && e.rect.y === el.rect.y &&
          e.rect.w === el.rect.w && e.rect.h === el.rect.h
        );
        return dup === i || sourcePriority(el.source) > sourcePriority(arr[dup].source);
      })
  };
}

const SOURCE_PRIORITY = {
  'standard': 6, 'aria': 5, 'icon-button': 4,
  'clickable': 3, 'onclick': 2, 'tabindex': 1, 'data-attr': 1
};
```

### 3.3 detector/index.mjs — UI 框架检测

```js
export async function detectFramework(page) {
  return page.evaluate(() => {
    const html = document.documentElement.innerHTML;
    const signals = {
      'element-plus': [
        () => document.querySelectorAll('.el-form-item, .el-input, .el-select').length > 3,
        () => html.includes('element-plus'),
        () => !!document.querySelector('[class*="el-"]')
      ],
      'ant-design': [
        () => document.querySelectorAll('.ant-form-item, .ant-input, .ant-select').length > 3,
        () => html.includes('ant-design') || html.includes('antd'),
        () => !!document.querySelector('[class*="ant-"]')
      ],
      'mui': [
        () => document.querySelectorAll('[class*="Mui"]').length > 3,
        () => html.includes('mui') || html.includes('material-ui'),
        () => !!document.querySelector('[class*="MuiButton"]')
      ]
    };
    // 三信号投票，返回最高分
  });
}
```

### 3.4 adapters/ — 框架适配器接口

```js
// 每个 adapter 实现统一接口
export const adapter = {
  name: 'element-plus',
  
  // 表单操作
  async fillInput(page, label, value) { ... },
  async selectDropdown(page, label, targetValue) { ... },
  async switchTab(page, tabName) { ... },
  
  // 读取表单
  async readForm(page) { ... },
  
  // 特征选择器
  selectors: {
    input: '.el-input__inner',
    dropdownTrigger: '.el-select__wrapper',
    dropdownOption: '.el-select-dropdown__item',
    formLabel: '.el-form-item__label',
    button: '.el-button',
    tab: '.el-tabs__item'
  }
};
```

### 3.5 cache/manager.mjs — 缓存管理

```js
import fs from 'fs';
import path from 'path';

const CACHE_DIR = './cache';
const INDEX_FILE = path.join(CACHE_DIR, 'index.json');

export class CacheManager {
  constructor() {
    this.index = this.loadIndex();
  }

  // 查找缓存：URL pattern 匹配
  findCache(url) {
    for (const [site, pages] of Object.entries(this.index)) {
      for (const [pageName, pageData] of Object.entries(pages)) {
        if (new RegExp(pageData.urlPattern).test(url)) {
          return { site, pageName, ...pageData };
        }
      }
    }
    return null;
  }

  // 保存地图
  saveMap(site, pageName, urlPattern, map) {
    const mapFile = `maps/${site}/${pageName}.json`;
    fs.mkdirSync(path.dirname(path.join(CACHE_DIR, mapFile)), { recursive: true });
    fs.writeFileSync(path.join(CACHE_DIR, mapFile), JSON.stringify(map, null, 2));
    this.updateIndex(site, pageName, urlPattern, mapFile, map.elements.length);
  }

  // 保存脚本
  saveScript(site, scriptName, code) {
    const scriptFile = `scripts/${site}/${scriptName}.mjs`;
    fs.mkdirSync(path.dirname(path.join(CACHE_DIR, scriptFile)), { recursive: true });
    fs.writeFileSync(path.join(CACHE_DIR, scriptFile), code);
    return scriptFile;
  }

  // 检查缓存是否过期（默认 7 天）
  isExpired(cacheEntry, maxAgeMs = 7 * 24 * 60 * 60 * 1000) {
    return Date.now() - new Date(cacheEntry.lastBuild).getTime() > maxAgeMs;
  }

  // 失效缓存
  invalidate(site, pageName) {
    delete this.index[site][pageName];
    this.saveIndex();
  }
}
```

---

## 四、混合执行流程

```
用户指令："打开 Kaggle Playground，点击 Titanic"

┌─ Step 1: 导航 ─────────────────────────────────────┐
│ page.goto('https://www.kaggle.com/competitions')    │
└─────────────────────────────────────────────────────┘
                        ↓
┌─ Step 2: 查缓存 ───────────────────────────────────┐
│ cache.findCache(currentUrl)                         │
│                                                     │
│ ✅ 命中且未过期 → 跳到 Step 5                       │
│ ❌ 未命中或过期 → 继续 Step 3                       │
└─────────────────────────────────────────────────────┘
                        ↓
┌─ Step 3: 建图（消耗 token）────────────────────────┐
│ map = buildMap(page, { compress: true })            │
│ framework = detectFramework(page)                   │
│ cache.saveMap(site, pageName, urlPattern, map)      │
│ → 消耗 ~500-2000 tokens（取决于页面复杂度）         │
└─────────────────────────────────────────────────────┘
                        ↓
┌─ Step 4: 生成脚本（消耗 token）────────────────────┐
│ script = llm.generate(map, userIntent)              │
│ cache.saveScript(site, scriptName, script)          │
│ → 消耗 ~1000-3000 tokens（一次性）                  │
└─────────────────────────────────────────────────────┘
                        ↓
┌─ Step 5: 执行脚本（零 token）──────────────────────┐
│ node cache/scripts/kaggle/goto-playground.mjs       │
│                                                     │
│ ✅ 成功 → 完成                                      │
│ ❌ 失败 → 跳到 Step 6                               │
└─────────────────────────────────────────────────────┘
                        ↓
┌─ Step 6: 出错恢复（消耗少量 token）────────────────┐
│ newMap = buildMap(page, { compress: true })         │
│ diff = compareMaps(oldMap, newMap)                  │
│ fixScript = llm.fixScript(oldScript, diff)          │
│ cache.saveScript(site, scriptName, fixScript)       │
│ → 消耗 ~300-800 tokens（差分修复）                  │
└─────────────────────────────────────────────────────┘
```

---

## 五、Token 消耗对比

| 场景 | 原方案（每步建图） | 混合方案 |
|------|------------------|---------|
| 首次访问 Kaggle | ~2000 × 5 步 = 10000 | ~2000（一次性建图+脚本） |
| 第 2 次访问 | 10000 | **0**（跑缓存脚本） |
| 第 100 次访问 | 10000 | **0** |
| 页面改版出错 | 10000 | ~500（差分修复） |
| 缓存过期重建 | 10000 | ~2000（重新建图） |

---

## 六、缓存结构

```
cache/
├── index.json               # 缓存索引
├── maps/                    # 页面地图
│   ├── kaggle/
│   │   ├── competitions.json
│   │   ├── competition-detail.json
│   │   └── rules.json
│   ├── das/
│   │   ├── component-list.json
│   │   └── component-form.json
│   └── baidu/
│       └── home.json
└── scripts/                 # 操作脚本
    ├── kaggle/
    │   ├── goto-playground.mjs
    │   └── click-competition.mjs
    └── das/
        └── create-component.mjs
```

### index.json 格式

```json
{
  "kaggle": {
    "competitions": {
      "urlPattern": "kaggle\\.com/competitions$",
      "mapFile": "maps/kaggle/competitions.json",
      "lastBuild": "2026-07-22T10:00:00Z",
      "elementCount": 445,
      "scripts": ["goto-playground.mjs"]
    },
    "competition-detail": {
      "urlPattern": "kaggle\\.com/competitions/[^/]+$",
      "mapFile": "maps/kaggle/competition-detail.json",
      "lastBuild": "2026-07-22T10:05:00Z",
      "elementCount": 137,
      "scripts": ["click-tab.mjs"]
    }
  }
}
```

---

## 七、可视化 Overlay

建图时可选注入 overlay，每个元素画彩色边框 + 序号：

```js
export async function injectOverlay(page, elements) {
  await page.evaluate((els) => {
    const overlay = document.createElement('div');
    overlay.id = '__ab_overlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:2147483647;';
    document.body.appendChild(overlay);

    const colors = ['#FF6B6B','#4ECDC4','#45B7D1','#96CEB4','#FFEAA7',...];

    els.forEach((el, i) => {
      const color = colors[i % colors.length];
      const { x, y, w, h } = el.rect;
      // 边框
      const box = document.createElement('div');
      box.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px;border:2px solid ${color};`;
      overlay.appendChild(box);
      // 序号标签
      const label = document.createElement('div');
      label.textContent = `${i + 1}`;
      label.style.cssText = `position:absolute;left:${x-1}px;top:${y-18}px;background:${color};color:#fff;font-size:11px;...`;
      overlay.appendChild(label);
    });
  }, elements);
}
```

---

## 八、实施计划

| Phase | 内容 | 预估时间 |
|-------|------|---------|
| 1 | 搭建 core/ + detector/ + api/ 骨架 | 1-2 天 |
| 2 | 实现 cache/manager.mjs + 缓存结构 | 1 天 |
| 3 | 实现 element-plus.mjs adapter（从 letsgopanel 迁移） | 2-3 天 |
| 4 | 实现 ant-design.mjs + mui.mjs adapter | 1-2 天 |
| 5 | CLI 工具 + 混合执行流程 | 1 天 |
| 6 | 测试 + 调优 | 1-2 天 |

---

## 九、风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| SPA 路由变化导致 DOM 重建 | 缓存脚本失效 | URL pattern 匹配 + 出错自动重建 |
| 自定义主题覆盖类名 | 检测失败 | 多信号投票 + 降级到 generic |
| 缓存过期 | 使用旧地图 | 可配置过期时间 + 手动 invalidate |
| 跨 iframe | 无法直接查询 | 暂不支持，后续扩展 |
| 脚本执行失败 | 流程中断 | 自动 fallback 到建图+修复模式 |
