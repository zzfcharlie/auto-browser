# auto-browser Agent Workflow Guide

> A step-by-step guide for AI agents (OpenCode, Claude Code, Codex) to use auto-browser v2.0 CLI to explore websites. No API keys needed — uses your real Chrome with CDP.

## Prerequisites

1. Chrome running with remote debugging on port 9222:
   ```powershell
   # Windows
   Start-Process "C:\Program Files\Google\Chrome\Application\chrome.exe" `
     -ArgumentList "--remote-debugging-port=9222"
   
   # macOS
   /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222
   
   # Linux
   google-chrome --remote-debugging-port=9222
   ```

2. auto-browser installed:
   ```bash
   npm install -g auto-browser
   ```

3. auto-browser locally (if developing):
   ```bash
   cd /path/to/auto-browser
   npm install
   ```

## CLI Reference

All commands use: `node bin/cli.mjs` (local) or `auto-browser` (global)

### Navigation & Observation
| Command | Description |
|---------|-------------|
| `open <url>` | Navigate to URL |
| `snap` | Snapshot current page (build element map) |
| `snap --json` | Snapshot with JSON output for parsing |
| `detect` | Detect UI framework on page |
| `screenshot` | Take JPEG screenshot (base64) |
| `eval <js>` | Execute JavaScript in page context |
| `get <attr>` | Get page attribute (title, url, html, text) |

### Interaction
| Command | Description |
|---------|-------------|
| `click <x> <y>` | Click at pixel coordinates |
| `click <selector>` | Click element matching CSS selector |
| `fill <selector> <value>` | Fill input field |
| `type <text>` | Type text (after focusing input) |
| `scroll <x> <y>` | Scroll to position |

### Page Maps (7-Layer Detection)
| Command | Description |
|---------|-------------|
| `map <url>` | Build full page element map |
| `map <url> -v` | Build map with visual overlay |

### Site Adapters (eval+fetch, 0 tokens)
| Command | Description |
|---------|-------------|
| `site list` | List available adapters |
| `site <name> key=value` | Run adapter (e.g. `site hackernews count=20`) |

### Network Capture
| Command | Description |
|---------|-------------|
| `network start` | Start capturing requests |
| `network requests` | Show captured requests |
| `network stop` | Stop and show results |
| `network nav <url>` | One-shot capture with navigation |
| `network nav <url> --with-body --json` | Capture with response bodies |

### Daemon Mode
| Command | Description |
|---------|-------------|
| `daemon start` | Start HTTP daemon on :19824 |
| `daemon status` | Check daemon status |
| `daemon stop` | Stop daemon |

### Cache Management
| Command | Description |
|---------|-------------|
| `cache list` | List cached page maps |
| `cache clear` | Clear all cache |

## Workflow: Explore Kaggle Competitions

This is the canonical example workflow. Follow these steps in order.

### Step 1: Check Chrome CDP
```bash
# Verify Chrome is listening on CDP port
curl http://127.0.0.1:9222/json/version
```
Expected: Returns JSON with Chrome version info.
If fails: Start Chrome with `--remote-debugging-port=9222` flag.

### Step 2: Test auto-browser
```bash
# Local development
node bin/cli.mjs help

# Or if installed globally
auto-browser help
```
Expected: Shows all available commands.
If auto-browser not found: Run `npm install` first.

### Step 3: Open Kaggle Competitions
```bash
node bin/cli.mjs open https://www.kaggle.com/competitions
```
Expected: Prints "Opened: https://www.kaggle.com/competitions" and page title.

### Step 4: Build Page Map
```bash
node bin/cli.mjs snap --json
```
Expected: Shows element count, detected framework, and up to 30 elements.
The JSON output contains all interactive elements with their positions.

### Step 5: Parse Results
Look for key information in the output:
- `Title:` — page title
- `Elements: N` — total interactive elements found
- `Framework:` — detected UI framework
- Each element shows: `#tag: <TAG> "text" at (x,y)`

### Step 6: Find Specific Content
Search the element list for keywords:
- "playground", "competition", "titanic", etc.
- Note the element index and position for clicking.

