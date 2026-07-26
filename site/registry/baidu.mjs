// Site Adapter: Baidu - Search (uses real browser cookies)
// Demonstrates bb-browser style "eval in page with your login state"

export const description = 'Search Baidu (uses your browser login)';
export const params = ['query', 'pn'];
export const examples = [
  { params: { query: 'auto-browser' }, desc: 'Search auto-browser' },
];

export default async function execute(page, { query, pn = '1' }) {
  await page.goto(`https://www.baidu.com/s?wd=${encodeURIComponent(query)}&pn=${(parseInt(pn) - 1) * 10}`, {
    waitUntil: 'networkidle0'
  });
  await new Promise(r => setTimeout(r, 2000));

  return page.evaluate(() => {
    const results = [];
    document.querySelectorAll('.result, .result-op').forEach(el => {
      const titleEl = el.querySelector('h3 a') || el.querySelector('.t a');
      const abstractEl = el.querySelector('.c-abstract') || el.querySelector('.content-right_8Zs40');
      if (titleEl) {
        results.push({
          title: titleEl.textContent.trim(),
          url: titleEl.href,
          abstract: abstractEl ? abstractEl.textContent.trim() : '',
        });
      }
    });
    return results;
  });
}
