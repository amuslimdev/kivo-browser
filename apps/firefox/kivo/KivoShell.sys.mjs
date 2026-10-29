// Kivo في Windows (مرحلة "Kivo يومي" في docs/FIREFOX.md): المتصفح الافتراضي، والتنبيه لما Firefox ينزّل نسخة أحدث.
//
// - المتصفح الافتراضي: install.ps1 بيسجّل Kivo (KivoURL و KivoHTML و KivoPDF، و StartMenuInternet). Firefox بيعرف
//   الافتراضي ويغيّره بأساميه هو (FirefoxURL-<hash>)، فـ "Make Default" في الإعدادات كان هيقول إن Kivo مش الافتراضي
//   على طول. هنا ShellService بيقرا اختيار Windows نفسه، و "Make Default" بيفتح صفحة Kivo في Settings > Default
//   apps (Windows مابيسمحش لبرنامج يختار نفسه).
// - التحميلات والسجل (G5): Ctrl+J والأيقونة بيفتحوا القايمة الصغيرة تحت السهم زي Edge، و "Show all downloads"
//   و "Show all history" بيفتحوا صفحات Kivo (web/ui) في تاب بدل نافذة المكتبة القديمة.
// - التحديثات (G6): Kivo بينزّل النسخة الجديدة من الـ release في الخلفية، و Kivo.exe بيركّبها وهو بيفتح (تحت).
// - زي Chrome: Ctrl+Shift+N للنافذة الخاصة، والبحث في الصفحة (Ctrl+F) صندوق صغير فوق (findbar.css).

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  BrowserWindowTracker: "resource:///modules/BrowserWindowTracker.sys.mjs",
  Downloads: "resource://gre/modules/Downloads.sys.mjs",
  PrivateBrowsingUtils: "resource://gre/modules/PrivateBrowsingUtils.sys.mjs",
  ShellService: "moz-src:///browser/components/shell/ShellService.sys.mjs",
  setInterval: "resource://gre/modules/Timer.sys.mjs",
  setTimeout: "resource://gre/modules/Timer.sys.mjs",
});

// ---------- المتصفح الافتراضي ----------

const PROG_ID = "KivoURL";

/** الـ ProgId اللي Windows بيفتح بيه لينكات http أو https. Windows 11 الجديد بيحطه في UserChoiceLatest. */
function userChoice(scheme) {
  for (const name of ["UserChoiceLatest", "UserChoice"]) {
    const key = Cc["@mozilla.org/windows-registry-key;1"].createInstance(Ci.nsIWindowsRegKey);
    try {
      key.open(
        Ci.nsIWindowsRegKey.ROOT_KEY_CURRENT_USER,
        `Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\${scheme}\\${name}`,
        Ci.nsIWindowsRegKey.ACCESS_READ
      );
      if (key.hasValue("ProgId")) {
        return key.readStringValue("ProgId");
      }
    } catch {
      // المفتاح مش موجود.
    } finally {
      key.close();
    }
  }
  return "";
}

export function isDefaultBrowser() {
  return ["http", "https"].every(scheme => userChoice(scheme) === PROG_ID);
}

/** صفحة Kivo في Settings > Default apps، وفيها "Set default". عن طريق Explorer عشان مايظهرش سؤال "Open link?". */
export function openDefaultApps() {
  const explorer = Services.dirsvc.get("WinD", Ci.nsIFile);
  explorer.append("explorer.exe");
  const process = Cc["@mozilla.org/process/util;1"].createInstance(Ci.nsIProcess);
  process.init(explorer);
  process.runw(false, ["ms-settings:defaultapps?registeredAppUser=Kivo"], 1);
}

function hookShellService() {
  const shell = lazy.ShellService;
  shell.isDefaultBrowser = () => isDefaultBrowser();
  shell.setDefaultBrowser = async () => openDefaultApps();
  shell.setAsDefault = async () => openDefaultApps();
}

// ---------- التحميلات والسجل ----------

// Kivo Home (G2) بعنوان ثابت (firefox-branding.js).
const HOME = "moz-extension://9d4b610d-d083-4703-8d31-c7178f7ba2e8/";

export function openKivoPage(win, page) {
  win.switchToTabHavingURI(HOME + page, true);
}

/**
 * Ctrl+J، و Downloads في القوايم: القايمة الصغيرة تحت السهم (DownloadsPanel)، وفيها "Show all downloads" لصفحة
 * Kivo. و "Show all history" (Ctrl+Shift+H) لصفحة History بتاعة Kivo. المكتبة بتفضل للـ bookmarks. النافذة الخاصة
 * بتفضل على صفحات Firefox، لأن صفحات Kivo مش بتشتغل فيها.
 */
