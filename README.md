# auto-browser

> **Your browser is the API.** CDP-driven browser automation framework — build a page map once, execute scripts forever. Zero screenshots, zero per-call LLM cost.

[![npm version](https://img.shields.io/npm/v/auto-browser.svg)](https://www.npmjs.com/package/auto-browser)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

## Why auto-browser?

The internet was built for browsers. AI agents have been trying to access it through APIs — but 99% of websites don't offer one.

**auto-browser flips this:** instead of forcing websites to provide machine interfaces, let machines use the human interface directly.

| Feature | Traditional tools | auto-browser |
|---------|-----------------|--------------|
| Browser | Headless, isolated | Your real Chrome |
| Login state | None, must re-login | **Already there** ✅ |
| Anti-bot | Detected easily | **Invisible** — it IS the user |
| Per-call LLM cost | ~2000 tokens/step | **Zero** after first map |
| Complex auth | Can't replicate | Page handles it itself |

## Features

### 🗺️ Page Map (7-Layer Detection)
Captures buttons, inputs, icon buttons, clickable elements, aria labels, onclick handlers, and tabindex elements. Build maps once, cache forever.

### 🔌 Site Adapters (NEW — Inspired by bb-browser)
Extract structured JSON from 10+ websites using your real browser's login state. No API keys needed.

```bash
auto-browser site github-repo owner=zzfcharlie repo=auto-browser    # Repo info
auto-browser site github-search query="browser automation"          # Search repos
auto-browser site arxiv-search query=transformer                     # Research papers
auto-browser site hackernews count=20                                 # Top stories
auto-browser site wikipedia title=Python                              # Wiki summary
auto-browser site baidu query="auto-browser"                          # Baidu search
auto-browser site zhihu                                               # Zhihu hot topics
auto-browser site list                                                # List all adapters
```

Each adapter runs `eval()` inside your browser tab, calls `fetch()` with your cookies — the website thinks it's you. Because it **is** you.

### 🌐 Network Capture (NEW)
Capture all network requests from a page — perfect for reverse-engineering websites' APIs.

```bash
auto-browser network start                                           # Start capture
auto-browser open https://example.com                                 # Navigate
auto-browser network stop --json                                      # See all requests
auto-browser network nav https://api.example.com --with-body          # One-shot capture
```

### 🖥️ Daemon Mode (NEW)
Run auto-browser as a persistent HTTP server for concurrent access.

```bash
auto-browser daemon start                                              # Start on :19824
auto-browser daemon status                                             # Check health
auto-browser daemon stop                                               # Stop daemon
```

Use the HTTP API from any client:
```bash
curl -X POST http://127.0.0.1:19824/command \
  -H 'Content-Type: application/json' \
  -d '{"method":"site/run","params":{"adapter":"hackernews"}}'
```

### 🎯 UI Framework Auto-Detection
Automatically detects Element Plus, Ant Design, and MUI.

### 👁️ Visual Debugging
Inject numbered overlay boxes on detected elements.

### 🤖 MCP Server
Use as a Model Context Protocol server for Claude Code, Cursor, etc.

### 💾 Smart Caching
Build page maps once, reuse forever. Zero token cost on subsequent runs.

## Quick Start

### Prerequisites

Start Chrome with remote debugging enabled:

```powershell
# Windows
Start-Process "C:\Program Files\Google\Chrome\Application\chrome.exe" `
  -ArgumentList "--remote-debugging-port=9222"

# macOS
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222

# Linux
google-chrome --remote-debugging-port=9222
```

### Installation

```bash
npm install -g auto-browser
```

### Usage

```bash
# Page map (one-time cost, then cached)
auto-browser map https://example.com

# Site adapters (zero token — uses your real browser)
auto-browser site github-search query="browser automation"

# Network capture (reverse-engineer APIs)
auto-browser network nav https://example.com --with-body --json

# Daemon mode
auto-browser daemon start
```

## API Usage

```javascript
import { AutoBrowser } from 'auto-browser';

const ab = new AutoBrowser();
await ab.connect();
await ab.navigate('https://example.com');

// Page map
const map = await ab.buildMap({ compress: true });

// Network capture
await ab.startNetworkCapture({ withBody: true });
// ... do things ...
const requests = await ab.stopNetworkCapture();

// Framework detection
const framework = await ab.detectFramework();
console.log(`Framework: ${framework.detected}`);

await ab.disconnect();
```

### Site Adapters Programmatic Use

```javascript
import { loadBuiltInAdapters, runAdapter } from 'auto-browser/site/loader.mjs';
import { connect } from 'auto-browser/core/browser.mjs';

await loadBuiltInAdapters();
const { page } = await connect();
const result = await runAdapter(page, 'hackernews', { count: 10 });
console.log(result);
```

### Daemon Client

```javascript
import { DaemonClient } from 'auto-browser/daemon/client.mjs';
const client = new DaemonClient();
const repos = await client.runSite('github-search', { query: 'browser automation' });
```

## Architecture

```
auto-browser/
├── core/           # CDP connection, DOM queries, interactions, network capture
├── detector/       # UI framework auto-detection
├── adapters/       # Framework-specific adapters (Element Plus, Ant Design, MUI)
├── site/           # Site adapters (github, arxiv, hackernews, wikipedia, etc.)
│   ├── loader.mjs  # Adapter loader + runner
│   └── registry/   # Built-in site adapters
├── daemon/         # Daemon server (persistent HTTP API)
├── cache/          # Smart caching layer
├── api/            # Main API (AutoBrowser class)
├── mcp/            # MCP server
└── bin/            # CLI tool
```

### 7-Layer Detection Strategy

1. **Standard** — `button`, `a`, `input`, `textarea`, `select`, `[role="button"]`, etc.
2. **Aria** — Elements with `aria-label`
3. **Icon Buttons** — `cursor:pointer` + SVG children
4. **Clickable** — `cursor:pointer` leaf elements
5. **Onclick** — Elements with `onclick` handlers
6. **Data Attributes** — `[data-toggle]`, `[data-target]`, etc.
7. **Tabindex** — Elements with `tabindex >= 0`

## Token Savings

| Scenario | Per-Step Build | Auto-Browser |
|----------|----------------|--------------|
| First visit | ~2000 tokens | ~2000 tokens |
| Second visit | ~2000 tokens | **0 tokens** ✅ |
| 100th visit | ~2000 tokens | **0 tokens** ✅ |
| Page changed | ~2000 tokens | ~500 tokens (diff) |
| Site adapter | ~2000 tokens | **0 tokens** (uses page eval) |

## Testing

Tested on 10+ websites:
- Google, Baidu (search)
- GitHub (code platform)
- Bilibili (video)
- JD.com (ecommerce, 1434 elements)
- Element Plus, Ant Design Pro (UI frameworks)
- Kaggle (competition platform)

## Comparison: auto-browser vs bb-browser

| Feature | auto-browser | bb-browser |
|---------|-------------|------------|
| Page element map (7-layer) | ✅ Built-in | ❌ Not available |
| UI framework detection | ✅ ElementPlus/AntD/MUI | ❌ Not available |
| Site adapters (eval+fetch) | ✅ 8 built-in | ✅ 103 community |
| Network capture | ✅ CDP interception | ✅ CDP interception |
| Daemon mode | ✅ HTTP server | ✅ Daemon + Streamer |
| MCP Server | ✅ stdio transport | ✅ stdio transport |
| Visual overlay | ✅ Numbered boxes | ❌ Not available |
| Cache/map persistence | ✅ Maps + scripts | ❌ No cache layer |
| WebRTC streaming | ❌ Planned | ✅ bb-viewer |
| Community adapters | ⭐ New | ⭐ 589 forks, 609 stars |

## License

MIT © zhifeng.z
