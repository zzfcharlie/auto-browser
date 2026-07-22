import { connect, navigate, sleep } from '../core/browser.mjs';
import { findOne, findAll } from '../core/dom.mjs';
import { click, type } from '../core/interact.mjs';
import { buildMap } from '../core/map.mjs';

const action = process.argv[2] || 'map';
const { browser, page } = await connect({ hostname: 'kaggle.com' });

try {
  if (action === 'map') {
    await navigate(page, 'https://www.kaggle.com/competitions');
    await sleep(3000);

    const map = await buildMap(page);
    console.log(`URL: ${map.url}`);
    console.log(`Title: ${map.title}`);
    console.log(`Elements: ${map.elements.length}\n`);

    const seen = new Set();
    map.elements.forEach((el, i) => {
      const key = el.text.slice(0, 30);
      if (!key || seen.has(key)) return;
      seen.add(key);
      console.log(`  ${i}: [${el.visible ? 'VIS' : 'HID'}] ${el.tag} "${el.text.slice(0, 60)}" at (${el.center.x},${el.center.y})`);
    });
  }
} finally {
  await browser.disconnect();
}
