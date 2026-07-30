#!/usr/bin/env node

// ============================================================
// auto-browser CLI v2.0
// Inspired by bb-browser — Your browser is the API.
//
// Usage:
//   auto-browser map <url>               Build page element map
//   auto-browser map <url> --visualize   With visual overlay
//
//   auto-browser site [list]             List site adapters
//   auto-browser site <name> [params]    Run a site adapter
//   auto-browser site update             Pull latest adapters (future)
//
//   auto-browser network start           Start network capture
//   auto-browser network requests        Show captured requests
//   auto-browser network stop            Stop + show results
//
//   auto-browser daemon start            Start daemon server
//   auto-browser daemon stop             Stop daemon
//   auto-browser daemon status           Daemon status
//
//   auto-browser tab list                List tabs
//   auto-browser tab new                 New tab
//   auto-browser tab close <id>          Close tab
//
//   auto-browser open <url>             Open URL
//   auto-browser snap                    Snapshot page elements
//   auto-browser detect                  Detect UI framework
//   auto-browser screenshot              Take screenshot
//
//   auto-browser click <x> <y>          Click at coordinates
//   auto-browser fill <sel> <val>       Fill input
//   auto-browser eval <code>            Run JS in page
//
//   auto-browser cache [list|clear]     Manage cache
//   auto-browser help                   Show this help
// ============================================================

import { AutoBrowser } from '../api/index.mjs';
import { CacheManager } from '../cache/manager.mjs';
import { connect, navigate, disconnect } from '../core/browser.mjs';
import { buildMap, formatMapJson, queryMap } from '../core/map.mjs';
import { detectFramework } from '../detector/index.mjs';
import * as network from '../core/network.mjs';
import { loadBuiltInAdapters, listAdapters, runAdapter } from '../site/loader.mjs';
import { startDaemon, stopDaemon } from '../daemon/index.mjs';
import { selectDropdown, readForm } from '../core/form.mjs';
import { selectValue, setChecked, fillContentEditable } from '../core/form.mjs';
import { waitForSelector, waitForText, waitForUrl, waitForDomStable } from '../core/wait.mjs';
import { diffMaps } from '../core/diff.mjs';
import { launchChrome, closeChrome, chromeStatus } from '../core/launcher.mjs';
import fs from 'fs';
import path from 'path';

const SNAPSHOT_FILE = new URL('../cache/last-snapshot.json', import.meta.url);

function loadSnapshot() {
  try {
    return JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8')).elements || [];
  } catch {
    return [];
  }
}

function saveSnapshot(map) {
  fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(map, null, 2));
}

// ------------------------------------------------------------
// Render one element as a single self-describing CLI line:
//   @e37  link      [click,open]  "SQL快速入门"  -> https://...
// An agent can read kind + actions and immediately know which
// command to use, without guessing from the tag name.
// ------------------------------------------------------------
function formatElement(el, fallbackIndex = 0) {
  const ref = `@${el.ref || `e${fallbackIndex + 1}`}`.padEnd(7);
  const kind = String(el.kind || '?').padEnd(15);
  const acts = `[${(el.actions || []).join(',')}]`.padEnd(22);
  const flags = [
    el.visible === false ? 'HID' : '',
    el.disabled ? 'DISABLED' : '',
    el.checked === true ? 'CHECKED' : '',
    el.required ? 'REQ' : ''
  ].filter(Boolean).join(',');

  const label = String(el.name || el.text || el.placeholder || '').replace(/\s+/g, ' ').trim().slice(0, 42);
  let line = `  ${ref} ${kind} ${acts} "${label}"`;

  if (flags) line += ` {${flags}}`;
  if (el.href) line += `\n           -> ${el.href}`;
  if (el.value) line += `\n           value="${String(el.value).slice(0, 60)}"`;
  if (el.options?.length) {
    const opts = el.options.slice(0, 8).map(o => o.label).join(' | ');
    line += `\n           options: ${opts}${el.options.length > 8 ? ' ...' : ''}`;
  }
  return line;
}

