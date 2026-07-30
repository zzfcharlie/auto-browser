import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
import { buildMap } from '../core/map.mjs';
import { selectValue, setChecked, fillContentEditable } from '../core/form.mjs';
import { waitForSelector, waitForText, waitForUrl, waitForDomStable } from '../core/wait.mjs';
import { diffMaps } from '../core/diff.mjs';
import { ensureChrome } from '../core/launcher.mjs';

const ready = await ensureChrome();
const browser = await puppeteer.connect({ browserURL: ready.browserURL });
const page = await browser.newPage();
await page.setContent(`
  <input id="name" value="old">
  <select id="choice"><option value="a">Alpha</option><option value="b">Beta</option></select>
  <input id="flag" type="checkbox">
  <div id="editor" contenteditable="true"></div>
  <div id="later"></div>
  <iframe id="child"></iframe>
`);
await page.$eval('#child', frame => {
  frame.contentDocument.body.innerHTML = '<button id="frame-button">Frame action</button>';
});
await page.evaluate(() => {
  const host = document.createElement('div');
  host.id = 'shadow-host';
  host.attachShadow({ mode: 'open' }).innerHTML = '<button id="shadow-button">Shadow action</button>';
  document.body.appendChild(host);
});

const map = await buildMap(page);
assert.ok(map.elements.some(element => element.tag === 'INPUT'));
assert.ok(map.elements.some(element => element.ref.startsWith('f1-')));
assert.ok(map.elements.some(element => element.text === 'Shadow action'));
const shadowElement = map.elements.find(element => element.text === 'Shadow action');
assert.ok(shadowElement.locator.shadow);
const changed = await page.evaluate(() => {
  const button = document.querySelector('#shadow-host').shadowRoot.querySelector('#shadow-button');
  button.textContent = 'Changed action';
  const added = document.createElement('button');
  added.textContent = 'Added action';
  document.body.appendChild(added);
});
void changed;
const nextMap = await buildMap(page);
const mapDiff = diffMaps(map, nextMap);
assert.ok(mapDiff.added.length >= 1);
assert.ok(mapDiff.changed.length >= 1);
await selectValue(page, '#choice', 'Beta');
assert.equal(await page.$eval('#choice', element => element.value), 'b');
await setChecked(page, '#flag', true);
assert.equal(await page.$eval('#flag', element => element.checked), true);
await fillContentEditable(page, '#editor', 'edited');
assert.equal(await page.$eval('#editor', element => element.textContent), 'edited');
await waitForSelector(page, '#name');
await waitForText(page, 'edited');
await page.evaluate(() => { document.querySelector('#later').textContent = 'ready'; });
await waitForText(page, 'ready');
await page.goto('https://example.com', { waitUntil: 'domcontentloaded' });
await waitForUrl(page, 'example\\.com');
assert.equal(await waitForDomStable(page, { timeout: 3000, stableMs: 200 }), true);
await page.close();
await browser.disconnect();
console.log('smoke tests passed');
