#!/usr/bin/env node
// صفحة البداية (G2) على Kivo، headless: التاب الجديد بيفتح Kivo Home، والـ bridge بيرد ويتحقق، وتغيير الثيم من الصفحة
// بيلوّن النافذة. والصور: الترحيب، وصفحة البداية بعد اختيار عالم، والنافذة.
//
// node apps/firefox/tools/home-check.mjs --kivo <Kivo.exe أو obj-kivo\dist\bin\firefox.exe> --out <فولدر>
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { chromeShot, launch, sleep, tabShot } from './kivo-bidi.mjs';

const { values: args } = parseArgs({
  options: { kivo: { type: 'string' }, out: { type: 'string' }, preset: { type: 'string', default: 'candy' } },
});
if (!args.kivo || !args.out) {
  console.error('usage: home-check.mjs --kivo <exe> --out <dir> [--preset candy]');
  process.exit(2);
}
mkdirSync(args.out, { recursive: true });

// نفس شكل fromPreset في web/ui/src/theme/presets.ts، عشان theme.set ياخد ثيم كامل زي اللي الصفحة بتبعته.
const PRESETS = {
  candy: { mode: 'light', accent: '#ff4f9a', font: 'baloo', corners: 'bubbly', background: { kind: 'scene', scene: 'candy' } },
  space: { mode: 'dark', accent: '#8b6cff', font: 'alexandria', corners: 'round', background: { kind: 'scene', scene: 'space' } },
  ocean: { mode: 'dark', accent: '#14c2d6', font: 'rubik', corners: 'bubbly', background: { kind: 'scene', scene: 'ocean' } },
  clean: { mode: 'light', accent: '#7964bc', font: 'readex', corners: 'round', background: { kind: 'color', color: '#f5f4f0' } },
};
const preset = PRESETS[args.preset];
if (!preset) throw new Error(`unknown preset ${args.preset}`);
const theme = { version: 1, preset: args.preset, ...preset, start: { buddy: true, clock: true, fact: true, tiles: true }, sites: 'theme' };

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`);
};

const kivo = await launch(args.kivo);
let code = 0;
try {
  await kivo.evaluate(`window.resizeTo(1280, 860); "ok"`);
  // الـ extension المدمجة بتشتغل بعد ما المتصفح يفتح بشوية.
  let addon = null;
  for (let i = 0; i < 40 && !addon; i++) {
    addon = await kivo.evaluate(`WebExtensionPolicy.getByID("home@kivo")?.getURL("") ?? null`);
    if (!addon) await sleep(250);
  }
  check('Kivo Home is installed and running', addon, addon);

  // هوية Kivo (G3): مش Firefox، والبيانات في %APPDATA%\Kivo، ومن غير crash reports، و policies بتاعة Firefox
  // اللي في الـ registry (Mozilla\Firefox) مابتتطبقش.
  const identity = JSON.parse(await kivo.evaluate(`JSON.stringify({
    name: Services.appinfo.name,
    vendor: Services.appinfo.vendor,
    userData: Services.dirsvc.get("UAppData", Ci.nsIFile).path,
    crashReporter: Services.appinfo.crashReporterEnabled,
    firefoxPolicies: ["DisablePrivateBrowsing", "BlockAboutConfig"].filter(p => p in (Services.policies.getActivePolicies() ?? {})),
    engine: Services.dirsvc.get("XREExeF", Ci.nsIFile).leafName,
  })`));
  if (identity.engine.toLowerCase() === 'kivo-browser.exe') {
    check('identity: Kivo, not Firefox', identity.name === 'Kivo' && identity.vendor === 'Kivo', identity);
    check('identity: data in %APPDATA%\\Kivo', /\\AppData\\Roaming\\Kivo$/i.test(identity.userData), identity.userData);
    check('identity: no crash reports', identity.crashReporter === false, identity.crashReporter);
    check("identity: Firefox's registry policies do not apply", identity.firefoxPolicies.length === 0, identity.firefoxPolicies);
  }
  check('Kivo Home has its fixed address', addon === 'moz-extension://9d4b610d-d083-4703-8d31-c7178f7ba2e8/', addon);
  await sleep(1500);
  const startup = JSON.parse(await kivo.evaluate(`JSON.stringify({
    url: gBrowser.tabs[0].linkedBrowser.currentURI.spec,
    home: document.documentElement.hasAttribute("kivo-home"),
    identity: getComputedStyle(gURLBar.querySelector(".identity-box") ?? document.getElementById("identity-box")).display,
  })`));
  check('first window opens Kivo Home', startup.url === `${addon}index.html`, startup.url);
  check('no "Extension (Kivo Home)" in the address bar', startup.home && startup.identity === 'none', startup);

  await kivo.evaluate(`(BrowserCommands?.openTab ?? BrowserOpenTab)(); "ok"`);
  await sleep(2500);
  const tab = JSON.parse(await kivo.evaluate(`JSON.stringify({
    url: gBrowser.selectedBrowser.currentURI.spec,
    urlbar: gURLBar.value,
    urlbarFocused: gURLBar.focused,
    homepage: HomePage.get(),
  })`));
  check('new tab opens Kivo Home', tab.url.startsWith(addon ?? '-') && tab.url.endsWith('index.html'), tab.url);
  check('home page is Kivo Home', tab.homepage.startsWith(addon ?? '-'), tab.homepage);
  check('address bar stays empty on the new tab', tab.urlbar === '', tab.urlbar);

  const contexts = (await kivo.send('browsingContext.getTree', {})).contexts;
  const page = contexts.findLast((c) => c.url.startsWith("moz-extension://"))?.context;
  check('start page context found', page, contexts.map((c) => c.url));
  const inPage = (expression) => kivo.evaluateIn(page, expression);
  const bridge = (type, payload = {}) =>
    inPage(`browser.kivo.request(${JSON.stringify({ type, payload })}).then(r => JSON.stringify({ ok: true, r }), e => JSON.stringify({ ok: false, e: e.message }))`).then(JSON.parse);

  await sleep(1500);
  const bridgeState = await inPage('document.documentElement.dataset.bridge ?? "(none)"');
  check('page reached the bridge', bridgeState === 'ok', bridgeState);
  writeFileSync(join(args.out, 'home-welcome.png'), await tabShot(kivo));

  const first = await bridge('theme.get');
  check('theme.get: no theme yet (welcome)', first.ok && first.r.theme === null && ['light', 'dark'].includes(first.r.system), first);

  const bad = await bridge('theme.set', { theme: { ...theme, css: 'body{}' } });
  check('theme.set rejects unknown fields', !bad.ok && /unknown field css/.test(bad.e), bad.e);
  const badColor = await bridge('theme.set', { theme: { ...theme, accent: 'red' } });
  check('theme.set rejects a non-hex accent', !badColor.ok, badColor.e);

  const set = await bridge('theme.set', { theme });
  check('theme.set saves the theme', set.ok && set.r.theme.accent === preset.accent, set.ok ? set.r.theme.preset : set.e);
  await sleep(500);
  const chrome = JSON.parse(await kivo.evaluate(`JSON.stringify({
    mode: document.documentElement.getAttribute("kivo-mode"),
    corners: document.documentElement.getAttribute("kivo-corners"),
    tabs: document.documentElement.style.getPropertyValue("--kivo-tabs"),
  })`));
  check('window took the theme at once', chrome.mode === preset.mode && chrome.corners === preset.corners, chrome);

  // الهيدر الثابت (header): لون hex بس، وبيلوّن النافذة بداله هو، وبعدين نرجع للعالم.
  const badHeader = await bridge('theme.set', { theme: { ...theme, header: 'navy' } });
  check('theme.set rejects a non-hex top bar', !badHeader.ok, badHeader.e);
  const fixed = await bridge('theme.set', { theme: { ...theme, header: '#1E293B' } });
  await sleep(300);
  const fixedTabs = (await kivo.evaluate(`document.documentElement.style.getPropertyValue("--kivo-tabs")`)).trim();
  check('a fixed top bar is saved and paints the window', fixed.ok && fixed.r.theme.header === '#1e293b' && fixedTabs === '#1e293b', [fixed.r?.theme?.header ?? fixed.e, fixedTabs]);
  const unfixed = await bridge('theme.set', { theme });
  await sleep(300);
  const worldTabs = (await kivo.evaluate(`document.documentElement.style.getPropertyValue("--kivo-tabs")`)).trim();
  check('without it the top bar follows the world again', unfixed.ok && unfixed.r.theme.header === undefined && worldTabs === chrome.tabs.trim(), [worldTabs, chrome.tabs]);

  const tiles = await bridge('tiles.set', {
    tiles: [
      { title: 'Wikipedia', url: 'https://www.wikipedia.org/' },
      { title: 'Bad', url: 'javascript:alert(1)' },
      { title: '', url: 'https://example.com/', emoji: '📚' },
    ],
  });
  check('tiles.set keeps http(s) only', tiles.ok && tiles.r.tiles.length === 2 && tiles.r.tiles[1].title === 'example.com', tiles.r?.tiles);
  const tilesBack = await bridge('tiles.get');
  check('tiles.get returns the saved tiles', tilesBack.ok && tilesBack.r.tiles.length === 2);

  const widgets = await bridge('widgets.set', {
    widgets: [
      { id: 'w1', type: 'clock', x: 18, y: 0, w: 6, h: 5, settings: { city: 'makkah', face: 'analog', html: '<b>' } },
      { id: 'w2', type: 'iframe', x: 0, y: 0, w: 3, h: 3, settings: {} },
      { id: 'w3', type: 'note', x: 22, y: 0, w: 6, h: 3, settings: {} },
      { id: 'w1', type: 'fact', x: 0, y: 6, w: 3, h: 3, settings: {} },
    ],
  });
  check(
    'widgets.set drops unknown types, bad places, repeats, and fields',
    widgets.ok && widgets.r.widgets.length === 1 && widgets.r.widgets[0].settings.html === undefined && widgets.r.widgets[0].settings.city === 'makkah',
    widgets.r?.widgets,
  );

  const top = await bridge('sites.top', { limit: 8 });
  check('sites.top answers', top.ok && Array.isArray(top.r.items), top.r?.items?.length);
  const me = await bridge('me.get', { path: 'avatar.png?v=1' });
  check('me.get answers (no avatar yet)', me.ok && me.r.url === null);
  const nope = await bridge('me.get', { path: '../prefs.js' });
  check('me.get only knows its own files', nope.ok && nope.r.url === null);
  const unknown = await bridge('vault.unlock');
  check('unknown messages are refused', !unknown.ok, unknown.e);

  // الصفحة بتقرا الثيم وهي بتفتح، فتاب جديد بيبان بالعالم الجديد.
  await kivo.evaluate(`gBrowser.removeCurrentTab(); (BrowserCommands?.openTab ?? BrowserOpenTab)(); "ok"`);
  await sleep(3500);
  const page2 = (await kivo.send("browsingContext.getTree", {})).contexts.findLast((c) => c.url.startsWith("moz-extension://"))?.context;
  writeFileSync(join(args.out, `home-${args.preset}.png`), await tabShot(kivo));
  writeFileSync(join(args.out, `window-${args.preset}.png`), await chromeShot(kivo, 1280, 90));

  // Customize، تاب Colors: الهيدر لوحده والمواقع لوحدها.
  await kivo.evaluateIn(page2, `location.hash = "customize"; "ok"`);
  await sleep(1200);
  await kivo.evaluateIn(page2, `[...document.querySelectorAll("button")].find(b => b.textContent.includes("Colors"))?.click(); "ok"`);
  await sleep(800);
  await kivo.evaluateIn(page2, `[...document.querySelectorAll("h3")].find(h => h.textContent === "Top bar")?.scrollIntoView({ block: "start" }); "ok"`);
  await sleep(400);
  writeFileSync(join(args.out, 'customize-colors.png'), await tabShot(kivo));

  const navigated = await kivo.evaluateIn(page2, `browser.kivo.request({ type: "tab.navigate", payload: { text: "javascript:alert(1)" } }).then(() => "sent")`);
  await sleep(1000);
  const afterBad = await kivo.evaluate('gBrowser.selectedBrowser.currentURI.spec');
  check('tab.navigate refuses javascript:', navigated === 'sent' && afterBad.startsWith('moz-extension://'), afterBad);
  await kivo.evaluateIn(page2, `browser.kivo.request({ type: "tab.navigate", payload: { text: "example.com" } }).then(() => "sent")`);
  await sleep(4000);
  const afterGood = await kivo.evaluate('gBrowser.selectedBrowser.currentURI.spec');
  check('tab.navigate opens a typed address', /^https?:\/\/(www\.)?example\.com\//.test(afterGood), afterGood);
  const siteIdentity = await kivo.evaluate(`getComputedStyle(gURLBar.querySelector(".identity-box") ?? document.getElementById("identity-box")).display`);
  check('sites keep the address bar identity box', siteIdentity !== 'none', siteIdentity);
} catch (e) {
  console.error(e);
  code = 1;
} finally {
  await kivo.close();
}
writeFileSync(join(args.out, 'home-check.json'), JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(code || (failed ? 1 : 0));
