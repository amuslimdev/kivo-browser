// Kivo's taskbar on Windows: a button per profile like Chrome and Edge, and the Jump List (right click) of each.
//
// - The main profile (the oldest in the group) stays on Kivo's own button, the one that is pinned. Windows draws
//   a pinned button from its shortcut and ignores the window icon, so a picture there could only be Windows'
//   overlay badge, which it places itself at the lower right. Every other profile gets its own button (its own
//   AppUserModelID), which Windows draws from the window icon: the Kivo mark with the profile's picture at the
//   lower left. The window's relaunch properties make a pin of that button start Kivo.exe with that profile,
//   under the same icon (<profile>\kivo\taskbar.ico).
// - The Jump List of each button: the profile's workspaces, its frequent sites, and new tab / window / private
//   window. Firefox's builder writes only its own process's AppUserModelID, with one custom category, and its
//   items started the engine without Kivo's identity. So Kivo.exe writes the lists (tools/JumpList.cs),
//   Firefox's are off (browser.taskbar.lists.enabled in firefox-branding.js), and its other
//   browser.taskbar.lists.* prefs still apply here.
import { inkOn } from "moz-src:///browser/components/kivo/KivoTheme.sys.mjs";

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  DeferredTask: "resource://gre/modules/DeferredTask.sys.mjs",
  KivoWorkspaces: "moz-src:///browser/components/kivo/KivoWorkspaces.sys.mjs",
  PlacesUtils: "resource://gre/modules/PlacesUtils.sys.mjs",
  PrivateBrowsingUtils: "resource://gre/modules/PrivateBrowsingUtils.sys.mjs",
  SelectableProfileService: "resource:///modules/profiles/SelectableProfileService.sys.mjs",
  Subprocess: "resource://gre/modules/Subprocess.sys.mjs",
});

const states = new WeakMap();
let native;
let artwork;
let mainId = null;
let launcherPath = null;
let jumpList = null;
const SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256];
const WORKSPACE_SIZES = [16, 20, 24, 32, 48];
// The System.AppUserModel properties of a window (propkey.h).
const APP_MODEL = "9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3";
const RELAUNCH_COMMAND = 2;
const RELAUNCH_ICON = 3;
const RELAUNCH_NAME = 4;
const APP_ID = 5;
// Frequent sites change slowly; workspaces and profiles rebuild the list right away.
const JUMP_LIST_REFRESH_MS = 15 * 60 * 1000;
// Items the user took out of a Jump List ("Remove from this list"), by their arguments, with the time: they stay
// out until the workspace or site is used again.
const HIDDEN_PREF = "kivo.taskbar.jumpListHidden";
const HIDDEN_MAX = 200;

function windows() {
  if (native) {
    return native;
  }
  const { ctypes: C } = ChromeUtils.importESModule("resource://gre/modules/ctypes.sys.mjs");
  const user32 = C.open("user32.dll");
  const shell32 = C.open("shell32.dll");
  const declare = (library, name, result, ...args) => library.declare(name, C.winapi_abi, result, ...args);
  const GUID = new C.StructType("GUID", [{ d1: C.uint32_t }, { d2: C.uint16_t }, { d3: C.uint16_t }, { d4: C.uint8_t.array(8) }]);
  const KEY = new C.StructType("PROPERTYKEY", [{ format: GUID }, { id: C.uint32_t }]);
  // PROPVARIANT: its type, three reserved words, and a union (a string pointer here) that is 16 bytes on 64-bit.
  const VARIANT = new C.StructType("PROPVARIANT", [
    { type: C.uint16_t },
    { reserved1: C.uint16_t },
    { reserved2: C.uint16_t },
    { reserved3: C.uint16_t },
    { value: C.voidptr_t },
    { rest: C.voidptr_t },
  ]);
  native = {
    C,
    GUID,
    KEY,
    VARIANT,
    libraries: [user32, shell32], // Keep the DLLs loaded while their functions and icons are in use.
    load: declare(user32, "LoadImageW", C.voidptr_t, C.voidptr_t, C.char16_t.ptr, C.uint32_t, C.int, C.int, C.uint32_t),
    send: declare(user32, "SendMessageW", C.intptr_t, C.voidptr_t, C.uint32_t, C.uintptr_t, C.intptr_t),
    destroy: declare(user32, "DestroyIcon", C.bool, C.voidptr_t),
    dpi: declare(user32, "GetDpiForWindow", C.uint32_t, C.voidptr_t),
    metric: declare(user32, "GetSystemMetricsForDpi", C.int, C.int, C.uint32_t),
    propertyStore: declare(shell32, "SHGetPropertyStoreForWindow", C.int32_t, C.voidptr_t, GUID.ptr, C.voidptr_t.ptr),
  };
  return native;
}