function printKinds(kinds) {
  if (!kinds || !Object.keys(kinds).length) return;
  const parts = Object.entries(kinds)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k}=${n}`);
  console.log(`Kinds: ${parts.join('  ')}`);
}

function parseRef(value) {
  if (!value?.startsWith('@')) return null;
  const raw = value.slice(1);
  const frameMatch = raw.match(/^f(\d+)-e(\d+)$/);
  if (frameMatch) {
    return { ref: raw, frameIndex: Number.parseInt(frameMatch[1], 10) - 1 };
  }
  const number = raw.startsWith('e') ? raw.slice(1) : raw;
  const index = Number.parseInt(number, 10);
  return Number.isInteger(index) && index > 0 ? { ref: `e${index}`, frameIndex: null } : null;
}

async function resolveRef(page, value) {
  const parsed = parseRef(value);
  if (!parsed) return null;

  const index = _lastElements.findIndex(element => element.ref === parsed.ref);
  if (index < 0) return null;
  const element = _lastElements[index];
  let context = page;
  if (parsed.frameIndex !== null) {
    const frames = page.frames().filter(frame => frame !== page.mainFrame());
    context = frames[parsed.frameIndex];
    if (!context) return null;
  }
  let handle = null;
  let method = null;
  let confidence = 0;
  if (element.locator?.shadow?.hostSelector) {
    const shadowHandle = await page.evaluateHandle(({ hostSelector, selector }) => {
      const host = document.querySelector(hostSelector);
      return host?.shadowRoot?.querySelector(selector) || null;
    }, element.locator.shadow);
    handle = shadowHandle.asElement();
    if (!handle) await shadowHandle.dispose();
    else {
      method = 'shadow-dom';
      confidence = 100;
    }
  }
  if (!handle && element.locator?.selector) {
    handle = await context.$(element.locator.selector);
    if (handle) {
      method = 'css';
      confidence = 100;
    }
  }
  if (!handle && element.locator?.xpath) {
    handle = await context.$(`xpath${element.locator.xpath}`);
    if (handle) {
      method = 'xpath';
      confidence = 90;
    }
  }
  if (!handle) {
    const match = await context.evaluate(({ tag, role, name, text, placeholder, rect, parentText }) => {
      const visible = node => {
        const rect = node.getBoundingClientRect();
        return node.offsetParent !== null && rect.width > 0 && rect.height > 0;
      };
      const candidates = [...document.querySelectorAll('*')]
        .filter(node => visible(node))
        .filter(node => !tag || node.tagName === tag);
      const accessibleName = node => node.getAttribute('aria-label') || node.getAttribute('title') || node.textContent.trim();
      const path = node => {
        const parts = [];
        for (let current = node; current && current.nodeType === 1; current = current.parentElement) {
          let index = 1;
          for (let sibling = current.previousElementSibling; sibling; sibling = sibling.previousElementSibling) {
            if (sibling.tagName === current.tagName) index++;
          }
          parts.unshift(`${current.tagName.toLowerCase()}[${index}]`);
        }
        return `/${parts.join('/')}`;
      };
      const distance = (a, b) => Math.hypot((a.x || 0) - (b.x || 0), (a.y || 0) - (b.y || 0));
      const scored = candidates.map(node => {
        const currentRect = node.getBoundingClientRect();
        const currentName = accessibleName(node);
        const currentParent = node.parentElement?.textContent.trim().slice(0, 120) || '';
        let score = 0;
        if (role && node.getAttribute('role') === role) score += 35;
        if (name && currentName === name) score += 35;
        else if (name && currentName && currentName.includes(name)) score += 15;
        if (text && node.textContent.trim() === text) score += 15;
        if (placeholder && node.getAttribute('placeholder') === placeholder) score += 25;
        if (parentText && currentParent === parentText) score += 10;
        const positionDistance = distance(currentRect, rect);
        if (positionDistance < 40) score += 15;
        else if (positionDistance < 150) score += 8;
        if (node.disabled || node.getAttribute('aria-disabled') === 'true') score -= 25;
        return { node, score, xpath: path(node) };
      }).sort((a, b) => b.score - a.score);
      const best = scored[0];
      return best ? { xpath: best.xpath, score: best.score, candidates: scored.length } : null;
    }, {
      tag: element.tag,
      role: element.role,
      name: element.name,
      text: element.text,
      placeholder: element.placeholder,
      rect: element.rect,
      parentText: element.parentText
    });
    if (match && match.score >= 50) {
      handle = await context.$(`xpath${match.xpath}`);
      if (handle) {
        method = `semantic (${match.candidates} candidates)`;
        confidence = match.score;
      }
    }
  }
  if (handle) {
    await handle.evaluate(node => node.scrollIntoView({ block: 'center', inline: 'center' }));
  }
  return handle ? { handle, element, index, method, confidence } : null;
}

const [,, cmd, ...args] = process.argv;

// ------------------------------------------------------------
// Resolve either an @ref (from the last snap/find) or a raw CSS
// selector into an element handle. Lets every action command
// accept both forms interchangeably.
// ------------------------------------------------------------
async function resolveTarget(page, target) {
  if (target.startsWith('@')) {
    const resolved = await resolveRef(page, target);
    if (!resolved) {
      console.error(`Element not found: ${target}. Run "snap" or "find" first.`);
      process.exit(1);
    }
    if (resolved.confidence < 80) {
      console.warn(`Warning: ${target} matched with confidence ${resolved.confidence} via ${resolved.method}`);
    }
    return { handle: resolved.handle, label: `@${resolved.element.ref}`, element: resolved.element };
  }
  const handle = await page.$(target);
  if (!handle) {
    console.error(`Element not found: ${target}`);
    process.exit(1);
  }
  return { handle, label: target, element: null };
}

// ============================================================
// Helper: connect to browser
// ============================================================

let _ab = null;
let _lastElements = loadSnapshot(); // cache of last snap/map elements for @ref click
let _overlayActive = false; // persistent overlay state


async function getAB() {
  if (!_ab) {
    _ab = new AutoBrowser();
    await _ab.connect();
  }
  return _ab;
}

async function getPage() {
  const ab = await getAB();
  return ab.getPage();
}

async function cleanup() {
  if (_ab) {
    // Do not let a stuck CDP transport keep one-shot CLI commands alive.
    await Promise.race([
      _ab.disconnect(),
      new Promise(resolve => setTimeout(resolve, 2000))
    ]);
    _ab = null;
  }
}

async function pageState(page) {
  return page.evaluate(() => ({
    url: location.href,
    title: document.title,
    textLength: document.body?.innerText?.length || 0,
    domLength: document.documentElement?.outerHTML?.length || 0,
    dialogs: document.querySelectorAll('[role="dialog"], [aria-modal="true"]').length
  }));
}

async function waitForActionState(page, before, timeout = 1500) {
  const started = Date.now();
  let current = await pageState(page);
  while (Date.now() - started < timeout) {
    if (current.url !== before.url || current.title !== before.title ||
        current.textLength !== before.textLength || current.domLength !== before.domLength ||
        current.dialogs !== before.dialogs) {
      return { changed: true, state: current };
    }
    await new Promise(resolve => setTimeout(resolve, 100));
    current = await pageState(page);
  }
  return { changed: false, state: current };
}

function formatActionState(result) {
  if (result.changed) {
    return `result=changed url=${result.state.url}`;
  }
  return 'result=no-observable-change';
}

// ============================================================
// Command: help
// ============================================================

function showHelp() {
  console.log(`
auto-browser v3.0 — CDP-driven browser automation framework
Your browser is the API. No keys. No bots. No scrapers.

=== Chrome Lifecycle ===
  launch                 唤起 Chrome with CDP (auto-detects binary, dedicated profile)
  launch --force         Kill existing auto-browser Chrome, then launch fresh
  launch --headless      Launch in headless mode
  close                  关闭 auto-browser's Chrome (leaves your normal Chrome alone)
  status                 Show whether CDP Chrome is up, PIDs, and open tabs
  (all three accept --port=<n>)

=== Discover Elements (每个元素自带 kind + 可用动作) ===
  snap                   Snapshot page; each element shows kind & actions & href
  snap --kind=link       Only elements of one kind
  snap --action=fill     Only elements supporting an action
  snap --text=keyword    Only elements matching text
  snap --limit=200       Show more than the default 50
  find "登录"            Locate elements by text
  find --kind=text       Locate by kind
  find "SQL" --kind=link Combine text + kind
  find --action=select   Locate by supported action
  find ... --json        Machine-readable output
  links                  Harvest every href on the page (no clicking)
  links --contain=/foo/  Only hrefs containing a substring
  links --json           Machine-readable output

  kinds: link button text textarea select dropdown checkbox radio toggle
         slider file tab menuitem option icon label contenteditable
         draggable clickable
  actions: click open fill type select check uncheck contenteditable
           upload drag hover

=== Page Map Commands ===
  map <url>              Build page element map (7-layer detection)
  map <url> -v           Build map with visual overlay

=== Site Adapters (zero-token data extraction) ===
  site [list]            List available site adapters
  site <name> [args]     Run a site adapter (e.g. github-repo owner=zzfcharlie repo=auto-browser)

=== Overlay (bb-browser style element highlighting) ===
  snap -i                Snapshot with numbered overlay injected
  snap --inject          Same as -i
  overlay inject         Inject numbered overlay on cached elements
  overlay remove         Remove the numbered overlay

=== Click by Reference ===
  click @e3              Click element @e3 from last snapshot/find
  click <x> <y>          Click at pixel coordinates
  click <selector>       Click element matching CSS selector
  hover @e3              Hover element @e3
  (refs survive DOM rebuilds — they re-locate by CSS, XPath, then semantics)


