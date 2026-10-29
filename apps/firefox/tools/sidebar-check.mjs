#!/usr/bin/env node
// أدوات الـ sidebar (KivoSidebar.sys.mjs)، headless: أكتر من chatbot، وأي موقع، و "Add a tool" مكان الـ checkboxes في
// Customize، والترتيب بالسحب والأسهم، والنوافذ التانية، وبعد ما Kivo يتقفل ويتفتح. مواقع الـ chatbots مابتتفتحش فعلًا:
// الـ proxy على port مقفول، فالـ panel بيطلب العنوان وبتطلع صفحة خطأ، وده كفاية نعرف إنه طلب الموقع الصح من غير ما
// نكلّم ChatGPT ولا Gemini. و "أي موقع" بيتجرب على سيرفر محلي (127.0.0.1 مش بيعدّي على الـ proxy) فيه صفحة باسم ولوجو.
// Open tabs مقفولة في Firefox 158 (sidebar.openTabsPanel.enabled)، والاختبار بيفتحها عشان "Show preview on hover".
//
// node apps/firefox/tools/sidebar-check.mjs --kivo <Kivo.exe المتغلف> --out <فولدر>
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { WINDOW_SHOT, launch, sleep } from './kivo-bidi.mjs';

const { values: args } = parseArgs({ options: { kivo: { type: 'string' }, out: { type: 'string' } } });
if (!args.kivo || !args.out) {
  console.error('usage: sidebar-check.mjs --kivo <Kivo.exe> --out <dir>');
  process.exit(2);
}
mkdirSync(args.out, { recursive: true });

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const PREFS = {
  'sidebar.revamp': true,
  'sidebar.verticalTabs': true,
  'sidebar.new-sidebar.has-used': true,
  'sidebar.openTabsPanel.enabled': true,
  'browser.ml.chat.enabled': true,
  'browser.ml.chat.provider': '',
  'network.proxy.type': 1,
  'network.proxy.http': '127.0.0.1',
  'network.proxy.http_port': 9,
  'network.proxy.ssl': '127.0.0.1',
  'network.proxy.ssl_port': 9,
  'network.proxy.allow_hijacking_localhost': false,
};
// Passwords بقت من الأدوات الأساسية في Firefox 159.
const DEFAULT_TOOLS = ['opentabs', 'bookmarks', 'aichat', 'history', 'syncedtabs', 'passwords'];

