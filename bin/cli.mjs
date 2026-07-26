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
import { buildMap, formatMapJson } from '../core/map.mjs';
import { detectFramework } from '../detector/index.mjs';
import * as network from '../core/network.mjs';
import { loadBuiltInAdapters, listAdapters, runAdapter } from '../site/loader.mjs';
import { startDaemon, stopDaemon } from '../daemon/index.mjs';
import { selectDropdown, readForm } from '../core/form.mjs';
import fs from 'fs';

const [,, cmd, ...args] = process.argv;

// ============================================================
// Helper: connect to browser
// ============================================================

let _ab = null;
let _lastElements = []; // cache of last snap/map elements for @ref click
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
    await _ab.disconnect();
    _ab = null;
  }
}

// ============================================================
// Command: help
// ============================================================

function showHelp() {
  console.log(`
auto-browser v2.0 — CDP-driven browser automation framework
Your browser is the API. No keys. No bots. No scrapers.

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
  click @3               Click element #3 from last snapshot
  click <x> <y>          Click at pixel coordinates
  click <selector>       Click element matching CSS selector

=== Network Capture ===
  network start          Start capturing network requests
  network requests       Show captured requests (--with-body for bodies)
  network stop           Stop capture and show results
  network clear          Clear captured requests
  network nav <url>      Navigate and capture all network activity

=== Navigation & Observation ===
  open <url>             Navigate to URL
  snap                   Snapshot current page (build map)
  detect                 Detect UI framework on current page
  screenshot             Take a JPEG screenshot (base64)
  eval <js>              Execute JavaScript in page context
  get <attr>             Get page attribute (title, url, html, text)

=== Interaction ===
  click <x> <y>          Click at pixel coordinates
  click <sel>            Click element matching CSS selector
  fill <sel> <value>     Fill input field
  type <text>            Type text (after focusing input)
  scroll <x> <y>         Scroll to position

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
  auto-browser map https://example.com
  auto-browser site github-repo owner=zzfcharlie repo=auto-browser
  auto-browser open https://news.ycombinator.com
  auto-browser snap
  auto-browser detect
  auto-browser network start && auto-browser open https://example.com && auto-browser network stop
  auto-browser daemon start
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

    // ==================== MAP ====================
    case 'map': {
      const url = args[0];
      if (!url) { console.error('Usage: auto-browser map <url> [-v]'); process.exit(1); }
      const visualize = args.includes('-v') || args.includes('--visualize');

      const ab = await getAB();
      await ab.navigate(url);

      const map = await ab.buildMap({ compress: true });
      const framework = await ab.detectFramework();

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

      console.log(`\nTitle: ${map.title}`);
      console.log(`Framework: ${fw.detected}`);
      console.log(`Elements: ${map.elements.length}\n`);

      // Print with @ref numbers (bb-browser style)
      map.elements.slice(0, 50).forEach((el, i) => {
        const ref = `@${i + 1}`.padEnd(4);
        const tag = el.tag.padEnd(8);
        const vis = el.visible ? '' : '[HID]';
        const text = String(el.text || '').slice(0, 45);
        console.log(`  ${ref} <${tag}> ${vis} "${text}" at (${el.rect.x},${el.rect.y})`);
      });
      if (map.elements.length > 50) {
        console.log(`  ... and ${map.elements.length - 50} more`);
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
    case 'eval': {
      const code = args.join(' ');
      if (!code) { console.error('Usage: auto-browser eval <js-code>'); process.exit(1); }
      const page = await getPage();
      const result = await page.evaluate(code);
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
        const refNum = parseInt(args[0].slice(1));
        if (isNaN(refNum) || refNum < 1 || refNum > _lastElements.length) {
          console.error(`Invalid ref: ${args[0]}. Available: 1-${_lastElements.length}`);
          console.log('Run "snap" first to see element references.');
          process.exit(1);
        }
        const el = _lastElements[refNum - 1];
        if (!el.center) {
          console.error(`Element @${refNum} has no center coordinates`);
          process.exit(1);
        }
        await page.mouse.click(el.center.x, el.center.y);
        console.log(`Clicked @${refNum}: <${el.tag}> "${String(el.text || '').slice(0, 40)}" at (${el.center.x},${el.center.y})`);
        await new Promise(r => setTimeout(r, 500));
        break;
      }

      // Click by selector if first arg starts with . or #
      if (args[0]?.startsWith('.') || args[0]?.startsWith('#')) {
        const el = await page.$(args[0]);
        if (!el) { console.error(`Element not found: ${args[0]}`); process.exit(1); }
        await el.click();
        console.log(`Clicked: ${args[0]}`);
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
      await page.click(selector);
      await page.keyboard.selectAll();
      await page.keyboard.press('Delete');
      await page.keyboard.type(value, { delay: 10 });
      console.log(`Filled "${selector}" with "${value}"`);
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
  .finally(() => cleanup());