function hookWindow(win) {
  const privateWindow = lazy.PrivateBrowsingUtils.isWindowPrivate(win);
  win.BrowserCommands.downloadsUI = () => win.DownloadsPanel.showPanel(true, true);
  if (privateWindow) {
    win.DownloadsPanel.showDownloadsHistory = () => {
      win.DownloadsPanel.hidePanel();
      win.openTrustedLinkIn("about:downloads", "tab");
    };
    return;
  }
  win.DownloadsPanel.showDownloadsHistory = () => {
    win.DownloadsPanel.hidePanel();
    openKivoPage(win, "downloads.html");
  };
  // شريط العنوان فاضي على صفحات Kivo زي التاب الجديد، بدل moz-extension://...
  win.gInitialPages.push(HOME + "history.html", HOME + "downloads.html");
  const organizer = win.PlacesCommandHook.showPlacesOrganizer.bind(win.PlacesCommandHook);
  win.PlacesCommandHook.showPlacesOrganizer = what => (what === "History" ? openKivoPage(win, "history.html") : organizer(what));
}

// ---------- زي Chrome ----------

/**
 * Ctrl+Shift+N بيفتح نافذة خاصة زي Chrome و Edge، و Ctrl+Shift+P بتاع Firefox بيرجع للمواقع (vscode.dev مثلًا).
 * و Ctrl+Shift+N كان "Reopen closed window"، وده بيفضل في Ctrl+Shift+T زي Chrome (آخر تاب أو نافذة اتقفلت).
 * بيحصل قبل CustomKeys (browser-window-load)، فـ about:keyboard بيعرضه على إنه الأصلي، واللي يتغيّر من هناك بيكسب.
 */
const KEYS = {
  key_privatebrowsing: { key: "N", modifiers: "accel,shift" },
  key_undoCloseWindow: {},
};

function chromeKeys(win) {
  const keysets = new Set();
  for (const [id, attrs] of Object.entries(KEYS)) {
    const key = win.document.getElementById(id);
    if (!key) {
      continue;
    }
    // ومن غير data-l10n-id، عشان Fluent مايرجّعش حرف Firefox.
    for (const attr of ["data-l10n-id", "key", "keycode", "modifiers"]) {
      key.removeAttribute(attr);
    }
    for (const [attr, value] of Object.entries(attrs)) {
      key.setAttribute(attr, value);
    }
    keysets.add(key.parentElement);
  }
  // Gecko بيقرا الـ <key> لما الـ keyset يدخل الصفحة بس، فبيتشال ويرجع (زي CustomKeys.sys.mjs).
  for (const keyset of keysets) {
    const parent = keyset.parentElement;
    keyset.remove();
    parent.append(keyset);
  }
}

/** عدد النتايج زي Chrome: "1/5" جنب الكلمة، و "0/0" لو مش موجودة، بدل "1 of 5 matches" و "Phrase not found". */
function showMatches(findbar, current, total) {
  const label = findbar._foundMatches;
  delete label.dataset.l10nId;
  label.hidden = !findbar._findField.value;
  label.setAttribute("value", label.hidden ? "" : `${current}/${total}`);
}

function chromeMatches(Findbar) {
  const findbar = Findbar.prototype;
  const updateStatus = findbar._updateStatusUI;
  findbar._updateStatusUI = function (result, findPrevious) {
    updateStatus.call(this, result, findPrevious);
    if (result === Ci.nsITypeAheadFind.FIND_NOTFOUND) {
      showMatches(this, 0, 0);
    }
  };
  // total -1: أكتر من accessibility.typeaheadfind.matchesCountLimit.
  findbar.onMatchesCountResult = function ({ current, total, limit }) {
    showMatches(this, current ?? 0, total === -1 ? `${limit}+` : total);
  };
}

/**
 * اختيارات Firefox (Highlight All، و Match Case، و Match Diacritics، و Whole Words) مابتتشالش: بتتنقل لصف تاني جوه
 * الصندوق، بيفتح ويقفل من زرار "⋯" جنب السهمين، و Kivo بيفتكره مفتوح ولا لأ (kivo.findbar.options) في كل النوافذ.
 * ولو اختيار بيغيّر النتايج شغال والصف مقفول، الزرار عليه نقطة. نفس الـ checkboxes بتاعة Firefox (الـ prefs،
 * والـ accesskeys، وقارئ الشاشة زي ما هما)، والشكل في findbar.css.
 */
