// --- Network capture via CDP ---
// Inspired by bb-browser's `network requests --with-body` feature.
// Intercepts all network requests in a tab and captures request/response bodies.

let _capturing = false;
let _requests = [];
let _maxEntries = 500;

const CDP_KEY = '__ab_network_session';

export function isCapturing() { return _capturing; }
export function getCapturedRequests() { return _requests; }
export function clearCapturedRequests() { _requests = []; }
export function setMaxEntries(n) { _maxEntries = Math.max(10, n); }

export async function startCapture(page, options = {}) {
  if (_capturing) { console.warn('[Network] Already capturing.'); return; }
  _capturing = true;
  _requests = [];
  const includeBody = options.withBody || false;
  const filters = options.filterPatterns || [];
  const excludes = options.excludePatterns || [
    '.css','.js.map','.png','.jpg','.jpeg','.gif','.svg','.webp',
    '.woff','.woff2','.ttf','.eot','.ico','.mp4','.webm',
    'favicon','analytics','google-analytics','doubleclick',
    'facebook.net','googletagmanager'
  ];

  const cdp = await page.target().createCDPSession();
  page[CDP_KEY] = cdp;
  await cdp.send('Network.enable');

  const ok = (u) => filters.length ? filters.some(p => u.includes(p)) : !excludes.some(p => u.includes(p));

  cdp.on('Network.requestWillBeSent', (ev) => {
    if (!_capturing || !ok(ev.request.url)) return;
    const e = {
      type: 'request', seq: _requests.length + 1,
      timestamp: new Date(ev.wallTime * 1000).toISOString(),
      method: ev.request.method, url: ev.request.url,
      requestId: ev.requestId, headers: ev.request.headers,
      resourceType: ev.type || 'unknown',
    };
    if (includeBody && ev.request.postData) e.body = ev.request.postData;
    _requests.push(e);
    if (_requests.length > _maxEntries) _requests.splice(0, _requests.length - _maxEntries);
  });

  cdp.on('Network.responseReceived', (ev) => {
    if (!_capturing) return;
    const r = _requests.find(x => x.requestId === ev.requestId && !x.response);
    if (!r) return;
    r.response = {
      status: ev.response.status, statusText: ev.response.statusText,
      contentType: ev.response.mimeType, headers: ev.response.headers,
    };
  });

  console.log(`[Network] Capture started (body=${includeBody})`);
  return cdp;
}

export async function getResponseBody(page, requestId) {
  const cdp = page[CDP_KEY];
  if (!cdp) throw new Error('Not capturing.');
  try {
    return await cdp.send('Network.getResponseBody', { requestId });
  } catch (e) {
    return { body: `[Error: ${e.message}]`, base64Encoded: false };
  }
}

export async function getAllResponseBodies(page) {
  const cdp = page[CDP_KEY];
  if (!cdp) throw new Error('Not capturing.');
  for (const e of _requests) {
    if (e.response && e.body === undefined) {
      try {
        const r = await cdp.send('Network.getResponseBody', { requestId: e.requestId });
        e.body = r.base64Encoded ? Buffer.from(r.body, 'base64').toString('utf-8').slice(0, 50000) : r.body.slice(0, 50000);
      } catch { e.body = '[unavailable]'; }
    }
  }
  return _requests;
}

export async function stopCapture(page) {
  if (!_capturing) return;
  _capturing = false;
  const cdp = page[CDP_KEY];
  if (cdp) {
    try { await cdp.send('Network.disable'); await cdp.detach(); } catch {}
    delete page[CDP_KEY];
  }
  console.log(`[Network] Stopped. ${_requests.length} captured.`);
  return _requests.length;
}

export async function captureNavigation(page, url, options = {}) {
  await startCapture(page, options);
  await page.goto(url, { waitUntil: options.waitUntil || 'networkidle0', timeout: options.timeout || 15000 });
  await new Promise(r => setTimeout(r, 2000));
  if (options.withBody) await getAllResponseBodies(page);
  await stopCapture(page);
  return _requests;
}
