export const adapter = {
  name: 'element-plus',
  
  selectors: {
    input: '.el-input__inner',
    dropdownTrigger: '.el-select__wrapper, .el-input__wrapper',
    dropdownOption: '.el-select-dropdown__item',
    formLabel: '.el-form-item__label',
    button: '.el-button',
    tab: '.el-tabs__item'
  },

  async fillInput(page, label, value) {
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
  },

  async selectDropdown(page, label, targetValue) {
    const triggerBox = await page.evaluate(({ lbl }) => {
      const items = document.querySelectorAll('.el-form-item');
      for (const item of items) {
        if (item.offsetParent === null) continue;
        const labelEl = item.querySelector('.el-form-item__label');
        if (labelEl && labelEl.textContent.includes(lbl)) {
          item.scrollIntoView({ block: 'center', behavior: 'instant' });
          const trigger = item.querySelector('.el-select__wrapper, .el-input__wrapper');
          if (trigger) {
            const r = trigger.getBoundingClientRect();
            return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
          }
        }
      }
      return null;
    }, { lbl: label });

    if (!triggerBox) return false;
    await page.mouse.click(triggerBox.x, triggerBox.y);
    await new Promise(r => setTimeout(r, 1200));

    const clicked = await page.evaluate((tv) => {
      const items = document.querySelectorAll('.el-select-dropdown__item');
      for (const i of items) {
        if (i.offsetParent !== null && i.textContent.trim() === tv) {
          const r = i.getBoundingClientRect();
          if (r.x > 0 && r.y > 0) {
            return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
          }
        }
      }
      for (const i of items) {
        if (i.offsetParent !== null && i.textContent.trim() === tv) {
          i.click();
          return { js: true };
        }
      }
      return null;
    }, targetValue);

    if (!clicked) return false;
    if (clicked.js) {
      await new Promise(r => setTimeout(r, 500));
    } else {
      await page.mouse.click(clicked.x, clicked.y);
      await new Promise(r => setTimeout(r, 500));
    }
    return true;
  },

  async switchTab(page, tabName) {
    const clicked = await page.evaluate((t) => {
      const all = document.querySelectorAll('*');
      for (const el of all) {
        if (el.offsetParent !== null && el.textContent.trim() === t && el.children.length === 0) {
          el.click();
          return true;
        }
      }
      return false;
    }, tabName);
    if (!clicked) return false;
    await new Promise(r => setTimeout(r, 1000));
    return true;
  },

  async readForm(page) {
    return page.evaluate(() => {
      const result = [];
      document.querySelectorAll('.el-form-item').forEach(item => {
        if (item.offsetParent === null) return;
        const label = item.querySelector('.el-form-item__label');
        const inp = item.querySelector('.el-input__inner');
        const ta = item.querySelector('textarea');
        const lbl = label ? label.textContent.trim() : '';
        const val = inp ? inp.value : (ta ? ta.value : '');
        if (lbl && lbl !== '封面图') result.push({ label: lbl, value: val });
      });
      return result;
    });
  }
};
