#!/usr/bin/env node
// صفحة Downloads بعد ما Kivo يتقفل ويتفتح، headless على profile مؤقت. التحميلات حقيقية من سيرفر محلي، عشان تتسجل في
// الـ history زي الاستخدام العادي، ولستة Firefox بتفضى بعد القفل. وبعدها كل زرار على تحميل قديم: الفتح، والفولدر،
// و Retry، والمسح من اللستة، و Clear list. فتح الملف والفولدر متبدلين بواحد بيسجل، فمفيش برنامج ولا نافذة بتظهر.
//
// node apps/firefox/tools/downloads-check.mjs --kivo <Kivo.exe المتغلف> --out <فولدر>
import { existsSync, mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { launch, sleep, tabShot } from './kivo-bidi.mjs';

const { values: args } = parseArgs({ options: { kivo: { type: 'string' }, out: { type: 'string' } } });
if (!args.kivo || !args.out) {
  console.error('usage: downloads-check.mjs --kivo <Kivo.exe> --out <dir>');
  process.exit(2);
}
mkdirSync(args.out, { recursive: true });

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`);
};
const HOME = 'moz-extension://9d4b610d-d083-4703-8d31-c7178f7ba2e8/';
const BODY = 'kivo test file '.repeat(100);

// broken.iso بيقطع في النص أول مرة، والمرة التانية بيكمل (Retry).
let brokenHits = 0;
const server = createServer((req, res) => {
  if (req.url === '/broken.iso' && ++brokenHits === 1) {
    res.writeHead(200, { 'Content-Length': BODY.length, 'Content-Type': 'application/octet-stream' });
    res.write(BODY.slice(0, 10));
    setTimeout(() => res.destroy(), 200);
    return;
  }
  res.writeHead(200, { 'Content-Length': BODY.length, 'Content-Type': 'application/octet-stream' });
  res.end(BODY);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const profile = mkdtempSync(join(tmpdir(), 'kivo-downloads-'));
const saved = join(profile, 'saved');
mkdirSync(saved);
const prefs = { 'browser.download.folderList': 2, 'browser.download.dir': saved };

const openPage = async (kivo) => {
  await kivo.evaluate(`DownloadsPanel.showDownloadsHistory(); "ok"`);
  await sleep(2500);
  const page = (await kivo.send('browsingContext.getTree', {})).contexts.find((c) => c.url.startsWith(`${HOME}downloads.html`))?.context;
  if (!page) throw new Error('no downloads page');
  return page;
};
const bridge = async (kivo, page, type, payload = {}) =>
  JSON.parse(await kivo.evaluateIn(page, `browser.kivo.request({ type: ${JSON.stringify(type)}, payload: ${JSON.stringify(payload)} }).then(JSON.stringify)`));
const byName = (items) => Object.fromEntries(items.map((d) => [d.name, d]));

let kivo;
let code = 0;
try {
  // ---------- الجلسة الأولى: تحميلات حقيقية ----------
  kivo = await launch(args.kivo, prefs, { profile });
  await sleep(3000);
  const session = JSON.parse(
    await kivo.evaluate(`(async () => {
      const { Downloads } = ChromeUtils.importESModule("resource://gre/modules/Downloads.sys.mjs");
      const { DownloadHistory } = ChromeUtils.importESModule("resource://gre/modules/DownloadHistory.sys.mjs");
      const list = await Downloads.getList(Downloads.PUBLIC);
      const dir = ${JSON.stringify(saved)};
      const states = {};
      let bad;
      for (const name of ["bad.exe", "broken.iso", "photo.png", "report.zip"]) {
        const download = await Downloads.createDownload({ source: "${base}/" + name, target: PathUtils.join(dir, name) });
        await list.add(download);
        await download.start().catch(() => {});
        states[name] = download.succeeded;
        if (name === "bad.exe") bad = download;
        await new Promise(r => setTimeout(r, 300));
      }
      await new Promise(r => setTimeout(r, 1000));
      // زي ملف Firefox حظره: ده مايتعملش بتحميل حقيقي من غير خدمة Safe Browsing.
      await DownloadHistory.updateMetaData({ source: bad.source, target: bad.target, stopped: true, succeeded: false, deleted: false, endTime: Date.now(), error: { becauseBlockedByReputationCheck: true, reputationCheckVerdict: "Malware" } });
      return JSON.stringify(states);
    })()`)
  );
  check('real downloads ran: three finished, one was cut', session['report.zip'] && session['photo.png'] && session['bad.exe'] && !session['broken.iso'], session);
  await sleep(1500);
  await kivo.quit();
  unlinkSync(join(saved, 'photo.png'));

  // ---------- بعد القفل والفتح ----------
  kivo = await launch(args.kivo, prefs, { profile });
  await sleep(3000);
  const left = await kivo.evaluate(`(async () => {
    const { Downloads } = ChromeUtils.importESModule("resource://gre/modules/Downloads.sys.mjs");
    return (await (await Downloads.getList(Downloads.PUBLIC)).getAll()).length;
  })()`);
  check("Firefox's own session list is empty after the restart", left === 0, left);

  let page = await openPage(kivo);
  const rows = JSON.parse(
    await kivo.evaluateIn(page, `JSON.stringify({ rows: document.querySelectorAll(".row").length, days: [...document.querySelectorAll("h2")].map(h => h.textContent) })`)
  );
  check('the page lists the old downloads after the restart', rows.rows === 4, rows);
  check('old downloads sit under their day', rows.days.length === 1 && rows.days[0] === 'Today', rows.days);
  writeFileSync(join(args.out, 'downloads-after-restart.png'), await tabShot(kivo));

  let { items } = await bridge(kivo, page, 'downloads.list');
  let files = byName(items);
  check('finished, with its size', files['report.zip']?.state === 'done' && files['report.zip'].size === BODY.length, files['report.zip']);
  check('a file that was deleted shows as missing', files['photo.png']?.state === 'missing', files['photo.png']);
  check('a cut download shows as failed', files['broken.iso']?.state === 'failed', files['broken.iso']);
  check('a blocked download stays blocked', files['bad.exe']?.state === 'blocked', files['bad.exe']);
  const recent = items.every((d) => Math.abs(Date.now() - d.startedAt) < 10 * 60000);
  const newestFirst = items.every((d, i) => !i || items[i - 1].startedAt >= d.startedAt);
  check('old downloads keep their time, newest first', recent && newestFirst && items[0].name === 'report.zip', items.map((d) => [d.name, d.startedAt]));

  // فتح الملف والفولدر من غير ما حاجة تظهر.
  await kivo.evaluate(`(() => {
    const { Integration } = ChromeUtils.importESModule("resource://gre/modules/Integration.sys.mjs");
    Integration.downloads.register(base => ({ __proto__: base, launchFile(file) { globalThis.kivoLaunched = file.path; } }));
    DownloadsCommon.showDownloadedFile = file => { globalThis.kivoShown = file.path; };
    return "ok";
  })()`);
  const report = join(saved, 'report.zip');
  await bridge(kivo, page, 'downloads.open', { id: files['report.zip'].id });
  await sleep(500);
  const launched = await kivo.evaluate(`globalThis.kivoLaunched ?? ""`);
  check('opening an old download reaches the file', launched === report, launched);
  await bridge(kivo, page, 'downloads.show', { id: files['report.zip'].id });
  const shown = await kivo.evaluate(`globalThis.kivoShown ?? ""`);
  check('"Show in folder" works on an old download', shown === report, shown);

  await bridge(kivo, page, 'downloads.retry', { id: files['broken.iso'].id });
  let retried;
  for (let i = 0; i < 40 && retried?.state !== 'done'; i++) {
    await sleep(250);
    retried = byName((await bridge(kivo, page, 'downloads.list')).items)['broken.iso'];
  }
  check('Retry downloads an old failed file again', retried?.state === 'done' && brokenHits === 2, { state: retried?.state, brokenHits });
  check('the retried file is on disk', existsSync(join(saved, 'broken.iso')), saved);

  ({ items } = await bridge(kivo, page, 'downloads.list'));
  files = byName(items);
  const after = (await bridge(kivo, page, 'downloads.remove', { id: files['report.zip'].id })).items;
  check('removing an old download takes it off the list', after.length === 3 && !byName(after)['report.zip'], after.map((d) => d.name));
  check('removing keeps the file', existsSync(report), report);
  await kivo.quit();

  // ---------- المسح بيفضل بعد القفل ----------
  kivo = await launch(args.kivo, prefs, { profile });
  await sleep(3000);
  page = await openPage(kivo);
  ({ items } = await bridge(kivo, page, 'downloads.list'));
  check('a removed download stays removed after a restart', items.length === 3 && !byName(items)['report.zip'], items.map((d) => d.name));
  await bridge(kivo, page, 'downloads.clearDone');
  await sleep(1000);
  ({ items } = await bridge(kivo, page, 'downloads.list'));
  check('"Clear list" clears the old downloads too', items.length === 0, items.map((d) => d.name));
  check('"Clear list" keeps the files', existsSync(join(saved, 'broken.iso')), saved);
  await kivo.quit();

  kivo = await launch(args.kivo, prefs, { profile });
  await sleep(3000);
  page = await openPage(kivo);
  ({ items } = await bridge(kivo, page, 'downloads.list'));
  check('a cleared list stays clear after a restart', items.length === 0, items.map((d) => d.name));
  const empty = await kivo.evaluateIn(page, `document.querySelector(".empty")?.textContent.trim() ?? ""`);
  check('the empty page says so', /will show up here/.test(empty), empty);
  await kivo.quit();
  kivo = null;
} catch (e) {
  console.error(e);
  code = 1;
} finally {
  if (kivo) await kivo.close();
  server.close();
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
writeFileSync(join(args.out, 'downloads-check.json'), JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(code || (failed ? 1 : 0));
