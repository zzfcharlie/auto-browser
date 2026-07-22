#!/usr/bin/env node

import { AutoBrowser } from '../api/index.mjs';
import { CacheManager } from '../cache/manager.mjs';

const args = process.argv.slice(2);
const command = args[0] || 'help';

async function main() {
  const ab = new AutoBrowser();

  switch (command) {
    case 'map': {
      const url = args[1];
      if (!url) {
        console.log('Usage: auto-browser map <url>');
        console.log('       auto-browser map <url> --visualize');
        process.exit(1);
      }
      const visualize = args.includes('--visualize') || args.includes('-v');
      await ab.connect();
      await ab.navigate(url);

      const map = await ab.buildMap({ compress: true });
      const framework = await ab.detectFramework();

      console.log(`\nURL: ${map.url}`);
      console.log(`Title: ${map.title}`);
      console.log(`Framework: ${framework.detected} (confidence: ${framework.confidence})`);
      console.log(`Elements: ${map.elements.length}\n`);

      map.elements.forEach((el, i) => {
        const desc = el.text || el.role || el.tag;
        console.log(`  #${i + 1}: [${el.source}] <${el.tag}> "${desc.slice(0, 35)}" at (${el.rect.x},${el.rect.y})`);
      });

      if (visualize) {
        await ab.injectOverlay(map.elements);
        console.log('\nOverlay injected. Press Ctrl+C to exit.');
        await new Promise(() => {});
      }

      await ab.disconnect();
      break;
    }

    case 'cache': {
      const cache = new CacheManager();
      const subCommand = args[1] || 'list';

      switch (subCommand) {
        case 'list': {
          const entries = cache.list();
          if (entries.length === 0) {
            console.log('No cached pages.');
          } else {
            console.log(`Cached pages: ${entries.length}\n`);
            entries.forEach(e => {
              console.log(`  ${e.site}/${e.pageName}`);
              console.log(`    URL: ${e.urlPattern}`);
              console.log(`    Elements: ${e.elementCount}`);
              console.log(`    Built: ${e.lastBuild}`);
              console.log(`    Scripts: ${e.scripts.join(', ') || 'none'}`);
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
        case 'invalidate': {
          const site = args[2];
          const page = args[3];
          if (!site || !page) {
            console.log('Usage: auto-browser cache invalidate <site> <page>');
            process.exit(1);
          }
          cache.invalidate(site, page);
          break;
        }
        default:
          console.log('Usage: auto-browser cache [list|clear|invalidate]');
      }
      break;
    }

    case 'detect': {
      const url = args[1];
      if (!url) {
        console.log('Usage: auto-browser detect <url>');
        process.exit(1);
      }
      await ab.connect();
      await ab.navigate(url);
      const framework = await ab.detectFramework();
      console.log(`Framework: ${framework.detected}`);
      console.log(`Confidence: ${framework.confidence}/3`);
      console.log(`Details:`, framework.results);
      await ab.disconnect();
      break;
    }

    case 'help':
    default:
      console.log(`
auto-browser — CDP-driven browser automation framework

Usage:
  auto-browser map <url> [-v]       Build page element map
  auto-browser detect <url>         Detect UI framework
  auto-browser cache [list|clear]   Manage cache
  auto-browser help                 Show this help

Examples:
  auto-browser map https://example.com
  auto-browser map https://example.com --visualize
  auto-browser detect https://element-plus.org
  auto-browser cache list
  auto-browser cache clear
`);
  }
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