=== Network Capture ===
  network start          Start capturing network requests
  network requests       Show captured requests (--with-body for bodies)
  network stop           Stop capture and show results
  network clear          Clear captured requests
  network nav <url>      Navigate and capture all network activity

=== Navigation & Observation ===
  open <url>             Navigate to URL
  snap                   Snapshot current page (build map)
  diff                   Compare current page map with last snapshot
  detect                 Detect UI framework on current page
  screenshot             Take a JPEG screenshot (base64)
  eval <js>              Execute JavaScript in page context
  eval --file <path.js>  Run JS from a file (avoids shell quote mangling)
  eval --stdin           Run JS piped from stdin
  get <attr>             Get page attribute (title, url, html, text)

=== Interaction (每个命令都接受 @ref 或 CSS selector) ===
  click <@ref|sel>       Click element (or: click <x> <y> for coordinates)
  fill <@ref|sel> <val>  Fill a text input / textarea
  type <text>            Type into whatever has focus
  select <@ref|sel> <v>  Choose an option in a native <select>
  check <@ref|sel>       Tick a checkbox / radio
  uncheck <@ref|sel>     Untick a checkbox
  contenteditable <@ref|sel> <text>   Set a contenteditable's text
  upload <@ref|sel> <file> [f2 ...]   Attach files to <input type=file>
  drag <@ref|sel> <@ref|sel>          Drag one element onto another
  drag <@ref|sel> --to=<x>,<y>        Drag to viewport coordinates
  drag <@ref|sel> --by=<dx>,<dy>      Drag by a delta (sliders)
  hover <@ref|sel>       Hover an element
  scroll <x> <y>         Scroll to position

=== Waiting ===
  wait selector <sel>    Wait for a CSS selector to appear
  wait text <text>       Wait for text to appear
  wait url <pattern>     Wait for the URL to match
  wait stable            Wait for the DOM to stop changing


=== Daemon (background server) ===
  daemon start           Start daemon on 127.0.0.1:19824
  daemon start --port <p>  Start on custom port
  daemon stop            Stop daemon
  daemon status          Daemon status

=== Tab Management ===
  tab list               List all tabs
  tab new                Create new tab
  tab close <id>         Close a tab

=== Cache ===
  cache [list]           List cached page maps
  cache clear            Clear all cache

=== Other ===
  help                   Show this help

Examples:
  # The core loop: open -> discover -> act
  auto-browser open https://example.com
  auto-browser find "登录" --kind=button
  auto-browser click @e12

  # Harvest links without clicking through
  auto-browser links --contain=/practice/ --json

  # Fill a form
  auto-browser find --action=fill
  auto-browser fill @e5 "hello"
  auto-browser select @e8 "Audi"
  auto-browser check @e9

  # Complex extraction (put JS in a file to dodge shell quoting)
  auto-browser eval --file scrape.js

  auto-browser site github-repo owner=zzfcharlie repo=auto-browser
  auto-browser network nav https://example.com --with-body --json
  auto-browser close