const OPTIONS_PREF = "kivo.findbar.options";
const OPTIONS = ["highlight", "find-case-sensitive", "find-match-diacritics", "find-entire-word"];
const FILTERS = ["find-case-sensitive", "find-match-diacritics", "find-entire-word"];

function showOptions(findbar) {
  const open = Services.prefs.getBoolPref(OPTIONS_PREF, false);
  findbar.querySelector(".kivo-find-options").hidden = !open;
  const button = findbar.querySelector(".kivo-find-options-button");
  button.toggleAttribute("checked", open);
  button.setAttribute("aria-expanded", open);
}

function addOptions(findbar) {
  const doc = findbar.ownerDocument;
  const row = doc.createXULElement("hbox");
  row.className = "kivo-find-options";
  row.append(...OPTIONS.map(id => findbar.getElement(id)));
  findbar.append(row);

  // في صف الكلمة، فـ _updateFindUI بيخبّيه في Quick find زي الباقي.
  const button = doc.createXULElement("toolbarbutton");
  button.className = "kivo-find-options-button tabbable";
  button.setAttribute("tooltiptext", "Find options");
  button.setAttribute("aria-label", "Find options");
  button.addEventListener("command", () => Services.prefs.setBoolPref(OPTIONS_PREF, !Services.prefs.getBoolPref(OPTIONS_PREF, false)));
  findbar.getElement("findbar-container").append(button);

  const filtered = () => button.toggleAttribute("kivo-filtered", FILTERS.some(id => findbar.getElement(id).checked));
  new doc.defaultView.MutationObserver(filtered).observe(row, { attributeFilter: ["checked"], subtree: true });
  filtered();
  showOptions(findbar);
}

function chromeFind(win) {
  // findbar.js بيتحمّل أول مرة findbar يتعمل، و TabFindInitialized بييجي قبل أي بحث. (whenDefined بيرفض "findbar"،
  // لأنه اسم XUL مافيهوش "-".) والـ findbar من getCachedFindBar: tab._findBar اتشال في Firefox 159.
  let patched = false;
  win.addEventListener("TabFindInitialized", event => {
    if (!patched) {
      chromeMatches(win.customElements.get("findbar"));
      patched = true;
    }
    addOptions(win.gBrowser.getCachedFindBar(event.target));
  });
  const sync = () => {
    for (const tab of win.gBrowser.tabs) {
      const findbar = win.gBrowser.getCachedFindBar(tab);
      if (findbar) {
        showOptions(findbar);
      }
    }
  };
  Services.prefs.addObserver(OPTIONS_PREF, sync);
  win.addEventListener("unload", () => Services.prefs.removeObserver(OPTIONS_PREF, sync), { once: true });
}

// ---------- التحديثات (G6) ----------
// kivo.update.url هو update.json بتاع آخر release (tools/release.ps1). لو فيه Kivo أحدث (BuildID أكبر)، بينزل في
// الخلفية في %LOCALAPPDATA%\Kivo\updates، وبعد ما الـ sha256 يطابق بيتكتب ready.txt ويظهر "Restart to update".
// Kivo.exe (Updater.cs) هو اللي بيتأكد من التوقيع وبيركّب، وهو بيفتح، فلو التنبيه اتقفل التحديث بيتركب المرة
// الجاية اللي Kivo يتفتح فيها. من غير kivo.update.url (نسخة اتبنت على الجهاز) بيفضل التنبيه القديم: Firefox أحدث،
// والتحديث بـ tools/update.ps1.

const VERSIONS = "https://product-details.mozilla.org/1.0/firefox_versions.json";
const URL_PREF = "kivo.update.url";
const LATEST_PREF = "kivo.update.latest";
const CHECKED_PREF = "kivo.update.lastCheck";
const DISMISSED_PREF = "kivo.update.dismissed";
const NOTICE = "kivo-update";
const DAY = 24 * 60 * 60;
const CHECK_EVERY = 6 * 60 * 60;

/** نفس الفولدر اللي Kivo.exe بيدوّر فيه (KIVO_UPDATES_DIR للاختبار). */
function updatesDir() {
  return Services.env.get("KIVO_UPDATES_DIR") || PathUtils.join(Services.dirsvc.get("LocalAppData", Ci.nsIFile).path, "Kivo", "updates");
}

/** ready.txt: سطور name=value، زي ما Updater.cs بيقراها. */
async function readReady() {
  try {
    const text = await IOUtils.readUTF8(PathUtils.join(updatesDir(), "ready.txt"));
    return Object.fromEntries(text.split("\n").map(line => line.split(/=(.*)/s, 2).map(part => part?.trim())).filter(([name]) => name));
  } catch {
    return null;
  }
}

