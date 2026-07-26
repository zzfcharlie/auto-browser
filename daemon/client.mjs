// --- auto-browser Daemon HTTP Client ---

export class DaemonClient {
  constructor(host = '127.0.0.1', port = 19824) {
    this.baseUrl = `http://${host}:${port}`;
  }

  async command(method, params = {}) {
    const resp = await fetch(`${this.baseUrl}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method, params }),
    });
    const data = await resp.json();
    if (data.error) throw new Error(data.error.message);
    return data.result;
  }

  async status() {
    const resp = await fetch(`${this.baseUrl}/status`);
    return resp.json();
  }

  // Shorthand methods
  tabList() { return this.command('tab/list'); }
  tabNew() { return this.command('tab/new'); }
  open(url, tab) { return this.command('navigate/open', { url, tab }); }
  snap(tab) { return this.command('observe/snap', { tab }); }
  eval(code, tab) { return this.command('observe/eval', { code, tab }); }
  click(x, y, tab) { return this.command('interact/click', { x, y, tab }); }
  clickSelector(selector, tab) { return this.command('interact/click', { selector, tab }); }
  fill(selector, value, tab) { return this.command('interact/fill', { selector, value, tab }); }
  screenshot(tab) { return this.command('observe/screenshot', { tab }); }
  detect(tab) { return this.command('detect', { tab }); }
  runSite(adapter, params = {}) { return this.command('site/run', { adapter, ...params }); }
  networkStart(withBody = false, tab) { return this.command('network/start', { withBody, tab }); }
  networkStop(withBody = false, tab) { return this.command('network/stop', { withBody, tab }); }
  siteList() { return this.command('site/list'); }
}
