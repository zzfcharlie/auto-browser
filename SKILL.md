---
name: auto-browser
description: >-
  CDP-driven browser automation framework. Build page maps, run site
  adapters (eval+fetch), capture network traffic. No API keys needed.
  Your real browser is the API. 0 tokens on repeat operations.
---

# Auto-Browser

> 一次建图，永久复用。零截图、零每轮理解成本。

## 核心理念

传统方案（openchrome / browser-use）：
```
每次操作 → LLM 理解页面 → 定位元素 → 执行 → 下次重复
                                                ↑ token 浪费在这里
```

Auto-Browser v2.0 三模式：
```
模式1: 建图缓存 — 建图一次，零 token 重复执行
模式2: Site Adapter — 直接 eval + fetch，零 token 拿数据
模式3: Network Capture — CDP 抓包，零 token 反向工程 API
```

## CLI 命令速查

### 建图
```bash
auto-browser map https://example.com           # 建图（7层检测）
auto-browser map https://example.com -v        # 带可视化 overlay
auto-browser cache list                         # 看缓存
auto-browser cache clear                        # 清缓存
```

### Site Adapter（取数据，零 token）
```bash
auto-browser site list                                     # 列出所有适配器
auto-browser site github-repo owner=zzfcharlie repo=auto-browser  # GitHub 仓库信息
auto-browser site github-search query="browser automation"        # GitHub 搜索
auto-browser site arxiv-search query=transformer                  # arXiv 论文
auto-browser site hackernews count=20                             # HackerNews 热榜
auto-browser site wikipedia title=Python                          # Wikipedia 摘要
auto-browser site zhihu                                            # 知乎热榜
auto-browser site baidu query="auto-browser"                      # 百度搜索
```

### Network 抓包
```bash
auto-browser network nav https://example.com --with-body --json   # 一键抓所有请求
auto-browser network start                                          # 开抓
auto-browser open https://example.com                               # 导航
auto-browser network stop --json                                    # 看结果
```

### Daemon 后台
```bash
auto-browser daemon start                           # 启动后台
auto-browser daemon status                          # 查看状态
curl -X POST http://127.0.0.1:19824/command \       # HTTP API
  -d '{"method":"site/run","params":{"adapter":"hackernews"}}'
```

### 浏览器交互
```bash
auto-browser open https://example.com      # 导航
auto-browser snap                           # 快照页面元素
auto-browser detect                         # 检测 UI 框架
auto-browser click 500 300                  # 坐标点击
auto-browser click .btn-submit              # 选择器点击
auto-browser fill #username "hello"          # 填输入框
auto-browser eval "document.title"           # 执行 JS
auto-browser screenshot                      # 截图
```

## 架构

```
auto-browser v2.0/
├── core/           CDP 连接、DOM、交互、表单、建图、抓包
├── detector/       UI 框架检测（Element Plus / AntD / MUI）
├── adapters/       框架适配器（表单操作）
├── site/           Site 适配器（GitHub / arXiv / HackerNews / 知乎...）
├── daemon/         后台 HTTP 服务
├── cache/          缓存管理（maps + scripts）
├── api/            AutoBrowser 主类
├── mcp/            MCP Server
└── bin/            CLI 入口
```

## 与 bb-browser 对比吸收

| bb-browser 优势 | auto-browser 已吸收 |
|----------------|-------------------|
| Site adapter 模式 | ✅ site/registry/ 8 个内置 |
| network requests --with-body | ✅ core/network.mjs |
| Daemon HTTP API | ✅ daemon/index.mjs |
| Tab 管理 | ✅ CLI: tab list/new/close |
| --json / --jq 输出 | ✅ --json 支持 |
| bb-sites 社区生态 | ⚠️ 基础框架已搭，待社区贡献 |

## Token 节省

| 模式 | 首次 | 后续 |
|------|------|------|
| 建图执行 | ~2000 tokens | **0 tokens** |
| Site Adapter | **0 tokens** (直接 fetch) | **0 tokens** |
| Network Capture | **0 tokens** (CDP 抓包) | **0 tokens** |

## 关键经验

1. **坐标必须取整** — puppeteer `dispatchMouseEvent` 不接受浮点坐标
2. **Site Adapter** — 运行 `page.evaluate(fetch)` 直接用浏览器 cookie，零额外 cost
3. **Network Capture** — 用 CDP `Network.enable` 拦截请求，比代理方式更干净
4. **Daemon** — HTTP API 让任何语言的客户端都可以用浏览器能力

## 注意事项

- Chrome 需要 `--remote-debugging-port=9222` 启动
- Site Adapters 用 `page.evaluate` 在浏览器上下文跑 JS
- `npm install -g auto-browser` 安装全局 CLI
