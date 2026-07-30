const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function waitForSelector(page, selector, { timeout = 10000, visible = true } = {}) {
  return page.waitForSelector(selector, { timeout, visible });
}

export async function waitForText(page, text, { timeout = 10000 } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await page.evaluate(value => document.body?.innerText?.includes(value), text)) return true;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for text: ${text}`);
}

export async function waitForUrl(page, pattern, { timeout = 10000 } = {}) {
  const matcher = pattern instanceof RegExp ? pattern : new RegExp(String(pattern));
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (matcher.test(page.url())) return page.url();
    await sleep(100);
  }
  throw new Error(`Timed out waiting for URL: ${pattern}`);
}

export async function waitForDomStable(page, { timeout = 10000, stableMs = 500 } = {}) {
  const started = Date.now();
  let last = await page.evaluate(() => document.documentElement?.outerHTML?.length || 0);
  let stableSince = Date.now();
  while (Date.now() - started < timeout) {
    await sleep(100);
    const current = await page.evaluate(() => document.documentElement?.outerHTML?.length || 0);
    if (current !== last) {
      last = current;
      stableSince = Date.now();
    } else if (Date.now() - stableSince >= stableMs) {
      return true;
    }
  }
  return false;
}
