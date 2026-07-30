// --- DOM query utilities ---

export async function findOne(page, selector, { text, visible = true } = {}) {
  return page.evaluate(({ sel, txt, vis }) => {
    const items = document.querySelectorAll(sel);
    for (const el of items) {
      if (vis && el.offsetParent === null) continue;
      if (txt && !el.textContent.trim().includes(txt)) continue;
      const r = el.getBoundingClientRect();
      return {
        tag: el.tagName,
        text: el.textContent.trim().slice(0, 100),
        rect: {
          x: Math.round(r.x), y: Math.round(r.y),
          w: Math.round(r.width), h: Math.round(r.height)
        },
        center: {
          x: Math.round(r.x + r.width / 2),
          y: Math.round(r.y + r.height / 2)
        },
        visible: el.offsetParent !== null
      };
    }
    return null;
  }, { sel: selector, txt: text, vis: visible });
}

export async function findAll(page, selector, { visible = true } = {}) {
  return page.evaluate(({ sel, vis }) => {
    return Array.from(document.querySelectorAll(sel))
      .filter(el => !vis || el.offsetParent !== null)
      .map(el => {
        const r = el.getBoundingClientRect();
        return {
          tag: el.tagName,
          text: el.textContent.trim().slice(0, 100),
          cls: (typeof el.className === 'string' ? el.className : el.className?.baseVal || '').slice(0, 60),
          rect: {
            x: Math.round(r.x), y: Math.round(r.y),
            w: Math.round(r.width), h: Math.round(r.height)
          },
          center: {
            x: Math.round(r.x + r.width / 2),
            y: Math.round(r.y + r.height / 2)
          },
          visible: el.offsetParent !== null
        };
      });
  }, { sel: selector, vis: visible });
}

export async function findByText(page, text, { tag = '*', visible = true } = {}) {
  return page.evaluate(({ txt, tg, vis }) => {
    const all = document.querySelectorAll(tg);
    for (const el of all) {
      if (vis && el.offsetParent === null) continue;
      if (el.children.length > 0) continue;
      if (el.textContent.trim() === txt || el.textContent.trim().includes(txt)) {
        const r = el.getBoundingClientRect();
        return {
          tag: el.tagName,
          text: el.textContent.trim().slice(0, 100),
          rect: {
            x: Math.round(r.x), y: Math.round(r.y),
            w: Math.round(r.width), h: Math.round(r.height)
          },
          center: {
            x: Math.round(r.x + r.width / 2),
            y: Math.round(r.y + r.height / 2)
          }
        };
      }
    }
    return null;
  }, { txt: text, tg: tag, vis: visible });
}

export async function waitVisible(page, selector, { timeout = 5000 } = {}) {
  return page.waitForSelector(selector, { visible: true, timeout });
}
