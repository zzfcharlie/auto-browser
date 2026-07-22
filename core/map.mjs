import { findAll, findByText } from './dom.mjs';

// --- Build page map: extract all interactive elements ---

export async function buildMap(page, { includeHidden = false } = {}) {
  const result = await page.evaluate((hidden) => {
    const elements = [];

    // Collect all interactive elements
    const selectors = [
      'button', 'a', 'input', 'textarea', 'select',
      '[role="button"]', '[role="link"]', '[role="tab"]',
      '[role="menuitem"]', '[role="checkbox"]', '[role="radio"]',
      '.el-button', '.el-select', '.el-input', '.el-textarea',
      '.el-tabs__item', '.el-dropdown-menu__item',
      '.el-icon', '[class*="circle-plus"]', '[class*="circle-remove"]',
      '[class*="more-icon"]', '.el-checkbox', '.el-radio',
      '.dq-tab .tab', '.nav-item', '.menu-item',
    ];

    const seen = new Set();

    for (const sel of selectors) {
      const items = document.querySelectorAll(sel);
      for (const el of items) {
        if (!hidden && el.offsetParent === null) continue;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;

        const text = el.textContent.trim().slice(0, 80);
        const key = text || el.className;
        if (seen.has(key)) continue;
        seen.add(key);

        elements.push({
          tag: el.tagName,
          text,
          cls: el.className.slice(0, 60),
          rect: {
            x: Math.round(rect.x), y: Math.round(rect.y),
            w: Math.round(rect.width), h: Math.round(rect.height)
          },
          center: {
            x: Math.round(rect.x + rect.width / 2),
            y: Math.round(rect.y + rect.height / 2)
          },
          type: el.type || '',
          placeholder: el.placeholder || '',
          role: el.getAttribute('role') || '',
          visible: el.offsetParent !== null
        });
      }
    }

    return {
      url: location.href,
      title: document.title,
      viewport: { w: window.innerWidth, h: window.innerHeight },
      elements
    };
  }, includeHidden);

  return result;
}

// --- Generate element map structure for known website ---

export async function generateScript(page, siteName, { outputDir = './scripts' } = {}) {
  const map = await buildMap(page);

  // Generate boilerplate .mjs script
  const script = [
    `import { connect } from '../../core/browser.mjs'`,
    `import { findOne, findAll } from '../../core/dom.mjs'`,
    `import { click, type, hover } from '../../core/interact.mjs'`,
    `import { selectDropdown, readForm } from '../../core/form.mjs'`,
    ``,
    `const { browser, page } = await connect({ hostname: '${new URL(map.url).hostname}' })`,
    ``,
    `// --- Page Map: ${map.title} ---`,
    `// URL: ${map.url}`,
    `// Elements: ${map.elements.length}`,
    ``,
    `// --- Action Script ---`,
    ``,
  ];

  return { map, script: script.join('\n') };
}

// --- Save map to JSON ---

export function formatMapJson(map) {
  return JSON.stringify({
    url: map.url,
    title: map.title,
    builtAt: new Date().toISOString(),
    viewport: map.viewport,
    elements: map.elements
  }, null, 2);
}
