import { findAll, findByText } from './dom.mjs';

// --- Build page map: extract all interactive elements ---

export async function buildMap(page, { includeHidden = false, includeFrames = true } = {}) {
  const result = await page.evaluate((hidden) => {
    const elements = [];

    // Collect all interactive elements
    const selectors = [
      'button', 'a', 'input', 'textarea', 'select',
      '[role="button"]', '[role="link"]', '[role="tab"]',
      '[role="menuitem"]', '[role="checkbox"]', '[role="radio"]',
      '[role="combobox"]', '[role="listbox"]', '[role="switch"]',
      '[role="slider"]', '[role="textbox"]', '[role="searchbox"]',
      '[contenteditable="true"]', '[contenteditable=""]', '[draggable="true"]',
      '.el-button', '.el-select', '.el-input', '.el-textarea',
      '.el-tabs__item', '.el-dropdown-menu__item',
      '.el-checkbox', '.el-radio', '.el-switch', '.el-slider', '.el-upload',
      '.el-icon', '[class*="circle-plus"]', '[class*="circle-remove"]',
      '[class*="more-icon"]',
      '.ant-btn', '.ant-select', '.ant-input', '.ant-checkbox',
      '.ant-radio', '.ant-switch', '.ant-slider', '.ant-upload', '.ant-tabs-tab',
      '.dq-tab .tab', '.nav-item', '.menu-item',
    ];

    const seen = new Set();

    function allElements(root = document) {
      const result = [];
      const visit = node => {
        for (const el of node.querySelectorAll('*')) {
          result.push(el);
          if (el.shadowRoot) visit(el.shadowRoot);
        }
      };
      visit(root);
      return result;
    }

    function cssPath(el) {
      if (el.id) return `#${CSS.escape(el.id)}`;
      const parts = [];
      let node = el;
      while (node && node.nodeType === Node.ELEMENT_NODE && node !== document.body) {
        let part = node.tagName.toLowerCase();
        if (node.classList.length) {
          part += [...node.classList].slice(0, 2).map(c => `.${CSS.escape(c)}`).join('');
        }
        const siblings = node.parentElement
          ? [...node.parentElement.children].filter(s => s.tagName === node.tagName)
          : [];
        if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(node) + 1})`;
        parts.unshift(part);
        node = node.parentElement;
      }
      return parts.join(' > ');
    }

    function xpath(el) {
      const parts = [];
      let node = el;
      while (node && node.nodeType === Node.ELEMENT_NODE) {
        let index = 1;
        for (let sibling = node.previousElementSibling; sibling; sibling = sibling.previousElementSibling) {
          if (sibling.tagName === node.tagName) index++;
        }
        parts.unshift(`${node.tagName.toLowerCase()}[${index}]`);
        node = node.parentElement;
      }
      return `/${parts.join('/')}`;
    }

    // ----------------------------------------------------------
    // Classify what an element IS and what you can DO with it.
    // kind    → semantic type (link, text, dropdown, checkbox, ...)
    // actions → concrete auto-browser commands that apply
    // ----------------------------------------------------------
    const TEXT_INPUT_TYPES = [
      'text', 'search', 'email', 'url', 'tel', 'password',
      'number', 'date', 'datetime-local', 'month', 'week', 'time'
    ];

    function classify(el) {
      const tag = el.tagName;
      const role = (el.getAttribute('role') || '').toLowerCase();
      const type = (el.getAttribute('type') || el.type || '').toLowerCase();
      const cls = typeof el.className === 'string' ? el.className : '';
      const editable = el.isContentEditable;
      const draggable = el.getAttribute('draggable') === 'true';

      // Native form controls first — most reliable signal.
      if (tag === 'SELECT') {
        return { kind: 'select', actions: ['select', 'click'] };
      }
      if (tag === 'TEXTAREA') {
        return { kind: 'textarea', actions: ['fill', 'type', 'click'] };
      }
      if (tag === 'INPUT') {
        if (type === 'checkbox') return { kind: 'checkbox', actions: ['check', 'uncheck', 'click'] };
        if (type === 'radio') return { kind: 'radio', actions: ['check', 'click'] };
        if (type === 'file') return { kind: 'file', actions: ['upload'] };
        if (type === 'range') return { kind: 'slider', actions: ['drag', 'fill'] };
        if (type === 'color') return { kind: 'color', actions: ['fill'] };
        if (['submit', 'button', 'reset', 'image'].includes(type)) {
          return { kind: 'button', actions: ['click'] };
        }
        if (TEXT_INPUT_TYPES.includes(type) || !type) {
          return { kind: 'text', actions: ['fill', 'type', 'click'] };
        }
        return { kind: 'input', actions: ['fill', 'click'] };
      }
      if (editable) {
        return { kind: 'contenteditable', actions: ['contenteditable', 'click'] };
      }

      // ARIA roles — authoritative when present.
      const roleMap = {
        button: { kind: 'button', actions: ['click'] },
        link: { kind: 'link', actions: ['click', 'open'] },
        tab: { kind: 'tab', actions: ['click'] },
        menuitem: { kind: 'menuitem', actions: ['click'] },
        checkbox: { kind: 'checkbox', actions: ['click'] },
        radio: { kind: 'radio', actions: ['click'] },
        combobox: { kind: 'dropdown', actions: ['click', 'select'] },
        listbox: { kind: 'dropdown', actions: ['click', 'select'] },
        option: { kind: 'option', actions: ['click'] },
        switch: { kind: 'toggle', actions: ['click'] },
        slider: { kind: 'slider', actions: ['drag'] },
        textbox: { kind: 'text', actions: ['fill', 'type', 'click'] },
        searchbox: { kind: 'text', actions: ['fill', 'type', 'click'] }
      };
      if (roleMap[role]) return roleMap[role];

      // Anchors: a real href means it navigates.
      if (tag === 'A') {
        const href = el.getAttribute('href') || '';
        if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
          return { kind: 'link', actions: ['click', 'open'] };
        }
        return { kind: 'button', actions: ['click'] };
      }
      if (tag === 'BUTTON') return { kind: 'button', actions: ['click'] };
      if (tag === 'LABEL') return { kind: 'label', actions: ['click'] };

      // UI-framework component classes (Element Plus / Ant Design / MUI).
      const has = frag => cls.includes(frag);
      if (has('el-select') || has('ant-select') || has('MuiSelect')) {
        return { kind: 'dropdown', actions: ['click', 'select'] };
      }
      if (has('el-checkbox') || has('ant-checkbox')) {
        return { kind: 'checkbox', actions: ['click'] };
      }
      if (has('el-radio') || has('ant-radio')) {
        return { kind: 'radio', actions: ['click'] };
      }
      if (has('el-switch') || has('ant-switch') || has('MuiSwitch')) {
        return { kind: 'toggle', actions: ['click'] };
      }
      if (has('el-slider') || has('ant-slider') || has('MuiSlider')) {
        return { kind: 'slider', actions: ['drag'] };
      }
      if (has('el-tabs__item') || has('ant-tabs-tab') || has('dq-tab')) {
        return { kind: 'tab', actions: ['click'] };
      }
      if (has('el-textarea')) {
        return { kind: 'textarea', actions: ['fill', 'type', 'click'] };
      }
      if (has('el-input') || has('ant-input')) {
        return { kind: 'text', actions: ['fill', 'type', 'click'] };
      }
      if (has('el-button') || has('ant-btn') || has('MuiButton')) {
        return { kind: 'button', actions: ['click'] };
      }
      if (has('dropdown-menu__item') || has('menu-item') || has('nav-item')) {
        return { kind: 'menuitem', actions: ['click'] };
      }
      if (has('el-upload') || has('ant-upload')) {
        return { kind: 'file', actions: ['upload', 'click'] };
      }
      if (has('el-icon') || has('anticon')) {
        return { kind: 'icon', actions: ['click', 'hover'] };
      }

      if (draggable) return { kind: 'draggable', actions: ['drag', 'click'] };

      return { kind: 'clickable', actions: ['click'] };
    }

    // Extra state worth reporting for form controls.
    function controlState(el) {
      const out = {};
      const tag = el.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
        out.value = String(el.value ?? '').slice(0, 120);
      }
      if (el.type === 'checkbox' || el.type === 'radio') {
        out.checked = Boolean(el.checked);
      }
      if (tag === 'SELECT') {
        out.options = [...el.options].slice(0, 30).map(o => ({
          value: o.value,
          label: o.textContent.trim().slice(0, 60),
          selected: o.selected
        }));
      }
      if (el.required) out.required = true;
      if (el.readOnly) out.readonly = true;
      if (el.maxLength && el.maxLength > 0) out.maxLength = el.maxLength;
      return out;
    }


    for (const sel of selectors) {
      const items = allElements().filter(el => el.matches(sel));
      for (const el of items) {
        if (!hidden && el.offsetParent === null) continue;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;

        const text = el.textContent.trim().slice(0, 80);
        const parentText = el.parentElement?.textContent.trim().slice(0, 120) || '';
        const key = el;
        if (seen.has(key)) continue;
        seen.add(key);

        const root = el.getRootNode();
        const shadow = root instanceof ShadowRoot
          ? { hostSelector: cssPath(root.host), selector: cssPath(el) }
          : null;

        const { kind, actions } = classify(el);
        const rawHref = el.getAttribute('href') || '';

        elements.push({
          ref: `e${elements.length + 1}`,
          tag: el.tagName,
          kind,
          actions,
          text,
          cls: (typeof el.className === 'string' ? el.className : el.className?.baseVal || '').slice(0, 60),
          name: el.getAttribute('aria-label') || el.getAttribute('title') || text,
          parentText,
          // Resolved absolute URL (el.href) plus the raw attribute, so
          // link harvesting no longer requires a click-through.
          href: el.href || '',
          rawHref,
          src: el.getAttribute('src') || '',
          elId: el.id || '',
          locator: { selector: cssPath(el), xpath: xpath(el), shadow },
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
          disabled: Boolean(el.disabled || el.getAttribute('aria-disabled') === 'true'),
          visible: el.offsetParent !== null,
          ...controlState(el)
        });
      }
    }

    // Roll up how many of each kind exist, so an agent can see the
    // shape of the page at a glance without scanning every element.
    const kinds = {};
    for (const el of elements) kinds[el.kind] = (kinds[el.kind] || 0) + 1;

    return {
      url: location.href,
      title: document.title,
      viewport: { w: window.innerWidth, h: window.innerHeight },
      kinds,
      elements
    };
  }, includeHidden);

  if (includeFrames && typeof page.frames === 'function') {
    const frames = page.frames().filter(frame => frame !== page.mainFrame?.());
    for (const frame of frames) {
      try {
        const frameMap = await buildMap(frame, { includeHidden, includeFrames: false });
        for (const element of frameMap.elements) {
          element.ref = `f${frames.indexOf(frame) + 1}-${element.ref}`;
          element.frameUrl = frame.url();
          result.elements.push(element);
        }
      } catch {
        // Cross-origin or detached frames can disappear during a snapshot.
      }
    }
    // Recompute the kind rollup now that frame elements are merged in.
    result.kinds = {};
    for (const el of result.elements) {
      result.kinds[el.kind] = (result.kinds[el.kind] || 0) + 1;
    }
  }
  return result;
}

// ------------------------------------------------------------
// Query a built map by text / kind / action. Powers `find`.
// ------------------------------------------------------------
export function queryMap(map, { text, kind, action, visibleOnly = true, limit = 50 } = {}) {
  const needle = (text || '').toLowerCase();
  return map.elements
    .filter(el => (visibleOnly ? el.visible !== false : true))
    .filter(el => (kind ? el.kind === kind : true))
    .filter(el => (action ? (el.actions || []).includes(action) : true))
    .filter(el => {
      if (!needle) return true;
      const haystack = [el.text, el.name, el.placeholder, el.value, el.elId]
        .filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(needle);
    })
    .slice(0, limit);
}

// --- Generate element map structure for known website ---


// --- Inject visual overlay with numbered boxes ---

export async function injectOverlay(page, elements) {
  await page.evaluate((els) => {
    const overlay = document.createElement('div');
    overlay.id = '__ab_overlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:2147483647;';
    document.body.appendChild(overlay);

    const colors = ['#FF6B6B','#4ECDC4','#45B7D1','#96CEB4','#FFEAA7','#DDA0DD','#98FB98','#FFD700'];

    els.forEach((el, i) => {
      if (!el.rect) return;
      const color = colors[i % colors.length];
      const { x, y, w, h } = el.rect;

      const box = document.createElement('div');
      box.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px;border:2px solid ${color};box-sizing:border-box;`;
      overlay.appendChild(box);

      const label = document.createElement('div');
      label.textContent = `${i + 1}`;
      label.style.cssText = `position:absolute;left:${x - 1}px;top:${y - 18}px;background:${color};color:#fff;font-size:11px;padding:1px 4px;border-radius:2px;font-family:monospace;white-space:nowrap;`;
      overlay.appendChild(label);
    });
  }, elements);
}

export async function removeOverlay(page) {
  await page.evaluate(() => {
    const el = document.getElementById('__ab_overlay');
    if (el) el.remove();
  });
}

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
