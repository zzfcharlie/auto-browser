// auto-browser 模板脚本
// 使用方式: node scripts/template.mjs <action>
//
// 建图流程:
//   1. node scripts/template.mjs map     → 抓取页面元素地图
//   2. 根据地图编写操作脚本
//   3. node scripts/template.mjs run     → 执行操作

import { connect, navigate, sleep } from '../core/browser.mjs';
import { findOne, findAll, findByText } from '../core/dom.mjs';
import { click, clickAt, type, typeByLabel, hover, scrollTo } from '../core/interact.mjs';
import { selectDropdown, readForm } from '../core/form.mjs';
import { buildMap, formatMapJson } from '../core/map.mjs';
import * as fs from 'fs';

const action = process.argv[2] || 'help';
const { browser, page } = await connect();

try {
  switch (action) {

    case 'map': {
      // Phase 1: Build page map
      const url = process.argv[3];
      if (!url) { console.log('Usage: node template.mjs map <url>'); break; }

      await navigate(page, url);
      await sleep(2000);

      const map = await buildMap(page);
      console.log(`URL: ${map.url}`);
      console.log(`Title: ${map.title}`);
      console.log(`Elements: ${map.elements.length}`);
      console.log('\nInteractive elements:');
      map.elements.forEach((el, i) => {
        const vis = el.visible ? 'VIS' : 'HID';
        console.log(`  ${i}: [${vis}] ${el.tag} "${el.text}" at (${el.center.x},${el.center.y})`);
      });
      break;
    }

    case 'run': {
      // Phase 2: Execute actions (customize this section)
      console.log('Customize this section for your target website');
      break;
    }

    default:
      console.log('Usage:');
      console.log('  node template.mjs map <url>   # Build page map');
      console.log('  node template.mjs run         # Run actions');
  }
} finally {
  await browser.disconnect();
}