// الموقع التجريبي: صفحة باسم في og:site_name ولوجو SVG، وأيقونة صغيرة أضعف منه.
const served = [];
const server = createServer((req, res) => {
  served.push({ path: req.url, cookie: req.headers.cookie ?? null });
  if (req.url === '/app') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><html><head><title>Inbox - Kivo Test Site</title><meta property="og:site_name" content="Kivo Test Site">' +
      '<link rel="icon" sizes="16x16" href="/small.png"><link rel="icon" type="image/svg+xml" href="/logo.svg"></head><body>Kivo test site</body></html>');
  } else if (req.url === '/logo.svg') {
    res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
    res.end('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="15" fill="#25d366"/><path d="M9 17l5 5 9-11" stroke="#fff" stroke-width="3" fill="none"/></svg>');
  } else {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const SITE = `http://127.0.0.1:${server.address().port}/app`;

// كود بيتحط قبل أي evaluate: الـ module، وصفحة Customize، وقايمة Add.
const HELPERS = `
  const { KivoSidebar } = ChromeUtils.importESModule("moz-src:///browser/components/kivo/KivoSidebar.sys.mjs");
  const pause = ms => new Promise(r => setTimeout(r, ms));
  const tools = () => Services.prefs.getStringPref("sidebar.main.tools").split(",");
  const launcher = async (win = window) => {
    const main = win.document.querySelector("sidebar-main");
    await main.updateComplete;
    return [...main.shadowRoot.querySelectorAll("moz-button[view]")]
      .filter(b => b.getAttribute("view") !== "viewCustomizeSidebar")
      .map(b => ({ view: b.getAttribute("view"), icon: b.iconSrc, label: b.title || b.buttonEl?.title || null }));
  };
  const page = () => SidebarController.browser.contentDocument?.querySelector("sidebar-customize");
  const customize = async () => {
    await SidebarController.show("viewCustomizeSidebar");
    for (let i = 0; i < 30 && !page()?.shadowRoot?.querySelector(".kivo-add"); i++) await pause(100);
  };
  const rows = async () => {
    await page().updateComplete;
    return [...page().shadowRoot.querySelectorAll(".kivo-tool")].map(r => ({
      tool: r.dataset.tool,
      label: r.querySelector(".kivo-tool-label").textContent.trim(),
      icon: r.querySelector(".kivo-tool-icon").getAttribute("src"),
    }));
  };
  const openAdd = async () => {
    await page().updateComplete;
    page().shadowRoot.querySelector(".kivo-add").click();
    const menu = document.getElementById("kivo-sidebar-add-menu");
    const groups = [[]];
    for (const el of menu.children) {
      if (el.localName === "menuseparator") groups.push([]);
      else groups.at(-1).push(el.getAttribute("label"));
    }
    return groups;
  };
  const choose = async label => {
    const menu = document.getElementById("kivo-sidebar-add-menu");
    [...menu.querySelectorAll("menuitem")].find(i => i.getAttribute("label") === label).doCommand();
    menu.hidePopup();
    await pause(400);
  };
  // الطلبات اللي اتبعتت لمواقع الـ chatbots (الـ proxy بيقفلها، فالصفحة نفسها بتفضل about:blank).
  const watchRequests = () => {
    const seen = [];
    const observer = { observe(subject) { const { spec } = subject.QueryInterface(Ci.nsIChannel).URI; if (/gemini\\.google|chatgpt|claude\\.ai/.test(spec)) seen.push(spec); } };
    Services.obs.addObserver(observer, "http-on-opening-request");
    return { seen, stop: () => Services.obs.removeObserver(observer, "http-on-opening-request") };
  };
  const inner = () => SidebarController.browser.contentDocument.querySelector("#browser-container browser");
  // الصفحة اللي الـ panel فيها: الـ proxy مابيخليش أي صفحة تفتح، فبنقول للـ panel إنه فيها.
  const pretendAt = url => Object.defineProperty(inner(), "currentURI", { configurable: true, get: () => Services.io.newURI(url) });
  const removeRow = async tool => {
    await page().updateComplete;
    page().shadowRoot.querySelector('.kivo-tool[data-tool="' + tool + '"] .kivo-tool-remove').click();
    await pause(400);
  };
  const row = tool => page().shadowRoot.querySelector('.kivo-tool[data-tool="' + tool + '"]');
  // سحب سطر على سطر تاني، فوق نصه أو تحته، بنفس الأحداث اللي الماوس بيعملها.
  const drag = async (from, to, after) => {
    await page().updateComplete;
    const fire = (el, type, y) => el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, composed: true, dataTransfer: new DataTransfer(), clientY: y }));
    const box = row(to).getBoundingClientRect();
    const y = after ? box.bottom - 2 : box.top + 2;
    fire(row(from), "dragstart", 0);
    fire(row(to), "dragover", y);
    const marked = row(to).className;
    fire(row(to), "drop", y);
    fire(row(from), "dragend", 0);
    await pause(400);
    return marked;
  };
  // "Any website…": الخانتين، و Enter.
  const addSite = async (address, name = "") => {
    await openAdd();
    await choose("Any website…");
    await page().updateComplete;
    const form = page().shadowRoot.querySelector(".kivo-site");
    form.querySelector("input[name=address]").value = address;
    form.querySelector("input[name=name]").value = name;
    form.querySelector("input[name=address]").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }));
    await pause(500);
    const error = page()?.shadowRoot?.querySelector(".kivo-site-error")?.textContent.trim() ?? null;
    return { error, open: SidebarController.currentID };
  };
  const sites = () => JSON.parse(Services.prefs.getStringPref("kivo.sidebar.sites", "[]"));
`;

const profile = mkdtempSync(join(tmpdir(), 'kivo-sidebar-'));
let code = 0;
let kivo = await launch(args.kivo, PREFS, { profile });
const json = async (body) => JSON.parse(await kivo.evaluate(`(async () => { ${HELPERS} ${body} })()`));
const shot = async (name) => {
  const png = await kivo.evaluate(`(${WINDOW_SHOT})(window)`);
  writeFileSync(join(args.out, `${name}.png`), Buffer.from(png.slice(png.indexOf(',') + 1), 'base64'));
};

try {
  await kivo.evaluate(`window.resizeTo(1280, 860); "ok"`);
  await sleep(3000);

  // ---------- Customize: لستة وزرار Add ----------
  const start = await json(`
    await customize();
    const root = page().shadowRoot;
    return JSON.stringify({
      tools: tools(),
      rows: await rows(),
      checkboxes: root.querySelectorAll(".tools moz-checkbox.tool").length,
      add: !!root.querySelector(".kivo-add"),
      hoverPreview: !!root.querySelector(".kivo-tool-option#hover-preview"),
      font: getComputedStyle(root.querySelector(".sidebar-panel")).fontFamily,
    });
  `);
  check('Customize lists the tools in the launcher, in order', same(start.rows.map((r) => r.tool), DEFAULT_TOOLS), start.rows);
  check('no tool checkboxes, an "Add a tool" button', start.checkboxes === 0 && start.add, start);
  check('the chatbot with no provider yet is "AI chatbot"', start.rows.find((r) => r.tool === 'aichat')?.label === 'AI chatbot', start.rows);
  check('"Show preview on hover" stays under Open tabs', start.hoverPreview);
  check('Customize uses the Kivo font', /Readex/.test(start.font), start.font);

  const menu1 = await json(`return JSON.stringify(await openAdd());`);
  // الأدوات اللي مش موجودة بتتجرب تحت مع History، لأن كلها في الـ launcher من الأول.
  check('Add offers every chatbot, then any website', menu1.length === 2 && same(menu1[0], ['ChatGPT', 'Google Gemini', 'Anthropic Claude', 'Copilot', 'Mistral Vibe', 'HuggingChat', 'Yahoo Scout']) && same(menu1[1], ['Any website…']), menu1);

  // ---------- أول chatbot هو بتاع Firefox ----------
  const first = await json(`
    await choose("ChatGPT");
    const open = SidebarController.currentID;
    await customize();
    return JSON.stringify({ open, tools: tools(), provider: Services.prefs.getStringPref("browser.ml.chat.provider"), rows: await rows(), launcher: await launcher() });
  `);
  check('the new chatbot opens, to sign in', first.open === 'viewGenaiChatSidebar', first.open);
  check('the first chatbot is Firefox\'s own, with that provider', same(first.tools, DEFAULT_TOOLS) && first.provider === 'https://chatgpt.com', first);
  check('its row and launcher button say ChatGPT', first.rows.find((r) => r.tool === 'aichat')?.label === 'ChatGPT' && first.launcher.find((b) => b.view === 'viewGenaiChatSidebar')?.icon.endsWith('chatgpt.svg'), first);

  // ---------- chatbot تاني ----------
  const second = await json(`
    const menu = await openAdd();
    await choose("Google Gemini");
    const open = SidebarController.currentID;
    await customize();
    return JSON.stringify({ menu, open, tools: tools(), rows: await rows(), launcher: await launcher() });
  `);
  check('Gemini opens once added', second.open === 'kivoChatSidebar-gemini', second.open);
  check('ChatGPT is not offered twice', !second.menu.flat().includes('ChatGPT'), second.menu);
  check('Gemini is added at the end of the tools', second.tools.at(-1) === 'kivochat-gemini' && second.tools.length === DEFAULT_TOOLS.length + 1, second.tools);
  check('Gemini has its own launcher button, last, with its logo', same(second.launcher.at(-1), { view: 'kivoChatSidebar-gemini', icon: 'chrome://browser/content/genai/assets/brands/gemini.svg', label: 'Google Gemini' }), second.launcher);
  check('both chatbots are in the launcher', second.launcher.filter((b) => /Genai|kivoChat/.test(b.view)).length === 2, second.launcher);
  check('Customize lists Gemini last', second.rows.at(-1)?.tool === 'kivochat-gemini' && second.rows.at(-1)?.label === 'Google Gemini', second.rows);

  // ---------- الأدوات اللي مابتتكررش ----------
  const single = await json(`
    await removeRow("history");
    const removed = { tools: tools(), rows: (await rows()).map(r => r.tool) };
    const menu = await openAdd();
    await choose("History");
    const menuAfter = await openAdd();
    document.getElementById("kivo-sidebar-add-menu").hidePopup();
    return JSON.stringify({ removed, menu, menuAfter, tools: tools(), launcher: (await launcher()).map(b => b.view) });
  `);
  check('removing History takes it out of the tools and the list', !single.removed.tools.includes('history') && !single.removed.rows.includes('history'), single.removed);
  check('Add offers History once it is gone, before the chatbots', single.menu[0].includes('History') && single.menu.length === 3 && !single.menu[1].includes('History'), single.menu);
  check('added again, History is not offered any more', !single.menuAfter.flat().includes('History'), single.menuAfter);
  check('History comes back at the end, after Gemini', same(single.tools.slice(-2), ['kivochat-gemini', 'history']) && same(single.launcher.slice(-2), ['kivoChatSidebar-gemini', 'viewHistorySidebar']), single);

  // ---------- من غير chatbot Firefox، أول واحد بيرجعله ----------
  const again = await json(`
    await removeRow("aichat");
    const menu = await openAdd();
    await choose("Anthropic Claude");
    return JSON.stringify({ menu, tools: tools(), provider: Services.prefs.getStringPref("browser.ml.chat.provider") });
  `);
  check('removing ChatGPT offers it again', again.menu.flat().includes('ChatGPT'), again.menu);
  check('the next chatbot goes back to Firefox\'s own', again.tools.includes('aichat') && !again.tools.some((t) => t === 'kivochat-claude') && again.provider === 'https://claude.ai/new', again);

  // ---------- panel الـ chatbot الزيادة ----------
  const panel = await json(`
    const requests = watchRequests();
    await SidebarController.show("kivoChatSidebar-gemini");
    await pause(3000);
    requests.stop();
    const doc = SidebarController.browser.contentDocument;
    const browser = inner();
    await launcher();
    return JSON.stringify({
      url: doc.location.href,
      title: doc.getElementById("title").textContent,
      icon: doc.getElementById("icon").getAttribute("src"),
      remote: browser?.isRemoteBrowser,
      group: browser?.getAttribute("messagemanagergroup"),
      requested: requests.seen,
      font: getComputedStyle(doc.body).fontFamily,
      selected: [...document.querySelector("sidebar-main").shadowRoot.querySelectorAll('moz-button[view][type="icon"]')].map(b => b.getAttribute("view")),
    });
  `);
  check('the Gemini panel opens with its name and logo', panel.url.endsWith('sidebar-web.html?tool=kivochat-gemini') && panel.title === 'Google Gemini' && panel.icon.endsWith('gemini.svg'), panel);
  check('the panel asks for Gemini, in a content process', panel.remote && panel.group === 'chatbot-browser' && same(panel.requested, ['https://gemini.google.com/']), panel);
  check('its launcher button is the selected one', same(panel.selected, ['kivoChatSidebar-gemini']), panel.selected);
  check('the panel uses the Kivo font', /Readex/.test(panel.font), panel.font);
  await shot('gemini-panel');

  const place = await json(`
    const reopen = async () => {
      await SidebarController.show("viewHistorySidebar");
      await pause(1500);
      const requests = watchRequests();
      await SidebarController.show("kivoChatSidebar-gemini");
      await pause(2500);
      requests.stop();
      return requests.seen;
    };
    pretendAt("https://gemini.google.com/app/kivo-test");
    const conversation = await reopen();
    pretendAt("https://accounts.google.com/signin");
    const signIn = await reopen();
    return JSON.stringify({ conversation, signIn });
  `);
  check('back from another panel, Gemini opens the same conversation', same(place.conversation, ['https://gemini.google.com/app/kivo-test']), place);
  check('a sign-in page on another site is not remembered', same(place.signIn, ['https://gemini.google.com/app/kivo-test']), place);

  // ---------- قايمة الـ panels من غير launcher، و View > Sidebar ----------
  const switcher = await json(`
    const items = await SidebarController.getRevampSwitcherItems();
    return JSON.stringify({ items, menu: document.getElementById("menu_kivoChatSidebar-gemini")?.getAttribute("label") });
  `);
  check('the panel switcher lists Gemini by name', switcher.items.some((i) => i.view === 'kivoChatSidebar-gemini' && i.label === 'Google Gemini') && switcher.items.every((i) => i.label), switcher.items);
  check('View > Sidebar has Gemini by name', switcher.menu === 'Google Gemini', switcher.menu);

  // ---------- الترتيب: بالسحب وبالأسهم ----------
  const sorted = await json(`
    await customize();
    const marked = await drag("kivochat-gemini", "bookmarks", false);
    const dragged = { tools: tools(), rows: (await rows()).map(r => r.tool), launcher: (await launcher()).map(b => b.view) };
    const grip = row("history").querySelector(".kivo-tool-grip");
    grip.focus();
    grip.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, composed: true }));
    await pause(500);
    await page().updateComplete;
    const keyed = { tools: tools(), focused: page().shadowRoot.activeElement?.closest(".kivo-tool")?.dataset.tool ?? null };
    const markedBelow = await drag("opentabs", "aichat", true);
    return JSON.stringify({ marked, dragged, keyed, markedBelow, tools: tools(), option: row("opentabs").nextElementSibling?.id ?? null });
  `);
  check('dragging shows where it goes', /kivo-drop-before/.test(sorted.marked) && /kivo-drop-after/.test(sorted.markedBelow), sorted);
  check('dragging Gemini above Bookmarks moves it there', same(sorted.dragged.tools, ['opentabs', 'kivochat-gemini', 'bookmarks', 'syncedtabs', 'passwords', 'history', 'aichat']) && same(sorted.dragged.rows, sorted.dragged.tools), sorted.dragged);
  check('the launcher follows the new order', same(sorted.dragged.launcher, ['viewOpenTabsSidebar', 'kivoChatSidebar-gemini', 'viewBookmarksSidebar', 'viewTabsSidebar', 'viewCPMSidebar', 'viewHistorySidebar', 'viewGenaiChatSidebar']), sorted.dragged.launcher);
  check('the up arrow moves History up and keeps the focus on it', same(sorted.keyed.tools, ['opentabs', 'kivochat-gemini', 'bookmarks', 'syncedtabs', 'history', 'passwords', 'aichat']) && sorted.keyed.focused === 'history', sorted.keyed);
  check('dropping below the last tool puts it last, with its option under it', sorted.tools.at(-1) === 'opentabs' && sorted.option === 'hover-preview', sorted);

  // ---------- أي موقع ----------
  const site = await json(`
    await customize();
    const invalid = await addSite("hello world");
    const added = await addSite(${JSON.stringify(SITE)});
    const tool = tools().at(-1);
    await pause(3500);
    const stored = sites();
    const icon = Services.prefs.getStringPref("kivo.sidebar.siteIcon." + (stored[0]?.id ?? "none"), "");
    const button = (await launcher()).at(-1);
    const doc = SidebarController.browser.contentDocument;
    const header = { url: doc.location.href, title: doc.getElementById("title")?.textContent, icon: doc.getElementById("icon")?.getAttribute("src")?.slice(0, 22) };
    await customize();
    const duplicate = await addSite(${JSON.stringify(`${SITE}/`)});
    await customize();
    const chat = await addSite("chatgpt.com");
    return JSON.stringify({ invalid, added, tool, stored, icon: icon.slice(0, 22), iconLength: icon.length, button: { ...button, icon: button.icon.slice(0, 22) }, header, duplicate, chat, tools: tools(), sitesAfter: sites().length });
  `);
  check('a wrong address says what to type', /web address/.test(site.invalid.error ?? '') && site.invalid.open === 'viewCustomizeSidebar', site.invalid);
  check('a website is added at the end and opens', /^kivosite-[a-z0-9]+$/.test(site.tool) && site.added.open === `kivoSiteSidebar-${site.tool.slice(9)}` && site.added.error === null, site);
  check('its name comes from the site', site.stored.length === 1 && site.stored[0].name === 'Kivo Test Site' && site.stored[0].auto === false, site.stored);
  check('its logo comes from the site, as a small PNG', site.icon === 'data:image/png;base64,' && site.iconLength < 16000, site);
  check('the launcher shows its name and logo', site.button.label === 'Kivo Test Site' && site.button.icon === 'data:image/png;base64,', site.button);
  check('its panel shows the site with its name and logo', site.header.url.endsWith(`sidebar-web.html?tool=${site.tool}`) && site.header.title === 'Kivo Test Site' && site.header.icon === 'data:image/png;base64,', site.header);
  check('the same website is not added twice', site.duplicate.error === 'Kivo Test Site is already in your sidebar', site.duplicate);
  check('a chatbot address becomes that chatbot', site.chat.open === 'kivoChatSidebar-chatgpt' && site.tools.includes('kivochat-chatgpt') && site.sitesAfter === 1, site);
  check('the site was asked for its page and logo, with no cookies', served.some((r) => r.path === '/logo.svg') && served.filter((r) => r.path === '/app').length >= 2 && served.every((r) => !r.cookie), served);
  await json(`await customize(); await pause(800); return "{}";`);
  await shot('customize');

  // ---------- الـ launcher: صف واحد، والباقي في More ----------
  const LAUNCHER = `
    const main = document.querySelector("sidebar-main");
    await main.updateComplete;
    await pause(800);
    const buttons = [...main.shadowRoot.querySelectorAll(".tools-and-extensions:not(.overflow-button) > moz-button[view]")];
    const shown = buttons.filter(b => b.style.visibility !== "hidden");
    const more = main.shadowRoot.querySelector(".overflow-button");
    return {
      expanded: main.hasAttribute("expanded"),
      all: buttons.map(b => b.getAttribute("view")),
      shown: shown.map(b => b.getAttribute("view")),
      rows: new Set(shown.map(b => Math.round(b.getBoundingClientRect().top))).size,
      more: !!more && !more.hidden,
      list: [...document.querySelectorAll("#tools-overflow-list > moz-button")].map(b => b.getAttribute("view")),
    };
  `;
  const many = await json(`const r = await (async () => { ${LAUNCHER} })(); return JSON.stringify(r);`);
  await shot('launcher');
  const few = await json(`
    const saved = Services.prefs.getStringPref("sidebar.main.tools");
    Services.prefs.setStringPref("sidebar.main.tools", "bookmarks,history,aichat");
    const r = await (async () => { ${LAUNCHER} })();
    Services.prefs.setStringPref("sidebar.main.tools", saved);
    await pause(800);
    return JSON.stringify(r);
  `);
  check('with many tools the launcher is one row', many.expanded && many.rows === 1 && many.shown.length >= 3, many);
  check('the rest is under More tools, after the ones shown, in order', many.more && many.list.length > 0 && same([...many.shown, ...many.list], many.all), many);
  check('with a few tools they all show, with no More', few.rows === 1 && !few.more && same(few.shown, few.all) && few.list.length === 0, few);

  // ---------- بعد ما Kivo يتقفل ويتفتح ----------
  // قبل النافذة التانية: Firefox نفسه مابيرجّعش الـ panel المفتوح لو نافذة تانية اتفتحت واتقفلت (History زي Gemini).
  const before = await json(`
    await SidebarController.show("kivoChatSidebar-gemini");
    await pause(1500);
    return JSON.stringify({ tools: tools(), launcher: (await launcher()).map(b => b.view) });
  `);
  await kivo.quit();
  // من غير browser.ml.chat.provider: user.js كان هيرجّعه فاضي، و chatbot Firefox من غير provider بياخد أول chatbot يتضاف.
  const { 'browser.ml.chat.provider': _, ...relaunchPrefs } = PREFS;
  kivo = await launch(args.kivo, relaunchPrefs, { profile });
  await sleep(5000);
  const after = await json(`
    const button = (await launcher()).find(b => b.view.startsWith("kivoSiteSidebar-"));
    return JSON.stringify({ tools: tools(), launcher: (await launcher()).map(b => b.view), open: SidebarController.currentID, page: SidebarController.browser.contentDocument?.location.href, site: button && { label: button.label, icon: button.icon.slice(0, 22) } });
  `);
  check('after a restart the tools and their order are the same', same(after.tools, before.tools) && same(after.launcher, before.launcher), { before, after });
  check('the Gemini panel that was open comes back', after.open === 'kivoChatSidebar-gemini' && /sidebar-web\.html\?tool=kivochat-gemini/.test(after.page ?? ''), after);
  check('the website keeps its name and logo', after.site?.label === 'Kivo Test Site' && after.site?.icon === 'data:image/png;base64,', after.site);

  // ---------- نافذة تانية ----------
  const windows = await json(`
    const other = OpenBrowserWindow();
    await new Promise(r => other.addEventListener("load", r, { once: true }));
    await pause(3000);
    const views = async win => (await launcher(win)).map(b => b.view);
    const mine = await views(window);
    const opened = await views(other);
    KivoSidebar.removeTool("kivochat-gemini");
    await pause(500);
    const removed = { here: await views(window), there: await views(other) };
    KivoSidebar.addChat("gemini");
    await pause(500);
    const added = { here: await views(window), there: await views(other) };
    other.close();
    return JSON.stringify({ mine, opened, removed, added });
  `);
  check('a new window has the same tools, in the same order', same(windows.opened, windows.mine), windows);
  check('removing Gemini removes it in every window', !windows.removed.here.includes('kivoChatSidebar-gemini') && !windows.removed.there.includes('kivoChatSidebar-gemini'), windows.removed);
  check('adding it back adds it in every window, at the end', windows.added.here.at(-1) === 'kivoChatSidebar-gemini' && windows.added.there.at(-1) === 'kivoChatSidebar-gemini', windows.added);

  // ---------- شيل الموقع ----------
  const removedSite = await json(`
    const tool = tools().find(t => t.startsWith("kivosite-"));
    await customize();
    await removeRow(tool);
    return JSON.stringify({ tools: tools(), sites: sites(), icon: Services.prefs.prefHasUserValue("kivo.sidebar.siteIcon." + tool.slice(9)), launcher: (await launcher()).map(b => b.view) });
  `);
  check('removing a website removes it, its name and its logo', !removedSite.tools.some((t) => t.startsWith('kivosite-')) && removedSite.sites.length === 0 && !removedSite.icon && !removedSite.launcher.some((v) => v.startsWith('kivoSiteSidebar-')), removedSite);
} catch (error) {
  console.error(error);
  code = 1;
} finally {
  await kivo.quit();
  server.close();
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} of ${results.length} passed`);
writeFileSync(join(args.out, 'sidebar-check.json'), JSON.stringify(results, null, 2));
process.exit(code || (failed.length ? 1 : 0));
