---
name: auto-browser
description: >
  CDP-driven browser automation framework. Build a page map once, execute
  scripts forever — no screenshots, no per-call LLM understanding.
  Use when automating multi-step browser tasks on known websites where
  token efficiency matters.
---

# Auto-Browser

> 一次建图，永久复用。零截图、零每轮理解成本。

## 核心理念

传统方案（openchrome / browser-use）：
```
每次操作 → LLM 理解页面 → 定位元素 → 执行 → 下次重复
                                                ↑ token 浪费在这里
```

Auto-Browser：
```
第一次：建图（LLM 分析页面 → 输出元素地图 + 脚本）
后续：  执行（直接 CDP 跑脚本，零 LLM 参与）
```

## 架构

```
auto-browser/
├── core/
│   ├── browser.mjs     CDP 连接管理
│   ├── dom.mjs          DOM 查询 + 元素过滤
│   ├── interact.mjs     点击 / 输入 / 下拉 / 滚动
│   ├── form.mjs         表单填充 / 读取
│   └── map.mjs          页面建图：7 层元素检测
├── detector/
│   └── index.mjs        UI 框架自动检测
├── adapters/
│   ├── element-plus.mjs Element Plus 适配器
│   ├── ant-design.mjs   Ant Design 适配器
│   ├── mui.mjs          Material UI 适配器
│   └── generic.mjs      通用 HTML 适配器
├── cache/
│   ├── manager.mjs      缓存管理
│   ├── maps/            页面地图 JSON
│   └── scripts/         操作脚本 .mjs
├── api/
│   └── index.mjs        AutoBrowser 主类
├── mcp/
│   └── server.mjs       MCP Server
└── bin/
    └── cli.mjs          CLI 工具
```

## 工作流

### Phase 1: 建图（一次性，消耗 token）
```
目标网站 → buildMap() 分析页面
         → 输出 cache/maps/<site>/<page>.json（元素选择器 + 布局）
         → 生成 cache/scripts/<site>/<action>.mjs（操作脚本）
```

### Phase 2: 执行（零 token，纯 CDP）
```
node cache/scripts/<site>/<action>.mjs
→ 直接 CDP 操作，不需要 LLM
```

## 7 层元素检测

```
Layer 1 (standard): button, a, input, textarea, select, [role="button"], ...
Layer 2 (aria):      [aria-label]
Layer 3 (icon-btn):  cursor:pointer + SVG 子元素 → 捕获图标按钮
Layer 4 (clickable): cursor:pointer 叶子元素
Layer 5 (onclick):   el.onclick !== null
Layer 6 (data-attr): [data-toggle], [data-target], [data-action]
Layer 7 (tabindex):  [tabindex] ≥ 0
```

## UI 框架检测

自动检测网站使用的 UI 组件库：
- Element Plus（`.el-*` 类名）
- Ant Design（`.ant-*` 类名）
- MUI（`.Mui*` 类名）

## CLI 使用

```bash
# 建图
auto-browser map https://example.com

# 带可视化 overlay
auto-browser map https://example.com --visualize

# 检测 UI 框架
auto-browser detect https://element-plus.org

# 缓存管理
auto-browser cache list
auto-browser cache clear
```

## API 使用

```javascript
import { AutoBrowser } from 'auto-browser';

const ab = new AutoBrowser();
await ab.connect();
await ab.navigate('https://example.com');

// 建图
const map = await ab.buildMap({ compress: true });
console.log(`Found ${map.elements.length} elements`);

// 检测框架
const framework = await ab.detectFramework();
console.log(`Framework: ${framework.detected}`);

// 可视化
await ab.injectOverlay(map.elements);

// 智能执行（使用缓存）
const result = await ab.smartExecute('https://example.com', 'click login');

await ab.disconnect();
```

## MCP Server

```bash
auto-browser mcp
```

或在 MCP 客户端配置：
```json
{
  "mcpServers": {
    "auto-browser": {
      "command": "auto-browser",
      "args": ["mcp"]
    }
  }
}
```

## Token 节省

| 场景 | 每步建图 | Auto-Browser |
|------|---------|--------------|
| 首次访问 | ~2000 tokens | ~2000 tokens |
| 二次访问 | ~2000 tokens | **0 tokens** ✅ |
| 第 100 次 | ~2000 tokens | **0 tokens** ✅ |
| 页面改版 | ~2000 tokens | ~500 tokens（差分） |

## 关键经验

1. **坐标必须取整** — puppeteer `dispatchMouseEvent` 在 Windows 上不接受浮点坐标
2. **下拉框** — CDP 点击 trigger → 1200ms 等 popper 动画 → CDP 点击选项 / JS 降级
3. **Tab 切换** — Vue 的 `@click` 能响应 JS `el.click()`，CDP 坐标点击不一定触发
4. **图标按钮** — 用 `cursor:pointer + SVG 子元素` 检测，不是 `role="button"`
5. **缓存复用** — URL pattern 匹配，7 天过期，出错自动重建

## 测试覆盖

已测试 10+ 网站：
- Google, Baidu（搜索）
- GitHub（代码平台）
- Bilibili（视频站）
- JD.com（电商，1434 元素）
- Element Plus, Ant Design Pro（UI 框架）
- Kaggle（竞赛平台）
