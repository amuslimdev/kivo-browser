#!/usr/bin/env node
// G5 (docs/FIREFOX.md)، headless على profile فيه history و bookmarks وتحميلات تجريبية: شكل Kivo على الإعدادات
// والـ sidebars والقوايم، و Ctrl+J بيفتح القايمة الصغيرة زي Edge، و "Show all downloads" و "Show all history" بيفتحوا
// صفحات Kivo، والصفحتين بيعرضوا ويمسحوا. والصور.
//
// node apps/firefox/tools/pages-check.mjs --kivo <Kivo.exe المتغلف> --out <فولدر>
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { WINDOW_SHOT, launch, sleep, tabShot } from './kivo-bidi.mjs';

const { values: args } = parseArgs({ options: { kivo: { type: 'string' }, out: { type: 'string' } } });
if (!args.kivo || !args.out) {
  console.error('usage: pages-check.mjs --kivo <Kivo.exe> --out <dir>');
  process.exit(2);
}
mkdirSync(args.out, { recursive: true });

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`);
};
const savePng = (name, png) => writeFileSync(join(args.out, `${name}.png`), png);
const HOME = 'moz-extension://9d4b610d-d083-4703-8d31-c7178f7ba2e8/';

let code = 0;
// has-used: زي profile استخدم الـ sidebar قبل كده، و Firefox مابيحطلوش أدوات لوحده.
const kivo = await launch(args.kivo, { 'browser.toolbars.bookmarks.visibility': 'always', 'sidebar.new-sidebar.has-used': true });
const json = async (js) => JSON.parse(await kivo.evaluate(js));
// صفحة Kivo مفتوحة (history.html مثلًا): الـ context بتاعها عشان نشغّل فيها JavaScript.
const pageContext = async (file) => (await kivo.send('browsingContext.getTree', {})).contexts.find((c) => c.url.startsWith(HOME + file))?.context;
try {
  await kivo.evaluate(`window.resizeTo(1280, 860); "ok"`);
  await sleep(3000);
  console.log(
    await kivo.evaluate(`(async () => {
      Services.prefs.setStringPref("kivo.theme", JSON.stringify({ version: 1, preset: "candy", mode: "light", accent: "#ff4f9a", font: "baloo", corners: "bubbly", background: { kind: "scene", scene: "candy" }, start: { buddy: true, clock: true, fact: true, tiles: true }, sites: "theme" }));
      const { PlacesUtils } = ChromeUtils.importESModule("resource://gre/modules/PlacesUtils.sys.mjs");
      const now = Date.now();
      const sites = [
        ["https://www.wikipedia.org/", "Wikipedia"], ["https://www.youtube.com/", "YouTube"], ["https://www.khanacademy.org/", "Khan Academy"],
        ["https://scratch.mit.edu/", "Scratch - Imagine, Program, Share"], ["https://www.nationalgeographic.com/", "National Geographic"],
        ["https://github.com/", "GitHub"], ["https://www.bbc.com/news", "BBC News"], ["https://developer.mozilla.org/", "MDN Web Docs"],
        ["https://www.duolingo.com/", "Duolingo"], ["https://www.nasa.gov/", "NASA"],
      ];
      await PlacesUtils.history.insertMany(sites.map(([url, title], i) => ({
        url, title, visits: [{ date: new Date(now - i * 47 * 60000) }, { date: new Date(now - (i + 26) * 3600000) }],
      })));
      for (const [url, title] of sites.slice(0, 5)) await PlacesUtils.bookmarks.insert({ parentGuid: PlacesUtils.bookmarks.toolbarGuid, url, title });
      const { Downloads } = ChromeUtils.importESModule("resource://gre/modules/Downloads.sys.mjs");
      const list = await Downloads.getList(Downloads.PUBLIC);
      for (const [name, size] of [["science-project.pdf", 1843200], ["holiday-photos.zip", 52428800], ["my-drawing.png", 734003]]) {
        const path = PathUtils.join(PathUtils.tempDir, name);
        await IOUtils.writeUTF8(path, "kivo test file");
        await list.add(await Downloads.createDownload({ source: { url: "https://example.com/" + name }, target: { path }, succeeded: true, startTime: new Date(now - size / 1000).toISOString(), totalBytes: size }));
      }
      return "seeded";
    })()`)
  );

  // ---------- الإعدادات ----------
  await kivo.evaluate(`gBrowser.selectedTab = gBrowser.addTrustedTab("about:preferences"); "ok"`);
  await sleep(3500);
  const settings = await json(`(() => {
    const doc = gBrowser.selectedBrowser.contentDocument;
    const style = doc.defaultView.getComputedStyle(doc.documentElement);
    const banner = doc.getElementById("policies-container-content");
    return JSON.stringify({
      font: doc.defaultView.getComputedStyle(doc.body).fontFamily,
      accent: style.getPropertyValue("--color-accent-primary").trim(),
      kivoAccent: style.getPropertyValue("--kivo-accent").trim(),
      hover: (() => { const nav = doc.querySelector("moz-page-nav-button"); const probe = doc.createElement("div"); probe.style.background = "var(--page-nav-button-background-color-hover)"; nav.append(probe); const color = doc.defaultView.getComputedStyle(probe).backgroundColor; probe.remove(); return color; })(),
      managed: !!banner && doc.defaultView.getComputedStyle(banner).display !== "none",
    });
  })()`);
  check('settings use the Kivo font', /Baloo/.test(settings.font), settings.font);
  check('settings use the profile color', settings.kivoAccent === '#ff4f9a' && /kivo-accent|#ff4f9a|255, 79, 154/.test(settings.accent + settings.kivoAccent), settings);
  check('no "managed by your organization" banner', !settings.managed, settings.managed);
  check('the settings menu hover is the profile color', /255, 79, 154|srgb 1 0\.3098\d* 0\.6039/.test(settings.hover), settings.hover);
  savePng('g5-settings', await tabShot(kivo));
  await kivo.evaluate(`gBrowser.removeTab(gBrowser.selectedTab); "ok"`);

  // ---------- القوايم ----------
  const menus = await json(`(() => {
    const root = getComputedStyle(document.documentElement);
    const menu = document.getElementById("contentAreaContextMenu");
    return JSON.stringify({ radius: root.getPropertyValue("--panel-border-radius").trim(), font: getComputedStyle(menu).fontFamily });
  })()`);
  check('menus use the Kivo font and corners', /Baloo/.test(menus.font) && menus.radius.length > 0, menus);

  // ---------- التحميلات ----------
  const panel = await json(`(async () => {
    BrowserCommands.downloadsUI();
    await new Promise(r => setTimeout(r, 1500));
    const state = DownloadsPanel.panel?.state;
    const library = Services.wm.getMostRecentWindow("Places:Organizer");
    DownloadsPanel.showDownloadsHistory();
    await new Promise(r => setTimeout(r, 2500));
    return JSON.stringify({ state, library: !!library, tab: gBrowser.selectedBrowser.currentURI.spec, urlbar: gURLBar.value });
  })()`);
  check('Ctrl+J opens the small downloads menu, like Edge', ['open', 'showing'].includes(panel.state) && !panel.library, panel);
  check('"Show all downloads" opens the Kivo downloads page', panel.tab === `${HOME}downloads.html`, panel.tab);
  check('the address bar stays clean on Kivo pages', panel.urlbar === '', panel.urlbar);
  await sleep(1500);
  const downloadsPage = await pageContext('downloads.html');
  const downloadsRows = downloadsPage
    ? await kivo.evaluateIn(downloadsPage, `document.querySelectorAll(".row").length`)
    : 0;
  check('the downloads page lists the downloads', downloadsRows === 3, downloadsRows);
  savePng('g5-downloads', await tabShot(kivo));
  const removed = downloadsPage
    ? await kivo.evaluateIn(
        downloadsPage,
        `(async () => { const { items } = await browser.kivo.request({ type: "downloads.list", payload: {} });
          const after = await browser.kivo.request({ type: "downloads.remove", payload: { id: items[0].id } });
          return items.length + ">" + after.items.length; })()`
      )
    : 'no page';
  check('removing a download takes it off the list only', removed === '3>2', removed);

  // ---------- الـ History ----------
  const history = await json(`(async () => {
    PlacesCommandHook.showPlacesOrganizer("History");
    await new Promise(r => setTimeout(r, 2500));
    const tab = gBrowser.selectedBrowser.currentURI.spec;
    PlacesCommandHook.showPlacesOrganizer("AllBookmarks");
    await new Promise(r => setTimeout(r, 2500));
    const library = Services.wm.getMostRecentWindow("Places:Organizer");
    library?.close();
    return JSON.stringify({ tab, bookmarksLibrary: !!library });
  })()`);
  check('"Show all history" opens the Kivo history page', history.tab === `${HOME}history.html`, history.tab);
  check('managing bookmarks still opens the Library', history.bookmarksLibrary, history.bookmarksLibrary);
  await sleep(1500);
  const historyPage = await pageContext('history.html');
  const visits = historyPage
    ? await kivo.evaluateIn(
        historyPage,
        `(async () => { await new Promise(r => setTimeout(r, 500));
          const rows = document.querySelectorAll(".row").length;
          const { items } = await browser.kivo.request({ type: "history.query", payload: { limit: 100 } });
          await browser.kivo.request({ type: "history.delete", payload: { ids: [items[0].id] } });
          const after = (await browser.kivo.request({ type: "history.query", payload: { limit: 100 } })).items;
          const search = (await browser.kivo.request({ type: "history.query", payload: { text: "nasa", limit: 100 } })).items;
          return JSON.stringify({ rows, total: items.length, after: after.length, gone: !after.some(v => v.id === items[0].id), search: search.length });
        })()`
      )
    : '{}';
  const v = JSON.parse(visits);
  check('the history page lists every visit, by day', v.rows === 20 && v.total === 20, v);
  check('removing a visit removes that visit only', v.after === 19 && v.gone, v);
  check('history search finds by name or address', v.search === 2, v.search);
  savePng('g5-history', await tabShot(kivo));

  // ---------- الـ sidebars ----------
  const sidebar = async (id, name) => {
    const png = await kivo.evaluate(`(async () => {
      const shot = ${WINDOW_SHOT};
      SidebarController.show(${JSON.stringify(id)});
      await new Promise(r => setTimeout(r, 3000));
      try { return await shot(window); } finally { SidebarController.hide(); }
    })()`);
    savePng(name, Buffer.from(png.slice(png.indexOf(',') + 1), 'base64'));
  };
  await kivo.evaluate(`gBrowser.selectedTab = gBrowser.tabs[0]; "ok"`);
  await sidebar('viewHistorySidebar', 'g5-history-sidebar');
  const historySidebar = await json(`(async () => {
    SidebarController.show("viewHistorySidebar");
    await new Promise(r => setTimeout(r, 2500));
    const doc = SidebarController.browser.contentDocument;
    const out = { url: doc.documentURI, accent: doc.documentElement.style.getPropertyValue("--kivo-accent"), font: doc.defaultView.getComputedStyle(doc.body).fontFamily };
    SidebarController.hide();
    return JSON.stringify(out);
  })()`);
  check('the history sidebar has the Kivo look', historySidebar.accent === '#ff4f9a' && /Baloo/.test(historySidebar.font), historySidebar);
  const tools = await json(`JSON.stringify([...SidebarController.toolsAndExtensions.values()].filter(t => !t.disabled).map(t => t.view))`);
  check('the sidebar has its tools, even for a profile that used it before', tools.length >= 4, tools);
  await sidebar('viewBookmarksSidebar', 'g5-bookmarks-sidebar');
  await kivo.evaluate(`Services.prefs.setBoolPref("sidebar.updatedBookmarks.enabled", true); "ok"`);
  await sleep(500);
  await sidebar('viewBookmarksSidebar', 'g5-bookmarks-sidebar-new');
} catch (e) {
  console.error(e);
  code = 1;
} finally {
  await kivo.close();
}
writeFileSync(join(args.out, 'pages-check.json'), JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(code || (failed ? 1 : 0));
