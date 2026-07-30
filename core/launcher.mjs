// ============================================================
// core/launcher.mjs
// Guarantees a CDP-enabled Chrome is reachable in ONE invocation.
//
// Root problem this solves:
//   If the user's normal Chrome is already running on its default
//   profile WITHOUT --remote-debugging-port, launching chrome.exe with
//   the flag just re-uses the existing process and the CDP port is
//   never opened. puppeteer.connect() then fails, forcing the user to
//   close every Chrome window and retry (the "open-close 10 times" pain).
//
// Solution:
//   Launch a DEDICATED Chrome instance with its own --user-data-dir.
//   A separate profile never collides with the user's running Chrome,
//   so the CDP port is always opened. We then poll /json/version until
//   the endpoint is truly ready before returning. Login state persists
//   in this profile across runs.
// ============================================================

import { spawn, execSync, execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const DEFAULT_PORT = 9222;
const DEFAULT_HOST = '127.0.0.1';
const PID_FILE_NAME = '.auto-browser.pid';

// ------------------------------------------------------------
// Locate a Chrome/Chromium/Edge binary across machines & OSes.
// ------------------------------------------------------------
function findChromeBinary() {
  // Explicit override wins.
  if (process.env.AUTO_BROWSER_CHROME && fs.existsSync(process.env.AUTO_BROWSER_CHROME)) {
    return process.env.AUTO_BROWSER_CHROME;
  }

  const platform = process.platform;
  const candidates = [];

  if (platform === 'win32') {
    const pf = process.env['ProgramFiles'] || 'C:\\Program Files';
    const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const local = process.env['LOCALAPPDATA'] || path.join(os.homedir(), 'AppData', 'Local');
    candidates.push(
      path.join(pf, 'Google\\Chrome\\Application\\chrome.exe'),
      path.join(pf86, 'Google\\Chrome\\Application\\chrome.exe'),
      path.join(local, 'Google\\Chrome\\Application\\chrome.exe'),
      path.join(pf, 'Google\\Chrome Beta\\Application\\chrome.exe'),
      path.join(pf, 'Chromium\\Application\\chrome.exe'),
      path.join(pf86, 'Microsoft\\Edge\\Application\\msedge.exe'),
      path.join(pf, 'Microsoft\\Edge\\Application\\msedge.exe')
    );
  } else if (platform === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
    );
  } else {
    // linux
    candidates.push(
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/snap/bin/chromium',
      '/usr/bin/microsoft-edge'
    );
    // Try PATH lookup as a fallback.
    for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
      try {
        const resolved = execSync(`command -v ${name}`, { stdio: ['ignore', 'pipe', 'ignore'] })
          .toString().trim();
        if (resolved) candidates.push(resolved);
      } catch { /* not found */ }
    }
  }

  for (const c of candidates) {
    try { if (c && fs.existsSync(c)) return c; } catch { /* ignore */ }
  }
  return null;
}

// ------------------------------------------------------------
// Dedicated automation profile dir (per-user, persistent).
// ------------------------------------------------------------
function defaultProfileDir() {
  if (process.env.AUTO_BROWSER_PROFILE) return process.env.AUTO_BROWSER_PROFILE;
  return path.join(stateDir(), 'chrome-profile');
}

// Base dir for auto-browser runtime state (profile + pid file).
function stateDir() {
  const base = process.env.LOCALAPPDATA || process.env.XDG_DATA_HOME || os.tmpdir();
  return path.join(base, 'auto-browser');
}

function pidFilePath() {
  return path.join(stateDir(), PID_FILE_NAME);
}

function writePidFile(data) {
  try {
    fs.mkdirSync(stateDir(), { recursive: true });
    fs.writeFileSync(pidFilePath(), JSON.stringify(data, null, 2));
  } catch { /* non-fatal */ }
}

function readPidFile() {
  try {
    return JSON.parse(fs.readFileSync(pidFilePath(), 'utf8'));
  } catch {
    return null;
  }
}

function removePidFile() {
  try { fs.unlinkSync(pidFilePath()); } catch { /* ignore */ }
}

