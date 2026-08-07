# auto-browser

> **Your browser is the API.** CDP-driven browser automation where every element tells you what it is and how to interact with it. Zero screenshots, zero per-call LLM cost.

[![npm version](https://img.shields.io/npm/v/auto-browser.svg)](https://www.npmjs.com/package/auto-browser)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

## What's new in v4

**Actions report their reaction.** Every action (`click` / `fill` / `type` / `select` / `check` / `hover` / `drag` / `upload`) now watches the page after it fires and tells you what happened — on `[reaction]` lines: toasts, form validation, inline errors, opened dialogs and dimming overlays, JS console/page errors, navigations, and judge/submit **verdicts** (`通过全部用例`, `答案错误`, `SQL_ERROR…`, `Accepted`, `Wrong Answer`, …). An agent reads the outcome instead of re-snapshotting to guess what its click did — see [`AGENTS.md` Step 4](AGENTS.md).

**Async results, handled.** A judge verdict, a submit result, or a search response often renders *seconds* after the click, behind a spinner / `评测中` / `正在为你查询结果` state. The reaction detector keeps observing until a concrete signal appears (verdict / modal / toast / error) or the DOM goes idle — so you get the real outcome, not the loading intermediate. Tunable via `AUTO_BROWSER_RESULT_TIMEOUT` (default 15s) and `AUTO_BROWSER_COOLDOWN`.

**Blocking walls are flagged, not looped.** When a login window, modal, or overlay covers the page, the action prints `[action-required]` and exits with code **10**, so a driving agent knows a human is needed rather than retrying into a dead end. `AUTO_BROWSER_INTERACTIVE=1` pauses for a human to resolve it, then continues.

**With `--json`,** the reaction is structured: `{ result, reaction, actionRequired }`.

### Previously, in v3

**Self-describing elements.** Every element now reports its semantic `kind` (link, text, select, dropdown, checkbox, radio, toggle, slider, file, tab, contenteditable, draggable, ...) and the exact `actions` it accepts. An agent no longer guesses whether something is a button or a dropdown — see [the core idea](#the-core-idea-self-describing-elements).

**Chrome auto-launch.** No more `--remote-debugging-port` flags or closing every Chrome window until the port opens. auto-browser launches Chrome on a dedicated profile that can't collide with your everyday browsing, then polls until the CDP endpoint genuinely answers. Cold start to first action is ~1.7s. New `launch` / `close` / `status` commands — [details](#chrome-lifecycle-that-actually-works).

**`href` in snapshots.** Links no longer require clicking through to discover their URL. New `links` command harvests every href in one call, sorted by on-screen position.

**New commands.** `find` (locate by text/kind/action), `links`, `drag`, `upload`, `eval --file` (sidesteps shell quote mangling that breaks inline JS), plus `select` / `check` / `uncheck` / `contenteditable` now accept `@ref` like every other action.

**Stable refs with verification.** Refs survive DOM rebuilds via CSS → XPath → semantic scoring, and warn on low-confidence matches. `click` reports whether the page actually changed; `fill` reads the DOM value back to confirm.

**Docs for agents.** [`AGENTS.md`](AGENTS.md) is a full reference manual written for models driving this tool; [`SKILL.md`](SKILL.md) is the condensed version. Both encode the non-obvious traps.

Full changelog: [`v3修改说明.md`](v3修改说明.md).

## Why auto-browser?

The internet was built for browsers. AI agents have been trying to access it through APIs — but 99% of websites don't offer one.

**auto-browser flips this:** instead of forcing websites to provide machine interfaces, let machines use the human interface directly.

| Feature | Traditional tools | auto-browser |
|---------|-----------------|--------------|
| Browser | Headless, isolated | Your real Chrome |
| Login state | None, must re-login | **Already there** |
| Anti-bot | Detected easily | **Invisible** — it IS the user |
| Element identity | Guess from raw HTML | **Self-describing** — kind + valid actions |
| Per-call LLM cost | ~2000 tokens/step | **Zero** after first map |
| Chrome startup | Manual flags, port conflicts | **Automatic**, dedicated profile |

## Quick Start

```bash
npm install -g auto-browser
```

That's it. No Chrome flags, no manual setup.

```bash
auto-browser open https://news.ycombinator.com
auto-browser find "comments" --kind=link
auto-browser click @e12
```

Chrome launches automatically on a dedicated profile. See [Chrome lifecycle](#chrome-lifecycle-that-actually-works) for why that matters.

## The core idea: self-describing elements

Most automation tools hand you raw HTML and let you figure out what's clickable. auto-browser classifies every element and tells you exactly which commands apply:

```
$ auto-browser find "Volvo"

@f1-e2  select          [select,click]         "Volvo Saab Opel Audi"
         value="audi"
         options: Volvo | Saab | Opel | Audi
```

Read it as `@ref` · `kind` · `[valid actions]` · `"label"`, followed by state. You know immediately this is a native `<select>`, that `select` is the right command, and what the options are — without a screenshot or an extra round trip.

Compare a few element types:

```
@e52    link            [click,open]           "查询所有列"
         -> https://www.nowcoder.com/practice/f9f82607cac44099a77154a80266234a
@e140   text            [fill,type,click]      "请输入手机号码"
@e1     slider          [drag,fill]            ""
         value="0"
@e3     checkbox        [check,uncheck,click]  "同意条款"  {REQ}
@e2     file            [upload]               ""
@e4     contenteditable [contenteditable,click] "edit me"
```

**19 kinds:** `link` `button` `text` `textarea` `select` `dropdown` `checkbox` `radio` `toggle` `slider` `file` `tab` `menuitem` `option` `icon` `label` `contenteditable` `draggable` `clickable`

**11 actions:** `click` `open` `fill` `type` `select` `check` `uncheck` `contenteditable` `upload` `drag` `hover`

Classification runs in three layers: native form controls (`input[type]`, `select`, `textarea`, `contenteditable`) → ARIA roles → UI framework classes (Element Plus, Ant Design, MUI).

Every discover command also prints a page-wide census, so you can tell a listing page from a form at a glance:

```
Kinds: link=124  button=14  text=8  dropdown=2  icon=1  label=1
```

## Features

### Discover: find what you need without dumping the page

```bash
auto-browser find "登录"                 # by visible text
auto-browser find --kind=select          # by element type
auto-browser find --action=fill          # by what you can do to it
auto-browser find "SQL" --kind=link      # combine filters
auto-browser find --kind=button --json   # machine-readable
auto-browser snap --kind=link --limit=200
```

### Links: harvest URLs without clicking through

Resolved `href` is included in every snapshot, so collecting a list of links takes one call instead of N navigations:

```bash
auto-browser links                             # every href, in page order
auto-browser links --contain=/practice/ --json
```

Results are sorted by on-screen position, which is usually the meaningful order — a numbered list's DOM order is often scrambled.

### Act: `@ref` or CSS selector, interchangeably

```bash
auto-browser click @e52
auto-browser click "a.question-link"        # equivalent form

auto-browser fill @e140 "13800138000"
auto-browser select @f1-e2 "Audi"
auto-browser check @e3
auto-browser contenteditable @e4 "text"
auto-browser upload @e2 ./resume.pdf
auto-browser drag @e1 --by=150,0            # slider
auto-browser drag @e5 @e6                   # element onto element
auto-browser hover @e9
```

**Refs survive DOM rebuilds.** Each element stores a CSS selector, an XPath, and semantic fingerprints (role, accessible name, text, placeholder, parent context, position). Recovery tries them in order and falls back to weighted scoring across all candidates. Low-confidence matches emit a warning instead of silently clicking the wrong thing.

**Actions verify themselves.** `click` compares URL, title, page text, DOM size, and dialog count before and after, then reports `changed` or `no-observable-change`. `fill` reads the DOM value back to confirm the input landed.

Type mismatches fail loudly with usable detail:

```
$ auto-browser check @f1-e2
check @f1-e2: not a checkbox/radio (got <SELECT> type="select-one")

$ auto-browser select @f1-e2 "Tesla"
select @f1-e2: option not found
Available: Volvo | Saab | Opel | Audi
```

### Chrome lifecycle that actually works

```bash
auto-browser launch            # optional — every command auto-launches
auto-browser launch --force    # kill existing instance, start fresh
auto-browser launch --headless
auto-browser status            # running? PIDs? open tabs?
auto-browser close             # leaves your everyday Chrome untouched
```

**The problem this solves:** launching `chrome.exe --remote-debugging-port=9222` while your normal Chrome is already running on the default profile silently reuses that process and never opens the debug port. Naive setups require closing every Chrome window and retrying — sometimes repeatedly.

**The fix:** auto-browser starts Chrome with a dedicated profile (`%LOCALAPPDATA%\auto-browser\chrome-profile`, or `$XDG_DATA_HOME` on Unix). A separate profile can't collide with your running Chrome, so the port always opens. Startup then polls `/json/version` until the endpoint genuinely responds, rather than assuming success once the process spawns.

Cold start to first action is ~1.7s. `close` only kills processes whose command line carries our debug port, so your everyday browsing is unaffected. Login state persists in the dedicated profile across runs — authenticate once, reuse forever.

Overrides: `AUTO_BROWSER_CHROME` (binary path), `AUTO_BROWSER_PROFILE` (profile dir), `AUTO_BROWSER_PORT`.

### Waiting instead of sleeping

```bash
auto-browser wait stable              # DOM stopped changing
auto-browser wait text "加载完成"
auto-browser wait selector "#app"
auto-browser wait url "github.com"
```

Navigation uses `domcontentloaded`, not `networkidle0`, so SPAs and sites with long-polling (GitHub, Kaggle, Nowcoder) don't stall.

### Complex extraction: `eval --file`

```bash
auto-browser eval --file scrape.js
auto-browser eval --stdin < scrape.js
auto-browser eval "document.title"     # inline is fine for simple expressions
```

Inline JS is fragile in shells that strip inner quotes — PowerShell turns `a[href*="/x/"]` into `a[href*=/x/]`, which throws. Passing a file sidesteps the shell entirely. File contents are wrapped in an async IIFE, so multi-line statements, `return`, and `await` all work.

### Site adapters: zero-cost structured data

```bash
auto-browser site list
auto-browser site github-repo owner=zzfcharlie repo=auto-browser
auto-browser site hackernews count=20
auto-browser site arxiv-search query=transformer
```

Built in: `github-repo` `github-search` `arxiv-search` `hackernews` `wikipedia` `zhihu` `baidu` `youtube`

Each adapter runs `fetch()` inside your browser tab with your real cookies. The site thinks it's you, because it **is** you — login-gated data works without credentials in config.

Add one at `site/registry/<name>.mjs`:

```javascript
export const description = 'What it does';
export const params = ['query', 'count'];
export default async function execute(page, { query, count }) {
  return page.evaluate(async ({ q, n }) => {
    const resp = await fetch(`https://api.example.com/search?q=${q}&n=${n}`);
    return resp.json();
  }, { q: query, n: count });
}
```

### Network capture: reverse-engineer the page's own API

```bash
auto-browser network nav https://example.com --with-body --json
auto-browser network start
auto-browser open https://example.com
auto-browser network stop --json
```

Often the fastest path: if a page fetches its data as JSON, read that endpoint instead of scraping the DOM.

### iframes and Shadow DOM

Same-origin iframe elements appear with `@f1-e2`-style refs and work with every action command. Open Shadow DOM is traversed and its elements record both host and inner selector. Cross-origin frames are skipped safely rather than failing the whole snapshot.

### Snapshot diff

```bash
auto-browser snap
# ... interact ...
auto-browser diff
```

Reports added, removed, text-changed, moved, visibility-changed, and disabled-state-changed elements.

### Other

- **UI framework detection** — Element Plus, Ant Design, MUI, via three-signal voting
- **Visual overlay** — `snap -i` injects numbered boxes on screen
- **Daemon mode** — persistent HTTP API on `127.0.0.1:19824`, CORS restricted to localhost
- **MCP server** — stdio transport for Claude Code, Cursor, etc.
- **Smart caching** — page maps persist for 7 days

## Worked example

Extract the first 10 questions from a Nowcoder practice list:

```bash
auto-browser open "https://www.nowcoder.com/exam/oj?tab=SQL%E7%AF%87"

auto-browser snap --limit=10
#   Kinds: link=124  button=14  text=8  dropdown=2  icon=1  label=1
#   -> 124 links means this is a listing page

auto-browser links --contain=/practice/ --json
#   -> titles + URLs in page order, one call
```

Question numbers and difficulty live in the *parent row* rather than the link, so those need one `eval --file` pass that walks up the DOM. Full walkthrough in [`AGENTS.md`](AGENTS.md#6-worked-example).

One non-obvious detail: sort by `getBoundingClientRect().top`, not by question number. This particular list places `SQL40` physically inside chapter 3, so numeric sorting produces the wrong order. Visual order is the truth; DOM order and ID order are not.

## For AI agents

Two documents are written specifically for models driving this tool:

- **[`AGENTS.md`](AGENTS.md)** — full reference: core loop, kind/action tables, extraction patterns, command reference, troubleshooting, rules of thumb
- **[`SKILL.md`](SKILL.md)** — condensed version for skill-loading contexts

Both encode the traps worth knowing up front: `select` only works on native `<select>` (custom dropdowns need open-then-click), non-trivial JS must go in a file, and extracted lists should be sorted by visual position.

## Programmatic API

```javascript
import { AutoBrowser } from 'auto-browser';

const ab = new AutoBrowser();
await ab.connect();                    // auto-launches Chrome
await ab.navigate('https://example.com');

const map = await ab.buildMap({ compress: true });
// map.kinds    -> { link: 124, button: 14, text: 8, ... }
// map.elements -> [{ ref, kind, actions, href, value, options, locator, rect, ... }]

const fw = await ab.detectFramework();
await ab.waitForDomStable();
const changes = await ab.diffMaps(map);

await ab.startNetworkCapture({ withBody: true });
const requests = await ab.stopNetworkCapture();

await ab.disconnect();
```

Query a built map without re-scraping:

```javascript
import { queryMap } from 'auto-browser/core/map.mjs';

const sqlLinks = queryMap(map, { kind: 'link', text: 'SQL' });
const fillable = queryMap(map, { action: 'fill' });
```

Chrome lifecycle control:

```javascript
import { ensureChrome, launchChrome, closeChrome, chromeStatus }
  from 'auto-browser/core/launcher.mjs';

const ready = await ensureChrome();        // idempotent, returns browserURL
await launchChrome({ force: true });
const status = await chromeStatus();
await closeChrome();
```

Site adapters and daemon client:

```javascript
import { loadBuiltInAdapters, runAdapter } from 'auto-browser/site/loader.mjs';
await loadBuiltInAdapters();
const stories = await runAdapter(page, 'hackernews', { count: 10 });

import { DaemonClient } from 'auto-browser/daemon/client.mjs';
const client = new DaemonClient();
const repos = await client.runSite('github-search', { query: 'browser automation' });
```

## Architecture

```
auto-browser/
├── core/
│   ├── launcher.mjs   Chrome auto-launch / close / status, dedicated profile
│   ├── map.mjs        Element detection, kind+action classification, queryMap
│   ├── interact.mjs   CDP clicks, typing, scrolling
│   ├── form.mjs       Select, checkbox, contenteditable, label-based fill
│   ├── network.mjs    CDP request interception
│   ├── wait.mjs       Selector / text / URL / DOM-stable waits
│   ├── diff.mjs       Snapshot comparison
│   ├── dom.mjs        Query helpers
│   └── browser.mjs    Connection management
├── detector/          UI framework detection
├── adapters/          Framework-specific form adapters
├── site/
│   ├── loader.mjs     Adapter loader + runner
│   └── registry/      8 built-in site adapters
├── daemon/            HTTP server + client
├── cache/             Page map persistence
├── api/               AutoBrowser class
├── mcp/               MCP server
├── bin/cli.mjs        CLI entry
└── tests/smoke.mjs    Smoke tests
```

## Testing

```bash
npm test
```

Covers page maps, iframes, Shadow DOM, select, checkbox, contenteditable, wait mechanisms, and snapshot diff. Runs from a fully cold state — the test harness auto-launches Chrome itself.

Verified against: Nowcoder (Element Plus, 150 elements), Kaggle, GitHub, Google, Baidu, Bilibili, JD.com (1434 elements), Element Plus and Ant Design Pro demos.

## Command reference

Run `auto-browser help` for the full list. Highlights:

| Category | Commands |
|---|---|
| Lifecycle | `launch` `close` `status` |
| Discover | `find` `links` `snap` `detect` `diff` |
| Act | `click` `fill` `type` `select` `check` `uncheck` `contenteditable` `upload` `drag` `hover` `scroll` |
| Navigate | `open` `wait` `get` `screenshot` `tab` |
| Extract | `eval --file` `site` `network` |
| Infra | `daemon` `cache` `overlay` `map` |

## Requirements

- Node.js >= 18
- Chrome, Chromium, or Edge (auto-detected on Windows, macOS, Linux)

## License

MIT © zhifeng.z
