---
name: auto-browser
description: >-
  CDP-driven browser automation. Every discovered element reports its
  semantic kind (link/text/select/checkbox/slider/...) and the exact
  commands it accepts, so an agent never guesses how to interact.
  Auto-launches Chrome on a dedicated profile. No API keys.
---

# auto-browser v3

> Discover once, act precisely. Elements are self-describing.

Full agent manual: `AGENTS.md`. This file is the condensed version.

## Core loop

```bash
auto-browser open <url>          # navigate (Chrome auto-launches)
auto-browser find "<text>"       # discover: kind + valid actions + href
auto-browser click @e12          # act on a @ref
```

## Why elements are self-describing

```
@e52    link            [click,open]           "查询所有列"
         -> https://www.nowcoder.com/practice/f9f8...
@e140   text            [fill,type,click]      "请选择"
         value="中国 +86"
@f1-e2  select          [select,click]         "Volvo Saab Opel Audi"
         value="audi"
         options: Volvo | Saab | Opel | Audi
```

`@ref` · `kind` · `[actions]` · `"label"` · then href/value/options.
Read the `actions` list and use exactly that command. No guessing.

Every discover command prints a page census:
```
Kinds: link=124  button=14  text=8  dropdown=2  icon=1  label=1
```

## Discover

```bash
auto-browser find "登录"                # by text
auto-browser find --kind=select         # by type
auto-browser find --action=fill         # by supported action
auto-browser find "SQL" --kind=link     # combine
auto-browser find ... --json            # machine-readable
auto-browser links --contain=/practice/ # harvest hrefs, no clicking
auto-browser snap --kind=button         # survey with filters
```

19 kinds: `link button text textarea select dropdown checkbox radio toggle
slider file tab menuitem option icon label contenteditable draggable clickable`

11 actions: `click open fill type select check uncheck contenteditable
upload drag hover`

## Act — `@ref` or CSS selector, interchangeably

```bash
auto-browser click @e52
auto-browser fill @e140 "13800138000"
auto-browser select @f1-e2 "Audi"
auto-browser check @e3
auto-browser contenteditable @e4 "text"
auto-browser upload @e2 ./file.pdf
auto-browser drag @e1 --by=150,0        # slider
auto-browser drag @e5 @e6               # onto another element
auto-browser hover @e9
```

`@ref`s survive DOM rebuilds (CSS → XPath → semantic scoring, with a
low-confidence warning). `click` reports whether the page actually changed;
`fill` reads back the DOM value to confirm.

## Extract

```bash
auto-browser eval --file scrape.js       # complex DOM traversal
auto-browser links --contain=/x/ --json  # bulk URLs
auto-browser site hackernews count=20    # prebuilt adapters
auto-browser network nav <url> --with-body --json   # find the page's own API
```

**Never pass non-trivial JS inline** — shells strip inner quotes and
`a[href*="/x/"]` arrives as `a[href*=/x/]`, which throws. Use `--file`.
File contents are wrapped in an async IIFE, so multi-line + `return` + `await` work.

## Wait

```bash
auto-browser wait stable
auto-browser wait text "加载完成"
auto-browser wait selector "#app"
auto-browser wait url "github.com"
```

## Chrome lifecycle

```bash
auto-browser launch          # optional — every command auto-launches
auto-browser launch --force  # kill and restart clean
auto-browser status
auto-browser close           # leaves your normal Chrome alone
```

Runs on a dedicated profile (`%LOCALAPPDATA%\auto-browser\chrome-profile`).
That's what avoids the classic trap: launching Chrome with
`--remote-debugging-port` while normal Chrome runs on the default profile
silently reuses that process and never opens the port. A separate profile
can't collide. Startup polls `/json/version` until the endpoint truly answers.
Login state persists across runs.

Overrides: `AUTO_BROWSER_CHROME`, `AUTO_BROWSER_PROFILE`, `AUTO_BROWSER_PORT`.

## Traps

| Symptom | Fix |
|---|---|
| `not a valid selector` from `eval` | Use `eval --file` |
| `Element not found: @e5` | Re-run `snap` / `find` |
| Blank `Page:`, 0 results | You forgot `open <url>` |
| `select` fails | It's `kind=dropdown`, not `select` — `click` to open, then `click` the option |
| 0 matches in `find` | Add `--all`; check the `Kinds:` census |
| `no-observable-change` | Click did nothing; try the parent element |
| Custom dropdown ignores clicks | Use `click` (real CDP events), not `eval` + `.click()` |

## Rules

1. Never guess a type — `find` reports `kind` and `actions`.
2. Read `href` from output; don't click to discover URLs.
3. Non-trivial JS goes in a file.
4. Check `Kinds:` before drilling in.
5. Sort extracted lists by `rect.y` — visual order ≠ DOM order ≠ ID order.
6. `wait` beats sleeping.
7. Check `site list` before writing a scraper.

## Architecture

```
core/       launcher (auto-launch/close) · map (kind+actions) · interact
            form · network · wait · diff · dom · browser
detector/   Element Plus / Ant Design / MUI detection
site/       8 zero-cost adapters + loader
daemon/     HTTP API on :19824
api/        AutoBrowser class
mcp/        MCP server
bin/cli.mjs CLI entry
```

## Programmatic

```javascript
import { AutoBrowser } from 'auto-browser';
const ab = new AutoBrowser();
await ab.connect();                  // auto-launches
await ab.navigate('https://example.com');
const map = await ab.buildMap({ compress: true });
// map.kinds, map.elements[].{ref,kind,actions,href,value,options,locator,rect}

import { queryMap } from 'auto-browser/core/map.mjs';
queryMap(map, { kind: 'link', text: 'SQL' });

import { ensureChrome, closeChrome } from 'auto-browser/core/launcher.mjs';
```

## Limits

Cross-origin iframes skipped · closed Shadow DOM unreachable · custom dropdowns
need open-then-click · `diff` rebuilds rather than observing mutations ·
daemon/MCP lack URL allow-lists.
