// تشغيل Kivo headless والكلام معاه بـ WebDriver BiDi، من غير مكتبات ومن غير ما نافذة تظهر.
// مشترك بين shot.mjs و home-check.mjs و profiles-check.mjs و fox-scan.mjs.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Kivo بـ profile جديد. prefs بتتكتب في user.js قبل ما يفتح.
 * registered: من غير -profile، فالـ profile بيتسجل في profiles.ini زي الاستخدام العادي، ودي الطريقة الوحيدة اللي
 * الـ profiles بتاعة Firefox (G3) بتشتغل بيها. بيستخدم هوية اختبار (browser\application-test.ini، Profile=KivoTest)،
 * فالبيانات في %APPDATA%\KivoTest وبتتمسح قبل كل تشغيلة، ومش بتلمس %APPDATA%\Kivo. prefs مش متاحة في الوضع ده.
 * profile: فولدر profile موجود بيتفتح تاني وما بيتمسحش (اختبار حاجة لازم تفضل بعد ما Kivo يتقفل ويتفتح، زي الـ
 * workspaces). والمسح على اللي نادى.
 */
export async function launch(exe, prefs = {}, { registered = false, profile: kept = null } = {}) {
  const profile = kept ?? mkdtempSync(join(tmpdir(), 'kivo-bidi-'));
  const lines = [
    ['browser.startup.homepage_override.mstone', 'ignore'],
    ['browser.aboutwelcome.enabled', false],
    ['trailhead.firstrun.didSeeAboutWelcome', true],
    // الاختبار مايسألش عن تحديثات Kivo الحقيقية ولا ينزّلها (updates-check.mjs بيدّي سيرفر محلي).
    ['kivo.update.url', ''],
    ...Object.entries(prefs),
  ].map(([name, value]) => `user_pref(${JSON.stringify(name)}, ${JSON.stringify(value)});`);
  writeFileSync(join(profile, 'user.js'), lines.join('\n') + '\n');

  // build محلي ملفاته symlinks، والـ sandbox محتاج المتغيرين دول زي mach run.
  const dev = /^(.*)[\\/]dist[\\/]bin[\\/]firefox\.exe$/i.exec(exe);
  const env = { ...process.env, MOZ_HEADLESS: '1', MOZ_REMOTE_ALLOW_SYSTEM_ACCESS: '1' };
  // ولا يلمس فولدر التحديثات بتاع Kivo المتثبت.
  env.KIVO_UPDATES_DIR ||= join(profile, 'kivo-updates');
  if (dev) Object.assign(env, { MOZ_DEVELOPER_OBJ_DIR: dev[1], MOZ_DEVELOPER_REPO_DIR: dirname(dev[1]) });

  // Kivo.exe (G3) launcher بيشغّل المحرك ويقفل، فالـ BiDi بنقراه من المحرك نفسه بنفس الـ -app بتاع الـ launcher.
  const args = registered ? ['-no-remote', '--headless', '--remote-debugging-port', '0'] : ['-profile', profile, '-no-remote', '--headless', '--remote-debugging-port', '0'];
  const engine = join(dirname(exe), 'kivo-browser.exe');
  let identity = join(dirname(exe), 'browser', 'application.ini');
  if (basename(exe).toLowerCase() === 'kivo.exe' && existsSync(engine) && existsSync(identity)) {
    if (registered) {
      const test = join(dirname(identity), 'application-test.ini');
      writeFileSync(test, readFileSync(identity, 'utf8').replace(/^Profile=.*$/m, 'Profile=KivoTest'));
      identity = test;
      rmSync(join(process.env.APPDATA, 'KivoTest'), { recursive: true, force: true });
      rmSync(join(process.env.LOCALAPPDATA, 'KivoTest'), { recursive: true, force: true });
    }
    exe = engine;
    args.unshift('-app', identity);
    // زي Launcher.cs: الـ profiles التانية بتفتح بنفس الهوية (KivoProfiles.sys.mjs).
    env.KIVO_APP_FILE = identity;
  } else if (registered) {
    throw new Error('registered profiles need a packaged Kivo.exe (browser\\application.ini)');
  }
  const ff = spawn(exe, args, { stdio: ['ignore', 'pipe', 'pipe'], env });
  let log = '';
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no BiDi endpoint\n${log}`)), 60000);
    const onData = (chunk) => {
      log += chunk;
      const m = /WebDriver BiDi listening on (ws:\/\/[^\s]+)/.exec(log);
      if (m) {
        clearTimeout(timer);
        resolve(m[1].replace(/\/$/, '') + '/session');
      }
    };
    ff.stdout.on('data', onData);
    ff.stderr.on('data', onData);
  });

  const socket = new WebSocket(url);
  let id = 0;
  const pending = new Map();
  socket.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    msg.type === 'error' ? p.reject(new Error(`${msg.error}: ${msg.message}`)) : p.resolve(msg.result);
  });
  await new Promise((r) => socket.addEventListener('open', r, { once: true }));
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      pending.set(++id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  await send('session.new', { capabilities: {} });

  let chrome = null;
  for (let i = 0; i < 40 && !chrome; i++) {
    const tree = await send('browsingContext.getTree', { 'moz:scope': 'chrome' });
    chrome = tree.contexts.find((c) => c.url === 'chrome://browser/content/browser.xhtml')?.context;
    if (!chrome) await sleep(250);
  }
  if (!chrome) throw new Error('no browser window');

  const evaluateIn = async (context, expression) => {
    const r = await send('script.evaluate', { expression, target: { context }, awaitPromise: true });
    if (r.type === 'exception') throw new Error(r.exceptionDetails?.text ?? 'script exception');
    return r.result?.value;
  };

  return {
    send,
    chrome,
    log: () => log,
    /** JavaScript في نافذة المتصفح نفسها (gBrowser، و Services...). */
    evaluate: (expression) => evaluateIn(chrome, expression),
    evaluateIn,
    /** قفل عادي زي ما الولد بيقفل Kivo (quit-application-granted وحفظ كل حاجة)، وبيستنى الـ process يخلص. */
    async quit() {
      const exited = new Promise((resolve) => (ff.exitCode !== null ? resolve() : ff.once('exit', resolve)));
      send('script.evaluate', {
        expression: 'Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit); "ok"',
        target: { context: chrome },
        awaitPromise: false,
      }).catch(() => {});
      await Promise.race([exited, sleep(30000)]);
      socket.close();
      if (ff.exitCode === null) ff.kill();
      if (!kept) rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
    },
    async close() {
      try {
        await send('browser.close', {});
      } catch {}
      socket.close();
      await sleep(1000);
      ff.kill();
      if (!kept) rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
    },
  };
}

/**
 * صورة للصفحة اللي في التاب المختار، من ناحية المتصفح. BiDi مابيصوّرش صفحات الـ extensions (privileged scope)،
 * و drawSnapshot على التاب نفسه بيشتغل لأي صفحة.
 */
export async function tabShot(kivo) {
  const png = await kivo.evaluate(`(async () => {
    const browser = gBrowser.selectedBrowser;
    const bitmap = await browser.browsingContext.currentWindowGlobal.drawSnapshot(null, 1, "white");
    const canvas = document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext("2d").drawImage(bitmap, 0, 0);
    return canvas.toDataURL("image/png");
  })()`);
  return Buffer.from(png.slice(png.indexOf(',') + 1), 'base64');
}

/** صورة للواجهة نفسها. drawSnapshot بيرجّع آخر صورة اترسمت، و drawWindow بيرسمها دلوقتي (من غير محتوى التاب). */
export async function chromeShot(kivo, width, height, scale = 1) {
  const png = await kivo.evaluate(`(async () => {
    for (const el of document.querySelectorAll("[remotecontrol]")) el.removeAttribute("remotecontrol");
    document.documentElement.getBoundingClientRect();
    const canvas = document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
    canvas.width = ${width} * ${scale};
    canvas.height = ${height} * ${scale};
    const context = canvas.getContext("2d");
    context.scale(${scale}, ${scale});
    context.drawWindow(window, 0, 0, ${width}, ${height}, "white");
    return canvas.toDataURL("image/png");
  })()`);
  return Buffer.from(png.slice(png.indexOf(',') + 1), 'base64');
}

// ---------- صور النافذة كلها والقوايم (mascot-review.mjs و workspaces-check.mjs) ----------
// كود بيتبعت لـ evaluate كنص: WINDOW_SHOT(win) بيرجّع data URL، و PANEL_SHOT(panel, WINDOW_SHOT) بيرسم قايمة مفتوحة.

// النافذة كلها: الواجهة (drawWindow) والصفحة اللي في التاب (drawSnapshot) مكانها.
export const WINDOW_SHOT = `async win => {
  const w = win.innerWidth, h = win.innerHeight;
  const canvas = win.document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
  canvas.width = w; canvas.height = h;
  const context = canvas.getContext("2d");
  for (const el of win.document.querySelectorAll("[remotecontrol]")) el.removeAttribute("remotecontrol");
  context.drawWindow(win, 0, 0, w, h, "white");
  const browser = win.gBrowser.selectedBrowser;
  const box = browser.getBoundingClientRect();
  try {
    const bitmap = await browser.browsingContext.currentWindowGlobal.drawSnapshot(null, 1, "white");
    context.drawImage(bitmap, box.left, box.top, box.width, box.height);
  } catch {}
  return canvas.toDataURL("image/png");
}`;

// قايمة مفتوحة فعلًا، بتترسم من الـ layout بتاعها: مكان ومقاس كل صورة وزرار ونص، فوق صورة النافذة. headless
// مابيرسمش الـ popups نفسها، بس الـ layout حقيقي، فمقاس الصورة ومكانها هما اللي الولد هيشوفهم.
export const PANEL_SHOT = `async (panel, shotUrl) => {
  const img = new Image();
  img.src = await shotUrl(window);
  await img.decode();
  const canvas = document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
  canvas.width = img.width; canvas.height = img.height;
  const c = canvas.getContext("2d");
  c.drawImage(img, 0, 0);
  const view = panel.querySelector("panelview[current], panelview[visible]") ?? panel;
  const box = view.getBoundingClientRect();
  const style = getComputedStyle(view);
  c.save();
  c.shadowColor = "rgba(0, 0, 0, 0.25)"; c.shadowBlur = 24; c.shadowOffsetY = 6;
  c.fillStyle = getComputedStyle(panel).getPropertyValue("--arrowpanel-background").trim() || "#fff";
  c.beginPath(); c.roundRect(box.x, box.y, box.width, box.height, 12); c.fill();
  c.restore();
  const urlOf = el => {
    const s = getComputedStyle(el);
    for (const v of [el.currentSrc, el.getAttribute?.("src"), s.listStyleImage, s.content, s.backgroundImage]) {
      const m = /url\\("?([^")]+)"?\\)/.exec(v ?? "") ?? (v && /^(chrome|file|blob|data):/.test(v) ? [0, v] : null);
      if (m) return m[1];
    }
    return null;
  };
  const visible = (el, r) => r.width > 1 && r.height > 1 && r.bottom > box.y && r.top < box.bottom && getComputedStyle(el).visibility !== "hidden";
  const elements = [];
  const collect = root => { for (const el of root.querySelectorAll("*")) { elements.push(el); if (el.shadowRoot) collect(el.shadowRoot); } };
  collect(view);
  for (const el of elements) {
    const r = el.getBoundingClientRect();
    if (!visible(el, r)) continue;
    const s = getComputedStyle(el);
    const radius = Math.min(parseFloat(s.borderTopLeftRadius) || 0, r.height / 2, r.width / 2);
    if (!/^(rgba\\(0, 0, 0, 0\\)|transparent)$/.test(s.backgroundColor)) {
      c.fillStyle = s.backgroundColor; c.beginPath(); c.roundRect(r.x, r.y, r.width, r.height, radius); c.fill();
    }
    // خلفيات linear-gradient بسيطة (to top/right/bottom/left)، من تحت لفوق زي CSS (منتقي الألوان مثلًا).
    if (el.localName !== "input") {
      const layers = [...s.backgroundImage.matchAll(/linear-gradient\\(to (top|right|bottom|left), ((?:rgba?\\([^)]*\\)(?:, )?)+)\\)/g)].reverse();
      for (const [, dir, stops] of layers) {
        const colors = stops.match(/rgba?\\([^)]*\\)/g);
        const [x0, y0, x1, y1] = { top: [0, r.height, 0, 0], bottom: [0, 0, 0, r.height], right: [0, 0, r.width, 0], left: [r.width, 0, 0, 0] }[dir];
        const g = c.createLinearGradient(r.x + x0, r.y + y0, r.x + x1, r.y + y1);
        colors.forEach((color, i) => g.addColorStop(i / Math.max(1, colors.length - 1), color));
        c.fillStyle = g; c.beginPath(); c.roundRect(r.x, r.y, r.width, r.height, radius); c.fill();
      }
    }
    const border = parseFloat(s.borderTopWidth) || 0;
    if (border > 0 && s.borderTopStyle !== "none" && s.borderTopColor !== "rgba(0, 0, 0, 0)") {
      c.strokeStyle = s.borderTopColor; c.lineWidth = border;
      c.setLineDash(s.borderTopStyle === "dashed" ? [5, 4] : []);
      c.beginPath(); c.roundRect(r.x + border / 2, r.y + border / 2, r.width - border, r.height - border, radius); c.stroke();
      c.setLineDash([]);
    }
    // شريط درجات (range بخلفية gradient): الألوان والدايرة اللي عليه.
    if (el.localName === "input" && el.type === "range") {
      const stops = [...s.backgroundImage.matchAll(/rgba?\\([^)]+\\)/g)].map(m => m[0]);
      if (stops.length > 1) {
        const g = c.createLinearGradient(r.x, 0, r.right, 0);
        stops.forEach((color, i) => g.addColorStop(i / (stops.length - 1), color));
        c.fillStyle = g; c.beginPath(); c.roundRect(r.x, r.y, r.width, r.height, r.height / 2); c.fill();
      }
      const at = (el.value - el.min) / ((el.max - el.min) || 1);
      c.strokeStyle = "#fff"; c.lineWidth = 2;
      c.beginPath(); c.arc(r.x + 8 + at * (r.width - 16), r.y + r.height / 2, 7, 0, 2 * Math.PI); c.stroke();
    }
    if (el.localName === "input" && /^(text|search|)$/.test(el.type ?? "")) {
      c.font = s.fontWeight + " " + s.fontSize + " " + s.fontFamily;
      c.fillStyle = el.value ? s.color : "#8a8a96"; c.textBaseline = "middle";
      c.fillText(el.value || el.placeholder, r.x + (parseFloat(s.paddingLeft) || 6), r.y + r.height / 2);
    }
    const url = urlOf(el);
    // الأفاتار ملف من غير امتداد (file: أو blob:)، فالـ img أي صورة، والخلفيات صور بس.
    if (url && (el.localName === "img" || /\\.(svg|png|gif)/.test(url)) && r.width > 16) {
      const pic = new Image(); pic.src = url;
      try {
        await pic.decode();
        const ratio = (pic.naturalWidth || r.width) / (pic.naturalHeight || r.height);
        let w = r.width, h = w / ratio;
        if (h > r.height) { h = r.height; w = h * ratio; }
        c.drawImage(pic, r.x + (r.width - w) / 2, r.y + (r.height - h) / 2, w, h);
      } catch {}
    }
    for (const node of el.childNodes) {
      if (node.nodeType !== 3 || !node.textContent.trim()) continue;
      const range = document.createRange(); range.selectNodeContents(node);
      const lines = [...range.getClientRects()];
      c.font = s.fontWeight + " " + s.fontSize + " " + s.fontFamily;
      c.fillStyle = s.color; c.textBaseline = "top";
      const words = node.textContent.trim().split(/\\s+/);
      let i = 0;
      for (const line of lines) {
        let text = "";
        while (i < words.length && c.measureText(text + words[i]).width <= line.width + 2) text += words[i++] + " ";
        c.fillText(text.trim(), line.x, line.y + 1);
      }
    }
  }
  c.fillStyle = "#c00"; c.font = "12px Segoe UI";
  c.fillText("panel redrawn from its real layout (headless cannot paint popups)", box.x, box.bottom + 8);
  return canvas.toDataURL("image/png");
}`;
