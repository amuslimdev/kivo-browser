#!/usr/bin/env node
// widgets الشغل اليومي على Kivo Home، headless: كمّل من مكانك (sessions.* و sites.recent)، وفولدر bookmarks
// (bookmarks.folders و bookmarks.folder)، وقايمة المهام (التحقق في widgets.set). الصفحات من سيرفر محلي، فمفيش نت.
// التاب المقفول بيرجع من دوسة على الـ widget نفسه: في التاب الجديد الفاضي بيرجع مكانه بالـ back بتاعه، ومن تاب
// ليه history بيفتح في تاب جديد. وصورة للصفحة بالـ 3 widgets.
// وبعدهم: الـ workspaces والتحميلات، والطقس والعملات والأخبار (weather.get و rates.get و feed.get) من نفس السيرفر
// عن طريق prefs العناوين، والـ cache، وصورة تانية بالخمسة. وفي الآخر زرار "New workspace" في نافذة workspace لونها
// فاتح أوي: لون كلامه بيتقري على القايمة (APCA) في الفاتح والغامق، وصورة للقايمة في الاتنين.
//
// node apps/firefox/tools/widgets-check.mjs --kivo <Kivo.exe متغلف> --out <فولدر>
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { PANEL_SHOT, WINDOW_SHOT, launch, sleep, tabShot } from './kivo-bidi.mjs';