### Step 7: Navigate to Competition Detail
```bash
node bin/cli.mjs open https://www.kaggle.com/competitions/<competition-id>
```
Use the competition ID found in Step 5-6.

### Step 8: Explore Competition Tabs
Once on the competition page, use snap to see available tabs:
```bash
node bin/cli.mjs snap
```

### Step 9: Take Screenshot (optional)
```bash
node bin/cli.mjs screenshot
```
Saves a JPEG screenshot to the current directory.

### Step 10: Network Capture (for API reverse-engineering)
```bash
node bin/cli.mjs network nav https://example.com --with-body --json
```
Captures all XHR/fetch requests. Useful for finding hidden APIs.

## Workflow: Site Adapters (0-token data extraction)

Site adapters are pre-built scripts that use `page.evaluate()` + `fetch()` to extract structured data directly.

### List Available Adapters
```bash
node bin/cli.mjs site list
```

### Run an Adapter
```bash
node bin/cli.mjs site hackernews count=20
```

### Available Built-in Adapters
| Adapter | Params | Description |
|---------|--------|-------------|
| `github-repo` | owner, repo | GitHub repo info (stars, forks, language) |
| `github-search` | query, sort | Search GitHub repos |
| `arxiv-search` | query, maxResults | Search arXiv papers |
| `hackernews` | count | Top HackerNews stories |
| `wikipedia` | title | Wikipedia article summary |
| `zhihu` | (none) | Zhihu hot topics |
| `baidu` | query, pn | Baidu search (uses real browser) |

### Adding New Adapters
Create a file in `site/registry/<name>.mjs`:
```javascript
export const description = 'Description';
export const params = ['param1', 'param2'];
export default async function execute(page, { param1, param2 }) {
  return page.evaluate(async ({ p1, p2 }) => {
    const resp = await fetch('https://api.example.com/data');
    return resp.json();
  }, { p1: param1, p2: param2 });
}
```

## Troubleshooting

### Chrome CDP not responding
```bash
# Check port
curl http://127.0.0.1:9222/json/version

# Kill all Chrome and restart with CDP
# Windows
taskkill /F /IM chrome.exe
Start-Process "C:\Program Files\Google\Chrome\Application\chrome.exe" `
  -ArgumentList "--remote-debugging-port=9222"
```

### auto-browser command not found
```bash
# Ensure dependencies installed
cd /path/to/auto-browser
npm install
npm ls puppeteer-core
```

### Page not loading fully
Wait for page to load before snapping:
```bash
node bin/cli.mjs open https://example.com
# Wait 3-5 seconds for JS rendering
node bin/cli.mjs snap
```

### "Cannot find module" errors
```bash
cd /path/to/auto-browser
npm install
```

### Windows-specific: ESM import fails
The site adapter loader uses `file://` URLs on Windows. This is handled automatically in v2.0.1+.

## Output Format Examples

### snap --json output
```json
{
  "url": "https://www.kaggle.com/competitions",
  "title": "Kaggle Competitions",
  "viewport": { "w": 1920, "h": 1080 },
  "elements": [
    {
      "tag": "A",
      "text": "Titanic - Machine Learning from Disaster",
      "rect": { "x": 100, "y": 200, "w": 300, "h": 50 },
      "center": { "x": 250, "y": 225 },
      "visible": true
    }
  ]
}
```

### site adapter output
```json
[
  {
    "title": "HackerNews Story Title",
    "url": "https://...",
    "points": 123,
    "author": "user",
    "comments": 45
  }
]
```

## Tips for AI Agents

1. **Always use `--json` flag** when you need to parse output programmatically
2. **Snap before clicking** — get coordinates from the element map
3. **Multiple tabs** — use `tab new` to open a second tab, then `tab list` to see IDs
4. **Cache is your friend** — maps are cached for 7 days, subsequent calls are instant
5. **Network nav is powerful** — `network nav <url> --with-body --json` reveals all API endpoints the page calls
6. **Use site adapters when possible** — they extract structured data in one shot
7. **Coordinate clicks** — use `click <x> <y>` with coordinates from the snap output