/** update.json زي ما release.ps1 بيكتبه، أو null لو فيه حاجة مش مظبوطة. */
function validRelease(json) {
  const ok =
    /^\d{14}$/.test(json?.buildId ?? "") &&
    /^\d+(\.\d+)+$/.test(json.version ?? "") &&
    // 127.0.0.1 للاختبار (updates-check.mjs). الـ zip نفسه متوقّع، فاللي بيغيّر الـ url مايقدرش يركّب حاجة.
    /^(https:\/\/|http:\/\/127\.0\.0\.1:\d+\/)/.test(json.url ?? "") &&
    /^[0-9a-f]{64}$/.test(json.sha256 ?? "") &&
    /^[A-Za-z0-9+/]+=*$/.test(json.signature ?? "") &&
    Number.isSafeInteger(json.size);
  return ok ? json : null;
}

async function sha256(path) {
  const digest = await crypto.subtle.digest("SHA-256", await IOUtils.read(path));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
}

let staging = null;

/** بينزّل النسخة لو مش متنزلة، ويرجّع ready.txt بتاعها، أو null. */
async function stage(release) {
  const dir = updatesDir();
  const ready = await readReady();
  if (ready?.buildId === release.buildId) {
    return ready;
  }
  await IOUtils.makeDirectory(dir);
  const file = `Kivo-${release.buildId}.zip`;
  // لكل process: كل profile مفتوح بيسأل لوحده.
  const part = PathUtils.join(dir, `${file}.${Services.appinfo.processID}.part`);
  await IOUtils.remove(part, { ignoreAbsent: true });
  await lazy.Downloads.fetch(release.url, part);
  const size = (await IOUtils.stat(part)).size;
  const hash = await sha256(part);
  if (size !== release.size || hash !== release.sha256) {
    await IOUtils.remove(part);
    throw new Error(`the download does not match update.json (${size} bytes, sha256 ${hash})`);
  }
  // نسخة قديمة اتنزلت قبل كده ومااتركبتش: مالهاش لازمة.
  if (ready?.file) {
    await IOUtils.remove(PathUtils.join(dir, PathUtils.filename(ready.file)), { ignoreAbsent: true });
  }
  await IOUtils.move(part, PathUtils.join(dir, file));
  const fields = { file, buildId: release.buildId, version: release.version, signature: release.signature };
  const text = Object.entries(fields).map(([name, value]) => `${name}=${value}\n`).join("");
  // ready.txt آخر حاجة، ومرة واحدة: Kivo.exe مايشوفش نسخة نصها متنزل.
  await IOUtils.writeUTF8(PathUtils.join(dir, "ready.txt"), text, { tmpPath: PathUtils.join(dir, "ready.tmp") });
  return fields;
}

/** نسخة جاهزة أحدث من Kivo ده، أو null. */
async function readyUpdate() {
  const ready = await readReady();
  return ready && /^\d{14}$/.test(ready.buildId ?? "") && ready.buildId > Services.appinfo.appBuildID ? ready : null;
}

/** "Restart to update": Kivo.exe بيستنى Kivo يقفل، ويركّب، ويفتحه تاني والتابات بترجع. */
export function restartToUpdate() {
  const cancel = Cc["@mozilla.org/supports-PRBool;1"].createInstance(Ci.nsISupportsPRBool);
  Services.obs.notifyObservers(cancel, "quit-application-requested", "restart");
  if (cancel.data) {
    return false;
  }
  const launcher = Services.dirsvc.get("XREExeF", Ci.nsIFile).parent;
  launcher.append("Kivo.exe");
  Services.prefs.setBoolPref("browser.sessionstore.resume_session_once", true);
  const process = Cc["@mozilla.org/process/util;1"].createInstance(Ci.nsIProcess);
  process.init(launcher);
  process.runw(false, ["--kivo-restart"], 1);
  Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit);
  return true;
}

