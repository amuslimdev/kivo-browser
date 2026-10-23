#!/usr/bin/env node
// صور لواجهة Kivo نفسها (التابات وشريط الأدوات)، headless، من غير ما نافذة تظهر على الشاشة.
// كل --theme أو --preset صورة لوحدها، والثيم بيتغير وهو شغال زي ما الـ profile بيغيّره (pref kivo.theme).
//
// node apps/firefox/tools/shot.mjs --kivo <Kivo.exe أو obj-kivo\dist\bin\firefox.exe> --out shot.png --preset candy --preset space
// الصور: shot-1.png و shot-2.png ... بنفس الترتيب.
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { chromeShot, launch, sleep } from './kivo-bidi.mjs';

const { values: args } = parseArgs({
  options: {
    kivo: { type: 'string' },
    out: { type: 'string' },
    theme: { type: 'string', multiple: true, default: [] },
    // عوالم Kivo بالاسم (web/ui/src/theme/presets.ts). Windows PowerShell 5.1 بيشيل علامات التنصيص من الـ JSON
    // وهو بيبعته لبرنامج، فـ --preset أسهل من --theme هناك.
    preset: { type: 'string', multiple: true, default: [] },
    width: { type: 'string', default: '1280' },
    height: { type: 'string', default: '96' },
    urls: { type: 'string', default: 'https://www.wikipedia.org/,https://example.com/,https://www.mozilla.org/' },
    select: { type: 'string', default: '2' },
    // 2 للتفاصيل (الاستدارة والانحناءات).
    scale: { type: 'string', default: '1' },
  },
});
if (!args.kivo || !args.out) {
  console.error('usage: shot.mjs --kivo <exe> --out <png> [--preset <name> ...] [--theme <json> ...]');
  process.exit(2);
}

export const PRESETS = {
  sky: { mode: 'light', accent: '#1f8bff', corners: 'bubbly', font: 'baloo' },
  space: { mode: 'dark', accent: '#8b6cff', corners: 'round', font: 'alexandria' },
  ocean: { mode: 'dark', accent: '#14c2d6', corners: 'bubbly', font: 'rubik' },
  candy: { mode: 'light', accent: '#ff4f9a', corners: 'bubbly', font: 'baloo' },
  jungle: { mode: 'dark', accent: '#5ad16b', corners: 'round', font: 'changa' },
  neon: { mode: 'dark', accent: '#ff3df2', corners: 'soft', font: 'handjet' },
  aurora: { mode: 'dark', accent: '#39d6a0', corners: 'round', font: 'messiri' },
  clean: { mode: 'light', accent: '#7964bc', corners: 'round', font: 'readex' },
  midnight: { mode: 'dark', accent: '#7aa2ff', corners: 'soft', font: 'cairo' },
};
for (const name of args.preset) {
  if (!PRESETS[name]) throw new Error(`unknown preset ${name}: ${Object.keys(PRESETS).join(', ')}`);
  args.theme.push(JSON.stringify(PRESETS[name]));
}

const kivo = await launch(args.kivo);
let code = 0;
try {
  await kivo.evaluate(`(async () => {
    window.resizeTo(${Number(args.width)}, 600);
    const principal = Services.scriptSecurityManager.getSystemPrincipal();
    for (const url of ${JSON.stringify(args.urls.split(',').filter(Boolean))}) {
      gBrowser.addTab(url, { triggeringPrincipal: principal });
    }
    gBrowser.removeTab(gBrowser.tabs[0]);
    gBrowser.selectedTab = gBrowser.tabs[${Number(args.select) - 1}] ?? gBrowser.tabs[0];
    return "ok";
  })()`);
  // المواقع تحمّل عناوينها وأيقوناتها.
  await sleep(6000);

  const themes = args.theme.length ? args.theme : [null];
  for (const [index, theme] of themes.entries()) {
    if (theme) await kivo.evaluate(`Services.prefs.setStringPref("kivo.theme", ${JSON.stringify(theme)}); "ok"`);
    await sleep(800);
    const out = themes.length > 1 ? args.out.replace(/\.png$/i, `-${index + 1}.png`) : args.out;
    writeFileSync(out, await chromeShot(kivo, Number(args.width), Number(args.height), Number(args.scale)));
    console.log(out);
  }
} catch (e) {
  console.error(e);
  code = 1;
} finally {
  await kivo.close();
}
process.exit(code);
