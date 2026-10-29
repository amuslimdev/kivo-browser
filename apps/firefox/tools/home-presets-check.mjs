// Packaged Kivo, isolated temporary profile. Verifies the real bridge and UI without changing user data.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';
import { launch, sleep, tabShot } from './kivo-bidi.mjs';

const { values: args } = parseArgs({ options: { kivo: { type: 'string' }, out: { type: 'string' } } });
if (!args.kivo || !args.out) throw new Error('usage: home-presets-check.mjs --kivo <Kivo.exe> --out <directory>');
mkdirSync(args.out, { recursive: true });
const results = [];
const check = (name, ok) => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`); if (!ok) throw new Error(name); };
const theme = { version: 1, preset: 'clean', mode: 'light', accent: '#008c59', font: 'readex', corners: 'round', background: { kind: 'color', color: '#f5f4f0' }, sites: 'theme', start: { buddy: true, clock: true, fact: true, tiles: true }, home: { width: 1600, rowHeight: 50, columnGap: 20, rowGap: 20, padding: 32 } };
const widgets = [
  { id: 'search', type: 'search', x: 0, y: 0, w: 12, h: 1, settings: {} },
  { id: 'shortcuts', type: 'shortcuts', x: 0, y: 2, w: 12, h: 3, settings: {} },
  { id: 'note', type: 'note', x: 14, y: 0, w: 6, h: 5, settings: { title: 'Keep this', text: 'My original home', uiColor: '#e9e3f4' } },
];
const outputRoot = resolve(args.out);
const profile = mkdtempSync(join(outputRoot, 'profile-'));
if (!resolve(profile).startsWith(outputRoot + sep)) throw new Error('Unexpected test profile path');
const kivo = await launch(args.kivo, {}, { profile });
let code = 0;
try {
  await kivo.evaluate('window.resizeTo(1440, 1000); "ok"');
  let addon;
  for (let i = 0; i < 50 && !addon; i++) {
    addon = await kivo.evaluate('WebExtensionPolicy.getByID("home@kivo")?.getURL("") ?? null');
    if (!addon) await sleep(250);
  }
  check('built-in home extension loads', !!addon);
  await sleep(1500);
  let page = (await kivo.send('browsingContext.getTree', {})).contexts.findLast(context => context.url.startsWith(addon))?.context;
  const ui = expression => kivo.evaluateIn(page, expression);
  const request = (type, payload = {}) => ui(`browser.kivo.request(${JSON.stringify({ type, payload })}).then(value => JSON.stringify(value))`).then(JSON.parse);
  await request('theme.set', { theme });
  await request('widgets.set', { widgets });
  const library = await request('homePresets.list');
  check('existing home is preserved automatically', JSON.stringify(library.presets[0].widgets) === JSON.stringify(widgets));
  const created = await request('homePresets.save', { preset: { name: 'My desk', widgets, home: theme.home } });
  const personal = created.presets.find(preset => preset.name === 'My desk');
  check('personal preset saves through the native bridge', !!personal?.id);
  await request('homePresets.save', { preset: { ...personal, name: 'Daily home' } });
  check('personal preset rename persists', (await request('homePresets.list')).presets.some(preset => preset.name === 'Daily home'));
  await kivo.evaluate('(BrowserCommands?.openTab ?? BrowserOpenTab)(); "ok"');
  await sleep(2500);
  page = (await kivo.send('browsingContext.getTree', {})).contexts.findLast(context => context.url.startsWith(addon))?.context;
  await ui('document.querySelector(".presets-button").click(); "ok"');
  await sleep(700);
  check('gallery shows saved and built-in presets', await ui('document.querySelectorAll(".preset-card").length === 10'));
  await ui('[...document.querySelectorAll(".preset-card")].find(card => card.querySelector("h3").textContent.trim() === "Chrome style").querySelector("button").click(); "ok"');
  check('selecting a preset does not change the saved layout', JSON.stringify((await request('widgets.get')).widgets) === JSON.stringify(widgets));
  await ui('document.querySelector(".use-preset").click(); "ok"');
  await sleep(800);
  const chrome = (await request('widgets.get')).widgets;
  check('Chrome style applies search and most visited', chrome.length === 2 && chrome.some(widget => widget.type === 'shortcuts' && widget.settings.source === 'top'));
  check('preset switching keeps Appearance', (await request('theme.get')).theme.accent === theme.accent);
  check('previous home is persisted for recovery', (await request('homePresets.list')).presets.some(preset => preset.id === 'previous-home' && JSON.stringify(preset.widgets) === JSON.stringify(widgets)));
  await ui('document.querySelector(".undo-notice button").click(); "ok"');
  await sleep(800);
  check('Undo restores all widget settings and dimensions', JSON.stringify((await request('widgets.get')).widgets) === JSON.stringify(widgets) && (await request('theme.get')).theme.home.width === 1600);
  for (const width of [820, 390]) {
    await kivo.evaluate(`window.resizeTo(${width}, 1000); "ok"`);
    await sleep(200);
    check(`home toolbar fits a ${width}px window`, await ui('document.querySelector(".top").scrollWidth <= document.querySelector(".top").clientWidth + 1'));
  }
  await kivo.evaluate('window.resizeTo(1440, 1000); "ok"');
  await request('homePresets.delete', { id: personal.id });
  check('delete preserves the original home preset', (await request('homePresets.list')).presets.some(preset => preset.id === 'original-home'));
  await ui('document.querySelector(".appearance").click(); "ok"');
  await sleep(300);
  await ui('document.querySelectorAll(".drawer .tabs button")[2].click(); "ok"');
  await sleep(150);
  await ui('document.querySelectorAll(".mode-option")[1].click(); "ok"');
  await sleep(400);
  check('Appearance draft does not persist automatically', (await request('theme.get')).theme.mode === 'light');
  await ui('document.querySelector(".cancel-button").click(); "ok"');
  await sleep(200);
  check('Cancel restores the original page mode', await ui('document.documentElement.dataset.mode === "light" && !document.querySelector(".drawer")'));
  await ui('document.querySelector(".appearance").click(); "ok"');
  await sleep(200);
  await ui('document.querySelectorAll(".drawer .tabs button")[2].click(); "ok"');
  await sleep(150);
  await ui('document.querySelectorAll(".mode-option")[1].click(); document.querySelector(".save-button").click(); "ok"');
  await sleep(600);
  check('Appearance Save commits through the native bridge', (await request('theme.get')).theme.mode === 'dark');
  await ui('document.querySelector(".presets-button").click(); "ok"');
  await sleep(400);
  writeFileSync(join(args.out, 'home-presets-native.png'), await tabShot(kivo));
} catch (error) {
  code = 1;
  console.error(error);
} finally {
  await kivo.close();
}
if (!code) rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
writeFileSync(join(args.out, 'home-presets-check.json'), JSON.stringify(results, null, 2));
console.log(`${results.filter(result => result.ok).length}/${results.length} passed`);
process.exit(code);
