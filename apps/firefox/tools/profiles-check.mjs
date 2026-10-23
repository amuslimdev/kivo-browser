#!/usr/bin/env node
// الـ profiles (G3) على Kivo، headless وبـ profile متسجل (kivo-bidi registered، هوية KivoTest في %APPDATA%\KivoTest):
// أول profile باسم Windows، واللون والأفاتار بتوع Kivo في قاعدة بيانات Firefox وبيتغيروا مع الثيم والأفاتار، وثيمات
// Firefox مابتغيرهمش، والـ profile التاني بيفتح بهوية Kivo، وصفحات الـ profiles بشكل Kivo. والصور: صفحة الاختيار،
// وصفحة التعديل، والأفاتار.
//
// node apps/firefox/tools/profiles-check.mjs --kivo <Kivo.exe> --out <فولدر>
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, join } from 'node:path';
import { parseArgs } from 'node:util';
import { PANEL_SHOT, WINDOW_SHOT, launch, sleep, tabShot } from './kivo-bidi.mjs';

const { values: args } = parseArgs({ options: { kivo: { type: 'string' }, out: { type: 'string' } } });
if (!args.kivo || !args.out) {
  console.error('usage: profiles-check.mjs --kivo <Kivo.exe> --out <dir>');
  process.exit(2);
}
mkdirSync(args.out, { recursive: true });

