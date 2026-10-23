#!/usr/bin/env node
// تحديثات Kivo (G6 في docs/FIREFOX.md)، من غير ما Kivo المتثبت يتلمس:
// - Kivo.exe (Updater.cs) متبني بمفتاح تجربة، ومحرك وهمي بيكتب الـ arguments اللي وصلته: النسخة الموقّعة بتتركب
//   مكان القديمة، والـ zip المتلعّب فيه أو الأقدم بيترفض، ومفيش تركيب و Kivo مفتوح، و --kivo-restart بيستنى.
// - جوه Kivo (KivoShell.sys.mjs) headless، مع سيرفر محلي: بينزّل في الخلفية، ويتأكد من الـ sha256، ويكتب ready.txt،
//   ويظهر "Restart to update".
//
// node apps/firefox/tools/updates-check.mjs --kivo <Kivo.exe المتغلف> --out <فولدر>
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { launch, sleep } from './kivo-bidi.mjs';

const { values: args } = parseArgs({ options: { kivo: { type: 'string' }, out: { type: 'string' } } });
if (!args.kivo || !args.out) {
  console.error('usage: updates-check.mjs --kivo <Kivo.exe> --out <dir>');
  process.exit(2);
}
mkdirSync(args.out, { recursive: true });
const tools = dirname(fileURLToPath(import.meta.url));

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`);
};
let code = 0;

const root = mkdtempSync(join(tmpdir(), 'kivo-updates-'));
const OLD = '20260101000000';
const NEW = '20270101000000';

// مفتاح تجربة، بنفس شكل release-key.pub.xml.
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = publicKey.export({ format: 'jwk' });
const b64 = (s) => Buffer.from(s, 'base64url').toString('base64');
const publicXml = join(root, 'test-key.pub.xml');
writeFileSync(publicXml, `<RSAKeyValue><Modulus>${b64(jwk.n)}</Modulus><Exponent>${b64(jwk.e)}</Exponent></RSAKeyValue>\n`);

const powershell = (file, ...rest) =>
  execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', file, ...rest], { encoding: 'utf8' });

// Kivo.exe الحقيقي (Launcher.cs و Updater.cs) بمفتاح التجربة، ومحرك وهمي: بيكتب الـ arguments في seen.txt، ومع
// --stay بيفضل مفتوح 4 ثواني (Kivo مفتوح).
const launcher = join(root, 'Kivo.exe');
powershell(join(tools, 'build-launcher.ps1'), '-Output', launcher, '-PublicKey', publicXml);
const fakeEngine = join(root, 'kivo-browser.exe');
writeFileSync(
  join(root, 'Fake.cs'),
  `class Fake { static void Main() {
    string args = System.Environment.CommandLine;
    args = args.StartsWith("\\"") ? args.Substring(args.IndexOf('"', 1) + 1) : args.Substring(args.IndexOf(' ') + 1);
    if (args.Contains("--stay")) { System.Threading.Thread.Sleep(4000); return; }
    System.IO.File.WriteAllText(System.IO.Path.Combine(System.AppDomain.CurrentDomain.BaseDirectory, "seen.txt"), args.Trim());
  } }`
);
const csc = join(process.env.WINDIR, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
execFileSync(csc, ['/nologo', `/out:${fakeEngine}`, join(root, 'Fake.cs')]);

/** فولدر Kivo وهمي: Kivo.exe والمحرك، و application.ini بالـ BuildID، وملف بيقول هو أنهي نسخة. */
function kivoFolder(dir, buildId, marker) {
  mkdirSync(join(dir, 'browser'), { recursive: true });
  copyFileSync(launcher, join(dir, 'Kivo.exe'));
  copyFileSync(fakeEngine, join(dir, 'kivo-browser.exe'));
  writeFileSync(join(dir, 'browser', 'application.ini'), `[App]\nName=Kivo\nVersion=1.0\nBuildID=${buildId}\n`);
  writeFileSync(join(dir, marker), marker);
}

/** zip زي package.ps1 (الفولدر Kivo جوه)، وتوقيعه. */
function release(name, buildId) {
  const stage = join(root, name);
  kivoFolder(join(stage, 'Kivo'), buildId, `${name}.txt`);
  const zip = join(root, `${name}.zip`);
  execFileSync('powershell.exe', ['-NoProfile', '-Command', `Compress-Archive -Path '${join(stage, 'Kivo')}' -DestinationPath '${zip}'`]);
  const bytes = readFileSync(zip);
  return { zip, bytes, signature: sign('sha256', bytes, privateKey).toString('base64') };
}
const fresh = release('new', NEW);
const older = release('older', '20250101000000');

let caseNumber = 0;
/** Kivo متثبت (القديم) وفولدر تحديثات فيه ready.txt للـ zip ده. */
function installed(update, { signature = update.signature, bytes = update.bytes } = {}) {
  const dir = join(root, `case-${++caseNumber}`);
  const app = join(dir, 'Kivo');
  const updates = join(dir, 'updates');
  kivoFolder(app, OLD, 'old.txt');
  mkdirSync(updates, { recursive: true });
  writeFileSync(join(updates, 'Kivo-x.zip'), bytes);
  writeFileSync(join(updates, 'ready.txt'), `file=Kivo-x.zip\nbuildId=${NEW}\nversion=999.0\nsignature=${signature}\n`);
  return { app, updates, env: { ...process.env, KIVO_UPDATES_DIR: updates } };
}

async function seen(app, ms = 30000) {
  for (let waited = 0; waited < ms; waited += 250) {
    if (existsSync(join(app, 'seen.txt'))) {
      return readFileSync(join(app, 'seen.txt'), 'utf8');
    }
    await sleep(250);
  }
  return null;
}
const log = (updates) => (existsSync(join(updates, 'update.log')) ? readFileSync(join(updates, 'update.log'), 'utf8') : '');

try {
  {
    const { app, updates, env } = installed(fresh);
    spawnSync(join(app, 'Kivo.exe'), ['-osint', '-url', 'https://example.com/'], { env });
    const args = await seen(app);
    check('a signed update replaces Kivo before the engine starts', existsSync(join(app, 'new.txt')) && !existsSync(join(app, 'old.txt')), { args, log: log(updates) });
    check('and the engine gets the same arguments (a link from another app)', args === '-osint -url https://example.com/', args);
    check('the download is cleaned up', !existsSync(join(updates, 'ready.txt')) && !existsSync(join(updates, 'Kivo-x.zip')) && !existsSync(`${app}.previous`), readdirSync(updates));
  }
  {
    const tampered = Buffer.from(fresh.bytes);
    tampered[Math.floor(tampered.length / 2)] ^= 0xff;
    const { app, updates, env } = installed(fresh, { bytes: tampered });
    spawnSync(join(app, 'Kivo.exe'), [], { env });
    const args = await seen(app);
    check('a changed zip is refused and the old Kivo opens', existsSync(join(app, 'old.txt')) && args !== null && /Bad signature/.test(log(updates)), log(updates));
    check('and it is not tried again', !existsSync(join(updates, 'ready.txt')) && !existsSync(join(updates, 'Kivo-x.zip')), readdirSync(updates));
  }
  {
    const { app, updates, env } = installed(older);
    spawnSync(join(app, 'Kivo.exe'), [], { env });
    await seen(app);
    check('an older signed release does not replace a newer Kivo', existsSync(join(app, 'old.txt')) && /not newer/.test(log(updates)), log(updates));
  }
  {
    const { app, updates, env } = installed(fresh);
    const running = spawn(join(app, 'kivo-browser.exe'), ['--stay'], { env });
    await sleep(500);
    spawnSync(join(app, 'Kivo.exe'), ['https://example.org/'], { env });
    const args = await seen(app);
    check('no update while Kivo is open (another window opens)', existsSync(join(app, 'old.txt')) && existsSync(join(updates, 'ready.txt')) && args === 'https://example.org/', args);
    await new Promise((r) => (running.exitCode !== null ? r() : running.once('exit', r)));
  }
  {
    const { app, updates, env } = installed(fresh);
    const running = spawn(join(app, 'kivo-browser.exe'), ['--stay'], { env });
    await sleep(500);
    const started = Date.now();
    spawnSync(join(app, 'Kivo.exe'), ['--kivo-restart'], { env });
    const args = await seen(app);
    check('"Restart to update" waits for Kivo to close, then updates', existsSync(join(app, 'new.txt')) && Date.now() - started > 3000, { args, log: log(updates) });
    check('and --kivo-restart does not reach the engine', args === '', args);
    running.kill();
  }
} catch (e) {
  console.error(e);
  check('the Kivo.exe tests ran', false, String(e.message ?? e));
}

// ---------- جوه Kivo ----------
let served = null;
let zipRequests = 0;
const server = createServer((request, response) => {
  if (request.url === '/update.json') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(served));
  } else if (request.url === '/Kivo.zip') {
    zipRequests++;
    response.writeHead(200, { 'content-type': 'application/zip' });
    response.end(fresh.bytes);
  } else {
    response.writeHead(404);
    response.end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const sha256 = createHash('sha256').update(fresh.bytes).digest('hex');
const releaseJson = (buildId, extra = {}) => ({
  version: '999.0',
  buildId,
  url: `${base}/Kivo.zip`,
  size: fresh.bytes.length,
  sha256,
  signature: fresh.signature,
  ...extra,
});

const updatesDir = join(root, 'kivo-updates');
process.env.KIVO_UPDATES_DIR = updatesDir;
served = releaseJson('29990101000000');
const kivo = await launch(args.kivo, { 'kivo.update.url': `${base}/update.json`, 'kivo.update.lastCheck': 0 });
try {
  const run = async (body) => JSON.parse(await kivo.evaluate(`(async () => {
    const K = ChromeUtils.importESModule("moz-src:///browser/components/kivo/KivoShell.sys.mjs");
    const dir = ${JSON.stringify(updatesDir)};
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const ready = async () => { try { return await IOUtils.readUTF8(PathUtils.join(dir, "ready.txt")); } catch { return ""; } };
    const files = async () => { try { return (await IOUtils.getChildren(dir)).map(p => PathUtils.filename(p)).sort(); } catch { return []; } };
    ${body}
  })()`));

  const staged = await run(`
    Services.prefs.setIntPref("kivo.update.lastCheck", 0);
    await K.checkForUpdate();
    await wait(500);
    const n = gNotificationBox.getNotificationWithValue("kivo-update");
    return JSON.stringify({
      ready: await ready(), files: await files(), label: n?.message ?? "",
      buttons: [...(n?.querySelectorAll("button, moz-button") ?? []), ...(n?.shadowRoot?.querySelectorAll("button, moz-button") ?? [])]
        .map(b => b.label || b.getAttribute("label") || b.textContent.trim()),
    });`);
  check('Kivo downloads a newer release in the background', staged.files.includes('Kivo-29990101000000.zip') && zipRequests === 1, staged.files);
  check('and writes ready.txt for Kivo.exe', /^file=Kivo-29990101000000\.zip$/m.test(staged.ready) && /^buildId=29990101000000$/m.test(staged.ready) && staged.ready.includes(`signature=${fresh.signature}`), staged.ready);
  check('the download matches update.json', readFileSync(join(updatesDir, 'Kivo-29990101000000.zip')).equals(fresh.bytes));
  check('Kivo says the update is ready', staged.label.includes('999.0') && staged.buttons.includes('Restart to update'), staged);

  const cancel = await run(`
    const veto = { observe(subject) { subject.QueryInterface(Ci.nsISupportsPRBool).data = true; } };
    Services.obs.addObserver(veto, "quit-application-requested");
    const restarted = K.restartToUpdate();
    Services.obs.removeObserver(veto, "quit-application-requested");
    return JSON.stringify({ restarted, resume: Services.prefs.getBoolPref("browser.sessionstore.resume_session_once", false) });`);
  check('"Restart to update" stops if a page asks to stay open', cancel.restarted === false && cancel.resume === false, cancel);

  served = releaseJson('29990202000000', { sha256: '0'.repeat(64) });
  const corrupt = await run(`
    Services.prefs.setIntPref("kivo.update.lastCheck", 0);
    await K.checkForUpdate();
    return JSON.stringify({ ready: await ready(), files: await files() });`);
  check('a download that does not match update.json is thrown away', /^buildId=29990101000000$/m.test(corrupt.ready) && !corrupt.files.some((f) => f.endsWith('.part')), corrupt);

  served = releaseJson('20000101000000');
  const before = zipRequests;
  const notNewer = await run(`
    Services.prefs.setIntPref("kivo.update.lastCheck", 0);
    await K.checkForUpdate();
    return JSON.stringify({ checked: Services.prefs.getIntPref("kivo.update.lastCheck", 0) });`);
  check('an older release is not downloaded', zipRequests === before && notNewer.checked > 0, { zipRequests, before });

  const dismissed = await run(`
    gNotificationBox.getNotificationWithValue("kivo-update")?.dismiss();
    await wait(300);
    await K.checkForUpdate();
    await wait(300);
    return JSON.stringify({ pref: Services.prefs.getStringPref("kivo.update.dismissed", ""), again: !!gNotificationBox.getNotificationWithValue("kivo-update") });`);
  check('closing the notice keeps it closed for that release', dismissed.pref === '29990101000000' && !dismissed.again, dismissed);
} catch (e) {
  console.error(e);
  code = 1;
} finally {
  await kivo.close();
  server.close();
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
writeFileSync(join(args.out, 'updates-check.json'), JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(code || (failed ? 1 : 0));
