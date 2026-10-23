#!/usr/bin/env node
// مرحلة "Kivo يومي" (docs/FIREFOX.md)، headless: Kivo.exe بيوصّل لينكات البرامج التانية صح، و "Make default" بتاع
// Kivo، وتنبيه التحديث، والفيديو المحمي (Widevine)، والـ Sync الاختياري.
//
// node apps/firefox/tools/daily-check.mjs --kivo <Kivo.exe المتغلف> --out <فولدر>
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { launch, sleep } from './kivo-bidi.mjs';

const { values: args } = parseArgs({ options: { kivo: { type: 'string' }, out: { type: 'string' } } });
if (!args.kivo || !args.out) {
  console.error('usage: daily-check.mjs --kivo <Kivo.exe> --out <dir>');
  process.exit(2);
}
mkdirSync(args.out, { recursive: true });

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`);
};

let code = 0;

// ---------- Kivo.exe ولينك من برنامج تاني ----------
// محرك وهمي جنب نسخة من Kivo.exe بيكتب الـ arguments والهوية اللي وصلته، فمفيش Kivo حقيقي بيفتح.
{
  const dir = mkdtempSync(join(tmpdir(), 'kivo-launcher-'));
  try {
    mkdirSync(join(dir, 'browser'));
    writeFileSync(join(dir, 'browser', 'application.ini'), '[App]\nName=Kivo\n');
    copyFileSync(args.kivo, join(dir, 'Kivo.exe'));
    const fake = join(dir, 'Fake.cs');
    writeFileSync(
      fake,
      `class Fake { static void Main() {
        string args = System.Environment.CommandLine;
        args = args.StartsWith("\\"") ? args.Substring(args.IndexOf('"', 1) + 1) : args.Substring(args.IndexOf(' ') + 1);
        System.IO.File.WriteAllText(System.IO.Path.Combine(System.AppDomain.CurrentDomain.BaseDirectory, "seen.txt"),
          args.Trim() + "\\n" + System.Environment.GetEnvironmentVariable("XUL_APP_FILE"));
      } }`
    );
    const csc = join(process.env.WINDIR, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
    execFileSync(csc, ['/nologo', `/out:${join(dir, 'kivo-browser.exe')}`, fake]);
    const link = 'https://example.com/?a=1&b="2"';
    // زي ما Windows بيشغّل KivoURL: "Kivo.exe" -osint -url "%1".
    spawnSync(join(dir, 'Kivo.exe'), ['-osint', '-url', link], { windowsVerbatimArguments: false });
    await sleep(1500);
    const [seen, appFile] = readFileSync(join(dir, 'seen.txt'), 'utf8').split('\n');
    check('a link from another app reaches the engine with -osint first', seen.startsWith('-osint -url '), seen);
    check('and the engine gets the Kivo identity in XUL_APP_FILE', appFile.endsWith(join('browser', 'application.ini')), appFile);
  } catch (e) {
    console.error(e);
    check('the launcher test ran', false, String(e.message ?? e));
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
}

// ---------- جوه Kivo ----------
const kivo = await launch(args.kivo, {});
try {
  await sleep(4000);
  const shell = JSON.parse(
    await kivo.evaluate(`(() => {
      const { ShellService } = ChromeUtils.importESModule("moz-src:///browser/components/shell/ShellService.sys.mjs");
      const K = ChromeUtils.importESModule("moz-src:///browser/components/kivo/KivoShell.sys.mjs");
      return JSON.stringify({
        same: ShellService.isDefaultBrowser(false, true) === K.isDefaultBrowser(),
        set: ShellService.setDefaultBrowser.toString().includes("openDefaultApps"),
        asDefault: ShellService.setAsDefault.toString().includes("openDefaultApps"),
        startupCheck: Services.prefs.getBoolPref("browser.shell.checkDefaultBrowser", true),
      });
    })()`)
  );
  check('settings ask Windows itself whether Kivo is the default', shell.same, shell);
  check('"Make Default" opens Kivo in Windows Default apps', shell.set && shell.asDefault, shell);
  check('no "make Kivo default" bar at startup', shell.startupCheck === false, shell.startupCheck);

  // التنبيه: Firefox أحدث، وبعد ما يتقفل مايرجعش لنفس النسخة.
  const notice = JSON.parse(
    await kivo.evaluate(`(async () => {
      const K = ChromeUtils.importESModule("moz-src:///browser/components/kivo/KivoShell.sys.mjs");
      Services.prefs.setStringPref("kivo.update.latest", "999.0");
      Services.prefs.setIntPref("kivo.update.lastCheck", Math.floor(Date.now() / 1000));
      await K.checkForUpdate();
      await new Promise(r => setTimeout(r, 500));
      const n = gNotificationBox.getNotificationWithValue("kivo-update");
      const label = n?.message ?? "";
      n?.dismiss();
      await new Promise(r => setTimeout(r, 300));
      const dismissed = Services.prefs.getStringPref("kivo.update.dismissed", "");
      await K.checkForUpdate();
      await new Promise(r => setTimeout(r, 300));
      const again = !!gNotificationBox.getNotificationWithValue("kivo-update");
      // السؤال الحقيقي لـ Mozilla.
      Services.prefs.clearUserPref("kivo.update.latest");
      Services.prefs.setIntPref("kivo.update.lastCheck", 0);
      await K.checkForUpdate();
      return JSON.stringify({ shown: !!n, label: String(label), dismissed, again, latest: Services.prefs.getStringPref("kivo.update.latest", ""), version: Services.appinfo.version });
    })()`)
  );
  check('Kivo says when a newer Firefox is out', notice.shown && notice.label.includes('999.0'), notice.label);
  check('closing the notice hides it until the next version', notice.dismissed === '999.0' && !notice.again, notice);
  check('Kivo learns the latest Firefox from Mozilla', /^\d+(\.\d+)+$/.test(notice.latest), notice.latest);

  // الفيديو المحمي: Widevine بيتنزل من Mozilla، والمواقع تقدر تطلبه.
  const widevine = JSON.parse(
    await kivo.evaluate(`(async () => {
      const { GMPInstallManager } = ChromeUtils.importESModule("resource://gre/modules/GMPInstallManager.sys.mjs");
      let result;
      try { result = await new GMPInstallManager().simpleCheckAndInstall(); } catch (e) { result = { error: String(e?.message ?? e) }; }
      gBrowser.selectedTab = gBrowser.addTrustedTab("https://example.com/");
      return JSON.stringify({ result, version: Services.prefs.getStringPref("media.gmp-widevinecdm.version", "") });
    })()`)
  );
  check('Widevine (protected video) installs', /^\d+(\.\d+)+$/.test(widevine.version), widevine);
  await sleep(4000);
  const page = (await kivo.send('browsingContext.getTree', {})).contexts.find((c) => c.url.startsWith('https://example.com'))?.context;
  const access = page
    ? await kivo.evaluateIn(
        page,
        `navigator.requestMediaKeySystemAccess("com.widevine.alpha", [{ initDataTypes: ["cenc"], videoCapabilities: [{ contentType: 'video/mp4; codecs="avc1.42E01E"' }] }]).then(a => a.keySystem, e => "refused: " + e.message)`
      )
    : 'no page';
  check('websites can use Widevine', access === 'com.widevine.alpha', access);

  // الـ Sync اختياري: الحساب مش مقفول، وثيم Kivo بيتزامن معاه.
  const sync = JSON.parse(
    await kivo.evaluate(`JSON.stringify({
      accounts: Services.prefs.getBoolPref("identity.fxaccounts.enabled", false),
      locked: Services.prefs.prefIsLocked("identity.fxaccounts.enabled"),
      theme: Services.prefs.getBoolPref("services.sync.prefs.sync.kivo.theme", false),
      policies: Object.keys(Services.policies.getActivePolicies?.() ?? {}),
    })`)
  );
  check('a Mozilla account is allowed (Sync is optional)', sync.accounts && !sync.locked && !sync.policies.includes('DisableAccounts'), sync);
  check("Kivo's look syncs with the account", sync.theme, sync.theme);

  // ثيم Firefox (الغامق مثلًا) مايتزامنش، ولو اتفعّل Kivo بيرجع للافتراضي.
  const firefoxTheme = JSON.parse(
    await kivo.evaluate(`(async () => {
      const { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");
      const dark = await AddonManager.getAddonByID("firefox-compact-dark@mozilla.org");
      await dark.enable();
      await new Promise(r => setTimeout(r, 1500));
      return JSON.stringify({
        active: Services.prefs.getStringPref("extensions.activeThemeID", ""),
        synced: Services.prefs.getBoolPref("services.sync.prefs.sync.extensions.activeThemeID", true),
      });
    })()`)
  );
  check("Firefox's theme does not sync", firefoxTheme.synced === false, firefoxTheme);
  check("a Firefox theme (dark from Sync) goes back to Kivo's look", firefoxTheme.active === 'default-theme@mozilla.org', firefoxTheme);
} catch (e) {
  console.error(e);
  code = 1;
} finally {
  await kivo.close();
}
writeFileSync(join(args.out, 'daily-check.json'), JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(code || (failed ? 1 : 0));