// ------------------------------------------------------------
// Probe the CDP endpoint. Returns the webSocketDebuggerUrl info
// object on success, or null if not reachable.
// ------------------------------------------------------------
async function probeCDP(host, port, timeoutMs = 1500) {
  const url = `http://${host}:${port}/json/version`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ------------------------------------------------------------
// ensureChrome — the single entry point.
// Returns { browserURL, host, port, launched, binary }.
// ------------------------------------------------------------
export async function ensureChrome(options = {}) {
  const host = options.host || DEFAULT_HOST;
  const port = options.port || Number(process.env.AUTO_BROWSER_PORT) || DEFAULT_PORT;
  const browserURL = `http://${host}:${port}`;

  // 1. Already up? Reuse it immediately (0-cost fast path).
  const existing = await probeCDP(host, port);
  if (existing) {
    return { browserURL, host, port, launched: false, binary: null, version: existing };
  }

  // 2. Need to launch. Find a binary.
  const binary = findChromeBinary();
  if (!binary) {
    throw new Error(
      'No Chrome/Chromium/Edge binary found. Set AUTO_BROWSER_CHROME to the executable path.'
    );
  }

  // 3. Dedicated profile so we never collide with the user's running Chrome.
  const profileDir = defaultProfileDir();
  fs.mkdirSync(profileDir, { recursive: true });

  const args = [
    `--remote-debugging-port=${port}`,
    `--remote-debugging-address=${host}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=Translate,ChromeWhatsNewUI',
    '--disable-popup-blocking',
    '--restore-last-session',
    'about:blank'
  ];
  if (options.headless) args.unshift('--headless=new');

  const child = spawn(binary, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: false
  });
  child.unref();

  // 4. Poll until the endpoint is truly ready (not just process spawned).
  const deadline = Date.now() + (options.startupTimeoutMs || 20000);
  let version = null;
  while (Date.now() < deadline) {
    version = await probeCDP(host, port, 1000);
    if (version) break;
    await sleep(250);
  }

  if (!version) {
    throw new Error(
      `Chrome launched (${binary}) but CDP endpoint ${browserURL} never became ready. ` +
      `If your normal Chrome is running on the same profile, this dedicated profile ` +
      `(${profileDir}) should still work — check firewall/antivirus blocking port ${port}.`
    );
  }

  // Remember what we started so `close` can kill exactly our instance.
  writePidFile({
    pid: child.pid,
    port,
    host,
    binary,
    profileDir,
    startedAt: new Date().toISOString()
  });

  return { browserURL, host, port, launched: true, binary, profileDir, version, pid: child.pid };
}

export { findChromeBinary, defaultProfileDir, probeCDP };

// ------------------------------------------------------------
// launchChrome — explicit "唤起" command.
// force:true kills an existing auto-browser instance first so you
// get a guaranteed-fresh browser.
// ------------------------------------------------------------
export async function launchChrome(options = {}) {
  if (options.force) {
    await closeChrome({ port: options.port, quiet: true });
    await sleep(600);
  }
  return ensureChrome(options);
}

// ------------------------------------------------------------
// Find every chrome/chromium/edge PID whose command line contains
// our debugging port. Cross-platform, and does NOT touch the user's
// normal Chrome windows (they have no such flag).
// ------------------------------------------------------------
function findCdpChromePids(port) {
  const needle = `--remote-debugging-port=${port}`;
  const pids = new Set();

  try {
    if (process.platform === 'win32') {
      const ps =
        `Get-CimInstance Win32_Process -Filter "name='chrome.exe' or name='msedge.exe'" | ` +
        `Where-Object { $_.CommandLine -like '*${needle}*' } | ` +
        `Select-Object -ExpandProperty ProcessId`;
      const out = execFileSync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', ps],
        { stdio: ['ignore', 'pipe', 'ignore'], timeout: 15000 }
      ).toString();
      for (const line of out.split(/\r?\n/)) {
        const n = Number.parseInt(line.trim(), 10);
        if (Number.isInteger(n) && n > 0) pids.add(n);
      }
    } else {
      const out = execSync(`ps -eo pid=,args=`, {
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 15000
      }).toString();
      for (const line of out.split('\n')) {
        if (!line.includes(needle)) continue;
        const n = Number.parseInt(line.trim().split(/\s+/)[0], 10);
        if (Number.isInteger(n) && n > 0) pids.add(n);
      }
    }
  } catch { /* enumeration failed; fall back to pid file below */ }

  // Fall back to / augment with the pid we recorded at launch.
  const recorded = readPidFile();
  if (recorded?.pid && (!recorded.port || recorded.port === port)) {
    pids.add(recorded.pid);
  }

  return [...pids];
}

function killPid(pid) {
  try {
    if (process.platform === 'win32') {
      execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        timeout: 15000
      });
    } else {
      process.kill(pid, 'SIGTERM');
    }
    return true;
  } catch {
    return false;
  }
}

// Is a PID still alive? Used to distinguish "kill failed" from
// "already gone because we killed its parent tree".
function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

// ------------------------------------------------------------
// closeChrome — explicit "关闭" command.
// Only kills Chrome processes started with our debugging port,
// so the user's everyday Chrome windows are left untouched.
// ------------------------------------------------------------
export async function closeChrome(options = {}) {
  const host = options.host || DEFAULT_HOST;
  const port = options.port || Number(process.env.AUTO_BROWSER_PORT) || DEFAULT_PORT;

  const wasRunning = !!(await probeCDP(host, port, 1000));
  const pids = findCdpChromePids(port);

  // Killing the parent with /T takes the child tree with it, so a
  // later kill on an already-dead child is not a real failure.
  const attempted = [];
  for (const pid of pids) {
    if (!isAlive(pid)) continue;
    killPid(pid);
    attempted.push(pid);
  }

  // Wait until the port is actually free (graceful shutdown can lag).
  const deadline = Date.now() + (options.shutdownTimeoutMs || 8000);
  let stillUp = true;
  while (Date.now() < deadline) {
    stillUp = !!(await probeCDP(host, port, 800));
    if (!stillUp) break;
    await sleep(250);
  }

  const killed = pids.filter(pid => !isAlive(pid));
  const failed = pids.filter(pid => isAlive(pid));

  removePidFile();

  return { wasRunning, killed, failed, attempted, port, host, portFree: !stillUp };
}

// ------------------------------------------------------------
// chromeStatus — is our CDP browser up, and what is it?
// ------------------------------------------------------------
export async function chromeStatus(options = {}) {
  const host = options.host || DEFAULT_HOST;
  const port = options.port || Number(process.env.AUTO_BROWSER_PORT) || DEFAULT_PORT;
  const version = await probeCDP(host, port, 1500);

  let tabs = [];
  if (version) {
    try {
      const res = await fetch(`http://${host}:${port}/json/list`);
      if (res.ok) {
        tabs = (await res.json())
          .filter(t => t.type === 'page')
          .map(t => ({ title: t.title, url: t.url }));
      }
    } catch { /* ignore */ }
  }

  return {
    running: !!version,
    host,
    port,
    browserURL: `http://${host}:${port}`,
    version: version || null,
    pids: version ? findCdpChromePids(port) : [],
    profileDir: defaultProfileDir(),
    recorded: readPidFile(),
    tabs
  };
}

