# auto-browser

> CDP-driven browser automation framework — build a page map once, execute scripts forever.

[![npm version](https://img.shields.io/npm/v/auto-browser.svg)](https://www.npmjs.com/package/auto-browser)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

## Features

- **7-Layer Element Detection** — Captures buttons, inputs, icon buttons, clickable elements, aria labels, onclick handlers, and tabindex elements
- **UI Framework Auto-Detection** — Automatically detects Element Plus, Ant Design, and MUI
- **Smart Caching** — Build page maps once, reuse forever. Zero token cost on subsequent runs
- **Visual Debugging** — Inject numbered overlay boxes on detected elements
- **MCP Server** — Use as a Model Context Protocol server for AI agents
- **CLI Tool** — Command-line interface for quick page mapping

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
# Build page element map
auto-browser map https://example.com

# With visual overlay
auto-browser map https://example.com --visualize

# Detect UI framework
auto-browser detect https://element-plus.org

# Manage cache
auto-browser cache list
auto-browser cache clear
```

## API Usage

```javascript
import { AutoBrowser } from 'auto-browser';

const ab = new AutoBrowser();

// Connect to Chrome
await ab.connect();

// Navigate to page
await ab.navigate('https://example.com');

// Build element map
const map = await ab.buildMap({ compress: true });
console.log(`Found ${map.elements.length} elements`);

// Detect UI framework
const framework = await ab.detectFramework();
console.log(`Framework: ${framework.detected}`);

// Visualize elements
await ab.injectOverlay(map.elements);

// Smart execute (uses cache if available)
const result = await ab.smartExecute('https://example.com', 'click login');
if (result.cached) {
  console.log('Used cached map!');
} else {
  console.log(`Built new map with ${result.map.elements.length} elements`);
}

await ab.disconnect();
```

## MCP Server

Use auto-browser as an MCP server for AI agents:

```bash
auto-browser mcp
```

Or configure in your MCP client:

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

### Available MCP Tools

- `auto-browser-map` — Build page element map
- `auto-browser-detect` — Detect UI framework
- `auto-browser-cache-list` — List cached pages
- `auto-browser-cache-clear` — Clear cache

## Architecture

```
auto-browser/
├── core/           # CDP connection, DOM queries, interactions
├── detector/       # UI framework auto-detection
├── adapters/       # Framework-specific adapters (Element Plus, Ant Design, MUI)
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

## Testing

Tested on 10+ websites:

- Google, Baidu (search)
- GitHub (code platform)
- Bilibili (video)
- JD.com (ecommerce, 1434 elements)
- Element Plus, Ant Design Pro (UI frameworks)
- Kaggle (competition platform)

## License

MIT © zhifeng.z

## Links

- [GitHub Repository](https://github.com/zhifeng-z/auto-browser)
- [npm Package](https://www.npmjs.com/package/auto-browser)
- [Design Document](./DESIGN.md)
- [Feasibility Report](./FEASIBILITY.md)
