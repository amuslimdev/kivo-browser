// The boy or girl choice through the real Home page and bridge, each flow on its own temporary profile. The
// taskbar side is in taskbar-check.mjs. A choice that stays a draft looks fine on the page and is lost later, so
// every check here reads profile.json itself.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';
import { launch, sleep, tabShot } from './kivo-bidi.mjs';

const { values: args } = parseArgs({ options: { kivo: { type: 'string' }, out: { type: 'string' } } });
if (!args.kivo || !args.out) throw new Error('usage: character-check.mjs --kivo <Kivo.exe> --out <directory>');
const output = resolve(args.out);
mkdirSync(output, { recursive: true });
const results = [];
function check(name, ok) {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  if (!ok) throw new Error(name);
}
const CLEAN = { version: 1, preset: 'clean', mode: 'light', accent: '#7964bc', font: 'readex', corners: 'round', background: { kind: 'color', color: '#f5f4f0' }, sites: 'theme', start: { buddy: true, clock: true, fact: true, tiles: true } };

async function withProfile(flow, prefs = {}) {
  const profile = mkdtempSync(join(output, 'profile-'));
  if (!resolve(profile).startsWith(output + sep)) throw new Error('Unexpected test profile');
  const kivo = await launch(args.kivo, prefs, { profile });
  try {
    let addon;
    for (let i = 0; i < 50 && !addon; i++) {
      addon = await kivo.evaluate('WebExtensionPolicy.getByID("home@kivo")?.getURL("") ?? null');
      if (!addon) await sleep(250);
    }
    await sleep(2000);
    let page;
    const focus = async () => {
      const { contexts } = await kivo.send('browsingContext.getTree', {});
      page = contexts.findLast(context => context.url.startsWith(addon))?.context;
    };
    await focus();
    const ui = expression => kivo.evaluateIn(page, expression);
    const request = (type, payload = {}) => ui(`browser.kivo.request(${JSON.stringify({ type, payload })}).then(value => JSON.stringify(value))`).then(JSON.parse);
    await flow({
      addon, kivo, focus, ui, request,
      click: async text => {
        check(`"${text}" is there`, await ui(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim().startsWith(${JSON.stringify(text)})); b?.click(); return !!b; })()`));
        await sleep(500);
      },
      choose: async label => {
        check(`${label} is offered`, await ui(`(() => { const b = [...document.querySelectorAll('button.character')].find(x => x.textContent.includes(${JSON.stringify(label)})); b?.click(); return !!b; })()`));
        await sleep(600);
      },
      saved: async () => JSON.parse(await kivo.evaluate(`IOUtils.readUTF8(PathUtils.join(PathUtils.profileDir, 'kivo', 'profile.json')).catch(() => '{}')`)).character,
      preset: async () => (await request('theme.get')).theme?.preset ?? null,
      shown: selector => ui(`!!document.querySelector(${JSON.stringify(selector)})`),
    });
  } finally {
    await kivo.close();
    rmSync(profile, { recursive: true, force: true });
  }
}

let code = 0;
try {
  await withProfile(async ({ click, choose, saved, preset, shown }) => {
    check('a new profile starts with the welcome', await shown('.welcome'));
    await click("Let's go");
    await choose('Girl');
    check('the welcome saves Girl at once', await saved() === 'energetic-girl');
    await sleep(1200);
    check('and her calm look', await preset() === 'calm-rose');
    await click('Next');
    await click('I love it');
    check('finishing the welcome keeps her', await saved() === 'energetic-girl');
  });

  // The profile menu's "Change my look" on a new profile: the page opens on #customize with the welcome still due.
  await withProfile(async ({ addon, kivo, focus, click, choose, saved, shown }) => {
    await kivo.evaluate(`gBrowser.selectedTab = gBrowser.addTrustedTab(${JSON.stringify(`${addon}index.html#customize`)}); "ok"`);
    await sleep(2500);
    await focus();
    check('#customize waits for the welcome', await shown('.welcome') && !(await shown('.drawer')));
    await click("Let's go");
    await choose('Girl');
    check('so Girl is saved, not a draft', await saved() === 'energetic-girl');
    await click('Next');
    await click('I love it');
    await sleep(600);
    check('Make it yours opens after it', await shown('.drawer'));
    await click('Cancel');
    await sleep(800);
    check('closing it does not lose her', await saved() === 'energetic-girl');
  });

  await withProfile(async ({ kivo, focus, ui, request, click, choose, saved, preset }) => {
    await request('theme.set', { theme: CLEAN });
    await kivo.evaluate('(BrowserCommands?.openTab ?? BrowserOpenTab)(); "ok"');
    await sleep(2500);
    await focus();
    const open = async () => {
      await ui('document.querySelector(".appearance").click(); "ok"');
      await sleep(400);
      await click('Profile');
    };
    await open();
    await choose('Girl');
    check('Make it yours previews the choice', await saved() === undefined && await preset() === 'clean');
    await click('Cancel');
    await sleep(800);
    check('Cancel keeps the profile as it was', await saved() === undefined && await preset() === 'clean');
    await open();
    await choose('Girl');
    await click('Save');
    await sleep(1000);
    check('Save keeps Girl and her look', await saved() === 'energetic-girl' && await preset() === 'calm-rose');
    check('Kivo Home\'s tab icon follows her', (await ui(`document.querySelector('link[rel="icon"]')?.href ?? ''`)).includes('energetic-girl'));
    await open();
    await choose('Boy');
    await click('Save');
    await sleep(1000);
    check('and Boy replaces her', await saved() === 'young-genius' && await preset() === 'calm-blue');
  });

  // Firefox's own page, which the test settings turn off.
  await withProfile(async ({ kivo, request }) => {
    await request('character.set', { character: 'energetic-girl' });
    await sleep(800);
    await kivo.evaluate('window.resizeTo(1280, 800); "ok"');
    await kivo.evaluate(`gBrowser.selectedTab = gBrowser.addTrustedTab('about:home'); "ok"`);
    await sleep(4000);
    const { contexts } = await kivo.send('browsingContext.getTree', {});
    const home = contexts.findLast(context => context.url === 'about:home')?.context;
    const look = JSON.parse(await kivo.evaluateIn(home, `JSON.stringify((() => {
      const logo = document.querySelector('.logo-and-wordmark .logo');
      const word = document.querySelector('.logo-and-wordmark .wordmark');
      return {
        face: getComputedStyle(logo).backgroundImage,
        text: getComputedStyle(word, '::after').content,
        gap: word.getBoundingClientRect().left - logo.getBoundingClientRect().right,
        image: getComputedStyle(word).backgroundImage,
      };
    })())`));
    console.log(JSON.stringify(look));
    writeFileSync(join(output, 'simple-page-girl.png'), await tabShot(kivo));
    check('Firefox\'s page shows her face', look.face.includes('energetic-girl'));
    check('and the owner\'s name, not the Kivo picture', look.text.includes('Hi') && look.image === 'none');
    check('right next to the face', look.gap >= 0 && look.gap <= 16);
    check('the tab icon is hers too', (await kivo.evaluate(`Cc['@mozilla.org/chrome/chrome-registry;1'].getService(Ci.nsIChromeRegistry).convertChromeURL(Services.io.newURI(gBrowser.selectedTab.image)).spec`)).includes('energetic-girl'));
    // The way back to Kivo Home (home-presets-check.mjs clicks it): right above Firefox's pencil, a moz-button in 159.
    const way = JSON.parse(await kivo.evaluateIn(home, `JSON.stringify((() => {
      const box = document.querySelector('.kivo-home-button')?.getBoundingClientRect();
      const pencil = document.querySelector('.personalizeButtonWrapper moz-button, .personalize-button')?.getBoundingClientRect();
      return { box: box && [box.left, box.top, box.right, box.bottom], pencil: pencil && [pencil.left, pencil.top, pencil.right, pencil.bottom, pencil.width], width: innerWidth, height: innerHeight };
    })())`));
    console.log(JSON.stringify(way));
    check('the Kivo Home button sits right above Firefox\'s pencil', way.box && way.pencil?.[4] > 0 && way.box[3] <= way.pencil[1] && way.pencil[1] - way.box[3] <= 16 && Math.abs(way.box[2] - way.pencil[2]) <= 1 && way.box[2] <= way.width && way.box[3] <= way.height);
  }, { 'remote.prefs.recommended': false, 'browser.newtabpage.enabled': true });
} catch (error) {
  console.error(error);
  code = 1;
}
console.log(`${results.filter(result => result.ok).length}/${results.length} passed`);
process.exit(code);
