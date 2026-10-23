#!/usr/bin/env node
// صور لكل مكان أبطال Kivo بيظهروا فيه (docs/MASCOT.md)، في النافذة كلها زي ما الولد هيشوفها، headless وبهوية اختبار
// (kivo-bidi registered، عشان قايمة الـ profile الجديد). الصفحات بتتصور جوه النافذة. والقوايم (popups) مابتتصورش
// headless، فبتترسم في صفحة اختبار بنفس عرض القايمة وبنفس طريقة Firefox في عرض الصورة، وعليها "simulated".
//
// node apps/firefox/tools/mascot-review.mjs --kivo <Kivo.exe> --out <فولدر>
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { PANEL_SHOT, WINDOW_SHOT, launch, sleep } from './kivo-bidi.mjs';

const { values: args } = parseArgs({ options: { kivo: { type: 'string' }, out: { type: 'string' } } });
if (!args.kivo || !args.out) {
  console.error('usage: mascot-review.mjs --kivo <Kivo.exe> --out <dir>');
  process.exit(2);
}
mkdirSync(args.out, { recursive: true });

const kivo = await launch(args.kivo, {}, { registered: true });
const shots = [];
const save = async (name, what, dataUrl) => {
  writeFileSync(join(args.out, `${name}.png`), Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'));
  shots.push({ name, what });
  console.log(`${name}: ${what}`);
};
const shoot = (expression) => kivo.evaluate(`(async () => { const shot = ${WINDOW_SHOT}; ${expression} })()`);
const open = async (url, wait = 3500) => {
  await kivo.evaluate(`gBrowser.selectedTab = gBrowser.addTrustedTab(${JSON.stringify(url)}); "ok"`);
  await sleep(wait);
};

try {
  await kivo.evaluate(`window.resizeTo(1280, 860); "ok"`);
  await sleep(1500);

  await open('about:addons');
  await save('addons-recommendations', 'about:addons, Recommendations: extensions.svg', await shoot('return shot(window);'));
  await kivo.evaluate(`gBrowser.selectedBrowser.contentWindow.gViewController?.loadView("addons://list/extension"); "ok"`);
  await sleep(2500);
  await save('addons-extensions', 'about:addons, Extensions with none installed', await shoot('return shot(window);'));
  await kivo.evaluate(`gBrowser.selectedBrowser.contentWindow.gViewController?.loadView("addons://list/theme"); "ok"`);
  await sleep(2500);
  await save('addons-themes', 'about:addons, Themes: themes.svg at the bottom', await shoot(`
    const doc = gBrowser.selectedBrowser.contentDocument;
    doc.scrollingElement.scrollTop = doc.scrollingElement.scrollHeight;
    await new Promise(r => setTimeout(r, 600));
    return shot(window);`));

  await open('http://kivo-review.invalid/', 6000);
  await save('error-no-connection', 'Site not found or no internet: concerned.svg', await shoot('return shot(window);'));
  await open('http://127.0.0.1:9/', 4000);
  await save('error-security', 'A blocked or unsafe address: security-error.svg', await shoot('return shot(window);'));

  await open('about:logins', 4000);
  await save('passwords', 'about:logins with no passwords: passwords.svg', await shoot('return shot(window);'));
  await open('about:restartrequired');
  await save('restart', 'about:restartrequired: restart.svg', await shoot('return shot(window);'));
  await open('about:preferences#general', 4000);
  await save('settings-general', 'Settings, General: the default-browser box (concerned or happy)', await shoot('return shot(window);'));

  // السجل فاضي في الـ sidebar (profile جديد).
  await open('about:blank', 1000);
  await kivo.evaluate(`SidebarController.show("viewHistorySidebar"); "ok"`);
  await sleep(3000);
  await save('sidebar-history', 'History sidebar, empty: empty.svg', await shoot('return shot(window);'));
  await kivo.evaluate(`SidebarController.hide(); "ok"`);

  // نافذة خاصة كاملة.
  await kivo.evaluate(`window.kivoPrivate = OpenBrowserWindow({ private: true }); "ok"`);
  await sleep(5000);
  await save('private-window', 'A private window: Kivo night look, no child, the mask', await shoot(`
    const win = window.kivoPrivate;
    win.resizeTo(1280, 860);
    await new Promise(r => setTimeout(r, 1500));
    return shot(win);`));
  await kivo.evaluate(`window.kivoPrivate.close(); "ok"`);

  // القوايم، مفتوحة فعلًا.
  const panelShot = (openPanel, panelId) => kivo.evaluate(`(async () => {
    const shotUrl = ${WINDOW_SHOT};
    const draw = ${PANEL_SHOT};
    ${openPanel}
    await new Promise(r => setTimeout(r, 2000));
    const panel = [...document.querySelectorAll("panel")].find(p => p.state === "open") ?? document.getElementById(${JSON.stringify(panelId)});
    try { return await draw(panel, shotUrl); } finally { panel.hidePopup?.(); await new Promise(r => setTimeout(r, 500)); }
  })()`);
  await open('about:blank', 800);
  await save('panel-extensions', 'Extensions menu with no extensions: extensions-wide.svg',
    await panelShot('document.getElementById("unified-extensions-button").click();', 'unified-extensions-panel'));
  await save('panel-profile', 'Kivo profile menu with one profile: new-profile-3x2.svg',
    await panelShot('document.querySelector("#kivo-profile-button .kivo-pm-button").click();', 'kivo-profile-panel'));
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await kivo.close();
}
writeFileSync(join(args.out, 'mascot-review.json'), JSON.stringify(shots, null, 2));