function guid(text) {
  const { C, GUID } = windows();
  const hex = text.replace(/-/g, "");
  const tail = [];
  for (let i = 16; i < 32; i += 2) {
    tail.push(parseInt(hex.slice(i, i + 2), 16));
  }
  return new GUID(
    parseInt(hex.slice(0, 8), 16),
    parseInt(hex.slice(8, 12), 16),
    parseInt(hex.slice(12, 16), 16),
    C.uint8_t.array(8)(tail)
  );
}

/** Writes System.AppUserModel properties of a native window, in order; null removes one. */
function setWindowProperties(hwnd, values) {
  const api = windows();
  const { C } = api;
  const store = C.voidptr_t();
  const iid = guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"); // IPropertyStore
  const found = api.propertyStore(hwnd, iid.address(), store.address());
  if (found < 0 || store.isNull()) {
    throw new Error(`No property store for the window (0x${(found >>> 0).toString(16)})`);
  }
  // IPropertyStore's methods: QueryInterface, AddRef, Release, GetCount, GetAt, GetValue, SetValue, Commit.
  const vtable = C.cast(C.cast(store, C.voidptr_t.ptr).contents, C.voidptr_t.array(8).ptr).contents;
  const method = (index, result, ...args) =>
    C.cast(vtable[index], C.FunctionType(C.winapi_abi, result, [C.voidptr_t, ...args]).ptr);
  try {
    const setValue = method(6, C.int32_t, api.KEY.ptr, api.VARIANT.ptr);
    const format = guid(APP_MODEL);
    for (const [id, text] of values) {
      const key = new api.KEY(format, id);
      const buffer = text === null ? null : C.char16_t.array()(text);
      const value = new api.VARIANT(
        buffer ? 31 /* VT_LPWSTR */ : 0 /* VT_EMPTY */,
        0,
        0,
        0,
        buffer ? C.cast(buffer.address(), C.voidptr_t) : null,
        null
      );
      const result = setValue(store, key.address(), value.address());
      if (result < 0) {
        throw new Error(`Unable to set window property ${id} (0x${(result >>> 0).toString(16)})`);
      }
    }
    const committed = method(7, C.int32_t)(store);
    if (committed < 0) {
      throw new Error(`Unable to commit window properties (0x${(committed >>> 0).toString(16)})`);
    }
  } finally {
    method(2, C.uint32_t)(store); // Release
  }
}

function handle(win) {
  const { C } = windows();
  const value = win.docShell.treeOwner.QueryInterface(Ci.nsIBaseWindow).nativeHandle;
  return C.voidptr_t(C.UInt64(value));
}

function setIcon(hwnd, slot, icon) {
  const { C, send } = windows();
  return send(hwnd, 0x80 /* WM_SETICON */, slot, C.cast(icon, C.intptr_t));
}

function release(state) {
  for (const icon of state.icons ?? []) {
    windows().destroy(icon);
  }
  state.icons = [];
}

function taskbar() {
  return Cc["@mozilla.org/windows-taskbar;1"].getService(Ci.nsIWinTaskbar);
}

