#!/usr/bin/env node
// Safe Browsing (G6 في docs/FIREFOX.md)، headless وعلى الإنترنت بجد: النسخة فيها مفتاح Kivo، و Google بتقبله وبتبعت
// القوايم، وصفحات الاختبار بتاعة Google بتتحجب بصفحة Firefox، وعليها "Google Safe Browsing" (من شروط Google).
// المفتاح نفسه مابيتطبعش، لا هنا ولا في الـ json.
//
// node apps/firefox/tools/safebrowsing-check.mjs --kivo <Kivo.exe المتغلف> --out <فولدر>
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { launch, sleep, tabShot } from './kivo-bidi.mjs';

const { values: args } = parseArgs({ options: { kivo: { type: 'string' }, out: { type: 'string' } } });
if (!args.kivo || !args.out) {
  console.error('usage: safebrowsing-check.mjs --kivo <Kivo.exe> --out <dir>');
  process.exit(2);
}
mkdirSync(args.out, { recursive: true });

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`);
};

// صفحات Google لاختبار أي متصفح: موجودة في القوايم الحقيقية، ومافيهاش حاجة مؤذية فعلًا.
const TEST_PAGES = [
  ['phishing', 'https://testsafebrowsing.appspot.com/s/phishing.html', 'deceptiveBlocked'],
  ['malware', 'https://testsafebrowsing.appspot.com/s/malware.html', 'malwareBlocked'],
  ['unwanted software', 'https://testsafebrowsing.appspot.com/s/unwanted.html', 'unwantedBlocked'],
];

let code = 0;
// الـ remote agent (WebDriver BiDi) بيقفل Safe Browsing في أي تشغيلة اختبار (remote/shared/RecommendedPreferences)،
// فمن غير السطر ده مفيش تحديث ولا حجب، و Kivo الحقيقي مالوش دعوة.
const kivo = await launch(args.kivo, { 'remote.prefs.recommended': false });
try {
  await sleep(3000);
  const prefs = JSON.parse(
    await kivo.evaluate(`JSON.stringify(Object.fromEntries(["phishing", "malware", "blockedURIs", "downloads"].map(n => [n, Services.prefs.getBoolPref("browser.safebrowsing." + n + ".enabled", false)])))`)
  );
  check('Kivo keeps phishing, malware and download blocking on', Object.values(prefs).every(Boolean), prefs);
  // مفتاح Kivo مالوش القايمتين بتوع التحميلات ولا الفحص من بعيد بتاع Google (firefox-branding.js).
  const lists = JSON.parse(
    await kivo.evaluate(`JSON.stringify({
      lists: Services.prefs.getCharPref("browser.safebrowsing.provider.google5.lists", ""),
      phishTable: Services.prefs.getCharPref("urlclassifier.phishTable", ""),
      remote: Services.prefs.getBoolPref("browser.safebrowsing.downloads.remote.enabled", true),
    })`)
  );
  check(
    "Kivo asks only for the lists Google gives its key, without the remote download check",
    !/badbinurl|downloadwhite/.test(lists.lists) && /goog-phish-proto/.test(lists.lists) && /goog-malware-proto/.test(lists.lists) && lists.remote === false,
    lists
  );
  // المحرك بتاع الـ artifact build هو بتاع Mozilla الرسمي، ومابيعرفش غير goog-phish-proto للـ phishing في V5.
  check('the phishing table is the one the engine knows (goog-phish-proto)', lists.phishTable.split(',')[0] === 'goog-phish-proto', lists.phishTable);
  const key = JSON.parse(
    await kivo.evaluate(`(() => {
      const { AppConstants } = ChromeUtils.importESModule("resource://gre/modules/AppConstants.sys.mjs");
      const key = AppConstants.MOZ_GOOGLE_SAFEBROWSING_API_KEY;
      return JSON.stringify({ set: !!key && key !== "no-google-safebrowsing-api-key", length: key.length });
    })()`)
  );
  check('this Kivo has a Safe Browsing key', key.set, { length: key.length });

  // زي زرار Update في about:url-classifier. لو تحديث أول التشغيل لسه شغال، forceUpdates بيرجّع false، وبنستنى ده.
  // الحدث بييجي لأي provider (قوايم Mozilla كمان)، فالنجاح هو إن lastupdatetime بتاع Google اتغيّر.
  const update = JSON.parse(
    await kivo.evaluate(`(async () => {
      const provider = Services.prefs.getBoolPref("browser.safebrowsing.provider.google5.enabled", false) ? "google5" : "google4";
      const pref = "browser.safebrowsing.provider." + provider + ".lastupdatetime";
      const before = Services.prefs.getCharPref(pref, "");
      const tables = Services.prefs.getCharPref("browser.safebrowsing.provider." + provider + ".lists", "");
      const listManager = Cc["@mozilla.org/url-classifier/listmanager;1"].getService(Ci.nsIUrlListManager);
      const errors = [];
      let observer;
      const done = new Promise(resolve => {
        observer = (subject, topic, data) => {
          if (data !== "success") errors.push(data);
          if (Services.prefs.getCharPref(pref, "") !== before) resolve();
        };
        Services.obs.addObserver(observer, "safebrowsing-update-finished");
      });
      const started = listManager.forceUpdates(tables);
      await Promise.race([done, new Promise(r => setTimeout(r, 120000))]);
      Services.obs.removeObserver(observer, "safebrowsing-update-finished");
      const after = Services.prefs.getCharPref(pref, "");
      return JSON.stringify({ provider, started, updated: after !== before && after !== "", errors, backoff: !!listManager.getBackOffTime(provider) });
    })()`)
  );
  check("Google accepts the key and sends the lists", update.updated && !update.backoff, update);

  for (const [kind, page, error] of TEST_PAGES) {
    const uri = await kivo.evaluate(`(async () => {
      const tab = gBrowser.addTrustedTab(${JSON.stringify(page)});
      gBrowser.selectedTab = tab;
      let uri = "";
      for (let i = 0; i < 80; i++) {
        await new Promise(r => setTimeout(r, 250));
        uri = tab.linkedBrowser.documentURI?.spec ?? "";
        if (uri.startsWith("about:blocked")) break;
      }
      return uri;
    })()`);
    check(`Google's ${kind} test page is blocked`, uri.startsWith('about:blocked') && uri.includes(`e=${error}`), uri.split('&')[0]);
  }

  // التاب المختار دلوقتي آخر صفحة اتحجبت. Google بتطلب إن الصفحة تقول إن التحذير منها.
  await sleep(1500);
  // BiDi ممكن يعرض صفحة الحجب بعنوان الصفحة الأصلي، مش about:blocked.
  const last = TEST_PAGES.at(-1)[1];
  const blocked = (await kivo.send('browsingContext.getTree', {})).contexts.filter((c) => c.url.startsWith('about:blocked') || c.url === last);
  const advisory = blocked.length
    ? await kivo.evaluateIn(blocked.at(-1).context, `(() => {
        const link = document.getElementById("advisory_provider");
        return JSON.stringify({ text: document.getElementById("advisoryDescText")?.textContent.trim() ?? "", href: link?.href ?? "" });
      })()`)
    : '{}';
  const { text = '', href = '' } = JSON.parse(advisory);
  check('the blocked page says the advisory is from Google Safe Browsing', text.includes('Google Safe Browsing') && href.startsWith('https://developers.google.com/'), { text, href });
  writeFileSync(join(args.out, 'safebrowsing-blocked.png'), await tabShot(kivo));

  const normal = await kivo.evaluate(`(async () => {
    const tab = gBrowser.addTrustedTab("https://example.com/");
    gBrowser.selectedTab = tab;
    for (let i = 0; i < 40 && tab.linkedBrowser.documentURI?.spec !== "https://example.com/"; i++) await new Promise(r => setTimeout(r, 250));
    return tab.linkedBrowser.documentURI?.spec ?? "";
  })()`);
  check('a normal site opens as usual', normal === 'https://example.com/', normal);
} catch (e) {
  console.error(e);
  code = 1;
} finally {
  await kivo.close();
}
writeFileSync(join(args.out, 'safebrowsing-check.json'), JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(code || (failed ? 1 : 0));