Note: every command auto-launches Chrome if it isn't running, so
"launch" is optional — use it when you want an explicit/fresh start.
`.trim());
}

// ============================================================
// Main command dispatcher
// ============================================================

async function main() {
  // Pre-load site adapters
  try {
    await loadBuiltInAdapters();
  } catch {}

  switch (cmd) {

    // ==================== HELP ====================
    case undefined:
    case 'help':
    case '--help':
      showHelp();
      process.exit(0);

    // ==================== CHROME LIFECYCLE ====================
    // launch / close / status — explicit control over the CDP browser.
    case 'launch':
    case 'up':
    case 'start-chrome': {
      const force = args.includes('-f') || args.includes('--force');
      const headless = args.includes('--headless');
      const portArg = args.find(a => a.startsWith('--port='));
      const port = portArg ? Number(portArg.split('=')[1]) : undefined;

      const result = await launchChrome({ force, headless, port });
      if (result.launched) {
        console.log(`Chrome launched: ${result.browserURL}`);
        console.log(`Binary:  ${result.binary}`);
        console.log(`Profile: ${result.profileDir}`);
        console.log(`PID:     ${result.pid}`);
      } else {
        console.log(`Chrome already running: ${result.browserURL}`);
      }
      console.log(`Version: ${result.version?.Browser || 'unknown'}`);
      break;
    }

    case 'close':
    case 'down':
    case 'kill-chrome': {
      const portArg = args.find(a => a.startsWith('--port='));
      const port = portArg ? Number(portArg.split('=')[1]) : undefined;

      const result = await closeChrome({ port });
      if (!result.wasRunning && result.killed.length === 0) {
        console.log(`No auto-browser Chrome running on port ${result.port}.`);
      } else {
        console.log(`Closed auto-browser Chrome on port ${result.port}.`);
        if (result.killed.length) console.log(`Killed PIDs: ${result.killed.join(', ')}`);
        if (result.failed.length) console.log(`Failed PIDs: ${result.failed.join(', ')}`);
        console.log(`Port free: ${result.portFree}`);
      }
      break;
    }

    case 'status': {
      const portArg = args.find(a => a.startsWith('--port='));
      const port = portArg ? Number(portArg.split('=')[1]) : undefined;

      const s = await chromeStatus({ port });
      console.log(`Running: ${s.running}`);
      console.log(`Endpoint: ${s.browserURL}`);
      console.log(`Profile: ${s.profileDir}`);
      if (s.running) {
        console.log(`Version: ${s.version?.Browser || 'unknown'}`);
        console.log(`PIDs: ${s.pids.join(', ') || 'unknown'}`);
        console.log(`Tabs: ${s.tabs.length}`);
        s.tabs.slice(0, 10).forEach((t, i) => {
          console.log(`  ${i + 1}. ${String(t.title).slice(0, 50)} — ${String(t.url).slice(0, 70)}`);
        });
      }
      break;
    }

    // ==================== MAP ====================
    case 'map': {
      const url = args[0];
      if (!url) { console.error('Usage: auto-browser map <url> [-v]'); process.exit(1); }
      const visualize = args.includes('-v') || args.includes('--visualize');

      const ab = await getAB();
      await ab.navigate(url);

       const map = await ab.buildMap({ compress: true });
       const framework = await ab.detectFramework();
       saveSnapshot(map);

       console.log(`\nURL: ${map.url}`);
      console.log(`Title: ${map.title}`);
      console.log(`Framework: ${framework.detected} (confidence: ${framework.confidence})`);
      console.log(`Elements: ${map.elements.length}\n`);

      map.elements.slice(0, 50).forEach((el, i) => {
        const desc = el.text || el.role || el.tag;
        console.log(`  #${i + 1}: [${el.source || 'std'}] <${el.tag}> "${String(desc).slice(0, 40)}" at (${el.rect.x},${el.rect.y})`);
      });
      if (map.elements.length > 50) {
        console.log(`  ... and ${map.elements.length - 50} more`);
      }

      if (visualize) {
        await ab.injectOverlay(map.elements);
        console.log('\nOverlay injected. Press Ctrl+C to exit.');
        await new Promise(() => {});
      }
      break;
    }

    // ==================== SITE ====================
    case 'site': {
      const sub = args[0];

      if (!sub || sub === 'list') {
        const adapters = listAdapters();
        if (adapters.length === 0) {
          console.log('No site adapters loaded.');
          break;
        }
        console.log(`\nAvailable site adapters (${adapters.length}):\n`);
        adapters.forEach(a => {
          console.log(`  ${a.name}`);
          console.log(`    ${a.description}`);
          if (a.params?.length) console.log(`    Params: ${a.params.join(', ')}`);
          if (a.examples?.length) {
            a.examples.forEach(ex => {
              const paramStr = Object.entries(ex.params || {}).map(([k, v]) => `${k}=${v}`).join(' ');
              console.log(`    Example: auto-browser site ${a.name} ${paramStr}`);
            });
          }
          console.log('');
        });
        break;
      }

      // Parse key=value params
      const adapterName = sub;
      const params = {};
      for (const arg of args.slice(1)) {
        const eqIdx = arg.indexOf('=');
        if (eqIdx > 0) {
          params[arg.slice(0, eqIdx)] = arg.slice(eqIdx + 1);
        }
      }
      // Also support positional params (first unused)
      if (Object.keys(params).length === 0 && args.length > 1) {
        params._ = args.slice(1);
      }

      try {
        const ab = await getAB();
        const page = ab.getPage();
        const result = await runAdapter(page, adapterName, params);
        console.log(JSON.stringify(result, null, 2));
      } catch (e) {
        console.error(`Error: ${e.message}`);
        process.exit(1);
      }
      break;
    }

    // ==================== NETWORK ====================
    case 'network': {
      const sub = args[0];

      switch (sub) {
        case 'start': {
          const withBody = args.includes('--with-body');
          const page = await getPage();
          await network.startCapture(page, { withBody });
          console.log(`Network capture started (body=${withBody}).`);
          console.log('Use "auto-browser network requests" to see captured requests.');
          console.log('Use "auto-browser network stop" to stop.');
          break;
        }
        case 'requests': {
          const requests = network.getCapturedRequests();
          const withBody = args.includes('--with-body');

          if (requests.length === 0) {
            console.log('No requests captured. Use "auto-browser network start" first.');
            break;
          }

          console.log(`\nCaptured ${requests.length} requests:\n`);
          requests.forEach((r, i) => {
            const method = r.method?.padEnd(6);
            const status = r.response ? r.response.status : '...';
            console.log(`  ${i + 1}. [${method}] ${status} ${r.url.slice(0, 100)}`);
            if (withBody && r.body) {
              const bodyStr = typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
              console.log(`     Body: ${bodyStr.slice(0, 200)}`);
            }
          });

          if (args.includes('--json')) {
            console.log('\n--- JSON ---');
            console.log(JSON.stringify(requests, null, 2));
          }
          break;
        }
        case 'stop': {
          const page = await getPage();
          const count = await network.stopCapture(page);
          const requests = network.getCapturedRequests();
          console.log(`\nCaptured ${count} requests:\n`);
          requests.forEach((r, i) => {
            const method = r.method?.padEnd(6);
            const status = r.response ? r.response.status : '...';
            const type = r.resourceType?.padEnd(10);
            console.log(`  ${i + 1}. [${method}] ${status} ${type} ${r.url.slice(0, 90)}`);
          });

          if (args.includes('--json')) {
            console.log('\n--- JSON ---');
            console.log(JSON.stringify(requests, null, 2));
          }
          break;
        }
        case 'clear': {
          network.clearCapturedRequests();
          console.log('Captured requests cleared.');
          break;
        }
        case 'nav': {
          const url = args[1];
          if (!url) { console.error('Usage: auto-browser network nav <url> [--with-body]'); process.exit(1); }
          const withBody = args.includes('--with-body');
          const page = await getPage();
          const requests = await network.captureNavigation(page, url, { withBody });
          console.log(`\nCaptured ${requests.length} requests from ${url}:\n`);
          requests.forEach((r, i) => {
            const method = r.method?.padEnd(6);
            const status = r.response ? r.response.status : '...';
            console.log(`  ${i + 1}. [${method}] ${status} ${r.url.slice(0, 90)}`);
          });

          if (args.includes('--json')) {
            console.log('\n--- JSON ---');
            console.log(JSON.stringify(requests, null, 2));
          }
          break;
        }
        default:
          console.log('Usage: auto-browser network [start|stop|requests|clear|nav] [--with-body] [--json]');
      }
      break;
    }

    // ==================== DAEMON ====================
    case 'daemon': {
      const sub = args[0];

      switch (sub) {
        case 'start': {
          const portIdx = args.indexOf('--port');
          const port = portIdx >= 0 ? parseInt(args[portIdx + 1]) : 19824;
          const hostIdx = args.indexOf('--host');
          const host = hostIdx >= 0 ? args[hostIdx + 1] : '127.0.0.1';

          try {
            const result = await startDaemon({ port, host });
            console.log(`Daemon started on http://${result.host}:${result.port}`);
            console.log('Run "auto-browser daemon status" to check.');
            console.log('Available daemon commands via HTTP POST /command');
          } catch (e) {
            console.error(`Failed to start daemon: ${e.message}`);
          }
          break;
        }
        case 'stop': {
          await stopDaemon();
          console.log('Daemon stopped.');
          break;
        }
        case 'status': {
          const { getDaemonStatus } = await import('../daemon/index.mjs');
          const status = getDaemonStatus();
          console.log(`\nDaemon running: ${status.running}`);
          console.log(`Server: ${status.serverRunning ? 'listening' : 'stopped'}`);
          console.log(`Browser connected: ${status.browser?.isConnected() || false}`);
          console.log(`Started at: ${status.startedAt || 'N/A'}`);
          console.log(`Tabs: ${Object.keys(status.pages || {}).length}`);
          if (Object.keys(status.pages || {}).length > 0) {
            console.log('');
            for (const [id, p] of Object.entries(status.pages)) {
              console.log(`  ${id}: ${p.title || 'untitled'} — ${p.url || '(blank)'}`);
            }
          }
          break;
        }
        default:
          console.log('Usage: auto-browser daemon [start|stop|status]');
      }
      break;
    }

    // ==================== OPEN ====================
    case 'open': {
      const url = args[0];
      if (!url) { console.error('Usage: auto-browser open <url>'); process.exit(1); }
      const ab = await getAB();
      await ab.navigate(url);
      const title = await ab.getPage().title();
      console.log(`Opened: ${url}`);
      console.log(`Title: ${title}`);
      break;
    }

    // ==================== SNAP ====================
    case 'snap':
    case 'snapshot': {
      const ab = await getAB();
      const map = await ab.buildMap({ compress: true });
      const fw = await ab.detectFramework();
      _lastElements = map.elements; // cache for @ref clicks
      saveSnapshot(map);

      // Optional filters so a snap on a huge page stays readable:
      //   snap --kind=link       only links
      //   snap --action=fill     only fillable things
      //   snap --text=SQL        only matching text
      //   snap --limit=200
      const kindArg = args.find(a => a.startsWith('--kind='));
      const actionArg = args.find(a => a.startsWith('--action='));
      const textArg = args.find(a => a.startsWith('--text='));
      const limitArg = args.find(a => a.startsWith('--limit='));
      const limit = limitArg ? Number(limitArg.split('=')[1]) : 50;

      const filtered = (kindArg || actionArg || textArg)
        ? queryMap(map, {
            kind: kindArg?.split('=')[1],
            action: actionArg?.split('=')[1],
            text: textArg?.split('=').slice(1).join('='),
            visibleOnly: false,
            limit: Number.isFinite(limit) ? limit : 50
          })
        : map.elements.slice(0, Number.isFinite(limit) ? limit : 50);

      console.log(`\nTitle: ${map.title}`);
      console.log(`Framework: ${fw.detected}`);
      console.log(`Elements: ${map.elements.length}`);
      printKinds(map.kinds);
      console.log(`Showing: ${filtered.length}\n`);

      filtered.forEach((el, i) => console.log(formatElement(el, i)));

      const shown = filtered.length;
      if (!kindArg && !actionArg && !textArg && map.elements.length > shown) {
        console.log(`\n  ... and ${map.elements.length - shown} more`);
        console.log(`  Narrow it down: snap --kind=link | --action=fill | --text=keyword | --limit=200`);
      }


      // Inject overlay if -i or --inject flag
      if (args.includes('-i') || args.includes('--inject')) {
        await ab.injectOverlay(map.elements);
        _overlayActive = true;
        console.log('\n🟢 Overlay injected! Elements are numbered on screen.');
        console.log('   Use "click @N" to click by number.');
        console.log('   Use "overlay remove" to clear.');
      }

      if (args.includes('--json')) {
        console.log('\n--- JSON ---');
        console.log(JSON.stringify(map, null, 2));
      }
      break;
    }

    // ==================== FIND ====================
    // Locate elements by text / kind / action without dumping the page.
    //   find "登录"
    //   find --kind=text
    //   find "SQL" --kind=link --json
    //   find --action=select
    case 'find': {
      const ab = await getAB();
      const map = await ab.buildMap({ compress: true });
      _lastElements = map.elements;
      saveSnapshot(map);

      const kindArg = args.find(a => a.startsWith('--kind='));
      const actionArg = args.find(a => a.startsWith('--action='));
      const limitArg = args.find(a => a.startsWith('--limit='));
      const text = args.find(a => !a.startsWith('--')) || '';
      const limit = limitArg ? Number(limitArg.split('=')[1]) : 30;

      const hits = queryMap(map, {
        text,
        kind: kindArg?.split('=')[1],
        action: actionArg?.split('=')[1],
        visibleOnly: !args.includes('--all'),
        limit: Number.isFinite(limit) ? limit : 30
      });

      if (args.includes('--json')) {
        console.log(JSON.stringify(hits, null, 2));
        break;
      }

      const criteria = [
        text ? `text~"${text}"` : '',
        kindArg ? kindArg.replace('--', '') : '',
        actionArg ? actionArg.replace('--', '') : ''
      ].filter(Boolean).join(' ') || 'all';

      console.log(`\nPage: ${map.title}`);
      printKinds(map.kinds);
      console.log(`Query: ${criteria}`);
      console.log(`Matches: ${hits.length}\n`);

      if (!hits.length) {
        console.log('  No match. Try: find --kind=<kind>  (see Kinds above), or add --all for hidden elements.');
        break;
      }
      hits.forEach((el, i) => console.log(formatElement(el, i)));
      console.log(`\n  Act on one: click @<ref> | fill @<ref> "value" | select @<ref> "option" | hover @<ref>`);
      break;
    }

    // ==================== LINKS ====================
    // Harvest hrefs in one shot — no click-through needed.
    //   links
    //   links --contain=/practice/
    //   links --json
    case 'links': {
      const ab = await getAB();
      const map = await ab.buildMap({ compress: true });
      _lastElements = map.elements;
      saveSnapshot(map);

      const containArg = args.find(a => a.startsWith('--contain='));
      const needle = containArg ? containArg.split('=').slice(1).join('=') : '';
      const limitArg = args.find(a => a.startsWith('--limit='));
      const limit = limitArg ? Number(limitArg.split('=')[1]) : 200;

      let links = map.elements
        .filter(el => el.href)
        .filter(el => (needle ? el.href.includes(needle) : true))
        .map(el => ({
          ref: el.ref,
          text: String(el.name || el.text || '').replace(/\s+/g, ' ').trim(),
          href: el.href,
          y: el.rect?.y ?? 0
        }));

      // Page order (top-to-bottom) is usually the meaningful order.
      links.sort((a, b) => a.y - b.y);
      links = links.slice(0, Number.isFinite(limit) ? limit : 200);

      if (args.includes('--json')) {
        console.log(JSON.stringify(links, null, 2));
        break;
      }
      console.log(`\nPage: ${map.title}`);
      console.log(`Links: ${links.length}${needle ? ` (containing "${needle}")` : ''}\n`);
      links.forEach((l, i) => {
        console.log(`  ${String(i + 1).padStart(3)}. @${(l.ref || '').padEnd(6)} "${l.text.slice(0, 44)}"`);
        console.log(`       ${l.href}`);
      });
      break;
    }

    // ==================== DRAG ====================
    // drag @a @b            drag element a onto element b
    // drag @a --to=300,400  drag element a to viewport coords
    // drag @slider --by=120,0  move by a delta (sliders)
    case 'drag': {
      const page = await getPage();
      const from = args[0];
      if (!from) {
        console.error('Usage: auto-browser drag <@ref|selector> <@ref|selector>');
        console.error('       auto-browser drag <@ref|selector> --to=<x>,<y>');
        console.error('       auto-browser drag <@ref|selector> --by=<dx>,<dy>');
        process.exit(1);
      }

      const src = await resolveTarget(page, from);
      const srcBox = await src.handle.boundingBox();
      if (!srcBox) {
        console.error(`drag: ${src.label} has no layout box (hidden?)`);
        process.exit(1);
      }
      const start = { x: srcBox.x + srcBox.width / 2, y: srcBox.y + srcBox.height / 2 };

      const toArg = args.find(a => a.startsWith('--to='));
      const byArg = args.find(a => a.startsWith('--by='));
      let end;
      let destLabel;

      if (toArg) {
        const [x, y] = toArg.split('=')[1].split(',').map(Number);
        end = { x, y };
        destLabel = `(${x},${y})`;
      } else if (byArg) {
        const [dx, dy] = byArg.split('=')[1].split(',').map(Number);
        end = { x: start.x + dx, y: start.y + dy };
        destLabel = `delta(${dx},${dy})`;
      } else {
        const to = args.find((a, i) => i > 0 && !a.startsWith('--'));
        if (!to) {
          console.error('drag: provide a destination (@ref, selector, --to=x,y, or --by=dx,dy)');
          process.exit(1);
        }
        const dst = await resolveTarget(page, to);
        const dstBox = await dst.handle.boundingBox();
        await dst.handle.dispose();
        if (!dstBox) {
          console.error(`drag: ${dst.label} has no layout box (hidden?)`);
          process.exit(1);
        }
        end = { x: dstBox.x + dstBox.width / 2, y: dstBox.y + dstBox.height / 2 };
        destLabel = dst.label;
      }
      await src.handle.dispose();

      const before = await pageState(page);
      // Move in steps: HTML5 drag & drop and slider widgets both need
      // intermediate mousemove events, not a single jump.
      await page.mouse.move(Math.round(start.x), Math.round(start.y));
      await page.mouse.down();
      const steps = 20;
      for (let i = 1; i <= steps; i++) {
        await page.mouse.move(
          Math.round(start.x + ((end.x - start.x) * i) / steps),
          Math.round(start.y + ((end.y - start.y) * i) / steps)
        );
        await new Promise(r => setTimeout(r, 12));
      }
      await page.mouse.up();
      const result = await waitForActionState(page, before);
      console.log(`Dragged ${src.label} -> ${destLabel} (${formatActionState(result)})`);
      break;
    }

    // ==================== UPLOAD ====================
    // upload @ref <file> [more files...]
    case 'upload': {
      const target = args[0];
      const files = args.slice(1).filter(a => !a.startsWith('--'));
      if (!target || !files.length) {
        console.error('Usage: auto-browser upload <@ref|selector> <file> [file2 ...]');
        process.exit(1);
      }
      for (const f of files) {
        if (!fs.existsSync(f)) {
          console.error(`upload: file not found: ${f}`);
          process.exit(1);
        }
      }
      const page = await getPage();
      const { handle, label } = await resolveTarget(page, target);
      const isFileInput = await handle.evaluate(el => el.tagName === 'INPUT' && el.type === 'file');
      if (!isFileInput) {
        console.error(`upload ${label}: not an <input type="file">. Use "find --kind=file" to locate one.`);
        await handle.dispose();
        process.exit(1);
      }
      await handle.uploadFile(...files.map(f => path.resolve(f)));
      await handle.dispose();
      console.log(`Uploaded ${files.length} file(s) to ${label}: ${files.join(', ')}`);
      break;
    }

    // ==================== DETECT ====================
    case 'detect': {
      const ab = await getAB();
      const result = await ab.detectFramework();
      console.log(`Framework: ${result.detected}`);
      console.log(`Confidence: ${result.confidence}/3`);
      console.log('Details:', JSON.stringify(result.results));
      break;
    }

    // ==================== SCREENSHOT ====================
    case 'screenshot': {
      const ab = await getAB();
      const page = ab.getPage();
      const buffer = await page.screenshot({ type: 'jpeg', quality: 80 });
      const filename = `screenshot-${Date.now()}.jpg`;
      fs.writeFileSync(filename, buffer);
      console.log(`Screenshot saved: ${filename}`);
      break;
    }

    // ==================== EVAL ====================
    // Inline code is fragile in shells that eat quotes (PowerShell).
    // Prefer:  eval --file script.js   or   eval --stdin
    case 'eval': {
      const fileArg = args.find(a => a.startsWith('--file='));
      const fileFlagIndex = args.indexOf('--file');
      let code = '';
      let source = 'inline';

      if (fileArg) {
        const p = fileArg.split('=').slice(1).join('=');
        code = fs.readFileSync(p, 'utf8');
        source = p;
      } else if (fileFlagIndex >= 0 && args[fileFlagIndex + 1]) {
        const p = args[fileFlagIndex + 1];
        code = fs.readFileSync(p, 'utf8');
        source = p;
      } else if (args.includes('--stdin') || args.includes('-')) {
        code = fs.readFileSync(0, 'utf8');
        source = 'stdin';
      } else {
        code = args.filter(a => !a.startsWith('--')).join(' ');
      }

      if (!code.trim()) {
        console.error('Usage: auto-browser eval <js-code>');
        console.error('       auto-browser eval --file <path.js>   (recommended — avoids shell quoting)');
        console.error('       auto-browser eval --stdin            (pipe code in)');
        process.exit(1);
      }

      const page = await getPage();

      // A file may contain statements/newlines, so wrap it in an async IIFE
      // and let an explicit `return` produce the value.
      const isExpression = source === 'inline' && !/[\n;]/.test(code.trim());
      const payload = isExpression ? code : `(async () => { ${code}\n })()`;

      let result;
      try {
        result = await page.evaluate(payload);
      } catch (e) {
        console.error(`Eval failed (${source}): ${e.message}`);
        if (source === 'inline') {
          console.error('Hint: shells strip quotes from inline JS. Put the code in a file and use --file.');
        }
        process.exit(1);
      }
      console.log(typeof result === 'object' ? JSON.stringify(result, null, 2) : result);
      break;
    }

    // ==================== GET ====================
    case 'get': {
      const attr = args[0];
      if (!attr) { console.error('Usage: auto-browser get <attr> (title, url, html, text)'); process.exit(1); }
      const page = await getPage();
      const value = await page.evaluate((a) => {
        if (a === 'url') return location.href;
        if (a === 'title') return document.title;
        if (a === 'html') return document.documentElement.outerHTML;
        if (a === 'text') return document.body.innerText;
        return document[a]?.toString?.();
      }, attr);
      console.log(value?.slice(0, 5000));
      break;
    }

    // ==================== CLICK ====================
    case 'click': {
      const page = await getPage();

      // Click by @ref number (bb-browser style)
      if (args[0]?.startsWith('@')) {
        const resolved = await resolveRef(page, args[0]);
        if (!resolved) {
          console.error(`Invalid ref: ${args[0]}. Available: 1-${_lastElements.length}`);
          console.log('Run "snap" first to see element references.');
          process.exit(1);
        }
        const state = await resolved.handle.evaluate(node => ({
          disabled: Boolean(node.disabled || node.getAttribute('aria-disabled') === 'true'),
          connected: node.isConnected,
          visible: node.offsetParent !== null
        }));
        if (!state.connected || !state.visible || state.disabled) {
          await resolved.handle.dispose();
          console.error(`Ref ${args[0]} is not actionable (visible=${state.visible}, disabled=${state.disabled})`);
          process.exit(1);
        }
        if (resolved.confidence < 80) {
          console.warn(`Warning: ${args[0]} matched with confidence ${resolved.confidence} via ${resolved.method}`);
        }
        const before = await pageState(page);
        const box = await resolved.handle.boundingBox();
        if (box) {
          await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        } else {
          await resolved.handle.click();
        }
        await resolved.handle.dispose();
        const result = await waitForActionState(page, before);
        const el = resolved.element;
        console.log(`Clicked @${el.ref}: <${el.tag}> "${String(el.text || '').slice(0, 40)}" (re-located, ${formatActionState(result)})`);
        await new Promise(r => setTimeout(r, 500));
        break;
      }

      // Click by selector if first arg starts with . or #
      if (args[0]?.startsWith('.') || args[0]?.startsWith('#')) {
        const el = await page.$(args[0]);
        if (!el) { console.error(`Element not found: ${args[0]}`); process.exit(1); }
        const before = await pageState(page);
        await el.click();
        const result = await waitForActionState(page, before);
        await el.dispose();
        console.log(`Clicked: ${args[0]} (${formatActionState(result)})`);
      } else if (args[0] && args[1]) {
        const x = parseInt(args[0]), y = parseInt(args[1]);
        if (isNaN(x) || isNaN(y)) { console.error('Click: provide x y coordinates'); process.exit(1); }
        await page.mouse.click(x, y);
        console.log(`Clicked at (${x}, ${y})`);
      } else {
        console.error('Usage: auto-browser click <@N | x y | selector>');
        process.exit(1);
      }
      break;
    }

    // ==================== FILL ====================
    case 'fill': {
      const [selector, value] = args;
      if (!selector || value === undefined) {
        console.error('Usage: auto-browser fill <selector> <value>');
        process.exit(1);
      }
      const page = await getPage();
      let handle;
      let label = selector;
      if (selector.startsWith('@')) {
        const resolved = await resolveRef(page, selector);
        if (!resolved) {
          console.error(`Element not found: ${selector}. Run "snap" first.`);
          process.exit(1);
        }
        handle = resolved.handle;
        label = resolved.element.ref;
        if (resolved.confidence < 80) {
          console.warn(`Warning: ${selector} matched with confidence ${resolved.confidence} via ${resolved.method}`);
        }
      } else {
        handle = await page.$(selector);
      }
      if (!handle) {
        console.error(`Element not found: ${selector}`);
        process.exit(1);
      }
      const fillState = await handle.evaluate(node => ({
        connected: node.isConnected,
        visible: node.offsetParent !== null,
        disabled: Boolean(node.disabled || node.getAttribute('aria-disabled') === 'true'),
        editable: node.matches('input, textarea, [contenteditable="true"]')
      }));
      if (!fillState.connected || !fillState.visible || fillState.disabled || !fillState.editable) {
        await handle.dispose();
        console.error(`Element is not fillable: ${selector}`);
        process.exit(1);
      }
      await handle.evaluate(node => node.focus());
      await page.keyboard.down('Control');
      await page.keyboard.press('A');
      await page.keyboard.up('Control');
      await page.keyboard.press('Backspace');
      await page.keyboard.type(value, { delay: 10 });
      const actualValue = await handle.evaluate(node => node.isContentEditable ? node.textContent : node.value);
      await handle.dispose();
      if (actualValue !== value) {
        console.error(`Fill verification failed for ${selector}: expected ${JSON.stringify(value)}, got ${JSON.stringify(actualValue)}`);
        process.exit(1);
      }
      console.log(`Filled "${label}" with "${value}" (verified)`);
      break;
    }

    case 'diff': {
      if (!fs.existsSync(SNAPSHOT_FILE)) {
        console.error('No previous snapshot. Run "snap" first.');
        process.exit(1);
      }
      const previous = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8'));
      const current = await getAB().then(ab => ab.buildMap({ compress: true }));
      const diff = diffMaps(previous, current);
      console.log(JSON.stringify({
        added: diff.added.length,
        removed: diff.removed.length,
        changed: diff.changed.length,
        details: diff
      }, null, 2));
      break;
    }

    // ==================== WAIT ====================
    case 'wait': {
      const kind = args[0];
      const target = args[1];
      const timeout = Number(args[2]) || 10000;
      const page = await getPage();
      if (kind === 'selector') await waitForSelector(page, target, { timeout });
      else if (kind === 'text') await waitForText(page, target, { timeout });
      else if (kind === 'url') await waitForUrl(page, target, { timeout });
      else if (kind === 'stable') await waitForDomStable(page, { timeout });
      else {
        console.error('Usage: auto-browser wait [selector|text|url|stable] <value> [timeout]');
        process.exit(1);
      }
      console.log(`Wait satisfied: ${kind}${target ? ` ${target}` : ''}`);
      break;
    }

    // ==================== HOVER ====================
    case 'hover': {
      const target = args[0];
      if (!target) {
        console.error('Usage: auto-browser hover <@ref | selector>');
        process.exit(1);
      }
      const page = await getPage();
      let handle;
      let label = target;
      if (target.startsWith('@')) {
        const resolved = await resolveRef(page, target);
        if (!resolved) {
          console.error(`Element not found: ${target}. Run "snap" first.`);
          process.exit(1);
        }
        handle = resolved.handle;
        label = resolved.element.ref;
        if (resolved.confidence < 80) {
          console.warn(`Warning: ${target} matched with confidence ${resolved.confidence} via ${resolved.method}`);
        }
      } else {
        handle = await page.$(target);
      }
      if (!handle) {
        console.error(`Element not found: ${target}`);
        process.exit(1);
      }
      const hoverState = await handle.evaluate(node => ({
        connected: node.isConnected,
        visible: node.offsetParent !== null,
        disabled: Boolean(node.disabled || node.getAttribute('aria-disabled') === 'true')
      }));
      if (!hoverState.connected || !hoverState.visible || hoverState.disabled) {
        await handle.dispose();
        console.error(`Element is not hoverable: ${target}`);
        process.exit(1);
      }
      await handle.hover();
      await handle.dispose();
      console.log(`Hovered "${label}"`);
      break;
    }

    // ==================== FORM CONTROLS ====================
    // All of these accept either an @ref (from snap/find) or a CSS selector,
    // so the discover -> act loop is uniform across every command.
    case 'select': {
      const [target, value] = args;
      if (!target || value === undefined) {
        console.error('Usage: auto-browser select <@ref|selector> <value>');
        process.exit(1);
      }
      const page = await getPage();
      const { handle, label } = await resolveTarget(page, target);
      const ok = await handle.evaluate((el, wanted) => {
        if (el.tagName !== 'SELECT') return { error: `not a <select> (got <${el.tagName}>)` };
        const option = [...el.options].find(
          o => o.value === wanted || o.textContent.trim() === wanted
        );
        if (!option) {
          return { error: 'option not found', available: [...el.options].map(o => o.textContent.trim()) };
        }
        el.value = option.value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return { value: el.value, label: option.textContent.trim() };
      }, value);
      await handle.dispose();
      if (ok.error) {
        console.error(`select ${label}: ${ok.error}`);
        if (ok.available) console.error(`Available: ${ok.available.join(' | ')}`);
        process.exit(1);
      }
      console.log(`Selected "${ok.label}" (value=${ok.value}) in ${label}`);
      break;
    }

    case 'check':
    case 'uncheck': {
      const target = args[0];
      if (!target) {
        console.error(`Usage: auto-browser ${cmd} <@ref|selector>`);
        process.exit(1);
      }
      const page = await getPage();
      const { handle, label } = await resolveTarget(page, target);
      const res = await handle.evaluate((el, wanted) => {
        const isNative = ['checkbox', 'radio'].includes(el.type);
        const box = isNative ? el : el.querySelector('input[type=checkbox],input[type=radio]');
        if (!box) return { error: `not a checkbox/radio (got <${el.tagName}> type="${el.type || ''}")` };
        if (box.checked !== wanted) box.click();
        return { checked: box.checked };
      }, cmd === 'check');
      await handle.dispose();
      if (res.error) {
        console.error(`${cmd} ${label}: ${res.error}`);
        process.exit(1);
      }
      console.log(`${cmd === 'check' ? 'Checked' : 'Unchecked'} ${label} (now checked=${res.checked})`);
      break;
    }

    case 'contenteditable': {
      const [target, value] = args;
      if (!target || value === undefined) {
        console.error('Usage: auto-browser contenteditable <@ref|selector> <value>');
        process.exit(1);
      }
      const page = await getPage();
      const { handle, label } = await resolveTarget(page, target);
      const res = await handle.evaluate((el, text) => {
        if (!el.isContentEditable) return { error: 'element is not contenteditable' };
        el.focus();
        el.textContent = text;
        el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
        return { text: el.textContent.slice(0, 80) };
      }, value);
      await handle.dispose();
      if (res.error) {
        console.error(`contenteditable ${label}: ${res.error}`);
        process.exit(1);
      }
      console.log(`Filled contenteditable ${label} -> "${res.text}"`);
      break;
    }

    // ==================== TYPE ====================
    case 'type': {
      const text = args.join(' ');
      if (!text) { console.error('Usage: auto-browser type <text>'); process.exit(1); }
      const page = await getPage();
      await page.keyboard.type(text, { delay: 10 });
      console.log(`Typed: ${text}`);
      break;
    }

    // ==================== SCROLL ====================
    case 'scroll': {
      const x = parseInt(args[0]) || 0;
      const y = parseInt(args[1]) || 0;
      const page = await getPage();
      await page.evaluate((sx, sy) => window.scrollTo(sx, sy), x, y);
      console.log(`Scrolled to (${x}, ${y})`);
      break;
    }

    // ==================== TAB ====================
    case 'tab': {
      const sub = args[0];
      const ab = await getAB();

      switch (sub) {
        case 'list': {
          const browser = ab.browser;
          const pages = await browser.pages();
          console.log(`\nTabs (${pages.length}):\n`);
          for (let i = 0; i < pages.length; i++) {
            const p = pages[i];
            try {
              const title = await p.title();
              const url = p.url().slice(0, 80);
              console.log(`  ${i}: ${title || 'untitled'}`);
              console.log(`     ${url}`);
              console.log('');
            } catch {}
          }
          break;
        }
        case 'new': {
          const browser = ab.browser;
          const newPage = await browser.newPage();
          console.log(`Tab created: ${await newPage.title()}`);
          if (args[1]) {
            await newPage.goto(args[1], { waitUntil: 'networkidle0' });
            console.log(`Navigated to: ${args[1]}`);
          }
          break;
        }
        case 'close': {
          const idx = parseInt(args[1]);
          if (isNaN(idx)) { console.error('Usage: auto-browser tab close <index>'); process.exit(1); }
          const browser = ab.browser;
          const pages = await browser.pages();
          if (idx < 0 || idx >= pages.length) { console.error(`Tab index ${idx} out of range`); process.exit(1); }
          await pages[idx].close();
          console.log(`Tab ${idx} closed`);
          break;
        }
        default:
          console.log('Usage: auto-browser tab [list|new|close]');
      }
      break;
    }

    // ==================== OVERLAY ====================
    case 'overlay': {
      const sub = args[0];
      const ab = await getAB();
      const page = ab.getPage();

      switch (sub) {
        case 'inject':
        case 'show':
        case 'on': {
          if (_lastElements.length === 0) {
            console.log('No elements cached. Run "snap" first.');
            break;
          }
          await ab.injectOverlay(_lastElements);
          _overlayActive = true;
          console.log(`🟢 Overlay injected: ${_lastElements.length} elements numbered.`);
          break;
        }
        case 'remove':
        case 'hide':
        case 'off': {
          const { removeOverlay } = await import('../core/map.mjs');
          await removeOverlay(page);
          _overlayActive = false;
          console.log('🔴 Overlay removed.');
          break;
        }
        default:
          console.log('Usage: auto-browser overlay [inject|remove]');
      }
      break;
    }

    // ==================== CACHE ====================
    case 'cache': {
      const sub = args[0] || 'list';
      const cache = new CacheManager();

      switch (sub) {
        case 'list':
        case 'ls': {
          const entries = cache.list();
          if (entries.length === 0) {
            console.log('No cached pages.');
          } else {
            console.log(`\nCached pages: ${entries.length}\n`);
            entries.forEach(e => {
              console.log(`  ${e.site}/${e.pageName}`);
              console.log(`    URL: ${e.urlPattern}`);
              console.log(`    Elements: ${e.elementCount}`);
              console.log(`    Built: ${e.lastBuild}`);
              console.log(`    Scripts: ${(e.scripts || []).join(', ') || 'none'}`);
              console.log('');
            });
          }
          break;
        }
        case 'clear': {
          cache.clear();
          console.log('Cache cleared.');
          break;
        }
        default:
          console.log('Usage: auto-browser cache [list|clear]');
      }
      break;
    }

    // ==================== UNKNOWN ====================
    default:
      console.error(`Unknown command: "${cmd}"`);
      console.error('Run "auto-browser help" to see available commands.');
      process.exit(1);
  }
}

main()
  .catch(e => {
    console.error('Error:', e.message);
    process.exit(1);
  })
  .finally(async () => {
    await cleanup();
    // Puppeteer can retain a CDP transport handle after disconnect().
    // This process is a one-shot CLI command, so exit once cleanup is done.
    if (process.exitCode === undefined) process.exit(0);
  });
