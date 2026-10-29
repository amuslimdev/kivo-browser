#!/usr/bin/env node
// زي Chrome (KivoShell.sys.mjs و findbar.css)، headless: Ctrl+Shift+N بيفتح نافذة خاصة و Ctrl+Shift+P بقى للمواقع،
// والبحث في الصفحة (Ctrl+F) صندوق صغير فوق في الركن فوق الصفحة من غير ما يزقّها، بالعدد "1/4" و "0/0"، واختيارات
// Firefox في صف بيفتح من زرار "⋯" (بكليك ماوس بجد، و Match Case بيغيّر النتايج، والنقطة، و Kivo بيفتكر الصف).
// الصفحة من سيرفر محلي. وصور فاتح وغامق وبالاختيارات.
//
// node apps/firefox/tools/find-check.mjs --kivo <Kivo.exe أو obj-kivo\dist\bin\firefox.exe> --out <فولدر>
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { WINDOW_SHOT, launch, sleep } from './kivo-bidi.mjs';

const { values: args } = parseArgs({ options: { kivo: { type: 'string' }, out: { type: 'string' } } });
if (!args.kivo || !args.out) {
  console.error('usage: find-check.mjs --kivo <Kivo.exe> --out <dir>');
  process.exit(2);
}
mkdirSync(args.out, { recursive: true });

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`);
};

const PAGE = `<!doctype html><meta charset="utf-8"><title>Kivo find</title>
<style>body{margin:0;font:16px/1.6 system-ui}header{background:#1f6feb;color:#fff;padding:14px 24px;display:flex;justify-content:space-between}main{padding:24px;max-width:760px}</style>
<header><b>Kivo test page</b><span>Sign in</span></header>
<main><h1>Kites over the river</h1>
<p>Every spring the children fly a kite by the river. The kite is red, and the wind is strong.</p>
<p>Some days the kite climbs so high that nobody can see its tail. Then they pull the string and wait.</p>
${'<p>Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.</p>'.repeat(8)}
</main>`;
const server = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(PAGE);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;

// مفاتيح بجد (nsITextInputProcessor زي EventUtils.synthesizeKey)، مش events من JavaScript بيتجاهلها Firefox.
const PRESS = `(win, key, code, keyCode, mods) => {
  const tip = Cc["@mozilla.org/text-input-processor;1"].createInstance(Ci.nsITextInputProcessor);
  if (!tip.beginInputTransactionForTests(win)) throw new Error("no input transaction");
  const event = (key, code, keyCode) => new win.KeyboardEvent("", { key, code, keyCode });
  const keys = { ctrl: ["Control", "ControlLeft", 17], shift: ["Shift", "ShiftLeft", 16] };
  for (const mod of mods) tip.keydown(event(...keys[mod]));
  tip.keydown(event(key, code, keyCode));
  tip.keyup(event(key, code, keyCode));
  for (const mod of [...mods].reverse()) tip.keyup(event(...keys[mod]));
}`;

const PRIVATE_WINDOWS = `[...Services.wm.getEnumerator("navigator:browser")].filter(w => PrivateBrowsingUtils.isWindowPrivate(w)).length`;

let code = 0;
const kivo = await launch(args.kivo);
const json = async (js) => JSON.parse(await kivo.evaluate(js));
try {
  await kivo.evaluate(`window.resizeTo(1280, 800); "ok"`);
  await sleep(2500);

  // ---------- Ctrl+Shift+N ----------
  const keys = await json(`(() => {
    const { ShortcutUtils } = ChromeUtils.importESModule("resource://gre/modules/ShortcutUtils.sys.mjs");
    const attrs = id => { const k = document.getElementById(id); return Object.fromEntries([...k.attributes].map(a => [a.name, a.value])); };
    return JSON.stringify({
      privateKey: attrs("key_privatebrowsing"),
      shown: ShortcutUtils.prettifyShortcut(document.getElementById("key_privatebrowsing")),
      reopenWindow: attrs("key_undoCloseWindow"),
    });
  })()`);
  check('the private window shortcut reads Ctrl+Shift+N', keys.shown === 'Ctrl+Shift+N' && !keys.privateKey['data-l10n-id'], keys);
  check('"Reopen closed window" is off Ctrl+Shift+N (Ctrl+Shift+T reopens it)', !keys.reopenWindow.key && !keys.reopenWindow['data-l10n-id'], keys.reopenWindow);

  await kivo.evaluate(`gBrowser.selectedTab = gBrowser.addTrustedTab(${JSON.stringify(url)}); "ok"`);
  await sleep(2500);
  const before = Number(await kivo.evaluate(PRIVATE_WINDOWS));
  await kivo.evaluate(`(${PRESS})(window, "N", "KeyN", 78, ["ctrl", "shift"]); "ok"`);
  await sleep(2500);
  const afterN = Number(await kivo.evaluate(PRIVATE_WINDOWS));
  check('Ctrl+Shift+N opens a private window', afterN === before + 1, { before, afterN });
  await kivo.evaluate(`[...Services.wm.getEnumerator("navigator:browser")].filter(w => PrivateBrowsingUtils.isWindowPrivate(w)).forEach(w => w.close()); "ok"`);
  await sleep(1500);
  await kivo.evaluate(`window.focus(); gBrowser.selectedBrowser.focus(); "ok"`);
  await kivo.evaluate(`(${PRESS})(window, "P", "KeyP", 80, ["ctrl", "shift"]); "ok"`);
  await sleep(2500);
  const afterP = Number(await kivo.evaluate(PRIVATE_WINDOWS));
  check('Ctrl+Shift+P no longer opens one (it goes to the page)', afterP === 0, { afterP });

  // ---------- Ctrl+F ----------
  const pageBox = await json(`JSON.stringify(gBrowser.selectedBrowser.getBoundingClientRect())`);
  await kivo.evaluate(`(${PRESS})(window, "f", "KeyF", 70, ["ctrl"]); "ok"`);
  await sleep(1200);
  // الكتابة نفسها حرف حرف في خانة البحث.
  await kivo.evaluate(`(async () => {
    for (const ch of "kite") { (${PRESS})(window, ch, "Key" + ch.toUpperCase(), ch.toUpperCase().charCodeAt(0), []); await new Promise(r => setTimeout(r, 120)); }
    return "ok";
  })()`);
  await sleep(1500);
  const LAYOUT = `(() => {
    const bar = gFindBar;
    const box = r => { const b = r.getBoundingClientRect(); return { left: Math.round(b.left), top: Math.round(b.top), right: Math.round(b.right), bottom: Math.round(b.bottom), width: Math.round(b.width), height: Math.round(b.height) }; };
    const style = el => getComputedStyle(el);
    const status = bar.querySelector(".findbar-find-status");
    return JSON.stringify({
      hidden: bar.hidden,
      focused: document.activeElement === bar._findField,
      value: bar._findField.value,
      bar: box(bar),
      page: box(gBrowser.selectedBrowser),
      visibility: style(bar).visibility,
      radius: style(bar).borderTopLeftRadius,
      matches: { text: bar._foundMatches.getAttribute("value"), hidden: bar._foundMatches.hidden },
      options: (() => {
        const button = bar.querySelector(".kivo-find-options-button");
        const row = bar.querySelector(".kivo-find-options");
        return {
          button: button && { display: style(button).display, box: box(button), pressed: button.hasAttribute("checked"), dot: button.hasAttribute("kivo-filtered") },
          row: row && { display: style(row).display, box: box(row) },
          chips: row ? [...row.children].map(c => ({ label: c.getAttribute("label"), checked: c.checked, box: box(c) })) : [],
          pref: Services.prefs.getBoolPref("kivo.findbar.options", false),
        };
      })(),
      status: { text: status.textContent, width: box(status).width },
      order: [...["findbar-textbox", "found-matches", "find-status-icon", "find-previous", "find-next"].map(id => bar.getElement(id)), bar.querySelector(".kivo-find-options-button"), bar.getElement("find-closebutton")].map(el => Math.round(el.getBoundingClientRect().left)),
      highlightAll: Services.prefs.getBoolPref("findbar.highlightAll"),
      colors: ["ui.textHighlightBackground", "ui.textSelectAttentionBackground"].map(p => Services.prefs.getStringPref(p)),
    });
  })()`;
  const open = await json(LAYOUT);
  check('Ctrl+F opens the find box with the cursor in it', !open.hidden && open.focused && open.value === 'kite', open);
  check('the box is at the top corner of the page, over it', Math.abs(open.bar.top - open.page.top - 8) <= 2 && Math.abs(open.page.right - open.bar.right - 12) <= 2 && open.bar.width <= 380, { bar: open.bar, page: open.page });
  check('the page is not pushed or shrunk', JSON.stringify(open.page) === JSON.stringify({ left: Math.round(pageBox.left), top: Math.round(pageBox.top), right: Math.round(pageBox.right), bottom: Math.round(pageBox.bottom), width: Math.round(pageBox.width), height: Math.round(pageBox.height) }), { before: pageBox, after: open.page });
  check('matches read "1/4" like Chrome', open.matches.text === '1/4' && !open.matches.hidden, open.matches);
  check('word, count, line, up, down, options, close in one row', open.order.every((x, i) => i === 0 || x > open.order[i - 1]), open.order);
  check('the options row starts closed, so the box looks like Chrome', open.options.button?.display !== 'none' && open.options.row?.display === 'none' && !open.options.button.pressed, open.options);
  check('every match highlighted, yellow and orange', open.highlightAll && open.colors[0] === '#ffff00' && open.colors[1] === '#ff9632', { highlightAll: open.highlightAll, colors: open.colors });

  const SHOT = `(async () => {
    const shot = ${WINDOW_SHOT};
    const img = new Image();
    img.src = await shot(window);
    await img.decode();
    const canvas = document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
    canvas.width = img.width; canvas.height = img.height;
    const c = canvas.getContext("2d");
    c.drawImage(img, 0, 0);
    // drawSnapshot بيرسم الصفحة فوق مكان الصندوق، فالصندوق بيترسم تاني من الواجهة.
    const bar = gFindBar;
    if (!bar.hidden) {
      const r = bar.getBoundingClientRect();
      const ui = document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
      ui.width = img.width; ui.height = img.height;
      ui.getContext("2d").drawWindow(window, 0, 0, img.width, img.height, "white");
      c.save();
      c.shadowColor = "rgba(0,0,0,0.2)"; c.shadowBlur = 16; c.shadowOffsetY = 4;
      c.beginPath(); c.roundRect(r.left, r.top, r.width, r.height, parseFloat(getComputedStyle(bar).borderTopLeftRadius)); c.fillStyle = getComputedStyle(bar).backgroundColor; c.fill();
      c.restore();
      c.save();
      c.beginPath(); c.roundRect(r.left, r.top, r.width, r.height, parseFloat(getComputedStyle(bar).borderTopLeftRadius)); c.clip();
      c.drawImage(ui, 0, 0);
      c.restore();
    }
    return canvas.toDataURL("image/png");
  })()`;
  const save = async (name) => {
    const png = await kivo.evaluate(SHOT);
    writeFileSync(join(args.out, `${name}.png`), Buffer.from(png.slice(png.indexOf(',') + 1), 'base64'));
  };
  await save('find-light');

  // ---------- الاختيارات ----------
  // كليك بجد بالماوس على مكان العنصر (synthesizeMouseEvent زي EventUtils)، فلو حاجة مغطياه الكليك مايوصلوش.
  const click = (selector) =>
    kivo.evaluate(`(() => {
      const el = gFindBar.querySelector(${JSON.stringify(selector)});
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      window.synthesizeMouseEvent("mousedown", x, y, { button: 0, buttons: 1, clickCount: 1 }, { toWindow: true });
      window.synthesizeMouseEvent("mouseup", x, y, { button: 0, buttons: 0, clickCount: 1 }, { toWindow: true });
      return "ok";
    })()`);
  await click('.kivo-find-options-button');
  await sleep(600);
  const opened = await json(LAYOUT);
  const chips = opened.options.chips;
  const inBox = chips.every((c) => c.box.left >= opened.bar.left && c.box.right <= opened.bar.right && c.box.top > opened.options.button.box.bottom && c.box.bottom <= opened.bar.bottom);
  check(
    'the options button opens a second row with Firefox\'s four options',
    opened.options.pref && opened.options.button.pressed && opened.options.row.display !== 'none' &&
      chips.map((c) => c.label).join() === 'Highlight All,Match Case,Match Diacritics,Whole Words' && inBox && opened.bar.height > open.bar.height,
    { chips: chips.map((c) => [c.label, c.box]), bar: opened.bar }
  );
  check('two options a line', chips[0].box.top === chips[1].box.top && chips[2].box.top > chips[0].box.top, chips.map((c) => c.box));
  check('Highlight All starts on', chips[0].checked, chips[0]);
  check('the page still is not pushed', JSON.stringify(opened.page) === JSON.stringify(open.page), opened.page);

  await click('[anonid="find-case-sensitive"]');
  await sleep(1200);
  const matchCase = await json(LAYOUT);
  check('Match Case works: "kite" skips "Kites" (1/3)', matchCase.options.chips[1].checked && matchCase.matches.text === '1/3', { chip: matchCase.options.chips[1], matches: matchCase.matches });
  await save('find-options');

  await click('.kivo-find-options-button');
  await sleep(600);
  const filtered = await json(LAYOUT);
  check('closing the row keeps the option on, with a dot on the button', filtered.options.row.display === 'none' && filtered.options.button.dot && filtered.matches.text === '1/3', filtered.options.button);
  await save('find-filtered');

  // Kivo بيفتكر الصف مفتوح: تاب جديد بيفتح بيه.
  await click('.kivo-find-options-button');
  await sleep(400);
  await kivo.evaluate(`gBrowser.selectedTab = gBrowser.addTrustedTab(${JSON.stringify(url)}); "ok"`);
  await sleep(2000);
  await kivo.evaluate(`(${PRESS})(window, "f", "KeyF", 70, ["ctrl"]); "ok"`);
  await sleep(1200);
  const newTab = await json(LAYOUT);
  // Match Case نفسه لكل تاب زي Firefox (_typeAheadCaseSensitive)، الصف بس هو اللي بيتفتكر.
  check('a new tab opens the box with the row open too (remembered)', !newTab.hidden && newTab.options.row.display !== 'none' && newTab.options.button.pressed, newTab.options);
  await kivo.evaluate(`gBrowser.removeTab(gBrowser.selectedTab); "ok"`);
  await sleep(800);

  // رجوع: Match Case مقفول والصف مقفول.
  await click('[anonid="find-case-sensitive"]');
  await sleep(800);
  await click('.kivo-find-options-button');
  await sleep(600);
  const back = await json(LAYOUT);
  // البحث بيكمل من النتيجة اللي كان عليها، فالرقم الأول بيتغير.
  check('Match Case off again: back to 4 matches, no dot', /^\d\/4$/.test(back.matches.text) && !back.options.button.dot && back.options.row.display === 'none', { matches: back.matches, button: back.options.button });
  await kivo.evaluate(`gFindBar._findField.focus(); gFindBar._findField.setSelectionRange(4, 4); "ok"`);

  // كلمة مش موجودة.
  await kivo.evaluate(`(async () => {
    for (const ch of "qz") { (${PRESS})(window, ch, "Key" + ch.toUpperCase(), ch.toUpperCase().charCodeAt(0), []); await new Promise(r => setTimeout(r, 120)); }
    return "ok";
  })()`);
  await sleep(1500);
  const missing = await json(LAYOUT);
  check('a missing word reads "0/0", with no "Phrase not found" on screen', missing.matches.text === '0/0' && !missing.matches.hidden && missing.status.width <= 1, { matches: missing.matches, status: missing.status });
  await save('find-not-found');

  // غامق، بالـ profile bubbly.
  await kivo.evaluate(`(() => {
    Services.prefs.setStringPref("kivo.theme", JSON.stringify({ version: 1, preset: "space", mode: "dark", accent: "#8b7cff", font: "baloo", corners: "bubbly", background: { kind: "scene", scene: "space" }, start: { buddy: true, clock: true, fact: true, tiles: true }, sites: "theme" }));
    const field = gFindBar._findField; field.value = "kite"; field.dispatchEvent(new Event("input"));
    return "ok";
  })()`);
  await sleep(1500);
  const dark = await json(LAYOUT);
  check('dark profile: same box with the profile radius', !dark.hidden && /^\d\/4$/.test(dark.matches.text) && dark.radius !== open.radius, { radius: [open.radius, dark.radius], matches: dark.matches });
  await save('find-dark');

  // Escape بيقفله.
  await kivo.evaluate(`gFindBar._findField.focus(); (${PRESS})(window, "Escape", "Escape", 27, []); "ok"`);
  await sleep(600);
  const closed = await json(LAYOUT);
  check('Escape closes it', closed.hidden && closed.visibility === 'hidden', { hidden: closed.hidden, visibility: closed.visibility });

  // Quick find صغير زي Firefox، حتى لو الصف كان مفتوح.
  await kivo.evaluate(`Services.prefs.setBoolPref("kivo.findbar.options", true); gFindBar.open(gFindBar.FIND_TYPEAHEAD); "ok"`);
  await sleep(800);
  const quick = await json(LAYOUT);
  check('Quick find stays small: no options button or row', !quick.hidden && quick.options.button.display === 'none' && quick.options.row.display === 'none', quick.options);
} catch (e) {
  console.error(e);
  code = 1;
} finally {
  await kivo.close();
  server.close();
}
writeFileSync(join(args.out, 'results.json'), JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(code || (failed ? 1 : 0));
