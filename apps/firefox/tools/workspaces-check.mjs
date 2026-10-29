#!/usr/bin/env node
// الـ workspaces (G4) على Kivo، headless وبـ profile بيفضل بين تشغيلتين: الزرار في أول شريط التابات، وworkspace
// جديدة في نافذة لوحدها، وتاباتها بتتحفظ في workspaces.json، وبترجع لما نافذتها تتقفل وتتفتح، وبعد ما Kivo يتقفل
// ويتفتح. ولون الـ workspace هو هيدر نافذتها، والهيدر الثابت في الثيم مابيتغيرش مع العوالم. والملف بيرجع من
// الـ .bak لو الجهاز قفل وهو بيتكتب. والصور: القايمة، والتعديل، ونافذة workspace.
//
// node apps/firefox/tools/workspaces-check.mjs --kivo <Kivo.exe> --out <فولدر>
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { PANEL_SHOT, WINDOW_SHOT, launch, sleep } from './kivo-bidi.mjs';

const { values: args } = parseArgs({ options: { kivo: { type: 'string' }, out: { type: 'string' } } });
if (!args.kivo || !args.out) {
  console.error('usage: workspaces-check.mjs --kivo <Kivo.exe> --out <dir>');
  process.exit(2);
}
mkdirSync(args.out, { recursive: true });

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`);
};
const page = (title) => `data:text/html,<title>${title}</title><h1>${title}</h1>`;
const ONE = page('School one');
const TWO = page('School two');

const profile = mkdtempSync(join(tmpdir(), 'kivo-workspaces-'));
// JavaScript في النافذة الرئيسية، و W هو KivoWorkspaces. body بيرجّع قيمة بتتحوّل JSON.
const runIn = (kivo) => async (body) =>
  JSON.parse(
    await kivo.evaluate(`(async () => {
      const { KivoWorkspaces: W } = ChromeUtils.importESModule("moz-src:///browser/components/kivo/KivoWorkspaces.sys.mjs");
      const { SessionStore } = ChromeUtils.importESModule("moz-src:///browser/components/sessionstore/SessionStore.sys.mjs");
      const { TabStateFlusher } = ChromeUtils.importESModule("moz-src:///browser/components/sessionstore/TabStateFlusher.sys.mjs");
      const urls = async win => { await TabStateFlusher.flushWindow(win); return SessionStore.getWindowState(win).windows[0].tabs.map(t => t.entries[t.index - 1]?.url); };
      const wait = ms => new Promise(r => setTimeout(r, ms));
      return JSON.stringify(await (async () => { ${body} })());
    })()`)
  );
const savePng = (name, dataUrl) => writeFileSync(join(args.out, `${name}.png`), Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'));

let code = 0;
try {
  // ---------- التشغيلة الأولى ----------
  let kivo = await launch(args.kivo, {}, { profile });
  let run = runIn(kivo);
  await kivo.evaluate(`window.resizeTo(1280, 860); "ok"`);
  await sleep(2000);

  const placed = await run(`
    const { CustomizableUI } = ChromeUtils.importESModule("moz-src:///browser/components/customizableui/CustomizableUI.sys.mjs");
    return { placement: CustomizableUI.getPlacementOfWidget("kivo-workspaces-button"),
             inWindow: !!document.querySelector("#kivo-workspaces-button .kivo-ws-button"),
             list: await W.list() };`);
  check('the Workspaces button is first in the tab strip', placed.placement?.area === 'TabsToolbar' && placed.placement.position === 0 && placed.inWindow, placed.placement);
  check('no workspaces yet', placed.list.length === 0, placed.list.length);

  const school = await run(`
    const win = await W.create({ name: "School", color: "#22a55a" });
    win.gBrowser.addTrustedTab(${JSON.stringify(ONE)});
    win.gBrowser.addTrustedTab(${JSON.stringify(TWO)});
    await wait(2500);
    await W.saveNow();
    const file = await IOUtils.readJSON(PathUtils.join(PathUtils.profileDir, "kivo", "workspaces.json"));
    const saved = file.workspaces[0];
    return { id: win.kivoWorkspaceId, windows: BrowserWindowTracker.windowCount, title: win.document.querySelector("#kivo-workspaces-button .kivo-ws-label")?.textContent,
             saved: { name: saved.name, color: saved.color, open: saved.open, urls: saved.window.tabs.map(t => t.entries[t.index - 1]?.url) } };`);
  check('a new workspace opens in its own window', school.id && school.windows === 2, school);
  check('the window button shows the workspace', school.title === 'School', school.title);
  check('its tabs are saved in workspaces.json', school.saved.urls.includes(ONE) && school.saved.urls.includes(TWO) && school.saved.open, school.saved);

  const reopened = await run(`
    const win = [...BrowserWindowTracker.orderedWindows].find(w => w.kivoWorkspaceId === ${JSON.stringify(school.id)});
    win.close();
    await wait(1500);
    const closed = (await W.list())[0];
    const again = await W.open(${JSON.stringify(school.id)}, window);
    await wait(2500);
    return { closedOpen: closed.open, closedTabs: closed.tabs, urls: await urls(again), tagged: again.kivoWorkspaceId };`);
  check('closing the window keeps the workspace and its tabs', reopened.closedOpen === false && reopened.closedTabs >= 3, reopened);
  check('opening it again brings back the same tabs', reopened.urls.includes(ONE) && reopened.urls.includes(TWO) && reopened.tagged === school.id, reopened.urls);

  // الهيدر: لون الـ workspace على نافذتها، والعوالم، واللون الثابت. kivo.theme زي ما KivoData بيكتبه.
  const colors = await run(`
    const css = (win, name) => win.document.documentElement.style.getPropertyValue(name).trim();
    const look = win => ({ tabs: css(win, "--kivo-tabs"), toolbar: css(win, "--kivo-toolbar"), accent: css(win, "--kivo-accent"), mode: win.document.documentElement.getAttribute("kivo-mode") });
    const school = [...BrowserWindowTracker.orderedWindows].find(w => w.kivoWorkspaceId === ${JSON.stringify(school.id)});
    const setTheme = t => Services.prefs.setStringPref("kivo.theme", JSON.stringify({ version: 1, preset: "clean", mode: "light", accent: "#7964bc", font: "readex", corners: "round", sites: "theme", ...t }));
    const out = { school: look(school), main: look(window) };
    await W.update(${JSON.stringify(school.id)}, { color: "#2f80ed" });
    out.recolored = look(school);
    setTheme({ accent: "#ff4f5e" });
    out.worldA = look(window);
    setTheme({ accent: "#14c2d6", mode: "dark" });
    out.worldB = look(window);
    setTheme({ accent: "#ff4f5e", header: "#1e293b" });
    out.fixedA = look(window);
    setTheme({ accent: "#14c2d6", mode: "dark", header: "#1e293b" });
    out.fixedB = look(window);
    out.schoolWithFixed = look(school);
    Services.prefs.clearUserPref("kivo.theme");
    const { handle } = ChromeUtils.importESModule("moz-src:///browser/components/kivo/KivoData.sys.mjs");
    out.bridge = (await handle({ type: "theme.get" }, school.gBrowser.selectedBrowser)).workspace;
    out.bridgeMain = (await handle({ type: "theme.get" }, gBrowser.selectedBrowser)).workspace;
    return out;`);
  // صفحات Kivo Home المفتوحة (في النافذتين): الـ accent بتاعها.
  const pageAccents = async () => {
    const tree = await kivo.send('browsingContext.getTree', {});
    const accents = [];
    for (const c of tree.contexts.filter((c) => c.url.startsWith('moz-extension://'))) {
      accents.push(await kivo.evaluateIn(c.context, `getComputedStyle(document.documentElement).getPropertyValue("--accent").trim()`).catch(() => null));
    }
    return accents;
  };
  await sleep(1500);
  const accents = await pageAccents();
  check('a workspace window has its color as the top bar', colors.school.tabs === '#22a55a' && colors.main.tabs !== '#22a55a', [colors.school, colors.main]);
  check('and as the color of the whole window (buttons, menus)', colors.school.accent === '#22a55a' && colors.main.accent !== '#22a55a', [colors.school.accent, colors.main.accent]);
  check('Kivo pages learn the workspace of their window', colors.bridge?.color === '#2f80ed' && colors.bridge?.name === 'School' && colors.bridgeMain === null, [colors.bridge, colors.bridgeMain]);
  check('the Kivo page in the workspace window takes the new color at once', accents.includes('#2f80ed'), accents);
  check('changing the workspace color repaints its window', colors.recolored.tabs === '#2f80ed', colors.recolored);
  check('without a fixed top bar, each world brings its own', colors.worldA.tabs !== colors.worldB.tabs, [colors.worldA, colors.worldB]);
  check(
    'a fixed top bar stays the same in every world',
    // الـ accent بيتغير مع العالم، والهيدر لأ.
    colors.fixedA.tabs === '#1e293b' && colors.fixedA.tabs === colors.fixedB.tabs && colors.fixedA.toolbar === colors.fixedB.toolbar && colors.fixedA.mode === 'dark' && colors.fixedB.mode === 'dark',
    [colors.fixedA, colors.fixedB]
  );
  check('a workspace window keeps its own color over a fixed top bar', colors.schoolWithFixed.tabs === '#2f80ed', colors.schoolWithFixed);

  // التعديل: القلم باين من غير hover، و "Any color" بيختار لون ويتحفظ.
  const edit = await run(`
    W.togglePanel(window, document.querySelector("#kivo-workspaces-button .kivo-ws-button"));
    await wait(600);
    const panel = document.getElementById("kivo-workspaces-panel");
    const pencil = panel.querySelector(".kivo-ws-edit");
    const opacity = Number(getComputedStyle(pencil).opacity);
    pencil.click();
    await wait(200);
    const form = panel.querySelector(".kivo-ws-form");
    const hiddenAtFirst = panel.querySelector(".kivo-ws-picker").hidden;
    panel.querySelector(".kivo-ws-more").click();
    const shown = !panel.querySelector(".kivo-ws-picker").hidden;
    const hex = panel.querySelector(".kivo-picker-code");
    hex.value = "5b3fd1";
    hex.dispatchEvent(new Event("input", { bubbles: true }));
    const typed = form.dataset.color;
    const schoolWin = [...BrowserWindowTracker.orderedWindows].find(w => w.kivoWorkspaceId === ${JSON.stringify(school.id)});
    const previewTop = schoolWin.document.documentElement.style.getPropertyValue("--kivo-tabs").trim();
    const hue = panel.querySelector(".kivo-picker-hue");
    hue.value = "300";
    hue.dispatchEvent(new Event("input", { bubbles: true }));
    const picked = form.dataset.color;
    const pressed = panel.querySelector(".kivo-ws-more").getAttribute("aria-pressed");
    form.requestSubmit();
    await wait(500);
    panel.hidePopup();
    const school = [...BrowserWindowTracker.orderedWindows].find(w => w.kivoWorkspaceId === ${JSON.stringify(school.id)});
    const result = { opacity, hiddenAtFirst, shown, typed, previewTop, picked, pressed, saved: (await W.list())[0].color, top: school.document.documentElement.style.getPropertyValue("--kivo-tabs").trim() };
    await W.update(${JSON.stringify(school.id)}, { color: "#22a55a" });

    // Cancel: المعاينة بترجع، ومابيتحفظش حاجة.
    W.togglePanel(window, document.querySelector("#kivo-workspaces-button .kivo-ws-button"));
    await wait(600);
    panel.querySelector(".kivo-ws-edit").click();
    await wait(200);
    panel.querySelector('.kivo-ws-swatch[data-color="#e5484d"]').click();
    const top = () => school.document.documentElement.style.getPropertyValue("--kivo-tabs").trim();
    const accent = () => school.document.documentElement.style.getPropertyValue("--kivo-accent").trim();
    result.cancel = { during: top(), duringAccent: accent() };
    panel.querySelector(".kivo-ws-cancel").click();
    await wait(200);
    result.cancel.after = top();
    result.cancel.saved = (await W.list())[0].color;
    panel.hidePopup();
    await wait(300);
    return result;`);
  check('the edit pencil is visible without hovering', edit.opacity >= 0.5, edit.opacity);
  check('"Any color" opens a color picker under the colors', edit.hiddenAtFirst && edit.shown, edit);
  check('the picker takes a typed color code and a hue', edit.typed === '#5b3fd1' && edit.picked !== edit.typed && edit.pressed === 'true', edit);
  check('the window shows the color live, before Save', edit.previewTop === '#5b3fd1', edit.previewTop);
  check(
    'Cancel puts the saved color back and saves nothing',
    edit.cancel.during === '#e5484d' && edit.cancel.duringAccent === '#e5484d' && edit.cancel.after === '#22a55a' && edit.cancel.saved === '#22a55a',
    edit.cancel
  );
  check('the picked color is saved and paints the window', /^#[0-9a-f]{6}$/.test(edit.picked) && edit.saved === edit.picked && edit.top === edit.picked, edit);

  const games = await run(`
    await W.create({ name: "Games", color: "#e0499a", withWindow: window });
    return { here: window.kivoWorkspaceId, list: (await W.list()).map(w => w.name) };`);
  check('"Start with this window\'s tabs" turns this window into a workspace', games.here && games.list.join() === 'School,Games', games);

  // الصور: القايمة، والتعديل، ونافذة School.
  const panelShot = async (setup) =>
    kivo.evaluate(`(async () => {
      const shotUrl = ${WINDOW_SHOT};
      const draw = ${PANEL_SHOT};
      ${setup}
      await new Promise(r => setTimeout(r, 1200));
      const panel = document.getElementById("kivo-workspaces-panel");
      try { return await draw(panel, shotUrl); } finally { panel.hidePopup(); await new Promise(r => setTimeout(r, 400)); }
    })()`);
  const openPanel = `
    const { KivoWorkspaces: W } = ChromeUtils.importESModule("moz-src:///browser/components/kivo/KivoWorkspaces.sys.mjs");
    W.togglePanel(window, document.querySelector("#kivo-workspaces-button .kivo-ws-button"));`;
  savePng('workspaces-panel', await panelShot(openPanel));
  savePng('workspaces-edit', await panelShot(`${openPanel}
    await new Promise(r => setTimeout(r, 600));
    document.querySelector("#kivo-workspaces-panel .kivo-ws-edit").click();`));
  savePng('workspaces-picker', await panelShot(`${openPanel}
    await new Promise(r => setTimeout(r, 600));
    document.querySelector("#kivo-workspaces-panel .kivo-ws-edit").click();
    await new Promise(r => setTimeout(r, 200));
    document.querySelector("#kivo-workspaces-panel .kivo-ws-more").click();`));
  savePng('workspaces-new', await panelShot(`${openPanel}
    await new Promise(r => setTimeout(r, 600));
    document.querySelector("#kivo-workspaces-panel .kivo-ws-new").click();`));
  savePng('workspace-window', await kivo.evaluate(`(async () => {
    const shot = ${WINDOW_SHOT};
    const win = [...BrowserWindowTracker.orderedWindows].find(w => w.kivoWorkspaceId === ${JSON.stringify(school.id)});
    win.resizeTo(1280, 860);
    await new Promise(r => setTimeout(r, 1000));
    return shot(win);
  })()`));

  // Kivo بيتقفل والنافذتين مفتوحين.
  await kivo.quit();
  const file = JSON.parse(readFileSync(join(profile, 'kivo', 'workspaces.json'), 'utf8'));
  check('quitting Kivo keeps open workspaces marked open', file.workspaces.every((w) => w.open), file.workspaces.map((w) => [w.name, w.open]));

  // ---------- التشغيلة التانية، نفس الـ profile ----------
  kivo = await launch(args.kivo, {}, { profile });
  run = runIn(kivo);
  await sleep(6000);
  const back = await run(`
    const windows = [...BrowserWindowTracker.orderedWindows];
    const byName = {};
    for (const ws of await W.list()) {
      const win = windows.find(w => w.kivoWorkspaceId === ws.id);
      byName[ws.name] = win ? await urls(win) : null;
    }
    return { windows: windows.length, byName };`);
  check('after a restart, both workspaces open again', back.byName.School && back.byName.Games, back);
  check('after a restart, School has the same tabs', back.byName.School?.includes(ONE) && back.byName.School?.includes(TWO), back.byName.School);

  const removed = await run(`
    const games = (await W.list()).find(w => w.name === "Games");
    const win = [...BrowserWindowTracker.orderedWindows].find(w => w.kivoWorkspaceId === games.id);
    const before = win.document.documentElement.style.getPropertyValue("--kivo-tabs").trim();
    await W.remove(games.id);
    return { list: (await W.list()).map(w => w.name), windowStays: !!win && !win.closed, untagged: !win?.kivoWorkspaceId,
             before, after: win.document.documentElement.style.getPropertyValue("--kivo-tabs").trim() };`);
  check('deleting a workspace keeps its window as a normal one', removed.list.join() === 'School' && removed.windowStays && removed.untagged, removed);
  check("and its window goes back to the theme's top bar", removed.before === '#e0499a' && removed.after !== '#e0499a', [removed.before, removed.after]);
  await kivo.quit();

  // ---------- الجهاز قفل فجأة (25 أكتوبر) ----------
  // الملف بيرجع أصفار لو الكتابة مالحقتش توصل الهارد. Kivo بيقرا النسخة اللي قبله (.bak)، ولو هي كمان بايظة
  // بيسيب نسخة من الملف قبل ما يكتب فوقه.
  const dir = join(profile, 'kivo');
  const main = join(dir, 'workspaces.json');
  const saved = readFileSync(main, 'utf8');
  check('the saved file leaves out recently closed tabs', !saved.includes('"_closedTabs"'), saved.length);
  const backup = JSON.parse(readFileSync(`${main}.bak`, 'utf8'));
  check('the previous file is kept as workspaces.json.bak', backup.workspaces.some((w) => w.name === 'School'), backup.workspaces.map((w) => w.name));
  writeFileSync(main, Buffer.alloc(saved.length));
  kivo = await launch(args.kivo, {}, { profile });
  run = runIn(kivo);
  await sleep(6000);
  const rescued = await run(`return (await W.list()).map(w => w.name);`);
  check('after a crash that zeroed the file, the workspaces come back from the .bak', rescued.includes('School'), rescued);
  await kivo.quit();

  writeFileSync(main, Buffer.alloc(64));
  writeFileSync(`${main}.bak`, Buffer.alloc(64));
  kivo = await launch(args.kivo, {}, { profile });
  run = runIn(kivo);
  await sleep(4000);
  const lost = await run(`return (await W.list()).length;`);
  const broken = existsSync(join(dir, 'workspaces.broken.json')) ? readFileSync(join(dir, 'workspaces.broken.json')) : null;
  check('with both files broken, Kivo starts empty but keeps a copy of the broken file', lost === 0 && broken?.length === 64, [lost, broken?.length]);
  await kivo.quit();

  // ---------- crash وملفات Firefox نفسه باظت ----------
  // Firefox بيرجع لآخر قفلة عادية (previous.jsonlz4)، ونافذة الـ workspace فيها بتابات أقدم من workspaces.json.
  const crashProfile = mkdtempSync(join(tmpdir(), 'kivo-workspaces-crash-'));
  kivo = await launch(args.kivo, {}, { profile: crashProfile });
  run = runIn(kivo);
  await sleep(2000);
  const work = await run(`
    const win = await W.create({ name: "Work" });
    win.gBrowser.addTrustedTab(${JSON.stringify(ONE)});
    await wait(2500);
    await W.saveNow();
    return win.kivoWorkspaceId;`);
  await kivo.quit();

  kivo = await launch(args.kivo, {}, { profile: crashProfile });
  run = runIn(kivo);
  await sleep(6000);
  const older = await run(`
    const win = [...BrowserWindowTracker.orderedWindows].find(w => w.kivoWorkspaceId === ${JSON.stringify(work)});
    win.gBrowser.addTrustedTab(${JSON.stringify(TWO)});
    await wait(2500);
    await W.saveNow();
    // Firefox بينقل الـ session النضيف لـ previous.jsonlz4 مع أول كتابة بعد البداية (كل 15 ثانية).
    const path = PathUtils.join(PathUtils.profileDir, "sessionstore-backups", "previous.jsonlz4");
    for (let i = 0; i < 60 && !(await IOUtils.exists(path)); i++) await wait(500);
    const previous = await IOUtils.readJSON(path, { decompress: true });
    const old = previous.windows.find(w => w.extData?.["kivo-workspace"] === ${JSON.stringify(work)});
    return old?.tabs.map(t => t.entries[t.index - 1]?.url) ?? null;`);
  check('the older Firefox session has the workspace with one tab less', older?.includes(ONE) && !older.includes(TWO), older);
  await kivo.quit();

  // الجهاز قفل: مفيش ملف session نضيف، والـ recovery أصفار، و Crash Monitor ماشافش القفلة. والـ remote agent
  // بيقفل ترجيع الـ session بعد crash (resume_from_crash في الـ prefs اللي بيحطها)، فمن غيرها زي الاستخدام العادي.
  rmSync(join(crashProfile, 'sessionstore.jsonlz4'), { force: true });
  writeFileSync(join(crashProfile, 'sessionstore-backups', 'recovery.jsonlz4'), Buffer.alloc(4096));
  writeFileSync(join(crashProfile, 'sessionCheckpoints.json'), '{"profile-after-change":true}');
  kivo = await launch(args.kivo, { 'remote.prefs.recommended': false }, { profile: crashProfile });
  run = runIn(kivo);
  await sleep(6000);
  const after = await run(`
    const { SessionStartup } = ChromeUtils.importESModule("moz-src:///browser/components/sessionstore/SessionStartup.sys.mjs");
    const all = [...BrowserWindowTracker.orderedWindows];
    const wins = all.filter(w => w.kivoWorkspaceId === ${JSON.stringify(work)});
    return { crashed: SessionStartup.previousSessionCrashed, all: all.length, windows: wins.length, urls: wins[0] ? await urls(wins[0]) : null };`);
  // نافذتين: الـ workspace والنافذة العادية اللي Firefox رجّعهم، من غير نسخة تانية من الـ workspace.
  check(
    'after a crash that sent Firefox back to an older session, the workspace opens with its newer tabs',
    after.crashed && after.all === 2 && after.windows === 1 && after.urls?.includes(ONE) && after.urls?.includes(TWO),
    after
  );
  await kivo.quit();
  rmSync(crashProfile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
} catch (e) {
  console.error(e);
  code = 1;
} finally {
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
writeFileSync(join(args.out, 'workspaces-check.json'), JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(code || (failed ? 1 : 0));