/** Kivo.exe next to the engine, or null in a build without it (mach run), where a pin would start the bare engine. */
function launcher() {
  launcherPath ??= (async () => {
    const path = PathUtils.join(Services.dirsvc.get("XREExeF", Ci.nsIFile).parent.path, "Kivo.exe");
    return (await IOUtils.exists(path)) ? path : null;
  })();
  return launcherPath;
}

/** A Windows command line. Kivo's arguments are paths, ids and URLs, which never need a quote inside. */
function commandLine(args) {
  return args.map(arg => (!arg || /[\s"]/.test(arg) ? `"${arg.replace(/"/g, "")}"` : arg)).join(" ");
}

/** The button of a profile's windows: null for Kivo's own (the main profile, or a single one), or its own. */
async function identityOf(profile) {
  if (!profile || profile.id == null || profile.id === (await KivoTaskbar.mainProfileId())) {
    return null;
  }
  const exe = await launcher();
  if (!exe) {
    return null;
  }
  return {
    appId: `${taskbar().defaultGroupId}.Profile${profile.id}`,
    command: commandLine([exe, "-profile", profile.path]),
    name: `${profile.name} - Kivo`,
  };
}

async function image(win, url) {
  const img = new win.Image();
  img.src = url;
  await img.decode();
  return img;
}

function canvas(win, size) {
  const element = win.document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
  element.width = element.height = size;
  return element;
}

/** Shared by production and the native icon check; diameter is 36% of the mark. */
export function drawProfileIcon(canvas, base, avatar) {
  const size = canvas.width;
  const c = canvas.getContext("2d");
  c.clearRect(0, 0, size, size);
  c.drawImage(base, 0, 0, size, size);
  const radius = size * 0.18;
  const x = radius + size * 0.04;
  const y = size - radius - size * 0.04;
  c.beginPath();
  c.arc(x, y, radius + size * 0.035, 0, Math.PI * 2);
  c.fillStyle = "#ffffff";
  c.fill();
  c.save();
  c.beginPath();
  c.arc(x, y, radius, 0, Math.PI * 2);
  c.clip();
  c.drawImage(avatar, x - radius, y - radius, radius * 2, radius * 2);
  c.restore();
}

/** A workspace in the Jump List: its color dot and first letter, as on its button in Kivo. */
export function drawWorkspaceIcon(canvas, color, letter) {
  const size = canvas.width;
  const c = canvas.getContext("2d");
  c.clearRect(0, 0, size, size);
  c.beginPath();
  c.arc(size / 2, size / 2, size * 0.47, 0, Math.PI * 2);
  c.fillStyle = color;
  c.fill();
  if (letter) {
    c.fillStyle = inkOn(color);
    c.font = `600 ${Math.round(size * 0.58)}px "Segoe UI", sans-serif`;
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText(letter, size / 2, size * 0.54);
  }
}

/** An .ico with a PNG per size. Each is drawn 4x larger first, which keeps circles and edges clean at 16px. */
async function ico(win, sizes, draw) {
  const payloads = [];
  for (const size of sizes) {
    const large = canvas(win, size * 4);
    draw(large);
    const small = canvas(win, size);
    const context = small.getContext("2d");
    context.imageSmoothingQuality = "high";
    context.drawImage(large, 0, 0, size, size);
    const blob = await new Promise(resolve => small.toBlob(resolve, "image/png"));
    payloads.push(new Uint8Array(await blob.arrayBuffer()));
  }
  const header = 6 + sizes.length * 16;
  const buffer = new Uint8Array(header + payloads.reduce((sum, item) => sum + item.length, 0));
  const view = new DataView(buffer.buffer);
  view.setUint16(2, 1, true);
  view.setUint16(4, sizes.length, true);
  let offset = header;
  payloads.forEach((png, i) => {
    const entry = 6 + i * 16;
    view.setUint8(entry, sizes[i] % 256);
    view.setUint8(entry + 1, sizes[i] % 256);
    view.setUint16(entry + 4, 1, true);
    view.setUint16(entry + 6, 32, true);
    view.setUint32(entry + 8, png.length, true);
    view.setUint32(entry + 12, offset, true);
    buffer.set(png, offset);
    offset += png.length;
  });
  return buffer;
}

/** Writes the file whole, so the taskbar never reads half of it. */
async function writeFile(path, bytes) {
  await IOUtils.makeDirectory(PathUtils.parent(path), { ignoreExisting: true });
  await IOUtils.write(path, bytes, { tmpPath: `${path}.tmp` });
}

/** <profile>\kivo\taskbar.ico, the window icon. A pinned profile button keeps using it, so its path never changes. */
async function iconFile(win, profile) {
  const key = `${profile.avatar}:${profile.theme.themeBg}`;
  if (artwork?.key !== key) {
    const file = (async () => {
      const avatarURL = profile.hasCustomAvatar
        ? PathUtils.toFileURI(profile.getAvatarPath())
        : profile.getAvatarPath(48);
      const [base, avatar] = await Promise.all([
        image(win, "chrome://branding/content/about-logo.svg"),
        image(win, avatarURL),
      ]);
      const path = PathUtils.join(PathUtils.profileDir, "kivo", "taskbar.ico");
      await writeFile(path, await ico(win, SIZES, large => drawProfileIcon(large, base, avatar)));
      return path;
    })();
    artwork = { key, file };
  }
  const { file } = artwork;
  try {
    return await file;
  } catch (error) {
    if (artwork?.file === file) {
      artwork = null;
    }
    throw error;
  }
}

/** Kivo's own button: the original icons, and no AppUserModelID of the window's own. */
function reset(state) {
  if (state.original) {
    state.original.forEach((icon, slot) => setIcon(state.hwnd, slot, icon));
    release(state);
  }
  if (state.identity) {
    state.identity = false;
    setWindowProperties(state.hwnd, [RELAUNCH_COMMAND, RELAUNCH_ICON, RELAUNCH_NAME, APP_ID].map(id => [id, null]));
  }
  state.key = null;
}

async function update(win, state, profile) {
  if (win.closed || state.closed) {
    return;
  }
  const identity = await identityOf(profile);
  if (win.closed || state.closed) {
    return;
  }
  if (!identity) {
    reset(state);
    return;
  }
  const api = windows();
  const dpi = api.dpi(state.hwnd) || 96;
  const key = `${profile.avatar}:${profile.theme.themeBg}:${dpi}:${identity.appId}:${identity.name}:${identity.command}`;
  if (state.key === key) {
    return;
  }
  const file = await iconFile(win, profile);
  if (win.closed || state.closed) {
    return;
  }
  const icons = [];
  try {
    for (const [cx, cy] of [[49, 50], [11, 12]]) {
      const icon = api.load(null, file, 1 /* IMAGE_ICON */, api.metric(cx, dpi), api.metric(cy, dpi), 0x10 /* LR_LOADFROMFILE */);
      if (icon.isNull()) {
        throw new Error("Unable to load Kivo profile taskbar icon");
      }
      icons.push(icon);
    }
    if (win.closed || state.closed) {
      return;
    }
    if (!state.original) {
      state.original = [0, 1].map(slot => api.C.cast(api.C.intptr_t(api.send(state.hwnd, 0x7f /* WM_GETICON */, slot, 0)), api.C.voidptr_t));
    }
    icons.forEach((icon, slot) => setIcon(state.hwnd, slot, icon));
    release(state);
    state.icons = icons.splice(0);
    // The AppUserModelID last: it moves the window to its button, which then has everything else.
    setWindowProperties(state.hwnd, [
      [RELAUNCH_COMMAND, identity.command],
      [RELAUNCH_ICON, `${file},0`],
      [RELAUNCH_NAME, identity.name],
      [APP_ID, identity.appId],
    ]);
    state.identity = true;
    state.key = key;
  } finally {
    icons.forEach(icon => api.destroy(icon));
  }
}

// ---------- Jump List ----------

function field(text) {
  return String(text ?? "")
    .replace(/[\t\r\n]+/g, " ")
    .trim();
}

function item(title, args, icon, iconIndex, tooltip) {
  return ["item", field(title), field(commandLine(args)), field(icon), iconIndex, field(tooltip)].join("\t");
}

function hiddenItems() {
  try {
    return JSON.parse(Services.prefs.getStringPref(HIDDEN_PREF, "{}")) ?? {};
  } catch {
    return {};
  }
}

/** True while an item the user removed stays out: until the workspace or site is used after the removal. */
function isHidden(hidden, args, usedAt) {
  return (hidden[commandLine(args)] ?? -1) >= usedAt;
}

/** <profile>\kivo\jumplist\<color>-<letter>.ico. Windows keeps Jump List icons by path, so a new look is a new file. */
async function workspaceIcon(win, ws, used) {
  const letter = [...ws.name.trim()][0]?.toUpperCase() ?? "";
  const path = PathUtils.join(PathUtils.profileDir, "kivo", "jumplist", `${ws.color.slice(1)}-${letter.codePointAt(0) ?? 0}.ico`);
  used.add(path);
  if (!(await IOUtils.exists(path))) {
    await writeFile(path, await ico(win, WORKSPACE_SIZES, large => drawWorkspaceIcon(large, ws.color, letter)));
  }
  return path;
}

/** Firefox's frequent sites query, with the last visit for hidden items. */
async function frequentSites(prefix, engine, hidden, limit) {
  const conn = await lazy.PlacesUtils.promiseDBConnection();
  const rows = await conn.executeCached(
    "SELECT p.url, IFNULL(p.title, p.url) AS title, IFNULL(p.last_visit_date, 0) AS visited " +
      "FROM moz_places p WHERE p.hidden = 0 " +
      "AND EXISTS (SELECT id FROM moz_historyvisits WHERE place_id = p.id AND visit_type NOT IN (" +
      `0, ${Ci.nsINavHistoryService.TRANSITION_EMBED}, ${Ci.nsINavHistoryService.TRANSITION_FRAMED_LINK}) LIMIT 1) ` +
      "ORDER BY p.visit_count DESC LIMIT :limit",
    { limit: limit * 3 }
  );
  jumpList.favicons ??= taskbar().createJumpListBuilder(false);
  const sites = [];
  for (const row of rows) {
    const url = row.getResultByName("url");
    const args = [...prefix, "-url", url];
    // Sites only: anything else on a command line could be read as a flag.
    if (!/^https?:\/\/[^\s"]+$/i.test(url) || isHidden(hidden, args, row.getResultByName("visited") / 1000)) {
      continue;
    }
    let icon = "";
    try {
      icon = await jumpList.favicons.obtainAndCacheFaviconAsync(Services.io.newURI(url));
    } catch {
      // Not cached yet, or the site has none: the engine's page icon, like Firefox.
    }
    sites.push(item(row.getResultByName("title"), args, icon || engine, icon ? 0 : 1, url));
    if (sites.length >= limit) {
      break;
    }
  }
  return sites;
}

function tasks(prefix, engine) {
  const bundle = Services.strings.createBundle("chrome://browser/locale/taskbar.properties");
  const text = name => bundle.GetStringFromName(`taskbar.tasks.${name}`);
  // Firefox's tasks, with the icons it puts in the engine (tools/ExeIcon.cs makes them Kivo's).
  const list = [
    item(text("newTab.label"), [...prefix, "-new-tab", "about:blank"], engine, 3, text("newTab.description")),
    item(text("newWindow.label"), [...prefix, "-browser"], engine, 2, text("newWindow.description")),
  ];
  if (lazy.PrivateBrowsingUtils.enabled) {
    list.push(item(text("newPrivateWindow.label"), [...prefix, "-private-window"], engine, 4, text("newPrivateWindow.description")));
  }
  return list;
}

/** The lines for Kivo.exe --kivo-jumplist (tools/JumpList.cs), and the workspace icons they use. */
async function jumpListText() {
  const profile = lazy.SelectableProfileService.currentProfile ?? null;
  const identity = await identityOf(profile);
  const engine = Services.dirsvc.get("XREExeF", Ci.nsIFile).path;
  // The items name their profile, so a click opens it even when another profile was used last.
  const prefix = profile ? ["-profile", profile.path] : [];
  const prefs = Services.prefs.getBranch("browser.taskbar.lists.");
  const hidden = hiddenItems();
  const icons = new Set();
  const lines = [`app\t${identity?.appId ?? taskbar().defaultGroupId}`];

  const workspaces = await lazy.KivoWorkspaces.list();
  const win = Services.wm.getMostRecentWindow("navigator:browser");
  const shown = [];
  for (const ws of workspaces) {
    const args = [...prefix, "--kivo-workspace", ws.id];
    if (!isHidden(hidden, args, ws.used)) {
      const icon = win ? await workspaceIcon(win, ws, icons) : "";
      shown.push(item(ws.name, args, icon, 0, ws.name));
    }
  }
  if (shown.length) {
    lines.push("category\tWorkspaces", ...shown);
  }

  if (prefs.getBoolPref("frequent.enabled", true)) {
    const sites = await frequentSites(prefix, engine, hidden, prefs.getIntPref("maxListItemCount", 7));
    if (sites.length) {
      const title = Services.strings
        .createBundle("chrome://browser/locale/taskbar.properties")
        .GetStringFromName("taskbar.frequent.label");
      lines.push(`category\t${field(title)}`, ...sites);
    }
  }
  const showTasks = prefs.getBoolPref("tasks.enabled", true);
  if (showTasks) {
    lines.push("tasks", ...tasks(prefix, engine));
  }
  // Private windows have a button of their own (browser.privateWindowSeparation.enabled), with Firefox's tasks.
  if (!identity) {
    lines.push(`app\t${taskbar().defaultPrivateGroupId}`);
    if (showTasks) {
      lines.push("tasks", ...tasks(prefix, engine));
    }
  }
  return { text: `${lines.join("\n")}\n`, icons };
}

async function writeJumpList() {
  const exe = await launcher();
  if (!exe || jumpList.quitting) {
    return null;
  }
  // Until the profile service knows this profile, the list would land on the main profile's button.
  const profiles = lazy.SelectableProfileService;
  if (Services.prefs.getBoolPref("browser.profiles.created", false) && profiles.isEnabled && !profiles.initialized) {
    jumpList.task?.arm();
    return null;
  }
  const { text, icons } = await jumpListText();
  let result = null;
  if (text !== jumpList.written) {
    const file = PathUtils.join(PathUtils.profileDir, "kivo", "jumplist.txt");
    await IOUtils.writeUTF8(file, text);
    const proc = await lazy.Subprocess.call({ command: exe, arguments: ["--kivo-jumplist", file], stderr: "stdout" });
    let output = "";
    for (let chunk; (chunk = await proc.stdout.readString()); ) {
      output += chunk;
    }
    const { exitCode } = await proc.wait();
    result = { exitCode, output };
    const hidden = hiddenItems();
    let removed = false;
    for (const line of output.split(/\r?\n/)) {
      const [kind, , detail] = line.split("\t");
      if (kind === "removed" && detail) {
        hidden[detail] = Date.now();
        removed = true;
      } else if (kind === "error") {
        console.warn("Kivo Jump List:", line);
      }
    }
    if (removed) {
      const newest = Object.entries(hidden).sort((a, b) => b[1] - a[1]).slice(0, HIDDEN_MAX);
      Services.prefs.setStringPref(HIDDEN_PREF, JSON.stringify(Object.fromEntries(newest)));
    }
    jumpList.written = exitCode === 0 && !removed ? text : null;
    if (exitCode !== 0) {
      console.error(`Kivo Jump List: Kivo.exe exited with ${exitCode}`);
    }
  }
  // Icons of workspaces that changed color, were renamed or were removed.
  const dir = PathUtils.join(PathUtils.profileDir, "kivo", "jumplist");
  for (const path of await IOUtils.getChildren(dir, { ignoreAbsent: true })) {
    if (!icons.has(path)) {
      await IOUtils.remove(path, { ignoreAbsent: true }).catch(() => {});
    }
  }
  return result;
}

export const KivoTaskbar = {
  /** category browser-before-ui-startup: the Jump List, kept up to date. */
  init() {
    if (Services.appinfo.OS !== "WINNT") {
      return;
    }
    jumpList = { written: null, quitting: false, favicons: null };
    // Test runs (headless) leave the Jump List alone: it belongs to the Kivo install they were started from.
    if (Services.env.get("MOZ_HEADLESS") === "1") {
      return;
    }
    jumpList.task = new lazy.DeferredTask(() => writeJumpList().catch(error => console.error("Kivo Jump List:", error)), 2000);
    const rebuild = () => {
      if (!jumpList.quitting) {
        jumpList.task.arm();
      }
    };
    const firstWindow = () => {
      Services.obs.removeObserver(firstWindow, "browser-delayed-startup-finished");
      rebuild();
    };
    Services.obs.addObserver(firstWindow, "browser-delayed-startup-finished");
    Services.obs.addObserver(rebuild, "kivo-workspaces-changed");
    Services.obs.addObserver(rebuild, "browser:purge-session-history");
    // Another profile was added, removed or renamed: the main profile, and so this one's button, may change.
    Services.obs.addObserver(() => {
      mainId = null;
      rebuild();
    }, "sps-profiles-updated");
    Services.obs.addObserver(() => {
      jumpList.quitting = true;
      jumpList.task.disarm();
      jumpList.timer.cancel();
    }, "quit-application-granted");
    jumpList.timer = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
    jumpList.timer.initWithCallback(rebuild, JUMP_LIST_REFRESH_MS, Ci.nsITimer.TYPE_REPEATING_SLACK);
  },

  /** The oldest profile of the group, which keeps Kivo's own button. Tests replace it. */
  mainProfileId() {
    mainId ??= lazy.SelectableProfileService.getAllProfiles().then(all => (all.length ? Math.min(...all.map(profile => profile.id)) : null));
    return mainId;
  },

  /** For tests: the Jump List lines this profile would write now. */
  async jumpListText() {
    return (await jumpListText()).text;
  },

  /** For tests: write the Jump List now; { exitCode, output } of Kivo.exe. */
  writeJumpList() {
    jumpList.written = null;
    return writeJumpList();
  },

  async setProfile(win, profile) {
    if (Services.appinfo.OS !== "WINNT") {
      return Promise.resolve();
    }
    // Private windows have their own button and icon (browser.privateWindowSeparation.enabled).
    if (win.document?.documentElement?.getAttribute("privatebrowsingmode") === "temporary") {
      return Promise.resolve();
    }
    let state = states.get(win);
    if (!state) {
      state = { hwnd: handle(win), queue: Promise.resolve(), closed: false };
      if (state.hwnd.isNull()) {
        return; // No native icon in headless windows.
      }
      states.set(win, state);
      win.addEventListener("unload", () => {
        state.closed = true;
        state.media?.removeEventListener("change", state.dpiChanged);
        state.original?.forEach((icon, slot) => setIcon(state.hwnd, slot, icon));
        release(state);
      }, { once: true });
      // A window may move between screens with different scaling.
      const watchDpi = () => {
        state.media = win.matchMedia?.(`(resolution: ${win.devicePixelRatio}dppx)`);
        state.media?.addEventListener("change", state.dpiChanged, { once: true });
      };
      state.dpiChanged = () => {
        watchDpi();
        this.setProfile(win, state.profile).catch(error => console.error("Kivo taskbar:", error));
      };
      watchDpi();
    }
    state.profile = profile;
    const pending = state.queue.then(() => update(win, state, profile));
    state.queue = pending.catch(() => {}); // A failed image must not block later updates.
    return pending;
  },
};
