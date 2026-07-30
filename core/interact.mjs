import { sleep } from './browser.mjs';

// --- Click element at its center (CDP trusted click) ---

export async function click(page, el) {
  if (!el || !el.center) throw new Error('click: element missing center coordinates');
  await page.mouse.click(el.center.x, el.center.y);
  await sleep(500);
}

// --- Click by coordinates ---

export async function clickAt(page, x, y) {
  await page.mouse.click(Math.round(x), Math.round(y));
  await sleep(500);
}

// --- Hover element ---

export async function hover(page, el) {
  if (!el || !el.center) throw new Error('hover: element missing center coordinates');
  await page.mouse.move(el.center.x, el.center.y);
  await sleep(500);
}

// --- Type text into input ---

export async function type(page, el, value) {
  if (!el) throw new Error('type: element not found');
  await click(page, el);
  await page.keyboard.down('Control');
  await page.keyboard.press('A');
  await page.keyboard.up('Control');
  await page.keyboard.press('Delete');
  await page.keyboard.type(value, { delay: 10 });
}

// --- Type by JS evaluate (for Vue/React inputs) ---

export async function typeJS(page, selector, value) {
  await page.evaluate(({ sel, val }) => {
    const el = document.querySelector(sel);
    if (!el) return;
    el.value = val;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, { sel: selector, val: value });
}

// --- Type by label text ---

export async function typeByLabel(page, label, value) {
  await page.evaluate(({ lbl, val }) => {
    const items = document.querySelectorAll('.el-form-item');
    for (const item of items) {
      if (item.offsetParent === null) continue;
      const labelEl = item.querySelector('.el-form-item__label');
      const inp = item.querySelector('.el-input__inner, input');
      if (labelEl && labelEl.textContent.includes(lbl) && inp) {
        inp.value = val;
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      }
    }
    return false;
  }, { lbl: label, val: value });
}

// --- Scroll element into view ---

export async function scrollIntoView(page, el) {
  if (!el || !el.rect) throw new Error('scrollIntoView: element missing rect');
  await page.evaluate(({ x, y }) => {
    window.scrollTo(x - 200, y - 200);
  }, { x: el.rect.x, y: el.rect.y });
  await sleep(300);
}

// --- Scroll page ---

export async function scrollTo(page, x, y) {
  await page.evaluate(({ sx, sy }) => window.scrollTo(sx, sy), { sx: x, sy: y });
  await sleep(300);
}