const { values: args } = parseArgs({ options: { kivo: { type: 'string' }, out: { type: 'string' } } });
if (!args.kivo || !args.out) {
  console.error('usage: widgets-check.mjs --kivo <exe> --out <dir>');
  process.exit(2);
}
mkdirSync(args.out, { recursive: true });

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`);
};

// ردود زي Open-Meteo و exchange-api، و RSS و Atom، وصفحة بتعلن عن feed. hits بيعدّ الطلبات عشان الـ cache.
const hits = { weather: 0, rates: 0 };
const DAYS = ['2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28'];
const WEATHER = {
  current: { temperature_2m: 27.4, apparent_temperature: 29.1, relative_humidity_2m: 48, weather_code: 1, is_day: 1, wind_speed_10m: 14.2 },
  daily: {
    time: DAYS,
    weather_code: [1, 2, 3, 61, 0, 1],
    temperature_2m_max: [29, 28, 26, 24, 27, 28],
    temperature_2m_min: [19, 18, 18, 17, 18, 19],
    precipitation_probability_max: [0, 10, 20, 70, 0, 0],
  },
};
const RATES = {
  latest: { date: '2026-10-23', usd: { egp: 48.62, eur: 0.92, sar: 3.75, gbp: 0.79, aed: 3.6725, '1inch': 3 } },
  '2026-10-22': { date: '2026-10-22', usd: { egp: 48.5, eur: 0.92, sar: 3.75, gbp: 0.79, aed: 3.6725 } },
};
const rss = (base) => `<?xml version="1.0"?><rss version="2.0"><channel><title>Kivo test news</title><link>${base}/</link>
<item><title><![CDATA[First <b>story</b>]]></title><link>${base}/alpha</link><pubDate>Thu, 22 Oct 2026 10:00:00 GMT</pubDate></item>
<item><title>Bad link</title><link>javascript:alert(1)</link></item>
<item><title>Second &amp; last</title><link>/beta</link></item>
</channel></rss>`;
const atom = (base) => `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Atom test</title><link rel="alternate" href="${base}/"/>
<entry><title>Atom entry</title><link href="${base}/gamma"/><updated>2026-10-21T08:00:00Z</updated></entry></feed>`;

const server = createServer((req, res) => {
  const url = new URL(req.url, base);
  const send = (type, body, status = 200) => {
    res.writeHead(status, { 'content-type': `${type}; charset=utf-8` });
    res.end(body);
  };
  if (url.pathname === '/weather') {
    hits.weather++;
    return send('application/json', JSON.stringify(WEATHER));
  }
  const rate = /^\/rates\/([\w-]+)\/usd\.json$/.exec(url.pathname);
  if (rate) {
    hits.rates++;
    return RATES[rate[1]] ? send('application/json', JSON.stringify(RATES[rate[1]])) : send('text/plain', 'no', 404);
  }
  if (url.pathname === '/feed.xml') return send('application/rss+xml', rss(base));
  if (url.pathname === '/atom.xml') return send('application/atom+xml', atom(base));
  if (url.pathname === '/site') return send('text/html', `<!doctype html><link rel="alternate" type="application/rss+xml" href="/feed.xml"><title>A site</title>`);
  if (url.pathname === '/plain') return send('text/html', '<!doctype html><title>No feed here</title>');
  const name = url.pathname.slice(1).replace(/[^a-z]/g, '') || 'home';
  send('text/html', `<!doctype html><title>Test page ${name}</title><h1>${name}</h1>`);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

/** Lc بتاع APCA زي KivoTheme.sys.mjs، من ألوان getComputedStyle (rgb(...)). */
function apca(text, bg) {
  const channels = (color) => color.match(/[\d.]+/g).slice(0, 3).map(Number);
  const y = (color) => {
    const [r, g, b] = channels(color).map((c) => (c / 255) ** 2.4);
    return 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  };
  const clamp = (v) => (v > 0.022 ? v : v + (0.022 - v) ** 1.414);
  const t = clamp(y(text));
  const b = clamp(y(bg));
  if (Math.abs(b - t) < 0.0005) return 0;
  const s = b > t ? (b ** 0.56 - t ** 0.57) * 1.14 : (b ** 0.65 - t ** 0.62) * 1.14;
  return Math.abs(s) < 0.1 ? 0 : (s - Math.sign(s) * 0.027) * 100;
}

const theme = {
  version: 1,
  preset: 'clean',
  mode: 'light',
  accent: '#2f80ed',
  font: 'readex',
  corners: 'round',
  background: { kind: 'color', color: '#eef1f6' },
  start: { buddy: false, clock: false, fact: false, tiles: false },
  sites: 'theme',
};

const kivo = await launch(args.kivo, {
  'kivo.widgets.weatherUrl': `${base}/weather`,
  'kivo.widgets.ratesUrls': `${base}/rates/{date}/{base}.json`,
});
let code = 0;
try {
  await kivo.evaluate(`window.resizeTo(1280, 860); "ok"`);
  let addon = null;
  for (let i = 0; i < 40 && !addon; i++) {
    addon = await kivo.evaluate(`WebExtensionPolicy.getByID("home@kivo")?.getURL("") ?? null`);
    if (!addon) await sleep(250);
  }
  check('Kivo Home is running', addon, addon);

  const waitFor = async (expression, ms = 10000) => {
    for (let t = 0; t < ms; t += 200) {
      if (await kivo.evaluate(expression)) return true;
      await sleep(200);
    }
    return false;
  };
  const selectedIs = (url) => `gBrowser.selectedBrowser.currentURI.spec === ${JSON.stringify(url)} && !gBrowser.selectedTab.hasAttribute("busy")`;
  const openTab = async (url) => {
    await kivo.evaluate(`gBrowser.selectedTab = gBrowser.addTrustedTab(${JSON.stringify(url)}); "ok"`);
    return waitFor(selectedIs(url));
  };
  const goTo = async (url) => {
    await kivo.evaluate(`openTrustedLinkIn(${JSON.stringify(url)}, "current"); "ok"`);
    return waitFor(selectedIs(url));
  };
  const homePage = async () => {
    await sleep(1500);
    return (await kivo.send('browsingContext.getTree', {})).contexts.findLast((c) => c.url.startsWith('moz-extension://'))?.context;
  };

  // تابين بيتقفلوا: gamma الأول، وبعدين alpha ← beta (ليه back).
  await openTab(`${base}/gamma`);
  await sleep(800);
  await kivo.evaluate(`gBrowser.removeTab(gBrowser.selectedTab); "ok"`);
  await openTab(`${base}/alpha`);
  const loaded = await goTo(`${base}/beta`);
  check('test pages load', loaded);
  await sleep(1500);
  await kivo.evaluate(`gBrowser.removeTab(gBrowser.selectedTab); "ok"`);
  await sleep(1500);

  await kivo.evaluate(`(BrowserCommands?.openTab ?? BrowserOpenTab)(); "ok"`);
  let page = await homePage();
  check('new tab is Kivo Home', page);
  const bridge = (type, payload = {}) =>
    kivo
      .evaluateIn(page, `browser.kivo.request(${JSON.stringify({ type, payload })}).then(r => JSON.stringify({ ok: true, r }), e => JSON.stringify({ ok: false, e: e.message }))`)
      .then(JSON.parse);

  // ---------- كمّل من مكانك ----------
  const closed = await bridge('sessions.closed');
  const closedUrls = closed.r?.items?.map((i) => i.url) ?? [];
  check('sessions.closed: newest first, where each tab stood', closed.ok && closedUrls[0] === `${base}/beta` && closedUrls[1] === `${base}/gamma`, closedUrls);
  check('sessions.closed: titles and times', closed.ok && closed.r.items[0].title === 'Test page beta' && closed.r.items[0].closedAt > Date.now() - 120000, closed.r?.items?.[0]);
  check('sessions.closed: web pages only', closed.ok && closed.r.items.every((i) => /^https?:/.test(i.url)), closedUrls);

  const recent = await bridge('sites.recent', { limit: 10 });
  const recentUrls = recent.r?.items?.map((i) => i.url) ?? [];
  check('sites.recent: each page once, newest first', recent.ok && recentUrls[0] === `${base}/beta` && ['alpha', 'gamma'].every((p) => recentUrls.includes(`${base}/${p}`)) && new Set(recentUrls).size === recentUrls.length, recentUrls);
  const badReopen = await bridge('sessions.reopen', { id: 'all' });
  check('sessions.reopen refuses a bad id', !badReopen.ok, badReopen.e);

  // ---------- bookmarks ----------
  const inserted = JSON.parse(await kivo.evaluate(`PlacesUtils.bookmarks.insertTree({
    guid: PlacesUtils.bookmarks.toolbarGuid,
    children: [{
      title: "Kivo test",
      type: PlacesUtils.bookmarks.TYPE_FOLDER,
      children: [
        { title: "Alpha", url: "${base}/alpha" },
        { title: "Inside", type: PlacesUtils.bookmarks.TYPE_FOLDER, children: [{ title: "Gamma", url: "${base}/gamma" }] },
        { title: "Bookmarklet", url: "javascript:alert(1)" },
        { type: PlacesUtils.bookmarks.TYPE_SEPARATOR },
        { title: "Beta", url: "${base}/beta" },
      ],
    }],
  }).then(items => JSON.stringify(items.filter(i => i.type === PlacesUtils.bookmarks.TYPE_FOLDER).map(i => ({ guid: i.guid, title: i.title }))))`));
  const testFolder = inserted.find((f) => f.title === 'Kivo test')?.guid;
  const folders = await bridge('bookmarks.folders');
  const list = folders.r?.items ?? [];
  check(
    'bookmarks.folders: toolbar first, nested by depth, no tags',
    folders.ok && list[0]?.id === 'toolbar_____' && list.some((f) => f.id === testFolder && f.depth === 1 && f.count === 2) && list.some((f) => f.title === 'Inside' && f.depth === 2) && !list.some((f) => f.id === 'tags________'),
    list.map((f) => `${f.depth}:${f.title}(${f.count})`),
  );
  const folder = await bridge('bookmarks.folder', { id: testFolder });
  const shape = folder.r?.items?.map((i) => (i.kind === 'folder' ? `[${i.title}:${i.count}]` : i.title)) ?? [];
  check('bookmarks.folder: links and folders in order, no bookmarklets or separators', folder.ok && folder.r.title === 'Kivo test' && shape.join(',') === 'Alpha,[Inside:1],Beta', shape);
  const toolbar = await bridge('bookmarks.folder', { id: '../../etc' });
  check('bookmarks.folder: a bad id means the toolbar', toolbar.ok && toolbar.r.id === 'toolbar_____' && toolbar.r.items.some((i) => i.id === testFolder), toolbar.r?.title);
  const tags = await bridge('bookmarks.folder', { id: 'tags________' });
  check('bookmarks.folder: not the tags', !tags.ok, tags.e);

  // ---------- الـ widgets والتحقق ----------
  const TASKS = '[ ] Reply to the Firefox upgrade issue\n[ ] أراجع الـ widgets الجديدة\n[ ] Buy groceries\n[x] Ship G6 updates\n[x] Morning run';
  const cleaned = await bridge('widgets.set', {
    widgets: [
      { id: 'c1', type: 'continue', x: 0, y: 0, w: 6, h: 5, settings: { show: 'everything' } },
      { id: 'b1', type: 'bookmarks', x: 6, y: 0, w: 6, h: 5, settings: { folder: 'not a guid' } },
      { id: 't1', type: 'tasks', x: 12, y: 0, w: 6, h: 5, settings: { title: 'Today', tasks: '[ ] fine\nnot a task' } },
      { id: 't2', type: 'tasks', x: 18, y: 0, w: 6, h: 5, settings: { tasks: TASKS } },
    ],
  });
  const byId = Object.fromEntries((cleaned.r?.widgets ?? []).map((w) => [w.id, w.settings]));
  check(
    'widgets.set: new widget types kept, bad settings dropped',
    cleaned.ok && byId.c1 && byId.c1.show === undefined && byId.b1 && byId.b1.folder === undefined && byId.t1?.title === 'Today' && byId.t1.tasks === undefined && byId.t2?.tasks === TASKS,
    byId,
  );

  await bridge('theme.set', { theme });
  await bridge('widgets.set', {
    widgets: [
      { id: 'search', type: 'search', x: 6, y: 0, w: 12, h: 1, settings: {} },
      { id: 'c1', type: 'continue', x: 0, y: 2, w: 8, h: 7, settings: { show: 'closed' } },
      { id: 'b1', type: 'bookmarks', x: 8, y: 2, w: 8, h: 7, settings: { folder: testFolder } },
      { id: 't1', type: 'tasks', x: 16, y: 2, w: 8, h: 7, settings: { title: 'Today', tasks: TASKS } },
    ],
  });
  await kivo.evaluateIn(page, `location.reload(); "ok"`);
  page = await homePage();
  await sleep(1500);
  const rendered = JSON.parse(await kivo.evaluateIn(page, `JSON.stringify({
    closed: [...document.querySelectorAll(".widget-continue .link-row .name")].map(e => e.textContent),
    folders: [...document.querySelectorAll(".widget-bookmarks .folder-row .name")].map(e => e.textContent),
    links: document.querySelectorAll(".widget-bookmarks .link-row").length,
    tasks: [...document.querySelectorAll(".widget-tasks li")].map(e => (e.classList.contains("done") ? "x " : "- ") + e.textContent.trim()),
    count: document.querySelector(".widget-tasks .count")?.textContent,
  })`));
  check('home shows closed tabs', rendered.closed[0] === 'Test page beta' && rendered.closed.includes('Test page gamma'), rendered.closed);
  check('home shows the bookmarks folder', rendered.folders.join() === 'Inside' && rendered.links === 2, rendered);
  check('home shows the tasks, done ones last', rendered.tasks.length === 5 && rendered.tasks[3].startsWith('x ') && rendered.count === '2 of 5', rendered.tasks);
  writeFileSync(join(args.out, 'widgets.png'), await tabShot(kivo));

  // مهمة جديدة من الـ widget نفسه بتتحفظ بعد تحقق الـ host.
  await kivo.evaluateIn(page, `(() => {
    const input = document.querySelector(".widget-tasks .add input");
    input.value = "Call the bank";
    input.dispatchEvent(new Event("input"));
    input.closest("form").requestSubmit();
    return "ok";
  })()`);
  await sleep(1200);
  const saved = await bridge('widgets.get');
  const savedTasks = saved.r?.widgets?.find((w) => w.id === 't1')?.settings?.tasks ?? '';
  check('a task added on the widget is saved', savedTasks.split('\n')[3] === '[ ] Call the bank', savedTasks.split('\n'));

  // دوسة على تاب مقفول من التاب الجديد الفاضي: نفس التاب بيبقى beta، والـ back بيرجع alpha، ومفيش تاب زيادة.
  const before = Number(await kivo.evaluate('gBrowser.tabs.length'));
  await kivo.evaluateIn(page, `document.querySelector(".widget-continue .link-row").click(); "ok"`);
  const inPlace = await waitFor(selectedIs(`${base}/beta`));
  await sleep(800);
  const after = JSON.parse(await kivo.evaluate(`JSON.stringify({
    tabs: gBrowser.tabs.length,
    back: gBrowser.selectedBrowser.canGoBack,
    closed: SessionStore.getClosedTabData({ sourceWindow: window }).map(t => t.state.entries[t.state.index - 1]?.url),
  })`));
  check('reopen from a fresh home tab: same tab, with its history', inPlace && after.tabs === before && after.back, after);
  check('reopen: gone from closed tabs, and the home tab is not added', !after.closed.includes(`${base}/beta`) && !after.closed.some((u) => u?.startsWith('moz-extension:')), after.closed);

  // من تاب ليه history (رجع للصفحة بـ back): التاب المقفول بيفتح في تاب جديد، والصفحة بتفضل.
  await kivo.evaluate(`(BrowserCommands?.openTab ?? BrowserOpenTab)(); "ok"`);
  await sleep(1500);
  await goTo(`${base}/alpha`);
  await kivo.evaluate(`gBrowser.goBack(); "ok"`);
  page = await homePage();
  await sleep(500);
  const tabsBefore = Number(await kivo.evaluate('gBrowser.tabs.length'));
  const gamma = (await bridge('sessions.closed')).r.items.find((i) => i.url === `${base}/gamma`);
  await bridge('sessions.reopen', { id: gamma?.id });
  const newTab = await waitFor(selectedIs(`${base}/gamma`));
  const tabsAfter = Number(await kivo.evaluate('gBrowser.tabs.length'));
  check('reopen from a home tab with history: opens a new tab', newTab && tabsAfter === tabsBefore + 1, [tabsBefore, tabsAfter]);

  // ---------- الـ workspaces والتحميلات ----------
  // تاب الهوم في النافذة الرئيسية قبل School، لأن نافذة School بتفتح على Kivo Home هي كمان. الـ context بتاعه
  // بيفضل هو نفسه بعد الـ reload.
  await kivo.evaluate(`gBrowser.selectedTab = gBrowser.tabs[0]; (BrowserCommands?.openTab ?? BrowserOpenTab)(); "ok"`);
  page = await homePage();
  const W = 'const { KivoWorkspaces: W } = ChromeUtils.importESModule("moz-src:///browser/components/kivo/KivoWorkspaces.sys.mjs");';
  await kivo.evaluate(`(async () => { ${W} await W.create({ name: "School", color: "#2f80ed" }); return "ok"; })()`);
  await sleep(1500);
  await kivo.evaluate(`(async () => {
    const { Downloads } = ChromeUtils.importESModule("resource://gre/modules/Downloads.sys.mjs");
    const list = await Downloads.getList(Downloads.PUBLIC);
    const path = PathUtils.join(PathUtils.tempDir, "kivo-widgets-report.pdf");
    await IOUtils.writeUTF8(path, "kivo test file");
    await list.add(await Downloads.createDownload({ source: { url: "${base}/report.pdf" }, target: { path }, succeeded: true, startTime: new Date().toISOString(), totalBytes: 14 }));
    return "ok";
  })()`);
  const spaces = await bridge('workspaces.list');
  const school = spaces.r?.items?.find((w) => w.name === 'School');
  check('workspaces.list: name, color, and open in its own window', spaces.ok && school?.color === '#2f80ed' && school.open && !school.current, spaces.r?.items ?? spaces.e);
  const badSpace = await bridge('workspaces.open', { id: '../x' });
  check('workspaces.open refuses a bad id', !badSpace.ok, badSpace.e);

  // ---------- من النت ----------
  const weather = await bridge('weather.get', { lat: 30.04, lon: 31.24, unit: 'c' });
  check('weather.get: now and the next days', weather.ok && weather.r.current.temp === 27.4 && weather.r.current.code === 1 && weather.r.days.length === 6 && weather.r.days[3].rain === 70, weather.r?.current ?? weather.e);
  const weatherAgain = await bridge('weather.get', { lat: 30.04, lon: 31.24, unit: 'c' });
  check('weather.get: the second ask comes from memory', weatherAgain.ok && hits.weather === 1, hits.weather);
  const badPlace = await bridge('weather.get', { lat: 200, lon: 0 });
  check('weather.get refuses a bad place', !badPlace.ok, badPlace.e);
  const rates = await bridge('rates.get', { base: 'USD' });
  check(
    'rates.get: today and yesterday, 3-letter codes only',
    rates.ok && rates.r.date === '2026-10-23' && rates.r.rates.EGP === 48.62 && rates.r.previous?.EGP === 48.5 && !Object.keys(rates.r.rates).some((c) => c.length !== 3),
    rates.r ? { date: rates.r.date, EGP: rates.r.rates.EGP, before: rates.r.previous?.EGP } : rates.e,
  );
  const ratesHits = hits.rates;
  await bridge('rates.get', { base: 'USD' });
  check('rates.get: the second ask comes from memory', hits.rates === ratesHits, hits.rates);
  const news = await bridge('feed.get', { url: `${base}/feed.xml` });
  check(
    'feed.get: RSS titles as plain text, web links only',
    news.ok && news.r.title === 'Kivo test news' && news.r.items.map((i) => i.title).join('|') === 'First story|Second & last' && news.r.items[1].url === `${base}/beta` && news.r.items[0].date === Date.parse('Thu, 22 Oct 2026 10:00:00 GMT'),
    news.r?.items ?? news.e,
  );
  const atomFeed = await bridge('feed.get', { url: `${base}/atom.xml` });
  check('feed.get: Atom', atomFeed.ok && atomFeed.r.title === 'Atom test' && atomFeed.r.items[0]?.url === `${base}/gamma`, atomFeed.r ?? atomFeed.e);
  const found = await bridge('feed.get', { url: `${base}/site` });
  check('feed.get: finds the feed a site links to', found.ok && found.r.title === 'Kivo test news', found.r?.title ?? found.e);
  const noFeed = await bridge('feed.get', { url: `${base}/plain` });
  check('feed.get: a page with no feed is an error', !noFeed.ok, noFeed.e);
  const notWeb = await Promise.all(['javascript:alert(1)', 'file:///C:/Windows/win.ini', `http://user:pass@127.0.0.1/`].map((url) => bridge('feed.get', { url })));
  check('feed.get refuses addresses that are not plain web pages', notWeb.every((r) => !r.ok), notWeb.map((r) => r.e));

  const more = await bridge('widgets.set', {
    widgets: [
      { id: 'n1', type: 'weather', x: 0, y: 0, w: 6, h: 3, settings: { city: 'cairo', unit: 'k' } },
      { id: 'n2', type: 'rates', x: 6, y: 0, w: 4, h: 4, settings: { from: 'usd', to: 'EGP' } },
      { id: 'n3', type: 'news', x: 10, y: 0, w: 6, h: 6, settings: { feed: 'javascript:alert(1)' } },
      { id: 'n4', type: 'news', x: 16, y: 0, w: 6, h: 6, settings: { feed: `${base}/feed.xml` } },
      { id: 'n5', type: 'workspaces', x: 0, y: 6, w: 6, h: 4, settings: {} },
      { id: 'n6', type: 'downloads', x: 6, y: 6, w: 6, h: 4, settings: {} },
    ],
  });
  const moreById = Object.fromEntries((more.r?.widgets ?? []).map((w) => [w.id, w.settings]));
  check(
    'widgets.set: weather, rates, news, workspaces and downloads, bad settings dropped',
    more.ok && JSON.stringify(moreById) === JSON.stringify({ n1: { city: 'cairo' }, n2: { to: 'EGP' }, n3: {}, n4: { feed: `${base}/feed.xml` }, n5: {}, n6: {} }),
    moreById,
  );

  await bridge('widgets.set', {
    widgets: [
      { id: 'weather', type: 'weather', x: 0, y: 0, w: 6, h: 7, settings: { city: 'cairo', unit: 'c' } },
      { id: 'rates', type: 'rates', x: 6, y: 0, w: 5, h: 7, settings: { from: 'USD', to: 'EGP' } },
      { id: 'news', type: 'news', x: 11, y: 0, w: 7, h: 7, settings: { feed: `${base}/feed.xml` } },
      { id: 'workspaces', type: 'workspaces', x: 18, y: 0, w: 6, h: 4, settings: {} },
      { id: 'downloads', type: 'downloads', x: 18, y: 4, w: 6, h: 3, settings: {} },
    ],
  });
  await kivo.evaluateIn(page, `location.reload(); "ok"`);
  await sleep(3500);
  const shown = JSON.parse(await kivo.evaluateIn(page, `JSON.stringify({
    temp: document.querySelector(".widget-weather .temp")?.textContent,
    sky: [...(document.querySelector(".widget-weather .weather")?.classList ?? [])].join(" "),
    rate: document.querySelector(".widget-rates .rate")?.textContent,
    change: document.querySelector(".widget-rates .chip")?.textContent,
    stories: [...document.querySelectorAll(".widget-news .story .headline")].map(e => e.textContent),
    spaces: [...document.querySelectorAll(".widget-workspaces .space .name")].map(e => e.textContent),
    files: [...document.querySelectorAll(".widget-downloads .row .name")].map(e => e.textContent),
  })`));
  check('home shows the weather', shown.temp === '27°' && /sky-clear/.test(shown.sky), [shown.temp, shown.sky]);
  check('home shows the rate and its change', /48\.62/.test(shown.rate ?? '') && /▲ 0\.25%/.test(shown.change ?? ''), [shown.rate, shown.change]);
  check('home shows the news', shown.stories.join('|') === 'First story|Second & last', shown.stories);
  check('home shows the workspaces and downloads', shown.spaces.includes('School') && shown.files.includes('kivo-widgets-report.pdf'), [shown.spaces, shown.files]);
  writeFileSync(join(args.out, 'widgets-more.png'), await tabShot(kivo));

  await bridge('workspaces.manage');
  await sleep(1200);
  const managed = await kivo.evaluate(`document.getElementById("kivo-workspaces-panel")?.state ?? "none"`);
  check('workspaces.manage opens the workspaces menu', managed === 'open' || managed === 'showing', managed);
  await kivo.evaluate(`document.getElementById("kivo-workspaces-panel")?.hidePopup(); "ok"`);
  await sleep(500);

  // ---------- "New workspace" في نافذة workspace لونها فاتح أوي ----------
  await kivo.evaluate(`(async () => { ${W} await W.create({ name: "A1", color: "#c5e1a5", withWindow: window }); return "ok"; })()`);
  await sleep(1200);
  // الصفحة نفسها بلون الـ workspace: عناوين الـ widgets (--accent-ink) لازم تتقري على الكارت الأبيض برضه.
  const headInk = await kivo.evaluateIn(page, `getComputedStyle(document.querySelector(".widget-workspaces .w-head")).color`);
  check('widget titles are readable on the page in a pale workspace', Math.abs(apca(headInk, 'rgb(255, 255, 255)')) >= 70, headInk);
  // ونتايج شريط العنوان: عنوان الموقع بلون اللينكات (--link-color)، اللي Firefox بياخده من لون الـ accent.
  const urlInk = await kivo.evaluate(`(() => {
    const view = document.querySelector("#urlbar .urlbarView") ?? document.getElementById("urlbar");
    const probe = document.createElement("span");
    probe.style.color = "var(--link-color)";
    view.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  })()`);
  check('site addresses in the address bar results are readable in a pale workspace', Math.abs(apca(urlInk, 'rgb(255, 255, 255)')) >= 70, urlInk);
  // القايمة color-scheme: light dark، يعني فاتحة أو غامقة زي Windows مش زي النافذة، وخلفيتها
  // --panel-background-color (light-dark أبيض و rgb(66, 65, 77)). فالاختبار بيفرض شكل القايمة، بأصعب لون لكل واحد:
  // workspace فاتحة أوي على القايمة الفاتحة، وغامقة أوي على الغامقة. اللون الأصلي كان هيختفي في الحالتين.
  const panelInk = async (scheme, color) => {
    await kivo.evaluate(`(async () => { ${W} const ws = (await W.list()).find(w => w.name === "A1"); await W.update(ws.id, { color: "${color}" }); return "ok"; })()`);
    await sleep(800);
    const result = JSON.parse(await kivo.evaluate(`(async () => {
      ${W}
      const shotUrl = ${WINDOW_SHOT};
      const draw = ${PANEL_SHOT};
      W.togglePanel(window, document.querySelector("#kivo-workspaces-button .kivo-ws-button"));
      await new Promise(r => setTimeout(r, 1200));
      const panel = document.getElementById("kivo-workspaces-panel");
      panel.style.colorScheme = "${scheme}";
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const add = panel.querySelector(".kivo-ws-new");
      const probe = document.createElement("div");
      probe.style.background = "var(--panel-background-color)";
      add.after(probe);
      const colors = { ink: getComputedStyle(add).color, bg: getComputedStyle(probe).backgroundColor };
      probe.remove();
      try { return JSON.stringify({ ...colors, png: await draw(panel, shotUrl) }); } finally { panel.hidePopup(); panel.style.colorScheme = ""; await new Promise(r => setTimeout(r, 400)); }
    })()`));
    writeFileSync(join(args.out, `new-workspace-${scheme}.png`), Buffer.from(result.png.slice(result.png.indexOf(',') + 1), 'base64'));
    return { ink: result.ink, bg: result.bg, lc: Math.round(Math.abs(apca(result.ink, result.bg))) };
  };
  const brightness = (color) => color.match(/[\d.]+/g).slice(0, 3).map(Number).reduce((a, b) => a + b, 0) / 3;
  const light = await panelInk('light', '#c5e1a5');
  check('"New workspace" is readable on a light menu in a pale workspace', brightness(light.bg) > 200 && light.lc >= 70 && light.ink !== 'rgb(197, 225, 165)', light);
  const dark = await panelInk('dark', '#1e293b');
  check('"New workspace" is readable on a dark menu in a dark workspace', brightness(dark.bg) < 100 && dark.lc >= 70 && dark.ink !== 'rgb(30, 41, 59)', dark);
} catch (e) {
  console.error(e);
  code = 1;
} finally {
  await kivo.close();
  server.close();
}
writeFileSync(join(args.out, 'widgets-check.json'), JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(code || (failed ? 1 : 0));
