#!/usr/bin/env node
// بيدوّر على رسومات Firefox (التعلب "Kit"، وشعاراته) في Kivo، headless: اللي ظاهر في القايمة الرئيسية وقايمة الحساب
// وصفحة الإعدادات، وجرد لكل صورة تعلب في الـ build (حتى اللي في قايمة فرعية أو صفحة فاضية) إن ليها override في
// kivo/jar.mn. أماكنهم في docs/MASCOT.md.
// node apps/firefox/tools/fox-scan.mjs --kivo <Kivo.exe>
import { parseArgs } from 'node:util';
import { launch, sleep } from './kivo-bidi.mjs';

const { values: args } = parseArgs({ options: { kivo: { type: 'string' } } });
if (!args.kivo) {
  console.error('usage: fox-scan.mjs --kivo <exe>');
  process.exit(2);
}

// بيرجّع العناصر الظاهرة اللي صورتها (src، أو image، أو list-style-image، أو background-image) فيها تعلب أو شعار Firefox.
const SCAN = `(doc, where) => {
  const fox = /kit[-.]|fox|mascot|firefox-logo|share-firefox|firefox\\.svg|monitor|relay|vpn/i;
  const found = [];
  const walk = root => {
    for (const el of root.querySelectorAll("*")) {
      if (el.shadowRoot) walk(el.shadowRoot);
      const style = el.ownerGlobal?.getComputedStyle(el) ?? el.ownerDocument.defaultView.getComputedStyle(el);
      const urls = [el.getAttribute("src"), el.getAttribute("image"), style.listStyleImage, style.backgroundImage, style.content]
        .filter(u => u && u !== "none" && fox.test(u));
      if (!urls.length) continue;
      const box = el.getBoundingClientRect();
      if (box.width < 2 || box.height < 2 || style.visibility === "hidden") continue;
      found.push({ where, el: el.localName + (el.id ? "#" + el.id : "") + (typeof el.className === "string" && el.className ? "." + el.className.trim().split(/\\s+/).join(".") : ""), url: urls[0].slice(0, 120), size: Math.round(box.width) + "x" + Math.round(box.height) });
    }
  };
  walk(doc);
  return found;
}`;