async function showReadyNotice(win) {
  const ready = await readyUpdate();
  if (!ready || win.closed || lazy.PrivateBrowsingUtils.isWindowPrivate(win)) {
    return;
  }
  const box = win.gNotificationBox;
  const shown = box?.getNotificationWithValue(NOTICE);
  if (!box || shown?.kivoBuildId === ready.buildId || Services.prefs.getStringPref(DISMISSED_PREF, "") === ready.buildId) {
    return;
  }
  shown?.close();
  const notice = await box.appendNotification(
    NOTICE,
    {
      label: `A new Kivo (Firefox ${ready.version}) is ready. Restart Kivo to update, or it updates the next time Kivo opens.`,
      priority: box.PRIORITY_INFO_HIGH,
      eventCallback(event) {
        if (event === "dismissed") {
          Services.prefs.setStringPref(DISMISSED_PREF, ready.buildId);
        }
      },
    },
    [{ label: "Restart to update", accessKey: "R", callback: () => !restartToUpdate() }]
  );
  notice.kivoBuildId = ready.buildId;
}

/** آخر Firefox لو أحدث من Kivo وماتقفلش تنبيهه، وإلا null. */
export function newerFirefox() {
  const latest = Services.prefs.getStringPref(LATEST_PREF, "");
  if (!/^\d+(\.\d+)+$/.test(latest) || Services.vc.compare(latest, Services.appinfo.version) <= 0) {
    return null;
  }
  return Services.prefs.getStringPref(DISMISSED_PREF, "") === latest ? null : latest;
}

async function showUpdateNotice(win) {
  const latest = newerFirefox();
  if (!latest || win.closed || lazy.PrivateBrowsingUtils.isWindowPrivate(win)) {
    return;
  }
  const box = win.gNotificationBox;
  if (!box || box.getNotificationWithValue(NOTICE)) {
    return;
  }
  await box.appendNotification(NOTICE, {
    label: `Firefox ${latest} is out with security fixes, and Kivo is still on ${Services.appinfo.version}. Time to update Kivo (tools\\update.ps1).`,
    priority: box.PRIORITY_INFO_HIGH,
    eventCallback(event) {
      // اتقفل بالـ X: مايرجعش لحد نسخة أحدث.
      if (event === "dismissed") {
        Services.prefs.setStringPref(DISMISSED_PREF, latest);
      }
    },
  });
}

/** بيسأل update.json (كل 6 ساعات)، وينزّل لو فيه جديد. */
async function checkRelease(url) {
  const now = Math.floor(Date.now() / 1000);
  if (now - Services.prefs.getIntPref(CHECKED_PREF, 0) >= CHECK_EVERY) {
    staging ??= (async () => {
      const response = await fetch(url, { cache: "no-store" });
      const release = validRelease(await response.json());
      if (!release) {
        throw new Error("update.json is not a Kivo release");
      }
      Services.prefs.setIntPref(CHECKED_PREF, now);
      if (release.buildId > Services.appinfo.appBuildID) {
        await stage(release);
      }
    })().finally(() => (staging = null));
    try {
      await staging;
    } catch (e) {
      console.warn("Kivo: update failed", e);
    }
  }
  for (const win of lazy.BrowserWindowTracker.orderedWindows) {
    showReadyNotice(win).catch(console.error);
  }
}

export async function checkForUpdate() {
  const url = Services.prefs.getStringPref(URL_PREF, "");
  if (url) {
    return checkRelease(url);
  }
  const now = Math.floor(Date.now() / 1000);
  if (now - Services.prefs.getIntPref(CHECKED_PREF, 0) >= DAY) {
    try {
      const response = await fetch(VERSIONS, { cache: "no-store" });
      const latest = (await response.json()).LATEST_FIREFOX_VERSION;
      if (/^\d+(\.\d+)+$/.test(latest ?? "")) {
        Services.prefs.setStringPref(LATEST_PREF, latest);
      }
      Services.prefs.setIntPref(CHECKED_PREF, now);
    } catch (e) {
      console.warn("Kivo: update check failed", e);
      return;
    }
  }
  for (const win of lazy.BrowserWindowTracker.orderedWindows) {
    showUpdateNotice(win).catch(console.error);
  }
}

export const KivoShell = {
  /** category browser-before-ui-startup. */
  init() {
    hookShellService();
    Services.obs.addObserver(win => {
      chromeKeys(win);
      chromeFind(win);
    }, "browser-window-before-show");
    Services.obs.addObserver(win => {
      hookWindow(win);
      (Services.prefs.getStringPref(URL_PREF, "") ? showReadyNotice(win) : showUpdateNotice(win)).catch(console.error);
    }, "browser-delayed-startup-finished");
    // بعد ما Kivo يفتح بشوية، وكل 6 ساعات لو فضل مفتوح (السؤال نفسه مرة في اليوم).
    lazy.setTimeout(() => checkForUpdate().catch(console.error), 15000);
    lazy.setInterval(() => checkForUpdate().catch(console.error), 6 * 60 * 60 * 1000);
  },
};
