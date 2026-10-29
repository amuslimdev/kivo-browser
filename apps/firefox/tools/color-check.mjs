#!/usr/bin/env node
// منتقي الألوان الواحد (KivoColorPicker.sys.mjs) على Kivo متغلف، headless وبكليك ماوس ومفاتيح بجد: أي
// <input type="color"> (صفحة، و "Make it yours" و إعدادات الـ widget في Kivo Home) بيفتح منتقي Kivo مش منتقي Windows،
// وقايمة الـ workspaces فيها نفس المنتقي بالظبط. والقطّارة بتاخد لون من الصفحة ومن الواجهة، والخانة بتقبل أي صيغة لون
// باللصق (clipboard بجد) والكتابة. منتقي Windows متبدّل بواحد وهمي بيعد، فلو حاجة فتحته الاختبار يعرف ومفيش نافذة
// تظهر. والصور: المنتقي على صفحة، وفي Kivo Home، وفي الـ workspaces، والقطّارة.
//
// node apps/firefox/tools/color-check.mjs --kivo <Kivo.exe> --out <فولدر>
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { PANEL_SHOT, WINDOW_SHOT, launch, sleep } from './kivo-bidi.mjs';

const { values: args } = parseArgs({ options: { kivo: { type: 'string' }, out: { type: 'string' } } });
if (!args.kivo || !args.out) {
  console.error('usage: color-check.mjs --kivo <Kivo.exe> --out <dir>');
  process.exit(2);
}
mkdirSync(args.out, { recursive: true });

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`);
};
const near = (hex, expected, tolerance = 2) =>
  /^#[0-9a-f]{6}$/.test(hex ?? '') &&
  [1, 3, 5].every((i) => Math.abs(parseInt(hex.slice(i, i + 2), 16) - parseInt(expected.slice(i, i + 2), 16)) <= tolerance);

// صفحة فيها <input type="color"> ومربعين بلونين معروفين للقطّارة، وبتسجّل input و change.
const PAGE = `<!doctype html><title>Colors</title><body style="margin:0;background:rgb(0,128,255)">
<input id=c type=color value="#ff0000" style="position:absolute;left:100px;top:100px;width:80px;height:50px">
<div style="position:absolute;left:400px;top:300px;width:200px;height:200px;background:rgb(255,0,0)"></div>
<div style="position:absolute;left:700px;top:300px;width:200px;height:200px;background:rgb(0,160,64)"></div>
<script>window.log=[];const c=document.getElementById("c");for(const t of ["input","change"])c.addEventListener(t,()=>log.push(t+" "+c.value));</script>
</body>`;
const PAGE_URL = `data:text/html,${encodeURIComponent(PAGE)}`;

// مفاتيح بجد (nsITextInputProcessor زي EventUtils.synthesizeKey)، وكليك ماوس بجد (synthesizeMouseEvent) في نقطة من
// النافذة، فلو panel أو صفحة فوق النقطة دي هي اللي بتاخده.
const HELPERS = `
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const press = (key, code, keyCode, mods = []) => {
    const tip = Cc["@mozilla.org/text-input-processor;1"].createInstance(Ci.nsITextInputProcessor);
    if (!tip.beginInputTransactionForTests(window)) throw new Error("no input transaction");
    const event = (key, code, keyCode) => new KeyboardEvent("", { key, code, keyCode });
    const keys = { ctrl: ["Control", "ControlLeft", 17], shift: ["Shift", "ShiftLeft", 16] };
    for (const mod of mods) tip.keydown(event(...keys[mod]));
    tip.keydown(event(key, code, keyCode));
    tip.keyup(event(key, code, keyCode));
    for (const mod of [...mods].reverse()) tip.keyup(event(...keys[mod]));
  };
  const mouse = (type, x, y, buttons = 0) =>
    window.synthesizeMouseEvent(type, x, y, { button: 0, buttons, clickCount: type === "mousemove" ? 0 : 1 }, { toWindow: true });
  const clickAt = async (x, y) => { mouse("mousemove", x, y); await wait(60); mouse("mousedown", x, y, 1); mouse("mouseup", x, y); await wait(250); };
  const center = el => { const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
  const click = el => clickAt(...center(el));
  // لصق بجد: النص في الـ clipboard، والخانة متختارة كلها، و Ctrl+V.
  const paste = async (input, text) => {
    Cc["@mozilla.org/widget/clipboardhelper;1"].getService(Ci.nsIClipboardHelper).copyString(text);
    input.focus();
    input.select();
    press("v", "KeyV", 86, ["ctrl"]);
    await wait(250);
  };
  const colorPanel = () => document.getElementById("ColorPickerPanel");
  const picker = () => colorPanel()?.querySelector(".kivo-picker");
  const dropper = () => document.querySelector("panel.kivo-eyedropper");
  const shape = el => el ? [el.className, ...[...el.querySelectorAll("*")].map(e => e.localName + "." + e.className + (e.type ? ":" + e.type : ""))] : null;
  const natives = () => window.__kivoNativePicker?.length ?? -1;
`;

const kivo = await launch(args.kivo);
// JavaScript في النافذة الرئيسية بالـ helpers. body بيرجّع قيمة بتتحوّل JSON.
const run = async (body) =>
  JSON.parse(await kivo.evaluate(`(async () => { ${HELPERS}; return JSON.stringify(await (async () => { ${body} })()); })()`));
const savePng = (name, dataUrl) => writeFileSync(join(args.out, `${name}.png`), Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'));
const contextOf = async (prefix) => (await kivo.send('browsingContext.getTree', {})).contexts.findLast((c) => c.url.startsWith(prefix))?.context;
// Kivo Home في التاب المختار (الصفحة اللي باينة)، بعد ما يوصل للـ bridge.
const homeContext = async () => {
  for (let i = 0; i < 60; i++) {
    const contexts = (await kivo.send('browsingContext.getTree', {})).contexts.filter((c) => c.url.startsWith('moz-extension://'));
    for (const { context } of contexts.reverse()) {
      const ready = await kivo
        .evaluateIn(context, `typeof browser !== "undefined" && document.visibilityState === "visible" && document.documentElement.dataset.bridge === "ok"`)
        .catch(() => false);
      if (ready) return context;
    }
    await sleep(250);
  }
  const tree = (await kivo.send('browsingContext.getTree', {})).contexts;
  const seen = [];
  for (const c of tree) seen.push([c.url.slice(0, 70), await kivo.evaluateIn(c.context, `JSON.stringify([typeof browser, document.visibilityState, document.documentElement.dataset.bridge ?? null])`).catch((e) => String(e).slice(0, 80))]);
  throw new Error(`Kivo Home did not load ${JSON.stringify(seen)}`);
};
// كليك بجد على عنصر في الصفحة اللي في التاب: مكانه من الصفحة، والكليك من النافذة.
const clickInPage = async (context, js) => {
  const r = JSON.parse(
    await kivo.evaluateIn(context, `(() => { const el = ${js}; if (!el) return "null"; el.scrollIntoView({ block: "center" });
      const r = el.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2, dpr: devicePixelRatio }); })()`)
  );
  if (!r) return false;
  await run(`const box = gBrowser.selectedBrowser.getBoundingClientRect(); const z = ${r.dpr} / devicePixelRatio;
    await clickAt(box.left + ${r.x} * z, box.top + ${r.y} * z); await wait(400); return true;`);
  return true;
};
const panelShot = (selector) =>
  kivo.evaluate(`(async () => {
    const shotUrl = ${WINDOW_SHOT};
    const draw = ${PANEL_SHOT};
    return draw(document.querySelector(${JSON.stringify(selector)}), shotUrl);
  })()`);

let code = 0;
try {
  await kivo.evaluate(`window.resizeTo(1280, 860); "ok"`);
  await sleep(2500);

  // منتقي Windows (@mozilla.org/colorpicker;1) بواحد وهمي بيعد ومابيفتحش حاجة.
  const mocked = await run(`
    const calls = window.__kivoNativePicker = [];
    const factory = {
      QueryInterface: ChromeUtils.generateQI(["nsIFactory"]),
      createInstance(iid) {
        calls.push(Date.now());
        const picker = { kivoMock: true, get wrappedJSObject() { return this; }, QueryInterface: ChromeUtils.generateQI(["nsIColorPicker"]), init() {}, open(callback) { callback.done(""); } };
        return picker.QueryInterface(iid);
      },
    };
    Components.manager.QueryInterface(Ci.nsIComponentRegistrar).registerFactory(Components.ID(Services.uuid.generateUUID().toString()), "Kivo test color picker", "@mozilla.org/colorpicker;1", factory);
    const works = Cc["@mozilla.org/colorpicker;1"].createInstance(Ci.nsIColorPicker).wrappedJSObject?.kivoMock === true;
    calls.length = 0;
    return { works, pref: Services.prefs.getBoolPref("dom.forms.html_color_picker.enabled", false) };`);
  check('the Windows color picker is replaced by a counting stand-in for the test', mocked.works, mocked);
  check('Kivo turns on the in-page color picker (dom.forms.html_color_picker.enabled)', mocked.pref, mocked.pref);

  // ---------- <input type="color"> في صفحة ----------
  await run(`gBrowser.selectedTab = gBrowser.addTrustedTab(${JSON.stringify(PAGE_URL)}); await wait(2500); return true;`);
  const page = await contextOf('data:text/html');
  const pageLog = async () => JSON.parse(await kivo.evaluateIn(page, `JSON.stringify({ value: document.getElementById("c").value, log })`));
  const openInput = () => run(`const box = gBrowser.selectedBrowser.getBoundingClientRect(); await clickAt(box.left + 140, box.top + 125); await wait(500);
    return { state: colorPanel()?.state ?? null };`);

  const opened = await openInput();
  const first = await run(`
    const p = picker();
    return { state: colorPanel()?.state, kivo: !!p, firefoxFrame: !!document.getElementById("ColorPickerPanelPopupFrame"),
             code: p?.querySelector(".kivo-picker-code")?.value, focusInside: colorPanel()?.contains(document.activeElement),
             eyedropper: !!p?.querySelector(".kivo-picker-eyedropper"), natives: natives(), shape: shape(p) };`);
  check('a real click on <input type="color"> opens Kivo\'s picker in a menu', opened.state === 'open' && first.kivo && !first.firefoxFrame, first);
  check('it starts at the input\'s color, with focus inside', first.code === '#ff0000' && first.focusInside, first);
  check('the Windows color picker never opened', first.natives === 0, first.natives);

  // سحب في المربع: الصفحة بتاخد input مع كل حركة.
  const dragged = await run(`
    const sv = picker().querySelector(".kivo-picker-sv");
    const r = sv.getBoundingClientRect();
    mouse("mousemove", r.left + r.width * 0.25, r.top + r.height * 0.25);
    mouse("mousedown", r.left + r.width * 0.25, r.top + r.height * 0.25, 1);
    await wait(80);
    mouse("mousemove", r.left + r.width * 0.75, r.top + r.height * 0.5, 1);
    await wait(80);
    mouse("mouseup", r.left + r.width * 0.75, r.top + r.height * 0.5);
    await wait(400);
    return { code: picker().querySelector(".kivo-picker-code").value };`);
  const afterDrag = await pageLog();
  check(
    'dragging in the square changes the page\'s color live (input events)',
    near(dragged.code, '#802020', 6) && afterDrag.value === dragged.code && afterDrag.log.filter((l) => l.startsWith('input')).length >= 2,
    { picker: dragged.code, page: afterDrag }
  );

  const hued = await run(`
    const hue = picker().querySelector(".kivo-picker-hue");
    const r = hue.getBoundingClientRect();
    await clickAt(r.left + 8 + (r.width - 16) / 3, r.top + r.height / 2);
    await wait(300);
    return { hue: Number(hue.value), code: picker().querySelector(".kivo-picker-code").value };`);
  check('a click on the hue bar moves the hue', Math.abs(hued.hue - 120) <= 12 && (await pageLog()).value === hued.code, hued);

  // أي صيغة باللصق: الخانة بتبقى hex على طول، والصفحة بتاخد اللون.
  const formats = [
    ['#0f0', '#00ff00'],
    ['#11223344', '#112233'],
    ['#abcd', '#aabbcc'],
    ['336699', '#336699'],
    ['  #ABCDEF  ', '#abcdef'],
    ['rgb(0, 0, 255)', '#0000ff'],
    ['rgba(255, 0, 0, 0.5)', '#ff0000'],
    ['rgb(10 20 30 / 40%)', '#0a141e'],
    ['hsl(120 100% 25%)', '#008000'],
    ['hsla(240, 100%, 50%, 0.3)', '#0000ff'],
    ['hwb(0 0% 0%)', '#ff0000'],
    ['rebeccapurple', '#663399'],
    ['oklch(0.7 0.15 250)', '#4ba3f7'],
    ['lab(50% 40 -20)', '#ab5a9a'],
    ['color(srgb 1 0.5 0)', '#ff8000'],
    ['color: #123456;', '#123456'],
    ['255, 128, 0', '#ff8000'],
  ];
  const pasted = [];
  for (const [text, expected] of formats) {
    const got = await run(`
      const input = picker().querySelector(".kivo-picker-code");
      await paste(input, ${JSON.stringify(text)});
      return { code: input.value, invalid: input.getAttribute("aria-invalid") };`);
    const inPage = (await pageLog()).value;
    const ok = near(got.code, expected, expected === '#4ba3f7' || expected === '#ab5a9a' ? 4 : 1) && inPage === got.code;
    pasted.push({ text, expected, ...got, page: inPage, ok });
  }
  check('pasting any CSS color (hex 3/4/6/8, rgb, hsl, hwb, names, oklch, lab, color(), bare numbers) works', pasted.every((p) => p.ok), pasted.filter((p) => !p.ok).length ? pasted.filter((p) => !p.ok) : pasted.map((p) => `${p.text.trim()} -> ${p.code}`));

  const bad = await run(`
    const input = picker().querySelector(".kivo-picker-code");
    const before = input.value;
    await paste(input, "banana");
    const during = { text: input.value, invalid: input.getAttribute("aria-invalid") };
    // من برّه الخانة (change): الكود بيرجع للون اللي متختار.
    picker().querySelector(".kivo-picker-sv").focus();
    await wait(100);
    return { before, during, after: input.value };`);
  check('a word that is not a color marks the box and changes nothing', bad.during.invalid === 'true' && bad.after === bad.before && (await pageLog()).value === bad.before, bad);

  // الكتابة: اللون بيتطبق أول ما الكلام يبقى لون، والكلام بيفضل لحد ما يخلص. ("blue" مش أحمر، عشان القفل يبعت change.)
  const typed = await run(`
    const input = picker().querySelector(".kivo-picker-code");
    input.focus();
    input.select();
    press("Backspace", "Backspace", 8);
    for (const [key, code, keyCode] of [["b", "KeyB", 66], ["l", "KeyL", 76], ["u", "KeyU", 85], ["e", "KeyE", 69]]) press(key, code, keyCode);
    await wait(200);
    const during = input.value;
    press("Enter", "Enter", 13);
    await wait(500);
    return { during, state: colorPanel()?.state };`);
  const afterEnter = await pageLog();
  check('typing "blue" applies blue while the text stays, and Enter closes with it', typed.during === 'blue' && afterEnter.value === '#0000ff' && typed.state === 'closed', { typed, page: afterEnter.value });
  check('closing sends "change" to the page', afterEnter.log.at(-1) === 'change #0000ff', afterEnter.log.slice(-3));

  // Escape بيرجّع اللون اللي كان.
  await openInput();
  const escaped = await run(`
    await paste(picker().querySelector(".kivo-picker-code"), "#00ffff");
    press("Escape", "Escape", 27);
    await wait(500);
    return { state: colorPanel()?.state };`);
  check('Escape closes and puts the old color back', escaped.state === 'closed' && (await pageLog()).value === '#0000ff', escaped);

  // ---------- القطّارة ----------
  await openInput();
  savePng('picker-page', await panelShot('#ColorPickerPanel'));
  const dropping = await run(`
    await click(picker().querySelector(".kivo-picker-eyedropper"));
    await wait(600);
    const d = dropper();
    const shot = d?.querySelector(".kivo-eyedropper-shot");
    const box = gBrowser.selectedBrowser.getBoundingClientRect();
    mouse("mousemove", box.left + 800, box.top + 400);
    await wait(300);
    return { state: d?.state ?? null, size: shot ? [shot.width, shot.height] : null, window: [innerWidth, innerHeight],
             pressed: picker().querySelector(".kivo-picker-eyedropper").getAttribute("aria-pressed"),
             label: d?.querySelector(".kivo-eyedropper-code")?.textContent, loupe: d ? !d.querySelector(".kivo-eyedropper-loupe").hidden : false,
             pickerOpen: colorPanel()?.state };`);
  check('the eyedropper covers the whole window with a magnifier that follows the mouse', dropping.state === 'open' && dropping.loupe && dropping.size?.join() === dropping.window.join(), dropping);
  check('the magnifier shows the color under the mouse', dropping.label === '#00a040', dropping.label);
  // صورة القطّارة: صورة النافذة اللي فوقيها، والدايرة المكبّرة والكود مكانهم (headless مابيرسمش الـ popups).
  savePng(
    'picker-eyedropper',
    await kivo.evaluate(`(async () => {
      const d = document.querySelector("panel.kivo-eyedropper");
      const shot = d.querySelector(".kivo-eyedropper-shot"), zoom = d.querySelector(".kivo-eyedropper-zoom"), label = d.querySelector(".kivo-eyedropper-code");
      const canvas = document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
      canvas.width = shot.width; canvas.height = shot.height;
      const c = canvas.getContext("2d");
      c.drawImage(shot, 0, 0);
      const z = zoom.getBoundingClientRect(), cx = z.x + z.width / 2, cy = z.y + z.height / 2;
      c.save(); c.beginPath(); c.arc(cx, cy, z.width / 2, 0, 2 * Math.PI); c.clip(); c.drawImage(zoom, z.x, z.y, z.width, z.height); c.restore();
      c.lineWidth = 3; c.strokeStyle = "#fff"; c.beginPath(); c.arc(cx, cy, z.width / 2 + 1.5, 0, 2 * Math.PI); c.stroke();
      const l = label.getBoundingClientRect();
      c.fillStyle = "rgba(20, 20, 28, 0.88)"; c.beginPath(); c.roundRect(l.x, l.y, l.width, l.height, l.height / 2); c.fill();
      c.fillStyle = label.textContent; c.beginPath(); c.arc(l.x + 11, l.y + l.height / 2, 6, 0, 2 * Math.PI); c.fill();
      c.fillStyle = "#fff"; c.font = "600 12px Consolas, monospace"; c.textBaseline = "middle"; c.fillText(label.textContent, l.x + 23, l.y + l.height / 2);
      c.fillStyle = "#c00"; c.font = "12px Segoe UI"; c.textBaseline = "top";
      c.fillText("eyedropper redrawn from its real layout (headless cannot paint popups)", 8, canvas.height - 20);
      return canvas.toDataURL("image/png");
    })()`)
  );
  const dropped = await run(`
    const box = gBrowser.selectedBrowser.getBoundingClientRect();
    await clickAt(box.left + 800, box.top + 400);
    await wait(400);
    return { dropper: !!dropper(), pickerOpen: colorPanel()?.state, code: picker()?.querySelector(".kivo-picker-code")?.value };`);
  check('a click takes the color from the page, and the picker stays open', !dropped.dropper && dropped.pickerOpen === 'open' && dropped.code === '#00a040' && (await pageLog()).value === '#00a040', dropped);

  // من الواجهة نفسها: شريط التابات (فاضي على اليمين) بلونه.
  const fromUi = await run(`
    await click(picker().querySelector(".kivo-picker-eyedropper"));
    await wait(600);
    const strip = document.getElementById("TabsToolbar").getBoundingClientRect();
    const x = strip.right - 260, y = strip.top + 6;
    mouse("mousemove", x, y);
    await wait(150);
    await clickAt(x, y);
    await wait(400);
    return { code: picker()?.querySelector(".kivo-picker-code")?.value, tabs: getComputedStyle(document.documentElement).getPropertyValue("--kivo-tabs").trim() };`);
  check('the eyedropper takes colors from Kivo\'s own bar too', fromUi.code === fromUi.tabs.toLowerCase(), fromUi);

  const cancelled = await run(`
    const before = picker().querySelector(".kivo-picker-code").value;
    await click(picker().querySelector(".kivo-picker-eyedropper"));
    await wait(600);
    const opened = dropper()?.state;
    press("Escape", "Escape", 27);
    await wait(400);
    return { opened, dropper: !!dropper(), pickerOpen: colorPanel()?.state, before, after: picker()?.querySelector(".kivo-picker-code")?.value };`);
  check('Escape stops the eyedropper and keeps the color and the picker', cancelled.opened === 'open' && !cancelled.dropper && cancelled.pickerOpen === 'open' && cancelled.after === cancelled.before, cancelled);
  // بعد القطّارة الـ focus على المربع، فـ Enter بيقفل المنتقي (مش بيفتح القطّارة تاني).
  const closedAfter = await run(`const sv = picker().querySelector(".kivo-picker-sv"); const onSquare = document.activeElement === sv;
    press("Enter", "Enter", 13); await wait(400); return { onSquare, state: colorPanel()?.state, dropper: !!dropper() };`);
  check('after the eyedropper, Enter closes the picker instead of starting it again', closedAfter.onSquare && closedAfter.state === 'closed' && !closedAfter.dropper, closedAfter);
  const pageNatives = await run(`return natives();`);
  check('still no Windows color picker after all of that', pageNatives === 0, pageNatives);
  const inputShape = first.shape;

  // ---------- Kivo Home: "Make it yours" وإعدادات الـ widget ----------
  let addon = null;
  for (let i = 0; i < 40 && !addon; i++) {
    addon = await kivo.evaluate(`WebExtensionPolicy.getByID("home@kivo")?.getURL("") ?? null`);
    if (!addon) await sleep(250);
  }
  await run(`gBrowser.selectedTab = gBrowser.addTrustedTab(${JSON.stringify(`${addon}index.html`)}); await wait(1000); return true;`);
  let home = await homeContext();
  const theme = { version: 1, preset: 'clean', mode: 'light', accent: '#7964bc', font: 'readex', corners: 'round', sites: 'theme', background: { kind: 'color', color: '#f5f4f0' }, start: { buddy: true, clock: true, fact: true, tiles: true } };
  await kivo.evaluateIn(home, `browser.kivo.request(${JSON.stringify({ type: 'theme.set', payload: { theme } })}).then(() => "ok")`);
  await run(`gBrowser.removeCurrentTab(); gBrowser.selectedTab = gBrowser.addTrustedTab(${JSON.stringify(`${addon}index.html`)}); await wait(1000); return true;`);
  home = await homeContext();
  await sleep(1000);
  const inHome = (js) => kivo.evaluateIn(home, js);
  await inHome(`location.hash = "customize"; "ok"`);
  await sleep(1200);
  await inHome(`[...document.querySelectorAll(".drawer .tabs button")].find(b => b.textContent.includes("Background"))?.click(); "ok"`);
  await sleep(600);

  const homeOpen = async (name, js) => {
    const clicked = await clickInPage(home, js);
    const got = await run(`await wait(300); return { state: colorPanel()?.state ?? null, kivo: !!picker(), natives: natives(), shape: shape(picker()) };`);
    return { name, clicked, ...got };
  };
  const bgPlus = await homeOpen('background +', `document.querySelector(".drawer .swatch.custom.picked")`);
  check('Kivo Home: the "+" under Colors in "Make it yours" opens Kivo\'s picker', bgPlus.clicked && bgPlus.state === 'open' && bgPlus.kivo && bgPlus.natives === 0, bgPlus);
  check('it is the same picker as on any page (same parts)', JSON.stringify(bgPlus.shape) === JSON.stringify(inputShape), { home: bgPlus.shape, page: inputShape });
  await run(`await paste(picker().querySelector(".kivo-picker-code"), "rgb(51, 102, 255)"); await wait(200); return true;`);
  await sleep(400);
  savePng('picker-home', await panelShot('#ColorPickerPanel'));
  await run(`press("Enter", "Enter", 13); await wait(500); return true;`);
  await sleep(900);
  // Appearance previews changes until Save; confirming the color picker alone does not persist the draft.
  await inHome(`document.querySelector(".drawer .save-button")?.click(); "ok"`);
  await sleep(700);
  const saved = JSON.parse(await inHome(`browser.kivo.request({ type: "theme.get", payload: {} }).then(r => JSON.stringify(r.theme.background))`));
  check('the pasted color becomes the page background and is saved', saved.kind === 'color' && saved.color === '#3366ff', saved);

  await inHome(`location.hash = "customize"; "ok"`);
  await sleep(500);
  await inHome(`[...document.querySelectorAll(".drawer .tabs button")].find(b => b.textContent.includes("Background"))?.click(); "ok"`);
  await sleep(300);
  const others = [];
  await inHome(`[...document.querySelectorAll(".drawer .swatches .swatch")].find(b => b.getAttribute("aria-label")?.startsWith("Gradient"))?.click(); "ok"`);
  await sleep(500);
  others.push(await homeOpen('gradient color', `document.querySelector(".drawer .gradient-colors label.pick")`));
  await run(`press("Escape", "Escape", 27); await wait(400); return true;`);
  await inHome(`[...document.querySelectorAll(".drawer .tabs button")].find(b => b.textContent.includes("Colors"))?.click(); "ok"`);
  await sleep(600);
  others.push(await homeOpen('my color +', `document.querySelector(".drawer .swatches.dots .swatch.custom:not(.header)")`));
  await run(`press("Escape", "Escape", 27); await wait(400); return true;`);
  others.push(await homeOpen('top bar +', `document.querySelector(".drawer .swatch.custom.header")`));
  await run(`press("Escape", "Escape", 27); await wait(400); return true;`);
  await inHome(`document.querySelector(".drawer .close")?.click(); "ok"`);
  await sleep(600);
  await inHome(`(document.querySelector('.frame[data-type="fact"]') ?? document.querySelector(".frame"))?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })); "ok"`);
  await sleep(900);
  others.push(await homeOpen('widget color +', `document.querySelector(".widget-inspector .custom-swatch")`));
  await run(`press("Escape", "Escape", 27); await wait(400); return true;`);
  check(
    'every other color circle in Kivo Home opens the same picker (gradient, my color, top bar, widget color)',
    others.every((o) => o.clicked && o.state === 'open' && o.kivo && o.natives === 0 && JSON.stringify(o.shape) === JSON.stringify(inputShape)),
    others.map(({ shape, ...o }) => o)
  );

  // ---------- قايمة الـ workspaces ----------
  const ws = await run(`
    await click(document.querySelector("#kivo-workspaces-button .kivo-ws-button"));
    await wait(700);
    const panel = document.getElementById("kivo-workspaces-panel");
    await click(panel.querySelector(".kivo-ws-new"));
    await wait(300);
    await click(panel.querySelector(".kivo-ws-more"));
    await wait(300);
    const p = panel.querySelector(".kivo-ws-picker");
    return { state: panel.state, shown: p && !p.hidden, kivo: p?.classList.contains("kivo-picker"), shape: shape(p) };`);
  check('the workspaces menu "+" opens the picker inside the menu', ws.state === 'open' && ws.shown && ws.kivo, ws);
  check('and it is the very same picker as every <input type="color">', JSON.stringify(ws.shape?.slice(1)) === JSON.stringify(inputShape?.slice(1)), { workspace: ws.shape, page: inputShape });

  const wsPaste = await run(`
    const panel = document.getElementById("kivo-workspaces-panel");
    await paste(panel.querySelector(".kivo-picker-code"), "hsl(280 70% 45%)");
    return { color: panel.querySelector(".kivo-ws-form").dataset.color, pressed: panel.querySelector(".kivo-ws-more").getAttribute("aria-pressed") };`);
  check('a pasted hsl() color becomes the workspace color', near(wsPaste.color, '#8e22c3', 2) && wsPaste.pressed === 'true', wsPaste);

  savePng('picker-workspace', await panelShot('#kivo-workspaces-panel'));
  const wsDrop = await run(`
    const panel = document.getElementById("kivo-workspaces-panel");
    await click(panel.querySelector(".kivo-picker-eyedropper"));
    await wait(600);
    const opened = dropper()?.state;
    const strip = document.getElementById("TabsToolbar").getBoundingClientRect();
    const x = strip.right - 260, y = strip.top + 6;
    mouse("mousemove", x, y);
    await wait(150);
    await clickAt(x, y);
    await wait(400);
    return { opened, dropper: !!dropper(), state: panel.state, form: !!panel.querySelector(".kivo-ws-form"),
             color: panel.querySelector(".kivo-ws-form")?.dataset.color, tabs: getComputedStyle(document.documentElement).getPropertyValue("--kivo-tabs").trim() };`);
  check(
    'the eyedropper works from the workspaces menu without closing it',
    wsDrop.opened === 'open' && !wsDrop.dropper && wsDrop.state === 'open' && wsDrop.form && wsDrop.color === wsDrop.tabs.toLowerCase(),
    wsDrop
  );
  await run(`const panel = document.getElementById("kivo-workspaces-panel"); await click(panel.querySelector(".kivo-ws-cancel")); panel.hidePopup(); await wait(300); return true;`);

  // رسم حقيقي من Firefox: نفس المنتقي جوه النافذة نفسها (مش popup)، فالأيقونة والتدرجات والدايرة زي ما الولد هيشوفهم.
  const real = await run(`
    const { KivoColorPicker } = ChromeUtils.importESModule("moz-src:///browser/components/kivo/KivoColorPicker.sys.mjs");
    const host = document.createElementNS("http://www.w3.org/1999/xhtml", "div");
    host.style.cssText = "position: fixed; left: 24px; top: 104px; z-index: 2147483647; width: 260px; padding: 12px; border-radius: 16px;" +
      "background: var(--arrowpanel-background); color: var(--arrowpanel-color); box-shadow: 0 8px 24px rgb(0 0 0 / 0.25)";
    const p = KivoColorPicker.create(document, { color: "#7964bc" });
    host.append(p.element);
    document.body.append(host);
    await wait(300);
    const icon = getComputedStyle(p.element.querySelector(".kivo-picker-eyedropper")).backgroundImage;
    const img = new Image();
    img.src = "chrome://browser/content/kivo/eyedropper.svg";
    const loaded = await img.decode().then(() => img.naturalWidth, () => 0);
    const r = host.getBoundingClientRect();
    const canvas = document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
    canvas.width = r.width + 48; canvas.height = r.height + 48;
    canvas.getContext("2d").drawWindow(window, r.left - 24, r.top - 24, canvas.width, canvas.height, "white");
    host.remove();
    return { icon, loaded, png: canvas.toDataURL("image/png") };`);
  savePng('picker-real', real.png);
  check('the eyedropper icon loads (Kivo\'s own, not DevTools\')', /eyedropper\.svg/.test(real.icon) && real.loaded > 0, { icon: real.icon, loaded: real.loaded });

  const total = await run(`return natives();`);
  check('the Windows color picker never opened in the whole run', total === 0, total);
} catch (e) {
  console.error(e);
  code = 1;
} finally {
  await kivo.close();
}
writeFileSync(join(args.out, 'color-check.json'), JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(code || (failed ? 1 : 0));