const kivo = await launch(args.kivo);
try {
  await sleep(2000);
  const report = JSON.parse(await kivo.evaluate(`(async () => {
    const scan = ${SCAN};
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const out = [];
    out.push(...scan(document, "window"));

    // القايمة الرئيسية (☰).
    PanelUI.show();
    await wait(1200);
    out.push(...scan(document, "app menu"));
    PanelUI.hide();
    await wait(300);

    // قايمة الحساب، لو الزرار موجود.
    const account = document.getElementById("fxa-toolbar-menu-button");
    if (account && !account.hidden) {
      account.click();
      await wait(1200);
      out.push(...scan(document, "account menu"));
      for (const panel of document.querySelectorAll("panel[panelopen], panel[open]")) panel.hidePopup?.();
      await wait(300);
    }

    // صفحة الإعدادات بتشتغل في الـ process ده، فنقدر نقرا الـ DOM بتاعها.
    for (const pane of ["general", "home", "search", "privacy", "sync"]) {
      const tab = gBrowser.addTrustedTab("about:preferences#" + pane);
      gBrowser.selectedTab = tab;
      await wait(1800);
      const doc = tab.linkedBrowser.contentDocument;
      if (doc) out.push(...scan(doc, "about:preferences#" + pane));
      gBrowser.removeTab(tab);
    }
    // الـ override بيغيّر الملف اللي بيتحمّل، مش العنوان المكتوب، فبنسأل الـ chrome registry عن الملف الحقيقي.
    const registry = Cc["@mozilla.org/chrome/chrome-registry;1"].getService(Ci.nsIChromeRegistry);

    // الجرد: كل صورة في الـ omni.ja الاتنين اسمها فيه تعلب أو Kit أو شعار Firefox، أو SVG مرسوم بألوان Kit (فيه
    // تعالب اسمها عادي، زي extensions-panel-empty.svg و no-connection.svg)، حتى لو مش ظاهرة دلوقتي (قايمة فرعية، صفحة
    // فاضية، رسالة). الـ newtab بتاع Firefox مستخبي ورا Kivo Home، و resource:// مالوش override.
    const { NetUtil } = ChromeUtils.importESModule("resource://gre/modules/NetUtil.sys.mjs");
    const KIT = ["f14f00", "db2355", "fa9f03", "fba501", "bf1f58", "8a1652", "ed0b5b", "fb2872", "f60", "ff6600", "ffeb49", "ffe85d", "ffc638", "ffb52b"];
    // شعار Firefox نفسه جوه رسومات تانية (person-typing.svg، و line.svg في about:addons).
    const LOGO = ["fff44f", "ff980e", "ff3647", "e31587", "ff3750"];
    // بألوان Kit أو الشعار ومش تعالب: دروع، وعلامات VPN، وشعار Mozilla Monitor (اتشافوا بالعين في 19 أكتوبر). أي
    // صورة جديدة هنا لازم تتشاف الأول.
    const NOT_FOX = new Set([
      "breach-alert-shield-check.svg", "breach-alert-shield-cross.svg", "breach-alert-shield-warning.svg",
      "cfr-vpn-bandwith-reset-dark.svg", "cfr-vpn-bandwith-reset-light.svg", "shield-alert.svg", "shield-check.svg",
      "monitor.svg",
    ]);
    const kitColored = entry => {
      const stream = reader.getInputStream(entry);
      const text = NetUtil.readInputStreamToString(stream, stream.available()).toLowerCase();
      stream.close();
      const count = colors => colors.filter(c => new RegExp("#" + c + "(?![0-9a-f])").test(text)).length;
      return count(KIT) >= 2 || count(LOGO) >= 3;
    };
    const ROOTS = [
      ["chrome/browser/content/browser/", "chrome://browser/content/"],
      ["chrome/browser/content/activity-stream/", "chrome://activity-stream/content/"],
      ["chrome/browser/skin/classic/browser/", "chrome://browser/skin/"],
      ["chrome/devtools/skin/", "chrome://devtools/skin/"],
      ["chrome/toolkit/skin/classic/global/", "chrome://global/skin/"],
      ["chrome/toolkit/skin/classic/mozapps/", "chrome://mozapps/skin/"],
      ["chrome/toolkit/content/global/", "chrome://global/content/"],
    ];
    const image = /(^|[-_/])(kit|fox|foxy|mascot)([-_.]|$)|fox|firefox[-.]|share-firefox/i;
    const inventory = { checked: 0, hidden: 0, left: [] };
    const reader = Cc["@mozilla.org/libjar/zip-reader;1"].createInstance(Ci.nsIZipReader);
    for (const sub of [[], ["browser"]]) {
      const omni = Services.dirsvc.get("GreD", Ci.nsIFile);
      for (const part of sub) omni.append(part);
      omni.append("omni.ja");
      if (!omni.exists()) continue;
      reader.open(omni);
      const entries = reader.findEntries("*");
      while (entries.hasMore()) {
        const entry = entries.getNext();
        const name = entry.split("/").pop();
        if (!/\\.(svg|png|gif|webp|avif)$/i.test(name) || /firefox-wordmark|\\/kivo\\//.test(entry)) continue;
        if (!image.test(name) && !(name.endsWith(".svg") && !NOT_FOX.has(name) && kitColored(entry))) continue;
        if (entry.startsWith("chrome/browser/builtin-addons/newtab/")) { inventory.hidden++; continue; }
        const root = ROOTS.find(([prefix]) => entry.startsWith(prefix));
        if (!root) { inventory.left.push({ url: entry, file: "(no chrome URL)" }); continue; }
        const url = root[1] + entry.slice(root[0].length);
        inventory.checked++;
        let file = "?";
        try { file = registry.convertChromeURL(Services.io.newURI(url)).spec; } catch {}
        if (file.endsWith(entry)) inventory.left.push({ url, file: entry });
      }
      reader.close();
    }
    // وبرا الـ omni.ja: kit.gif بيتبدل في package.ps1 بـ PNG فيه علامة Kivo.
    const overlay = Services.dirsvc.get("GreD", Ci.nsIFile);
    for (const part of ["browser", "components", "shell", "assets", "kit.gif"]) overlay.append(part);
    if (overlay.exists()) {
      inventory.checked++;
      const head = await IOUtils.read(overlay.path, { maxBytes: 4 });
      if (String.fromCharCode(...head) === "GIF8") inventory.left.push({ url: "browser/components/shell/assets/kit.gif", file: "Firefox's GIF" });
    }
    for (const item of out) {
      const url = /^url\\("?(.*?)"?\\)$/.exec(item.url)?.[1] ?? item.url;
      try {
        item.file = url.startsWith("chrome://") ? registry.convertChromeURL(Services.io.newURI(url)).spec.split("/").slice(-3).join("/") : url;
      } catch {
        item.file = "?";
      }
    }
    return JSON.stringify({ out, inventory });
  })()`));
  const { inventory } = report;
  for (const item of inventory.left) console.log(`FOX  inventory ${item.url} -> ${item.file}`);
  console.log(`inventory: ${inventory.checked - inventory.left.length} of ${inventory.checked} fox images replaced, ${inventory.hidden} in Firefox's hidden newtab`);
  const seen = new Set();
  let foxes = 0;
  const fox = /kit[-.]|fox|mascot|firefox|monitor|relay|vpn/i;
  for (const item of report.out) {
    const key = `${item.where}|${item.el}|${item.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // kivo/mascot/<mood>.svg بتاعة Kivo (docs/MASCOT.md)، مش تعلب.
    const still = fox.test(item.file) && !/(^|\/)kivo\//.test(item.file);
    if (still) foxes++;
    console.log(`${still ? 'FOX ' : 'ok  '}${item.where.padEnd(28)} ${item.el.slice(0, 48).padEnd(48)} ${item.size.padEnd(7)} ${item.url.slice(0, 70)} -> ${item.file}`);
  }
  console.log(`${foxes} still showing Firefox art, ${seen.size - foxes} replaced`);
} finally {
  await kivo.close();
}