// candy من presets.ts، زي home-check.mjs.
const CANDY = {
  version: 1, preset: 'candy', mode: 'light', accent: '#ff4f9a', font: 'baloo', corners: 'bubbly',
  background: { kind: 'scene', scene: 'candy' }, start: { buddy: true, clock: true, fact: true, tiles: true }, sites: 'theme',
};

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`);
};

const kivo = await launch(args.kivo, {}, { registered: true });
// JavaScript في نافذة المتصفح، و S و KivoProfiles و KivoData جاهزين. body بيرجّع قيمة بتتحوّل JSON.
const run = async (body) =>
  JSON.parse(
    await kivo.evaluate(`(async () => {
      const { SelectableProfileService: S } = ChromeUtils.importESModule("resource:///modules/profiles/SelectableProfileService.sys.mjs");
      const { KivoProfiles } = ChromeUtils.importESModule("moz-src:///browser/components/kivo/KivoProfiles.sys.mjs");
      const KivoData = ChromeUtils.importESModule("moz-src:///browser/components/kivo/KivoData.sys.mjs");
      const state = async () => {
        const p = S.currentProfile;
        return { id: p.id, name: p.name, theme: p.theme, avatar: p.avatar, custom: p.hasCustomAvatar,
                 avatarExists: p.hasCustomAvatar && (await IOUtils.exists(p.getAvatarPath())) };
      };
      return JSON.stringify(await (async () => { ${body} })());
    })()`)
  );
const rgb = (hex) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;

let code = 0;
try {
  await kivo.evaluate(`window.resizeTo(1280, 860); "ok"`);

  const setup = await run(`
    await S.init();
    return { enabled: S.isEnabled, appFile: Services.env.get("KIVO_APP_FILE"),
             hooked: !String(S.updateProfileThemeColors).includes("windowlwthemeupdate") };`);
  check('selectable profiles are on', setup.enabled, setup);
  check('Kivo hooks are in Firefox profiles', setup.hooked);
  // Kivo.exe (و kivo-bidi) بيحطوا KIVO_APP_FILE، و KivoProfiles بيبعته -app للـ profiles التانية.
  check('the engine knows its Kivo identity file', /application(-test)?\.ini$/i.test(setup.appFile ?? ''), setup.appFile);

  const first = await run(`
    await S.maybeSetupDataStore();
    const omar = await S.createNewProfile(false);
    await omar.setNameAsync("Omar");
    await KivoProfiles.sync();
    await new Promise(r => setTimeout(r, 1500));
    await KivoProfiles.sync();
    return { me: await state(), windowsName: KivoData.windowsUserName(), omar: { id: omar.id, theme: omar.theme },
             bridge: await KivoData.handle({ type: "profile.get" }) };`);
  check('first profile has the Windows name', first.windowsName && first.me.name === first.windowsName, first.me.name);
  check('profile color is the Kivo theme', first.me.theme.themeId === 'kivo' && first.me.theme.themeBg === rgb('#7964bc'), first.me.theme);
  check('profile avatar is a Kivo picture', first.me.custom && first.me.avatarExists, first.me.avatar);
  check('a new profile gets Kivo colors, not a Firefox theme', first.omar.theme.themeId === 'kivo' && first.omar.theme.themeBg === rgb('#7964bc'), first.omar.theme);
  check('Kivo Home shows the profile name', first.bridge.name === first.me.name && first.bridge.id === String(first.me.id), first.bridge);

  const themed = await run(`
    const before = S.currentProfile.avatar;
    const oldPath = S.currentProfile.getAvatarPath();
    Services.prefs.setStringPref("kivo.theme", ${JSON.stringify(JSON.stringify(CANDY))});
    await KivoProfiles.sync();
    return { me: await state(), before, oldGone: !(await IOUtils.exists(oldPath)) };`);
  check('theme change recolors the profile', themed.me.theme.themeBg === rgb('#ff4f9a'), themed.me.theme);
  check('theme change redraws the avatar and drops the old file', themed.me.avatar !== themed.before && themed.oldGone, themed);

  const firefoxTheme = await run(`
    const { LightweightThemeManager } = ChromeUtils.importESModule("resource://gre/modules/LightweightThemeManager.sys.mjs");
    Services.obs.notifyObservers({ wrappedJSObject: LightweightThemeManager.themeData }, "lightweight-theme-styling-update");
    S.matchMediaObserver();
    await new Promise(r => setTimeout(r, 800));
    return (await state()).theme;`);
  check('Firefox theme updates keep the Kivo color', firefoxTheme.themeId === 'kivo' && firefoxTheme.themeBg === rgb('#ff4f9a'), firefoxTheme);

  const renamed = await run(`
    const before = S.currentProfile.avatar;
    await S.currentProfile.setNameAsync("Laila");
    await new Promise(r => setTimeout(r, 1500));
    await KivoProfiles.sync();
    return { me: await state(), before, bridge: await KivoData.handle({ type: "profile.get" }) };`);
  check('renaming redraws the initial', renamed.me.avatar !== renamed.before && renamed.bridge.name === 'Laila', renamed.bridge);

  const emoji = await run(`
    const before = S.currentProfile.avatar;
    await KivoData.handle({ type: "avatar.set", payload: { avatar: { kind: "emoji", emoji: "🦄" } } });
    await KivoProfiles.sync();
    const me = await state();
    const bytes = await IOUtils.read(S.currentProfile.getAvatarPath());
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { me, before, png: btoa(binary) };`);
  check('Kivo Home avatar shows in Firefox profiles', emoji.me.avatar !== emoji.before && emoji.me.custom, emoji.me.avatar);
  writeFileSync(join(args.out, 'profile-avatar.png'), Buffer.from(emoji.png, 'base64'));

  // profile تاني بيفتح في process لوحده، زي "New profile" في القايمة، بنفس الكود بتاع Firefox (launchInstance). لو
  // الـ process ده مش بهوية Kivo، مش هيلاقي قاعدة البيانات (profiles.ini بتاع Kivo)، وأفاتاره مش هيترسم.
  const omarPath = await run(`
    const omar = (await S.getAllProfiles()).find(p => p.name === "Omar");
    S.launchInstance(omar, []);
    return omar.path;`);
  let other = null;
  for (let i = 0; i < 60 && !other?.custom; i++) {
    await sleep(1000);
    other = await run(`
      const omar = (await S.getAllProfiles()).find(p => p.name === "Omar");
      return { custom: omar.hasCustomAvatar, theme: omar.theme };`);
  }
  // الـ process ده مش بتاعنا، فبنلاقيه بالـ profile بتاعه في الـ command line، وبنقفله.
  const ps = spawnSync('powershell.exe', ['-NoProfile', '-Command',
    `Get-CimInstance Win32_Process -Filter "Name='kivo-browser.exe'" | Where-Object { $_.CommandLine -like '*${basename(omarPath)}*' } | ForEach-Object { $_.CommandLine; Stop-Process -Id $_.ProcessId -Force }`],
    { encoding: 'utf8' });
  const commandLine = ps.stdout.trim().split(/\r?\n/)[0] ?? '';
  check('another profile opens as Kivo and draws its avatar', other?.custom && other.theme.themeId === 'kivo', other);
  check('another profile gets -app with the Kivo identity', /-app "?[^"]*application-test\.ini/.test(commandLine), commandLine);

  // الـ profile لوكال لحد ما يتربط بحساب Mozilla (الـ Sync اختياري)، وزرار الـ profile بتاع Kivo مكان زرار الحساب.
  const local = await run(`
    const { CustomizableUI } = ChromeUtils.importESModule("moz-src:///browser/components/customizableui/CustomizableUI.sys.mjs");
    const account = document.getElementById("fxa-toolbar-menu-button");
    const img = document.querySelector("#kivo-profile-button .kivo-pm-button img");
    return {
      accounts: Services.prefs.getBoolPref("identity.fxaccounts.enabled", true),
      locked: Services.prefs.prefIsLocked("identity.fxaccounts.enabled"),
      fxadisabled: document.documentElement.hasAttribute("fxadisabled"),
      sync: ChromeUtils.importESModule("resource://services-sync/UIState.sys.mjs").UIState.get().status,
      accountShown: !!account && getComputedStyle(account).display !== "none",
      button: CustomizableUI.getPlacementOfWidget("kivo-profile-button"),
      avatar: img?.getAttribute("src") ?? null,
      profileAvatar: S.currentProfile.hasCustomAvatar ? PathUtils.toFileURI(S.currentProfile.getAvatarPath()) : null,
    };`);
  check('a Mozilla account is optional, and the profile stays local until you sign in', local.accounts && !local.locked && !local.fxadisabled && local.sync === 'not_configured', local);
  check('the account button is gone', !local.accountShown, local.accountShown);
  check('the Kivo profile button is in the toolbar with the profile picture',
    local.button?.area === 'nav-bar' && local.avatar && local.avatar === local.profileAvatar, { button: local.button, avatar: local.avatar });
  const menu = JSON.parse(
    await kivo.evaluate(`(async () => {
      const { KivoProfileMenu } = ChromeUtils.importESModule("moz-src:///browser/components/kivo/KivoProfileMenu.sys.mjs");
      await KivoProfileMenu.togglePanel(window, document.querySelector("#kivo-profile-button .kivo-pm-button"));
      await new Promise(r => setTimeout(r, 1200));
      const panel = document.getElementById("kivo-profile-panel");
      return JSON.stringify({
        state: panel.state,
        name: panel.querySelector(".kivo-pm-name")?.textContent,
        others: [...panel.querySelectorAll(".kivo-pm-profile-name")].map(e => e.textContent),
        actions: [...panel.querySelectorAll("button[data-action]")].map(b => b.dataset.action),
      });
    })()`)
  );
  check('the profile menu shows this profile and the others', menu.state === 'open' && menu.name === 'Laila' && menu.others.includes('Omar'), menu);
  check('the profile menu can switch, add, rename and manage',
    ['look', 'rename', 'switch', 'add', 'manage'].every((a) => menu.actions.includes(a)), menu.actions);
  check('the profile menu offers "Sync this profile"', menu.actions.includes('sync-start'), menu.actions);
  const menuShot = await kivo.evaluate(`(async () => {
    const shotUrl = ${WINDOW_SHOT};
    const draw = ${PANEL_SHOT};
    const panel = document.getElementById("kivo-profile-panel");
    try { return await draw(panel, shotUrl); } finally { panel.hidePopup(); }
  })()`);
  writeFileSync(join(args.out, 'profiles-menu.png'), Buffer.from(menuShot.slice(menuShot.indexOf(',') + 1), 'base64'));

  // بعد ما الولد يربط حسابه (UIState متقلّد، لأن الدخول الحقيقي محتاج حساب وإيميل).
  const signed = JSON.parse(
    await kivo.evaluate(`(async () => {
      const { UIState } = ChromeUtils.importESModule("resource://services-sync/UIState.sys.mjs");
      const { KivoProfileMenu } = ChromeUtils.importESModule("moz-src:///browser/components/kivo/KivoProfileMenu.sys.mjs");
      const real = UIState.get;
      UIState.get = () => ({ status: UIState.STATUS_SIGNED_IN, email: "laila.the.long.name.family@example.com", syncing: false });
      try {
        await KivoProfileMenu.togglePanel(window, document.querySelector("#kivo-profile-button .kivo-pm-button"));
        await new Promise(r => setTimeout(r, 800));
        const panel = document.getElementById("kivo-profile-panel");
        const result = {
          sync: panel.querySelector(".kivo-pm-sync")?.textContent,
          me: panel.querySelector(".kivo-pm-me .kivo-pm-sub")?.textContent,
          actions: [...panel.querySelectorAll("button[data-action]")].map(b => b.dataset.action),
        };
        // الزرار بلون كلام الـ accent، ومفيش حاجة لازقة في التانية.
        const now = panel.querySelector(".kivo-pm-sync-now");
        const email = panel.querySelector(".kivo-pm-sync-email");
        const gear = panel.querySelector(".kivo-pm-sync-settings");
        const box = el => el.getBoundingClientRect();
        const overlap = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
        const rgb = v => { const c = document.createElementNS("http://www.w3.org/1999/xhtml", "span"); c.style.color = v; document.documentElement.append(c); const out = getComputedStyle(c).color; c.remove(); return out; };
        result.buttonInk = getComputedStyle(now).color;
        result.onAccent = rgb(getComputedStyle(document.documentElement).getPropertyValue("--kivo-on-accent").trim());
        result.overlaps = [overlap(box(now), box(email)), overlap(box(email), box(gear)), overlap(box(now), box(gear))];
        result.emailFits = email.scrollWidth <= email.clientWidth + 1 || getComputedStyle(email).textOverflow === "ellipsis";
        const shotUrl = ${WINDOW_SHOT};
        const draw = ${PANEL_SHOT};
        result.shot = await draw(panel, shotUrl);
        panel.hidePopup();
        return JSON.stringify(result);
      } finally {
        UIState.get = real;
      }
    })()`)
  );
  writeFileSync(join(args.out, 'profiles-menu-synced.png'), Buffer.from(signed.shot.slice(signed.shot.indexOf(',') + 1), 'base64'));
  delete signed.shot;
  check(
    'signed in, the menu says Sync is on, with the email and Sync now',
    signed.sync?.includes('Sync is on') && signed.sync.includes('laila.the.long.name.family@example.com') && signed.actions.includes('sync-now') && !signed.actions.includes('sync-start') && /Synced/.test(signed.me),
    signed
  );
  check('the Sync card: button text in the accent ink, nothing overlaps',
    signed.buttonInk === signed.onAccent && !signed.overlaps.includes(true) && signed.emailFits,
    { buttonInk: signed.buttonInk, onAccent: signed.onAccent, overlaps: signed.overlaps, emailFits: signed.emailFits });

  // الإعدادات: قسم الـ Sync بتاع Firefox رجع (كان متخفي لما الحساب كان مقفول).
  await kivo.evaluate(`gBrowser.selectedTab = gBrowser.addTrustedTab("about:preferences"); "ok"`);
  await sleep(3500);
  const settings = JSON.parse(
    await kivo.evaluate(`(() => {
      const doc = gBrowser.selectedBrowser.contentDocument;
      const group = doc.querySelector('setting-group[groupid="accountDisabled"]');
      return JSON.stringify({
        nav: doc.getElementById("category-sync")?.textContent.trim(),
        accountDisabled: !!group && doc.defaultView.getComputedStyle(group).display !== "none",
      });
    })()`)
  );
  check('settings have Sync, with no "unavailable" card', settings.nav && settings.nav !== 'General' && !settings.accountDisabled, settings);
  await kivo.evaluate(`gBrowser.removeTab(gBrowser.selectedTab); "ok"`);

  // صفحة الاختيار (في الـ process الرئيسي) وصفحة التعديل (process الصفحات المميزة).
  await kivo.evaluate(`gBrowser.selectedTab = gBrowser.addTrustedTab("about:profilemanager"); "ok"`);
  await sleep(3000);
  const picker = JSON.parse(
    await kivo.evaluate(`(async () => {
      const doc = gBrowser.selectedBrowser.contentDocument;
      const selector = doc.querySelector("profile-selector");
      const card = selector.shadowRoot.querySelector("profile-card");
      const avatar = card.shadowRoot.querySelector(".profile-avatar");
      const cover = card.shadowRoot.querySelector(".profile-background-image");
      await doc.fonts.ready;
      return JSON.stringify({
        cards: selector.shadowRoot.querySelectorAll("profile-card").length,
        font: doc.defaultView.getComputedStyle(selector.shadowRoot.querySelector("h1")).fontFamily,
        readex: doc.fonts.check('700 16px "Readex Pro"'),
        avatarRadius: doc.defaultView.getComputedStyle(avatar).borderTopLeftRadius,
        cover: cover.style.backgroundImage, coverFill: cover.style.fill,
      });
    })()`)
  );
  check('picker shows every profile', picker.cards === 2, picker.cards);
  check('picker uses the Kivo font', /Readex Pro/.test(picker.font) && picker.readex, picker.font);
  check('picker cards are Kivo cards', picker.avatarRadius === '50%' && /profilesBackground\d\.svg/.test(picker.cover), picker);
  writeFileSync(join(args.out, 'profiles-picker.png'), await tabShot(kivo));

  await kivo.evaluate(`gBrowser.selectedTab = gBrowser.addTrustedTab("about:editprofile"); "ok"`);
  await sleep(3000);
  const page = (await kivo.send('browsingContext.getTree', {})).contexts.findLast((c) => c.url === 'about:editprofile')?.context;
  const edit = JSON.parse(
    await kivo.evaluateIn(
      page,
      `(async () => {
        const card = document.querySelector("edit-profile-card");
        await card.updateComplete;
        const root = card.shadowRoot;
        const shown = s => { const e = root.querySelector(s); return e ? getComputedStyle(e).display !== "none" : null; };
        return JSON.stringify({
          name: root.querySelector("#profile-name")?.value,
          themes: shown("#themes"), moreThemes: shown("#more-themes"),
          shortcut: shown("#desktop-shortcut-section"), avatarButton: shown("#profile-avatar-selector-button"),
          font: getComputedStyle(root.querySelector("h1")).fontFamily,
        });
      })()`
    )
  );
  check('edit page shows the profile name', edit.name === 'Laila', edit.name);
  check('edit page hides Firefox themes, avatars, and the desktop shortcut',
    edit.themes === false && edit.moreThemes === false && edit.shortcut !== true && edit.avatarButton === false, edit);
  check('edit page uses the Kivo font', /Readex Pro/.test(edit.font), edit.font);
  writeFileSync(join(args.out, 'profiles-edit.png'), await tabShot(kivo));
} catch (e) {
  console.error(e);
  code = 1;
} finally {
  await kivo.close();
}
writeFileSync(join(args.out, 'profiles-check.json'), JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(code || (failed ? 1 : 0));
