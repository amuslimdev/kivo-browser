// Workspaces لكل profile زي Edge (docs/FIREFOX.md، G4): كل workspace ليها اسم ولون، ونافذة لوحدها، وتاباتها بتفضل
// محفوظة مهما طال الوقت. تقفل نافذتها وتفتحها بعد سنة تلاقي نفس التابات، ولو Kivo اتقفل وهي مفتوحة بترجع تفتح.
//
// - التخزين: <profile>\kivo\workspaces.json، يعني لكل profile لوحده. حالة كل نافذة هي اللي الـ session store بتاع
//   Firefox بيجمعها (getWindowState)، وبتتحفظ لما Firefox يكتب الـ session ولما النافذة تقفل وقبل ما Kivo يقفل.
//   الكتابة بتوصل الهارد قبل ما تاخد مكان الملف القديم، والقديم بيفضل workspaces.json.bak، فالجهاز لو قفل فجأة
//   (25 أكتوبر: hardware error، والملف رجع أصفار) بيفضل فيه ملف سليم. ملفات الـ session بتاعة Firefox مابتتعملش
//   كده، فبعد crash زي ده Firefox بيرجع لآخر قفلة عادية؛ ونافذة الـ workspace بتتفتح بالتابات اللي هنا لو أحدث.
// - النافذة: علامة "kivo-workspace" بالـ id جوه الـ session (setCustomWindowValue)، فلو الـ session رجّع النافذة
//   (restore، أو "Reopen closed window") بترجع workspace لوحدها.
// - الشكل: زرار في أول شريط التابات (CustomizableUI) وقايمة بشكل Kivo (workspaces.css). ولون الـ workspace هو هيدر
//   نافذتها (KivoTheme)، عشان الولد يعرف هو فاتح أنهي واحدة من غير ما يدوّر.
// - الـ taskbar: الـ workspaces في الـ jump list بتاع زرار الـ profile (KivoTaskbar)، والضغطة بتفتحها (--kivo-workspace).
// النوافذ الخاصة مالهاش workspaces.

import { KivoColorPicker } from "moz-src:///browser/components/kivo/KivoColorPicker.sys.mjs";
import { KivoTheme, inkOn } from "moz-src:///browser/components/kivo/KivoTheme.sys.mjs";

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  AsyncShutdown: "resource://gre/modules/AsyncShutdown.sys.mjs",
  BrowserWindowTracker: "resource:///modules/BrowserWindowTracker.sys.mjs",
  CustomizableUI: "moz-src:///browser/components/customizableui/CustomizableUI.sys.mjs",
  DeferredTask: "resource://gre/modules/DeferredTask.sys.mjs",
  PrivateBrowsingUtils: "resource://gre/modules/PrivateBrowsingUtils.sys.mjs",
  SessionStartup: "moz-src:///browser/components/sessionstore/SessionStartup.sys.mjs",
  SessionStore: "moz-src:///browser/components/sessionstore/SessionStore.sys.mjs",
  TabStateFlusher: "moz-src:///browser/components/sessionstore/TabStateFlusher.sys.mjs",
});

const XHTML = "http://www.w3.org/1999/xhtml";
const KEY = "kivo-workspace";
const WIDGET = "kivo-workspaces-button";
const PANEL = "kivo-workspaces-panel";
// الزرار في أول شريط التابات مرة واحدة، وبعد كده مكانه زي ما الولد يحب (تخصيص الأدوات).
const PLACED_PREF = "kivo.workspaces.placed";
export const COLORS = Object.freeze(["#7964bc", "#2f80ed", "#0ea5a4", "#22a55a", "#e8a020", "#e5484d", "#e0499a", "#64748b"]);
const MAX_WORKSPACES = 30;
const MAX_NAME = 40;
const ID = /^[a-z0-9]{6,24}$/;
const HEX = /^#[0-9a-f]{6}$/i;

let data = { version: 1, workspaces: [] };
let loaded = null;
let quitting = false;
let saveTask = null;
// وقت الـ session اللي Firefox رجّعه بعد crash (lastUpdate)، و null لو Kivo اتقفل عادي.
let crashedSessionTime = null;
// تايمر تحديث صفحات Kivo وانت بتجرّب لون (previewColor).
let previewPages = 0;
// منتقي الألوان (KivoColorPicker) بتاع كل فورم جديدة أو تعديل.
const pickers = new WeakMap();
// الـ workspaces اللي نافذتها بتتفتح دلوقتي (open).
const opening = new Map();

// ---------- التخزين ----------

function filePath() {
  return PathUtils.join(PathUtils.profileDir, "kivo", "workspaces.json");
}

function trimName(name) {
  // eslint-disable-next-line no-control-regex
  const clean = String(name ?? "").replace(/[\u0000-\u001f\u007f-\u009f]/g, "").trim();
  return clean.slice(0, MAX_NAME);
}

/** الملف بعد التحقق: أي workspace ناقصة أو غلط بتتشال، ومفيش خانة غير اللي هنا. */
function clean(raw) {
  const list = Array.isArray(raw?.workspaces) ? raw.workspaces : [];
  const seen = new Set();
  const workspaces = [];
  for (const ws of list) {
    const name = trimName(ws?.name);
    if (!ID.test(ws?.id ?? "") || seen.has(ws.id) || !name) {
      continue;
    }
    seen.add(ws.id);
    workspaces.push({
      id: ws.id,
      name,
      color: HEX.test(ws.color ?? "") ? ws.color.toLowerCase() : COLORS[0],
      created: Number.isSafeInteger(ws.created) ? ws.created : Date.now(),
      used: Number.isSafeInteger(ws.used) ? ws.used : Date.now(),
      // وقت آخر حفظ لتابات النافذة (store). 0 للملفات القديمة، فـ Firefox بيكسب زي الأول.
      saved: Number.isSafeInteger(ws.saved) ? ws.saved : 0,
      open: ws.open === true,
      tabs: Number.isSafeInteger(ws.tabs) ? ws.tabs : 0,
      window: ws.window && typeof ws.window === "object" && Array.isArray(ws.window.tabs) ? ws.window : null,
    });
    if (workspaces.length >= MAX_WORKSPACES) {
      break;
    }
  }
  return { version: 1, workspaces };
}

/**
 * الملف، ولو مااتقراش النسخة اللي قبله (.bak). ولو الاتنين مااتقروش والملف موجود، بيتنسخ workspaces.broken.json
 * قبل ما القايمة الفاضية تتكتب فوقه، عشان اللي فيه مايضيعش.
 */
async function load() {
  for (const path of [filePath(), `${filePath()}.bak`]) {
    try {
      data = clean(await IOUtils.readJSON(path));
      return;
    } catch {}
  }
  data = { version: 1, workspaces: [] };
  if (await IOUtils.exists(filePath())) {
    await IOUtils.copy(filePath(), PathUtils.join(PathUtils.parent(filePath()), "workspaces.broken.json")).catch(
      console.error
    );
  }
}

async function write() {
  await IOUtils.makeDirectory(PathUtils.parent(filePath()), { ignoreExisting: true });
  await IOUtils.writeJSON(filePath(), data, {
    tmpPath: `${filePath()}.tmp`,
    backupFile: `${filePath()}.bak`,
    flush: true,
  });
}

function scheduleSave() {
  saveTask?.arm();
}

function find(id) {
  return data.workspaces.find(ws => ws.id === id) ?? null;
}

// ---------- النوافذ ----------

function isPrivate(win) {
  return lazy.PrivateBrowsingUtils.isWindowPrivate(win);
}

function browserWindows() {
  return lazy.BrowserWindowTracker.orderedWindows.filter(win => !win.closed && !isPrivate(win));
}

function windowOf(id) {
  return browserWindows().find(win => win.kivoWorkspaceId === id) ?? null;
}

function tag(win, id) {
  win.kivoWorkspaceId = id;
  try {
    if (id) {
      lazy.SessionStore.setCustomWindowValue(win, KEY, id);
    } else {
      lazy.SessionStore.deleteCustomWindowValue(win, KEY);
    }
  } catch {
    // النافذة لسه مش في الـ session store، والعلامة بتتحط في restoreTag.
  }
  updateWindow(win);
}

/** عنوان الصفحة الحالية في كل تاب، عشان نعرف حالتين النافذة زي بعض ولا لأ. */
function tabUrls(state) {
  return (state?.tabs ?? []).map(tab => tab.entries?.[(tab.index ?? 1) - 1]?.url ?? "").join("\n");
}

/**
 * العلامة اللي الـ session رجّعها مع النافذة. بعد crash، Firefox ممكن يكون رجّع session أقدم من آخر حفظ هنا (25
 * أكتوبر: ملفاته اتصفّرت، فرجع لآخر قفلة عادية)، فالتابات اللي هنا لو أحدث ومختلفة هي اللي بتتفتح في النافذة.
 */
function restoreTag(win) {
  let id = "";
  try {
    id = lazy.SessionStore.getCustomWindowValue(win, KEY);
  } catch {}
  const ws = find(id);
  if (ws && !windowOf(ws.id)) {
    win.kivoWorkspaceId = ws.id;
    ws.open = true;
    if (ws.window && crashedSessionTime !== null && ws.saved > crashedSessionTime) {
      // بعد ما Firefox يخلص ترجيع النافذة دي (restoreTag بيتنادى من SSWindowRestored).
      win.setTimeout(() => {
        try {
          if (tabUrls(lazy.SessionStore.getWindowState(win).windows[0]) !== tabUrls(ws.window)) {
            lazy.SessionStore.setWindowState(win, { windows: [ws.window] }, true);
          }
        } catch (e) {
          console.error(e);
        }
      }, 0);
    }
    scheduleSave();
  }
  updateWindow(win);
}

/**
 * حالة النافذة في الـ workspace، لو فيها صفحات. حالة فاضية (لسه ماتجمعتش) مابتكتبش فوق حالة سليمة.
 * من غير التابات اللي اتقفلت قريب (_closedTabs): كانت بتوصل لـ 8 MB في workspace واحدة (فورمات WordPress)، والملف
 * بيتكتب كله بعد كل تغيير في التابات.
 */
function store(ws, state) {
  if (state?.tabs?.some(tab => tab.entries?.length)) {
    const { _closedTabs, ...window } = state;
    ws.window = window;
    ws.tabs = state.tabs.length;
    ws.used = Date.now();
    ws.saved = ws.used;
  }
}

/**
 * تابات النافذة في الـ workspace بتاعتها. الـ session store مابيجمعش عناوين التابات غير لما حد يطلب (flush)، فبنطلب
 * الأول.
 */
async function capture(win) {
  const ws = find(win.kivoWorkspaceId);
  if (!ws) {
    return;
  }
  try {
    await lazy.TabStateFlusher.flushWindow(win);
  } catch {}
  try {
    store(ws, lazy.SessionStore.getWindowState(win).windows[0]);
  } catch {}
}

async function captureAll() {
  await Promise.all(browserWindows().map(capture));
}

/** وقت القفل النوافذ بتتقفل قبل ما نلحق، والـ session store عنده آخر حالة لكل نافذة (عمل flush وقت القفل). */
function captureFromSession() {
  try {
    const state = JSON.parse(lazy.SessionStore.getBrowserState());
    for (const win of state.windows ?? []) {
      const ws = find(win.extData?.[KEY]);
      if (ws) {
        store(ws, win);
      }
    }
  } catch {}
}

function waitForWindow(win) {
  return new Promise(resolve => {
    const done = (subject, topic) => {
      if (subject === win) {
        Services.obs.removeObserver(done, "browser-delayed-startup-finished");
        resolve();
      }
    };
    Services.obs.addObserver(done, "browser-delayed-startup-finished");
  });
}

// ---------- الـ workspaces ----------

/** بيفتح الـ workspace في نافذتها، أو بيروح للنافذة لو مفتوحة. */
async function open(id, opener = null) {
  await loaded;
  const ws = find(id);
  if (!ws) {
    throw new Error("No such workspace");
  }
  const existing = windowOf(id);
  if (existing) {
    existing.focus();
    return existing;
  }
  // الـ jump list ورجوع الـ workspaces بعد التشغيل ممكن يفتحوها في نفس الوقت: نافذة واحدة.
  if (!opening.has(id)) {
    opening.set(id, openWindow(ws, opener).finally(() => opening.delete(id)));
  }
  return opening.get(id);
}

async function openWindow(ws, opener) {
  const { id } = ws;
  const win = lazy.BrowserWindowTracker.openWindow({ openerWindow: opener ?? undefined });
  await waitForWindow(win);
  win.kivoWorkspaceId = id;
  if (ws.window) {
    // الحالة المحفوظة فيها العلامة نفسها (extData)، فالـ session بيفضل فاكرها.
    lazy.SessionStore.setWindowState(win, { windows: [ws.window] }, true);
  }
  tag(win, id);
  ws.open = true;
  ws.used = Date.now();
  scheduleSave();
  refreshAll();
  return win;
}

/** workspace جديدة. withWindow: النافذة دي نفسها بتاباتها، بدل نافذة جديدة. */
async function create({ name, color, withWindow = null } = {}) {
  await loaded;
  const label = trimName(name);
  if (!label) {
    throw new Error("A workspace needs a name");
  }
  if (data.workspaces.length >= MAX_WORKSPACES) {
    throw new Error("Too many workspaces");
  }
  const ws = {
    id: Services.uuid.generateUUID().toString().replace(/[{}-]/g, "").slice(0, 16),
    name: label,
    color: HEX.test(color ?? "") ? color.toLowerCase() : COLORS[data.workspaces.length % COLORS.length],
    created: Date.now(),
    used: Date.now(),
    saved: 0,
    open: true,
    tabs: 0,
    window: null,
  };
  data.workspaces.push(ws);
  if (withWindow && !withWindow.kivoWorkspaceId && !isPrivate(withWindow)) {
    tag(withWindow, ws.id);
    await capture(withWindow);
    scheduleSave();
    refreshAll();
    return withWindow;
  }
  scheduleSave();
  return open(ws.id, withWindow);
}

async function update(id, { name, color } = {}) {
  await loaded;
  const ws = find(id);
  if (!ws) {
    return;
  }
  if (name !== undefined && trimName(name)) {
    ws.name = trimName(name);
  }
  if (HEX.test(color ?? "")) {
    ws.color = color.toLowerCase();
  }
  scheduleSave();
  refreshAll();
  // المعاينة كانت لوّنت النافذة باللون ده، فالصفحات بتقرا تاني هنا بالاسم واللون اللي اتحفظوا.
  const win = windowOf(id);
  if (win) {
    Services.obs.notifyObservers(win, "kivo-pages-refresh");
  }
}

/** بتتشال من القايمة. نافذتها لو مفتوحة بتفضل نافذة عادية بتاباتها. */
async function remove(id) {
  await loaded;
  const win = windowOf(id);
  data.workspaces = data.workspaces.filter(ws => ws.id !== id);
  if (win) {
    tag(win, null);
  }
  scheduleSave();
  refreshAll();
}

// ---------- الزرار والقايمة ----------

function initial(name) {
  return [...name.trim()][0]?.toUpperCase() ?? "?";
}

function html(doc, tag, props = {}, children = []) {
  const el = doc.createElementNS(XHTML, tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "class") {
      el.className = value;
    } else if (key === "text") {
      el.textContent = value;
    } else if (key === "style") {
      for (const [name, v] of Object.entries(value)) {
        el.style.setProperty(name, v);
      }
    } else if (value !== false && value !== null && value !== undefined) {
      el.setAttribute(key, value === true ? "" : value);
    }
  }
  el.append(...children);
  return el;
}

function badge(doc, ws) {
  return html(doc, "span", {
    class: "kivo-ws-badge",
    "aria-hidden": "true",
    text: ws ? initial(ws.name) : "",
    style: ws ? { "--kivo-ws-color": ws.color, "--kivo-ws-ink": inkOn(ws.color) } : {},
  });
}

/** الزرار: لون الـ workspace وأول حرف واسمها، أو أيقونة عادية لو النافذة مش workspace. */
function updateWindow(win) {
  if (win.closed) {
    return;
  }
  const doc = win.document;
  const ws = find(win.kivoWorkspaceId);
  doc.documentElement.toggleAttribute("kivo-workspace", !!ws);
  if (ws) {
    doc.documentElement.style.setProperty("--kivo-ws-color", ws.color);
  } else {
    doc.documentElement.style.removeProperty("--kivo-ws-color");
  }
  // لون النافذة كلها (الهيدر، والأزرار، وصفحات Kivo فيها) بلون الـ workspace، ولو النافذة بطلت workspace بيرجع
  // للثيم.
  if ((win.kivoWorkspaceColor ?? null) !== (ws?.color ?? null) || (win.kivoWorkspaceName ?? null) !== (ws?.name ?? null)) {
    win.kivoWorkspaceColor = ws?.color ?? null;
    win.kivoWorkspaceName = ws?.name ?? null;
    KivoTheme.refresh(win);
    Services.obs.notifyObservers(win, "kivo-pages-refresh");
  }
  const button = doc.getElementById(WIDGET)?.querySelector(".kivo-ws-button");
  if (!button) {
    return;
  }
  button.replaceChildren(badge(doc, ws), html(doc, "span", { class: "kivo-ws-label", text: ws ? ws.name : "" }));
  button.setAttribute("aria-label", ws ? `Workspaces: ${ws.name}` : "Workspaces");
  button.setAttribute("title", ws ? `${ws.name} (workspace)` : "Workspaces");
  if (doc.getElementById(PANEL)?.state === "open") {
    render(win);
  }
}

function refreshAll() {
  for (const win of browserWindows()) {
    updateWindow(win);
  }
  // الـ jump list بتاع الـ taskbar (KivoTaskbar).
  Services.obs.notifyObservers(null, "kivo-workspaces-changed");
}

function panelFor(win) {
  const doc = win.document;
  let panel = doc.getElementById(PANEL);
  if (!panel) {
    panel = doc.createXULElement("panel");
    panel.id = PANEL;
    panel.setAttribute("type", "arrow");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Workspaces");
    panel.className = "kivo-ws-panel";
    panel.append(html(doc, "div", { class: "kivo-ws" }));
    panel.addEventListener("click", event => onPanelClick(win, event));
    panel.addEventListener("popuphidden", () => {
      doc.getElementById(WIDGET)?.querySelector(".kivo-ws-button")?.removeAttribute("open");
      endPreview();
    });
    panel.addEventListener("submit", event => onSubmit(win, event));
    panel.addEventListener("keydown", event => {
      if (event.key === "Escape" && panel.querySelector(".kivo-ws-form:not([hidden])")) {
        event.preventDefault();
        event.stopPropagation();
        endPreview();
        render(win);
      }
    });
    doc.getElementById("mainPopupSet").append(panel);
  }
  return panel;
}

function tabsText(ws) {
  return ws.tabs === 1 ? "1 tab" : `${ws.tabs} tabs`;
}

/** القايمة: الـ workspaces، وواحدة جديدة، والتعديل. form: { id } للتعديل، أو {} لواحدة جديدة. */
function render(win, form = null) {
  const doc = win.document;
  const body = panelFor(win).querySelector(".kivo-ws");
  const current = win.kivoWorkspaceId;
  const rows = data.workspaces.map(ws => {
    const here = ws.id === current;
    const elsewhere = !here && !!windowOf(ws.id);
    const meta = [tabsText(ws), here ? "this window" : elsewhere ? "open" : ""].filter(Boolean).join(" · ");
    return html(doc, "div", { class: "kivo-ws-row", current: here, role: "listitem" }, [
      html(doc, "button", { class: "kivo-ws-open", "data-id": ws.id, "aria-current": here ? "true" : null }, [
        badge(doc, ws),
        html(doc, "span", { class: "kivo-ws-text" }, [
          html(doc, "span", { class: "kivo-ws-name", text: ws.name }),
          html(doc, "span", { class: "kivo-ws-meta", text: meta }),
        ]),
      ]),
      html(doc, "button", { class: "kivo-ws-edit", "data-id": ws.id, "aria-label": `Edit ${ws.name}`, title: "Edit" }),
    ]);
  });

  const children = [html(doc, "div", { class: "kivo-ws-title", text: "Workspaces" })];
  if (rows.length) {
    children.push(html(doc, "div", { class: "kivo-ws-list", role: "list" }, rows));
  } else {
    children.push(
      html(doc, "p", {
        class: "kivo-ws-empty",
        text: "Keep school, games and projects apart. Each workspace opens in its own window, with the same tabs every time.",
      })
    );
  }

  let colorPicker = null;
  if (form) {
    const ws = form.id ? find(form.id) : null;
    const color = ws?.color ?? COLORS[data.workspaces.length % COLORS.length];
    // "+" بيفتح منتقي Kivo (KivoColorPicker) تحت الدواير، وهو نفسه اللي بيفتح لأي <input type="color">.
    colorPicker = KivoColorPicker.create(doc, {
      color,
      onInput: c => pickColor(colorPicker.element.closest(".kivo-ws-form"), c, { from: "picker" }),
    });
    colorPicker.element.classList.add("kivo-ws-picker");
    colorPicker.element.hidden = COLORS.includes(color);
    const swatches = COLORS.map(c =>
      html(doc, "button", {
        type: "button",
        class: "kivo-ws-swatch",
        "data-color": c,
        role: "radio",
        "aria-checked": c === color ? "true" : "false",
        "aria-label": c,
        style: { "--kivo-ws-color": c },
      })
    );
    const canUseWindow = !ws && !current;
    children.push(
      html(doc, "form", { class: "kivo-ws-form", "data-id": ws?.id ?? "", "data-color": color }, [
        html(doc, "input", {
          class: "kivo-ws-input",
          type: "text",
          maxlength: String(MAX_NAME),
          placeholder: "Name, like School or Games",
          value: ws?.name ?? "",
          "aria-label": "Workspace name",
          required: true,
        }),
        html(doc, "div", { class: "kivo-ws-color-title", text: "Color: the whole window takes it" }),
        html(doc, "div", { class: "kivo-ws-swatches", role: "radiogroup", "aria-label": "Color" }, [
          ...swatches,
          html(doc, "button", {
            type: "button",
            class: "kivo-ws-more",
            "aria-label": "Any color",
            title: "Any color",
            "aria-expanded": COLORS.includes(color) ? "false" : "true",
            "aria-pressed": COLORS.includes(color) ? "false" : "true",
          }),
        ]),
        colorPicker.element,
        canUseWindow
          ? html(doc, "label", { class: "kivo-ws-check" }, [
              html(doc, "input", { type: "checkbox", class: "kivo-ws-use-window" }),
              html(doc, "span", { text: "Start with this window's tabs" }),
            ])
          : "",
        html(doc, "div", { class: "kivo-ws-actions" }, [
          ws ? html(doc, "button", { type: "button", class: "kivo-ws-delete", "data-id": ws.id, text: "Delete" }) : "",
          html(doc, "span", { class: "kivo-ws-spacer" }),
          html(doc, "button", { type: "button", class: "kivo-ws-cancel", text: "Cancel" }),
          html(doc, "button", { type: "submit", class: "kivo-ws-save", text: ws ? "Save" : "Create" }),
        ]),
      ])
    );
  } else if (data.workspaces.length < MAX_WORKSPACES) {
    children.push(html(doc, "button", { class: "kivo-ws-new", text: "New workspace" }));
  }
  body.replaceChildren(...children);
  if (form) {
    const formEl = body.querySelector(".kivo-ws-form");
    pickers.set(formEl, colorPicker);
    pickColor(formEl, formEl.dataset.color);
    const input = body.querySelector(".kivo-ws-input");
    input.focus();
    input.select();
  }
}

function onPanelClick(win, event) {
  const target = event.target.closest?.("button");
  if (!target) {
    return;
  }
  const panel = panelFor(win);
  const form = panel.querySelector(".kivo-ws-form");
  if (target.classList.contains("kivo-ws-open")) {
    panel.hidePopup();
    open(target.dataset.id, win).catch(console.error);
  } else if (target.classList.contains("kivo-ws-edit")) {
    endPreview();
    render(win, { id: target.dataset.id });
  } else if (target.classList.contains("kivo-ws-new")) {
    endPreview();
    render(win, {});
  } else if (target.classList.contains("kivo-ws-cancel")) {
    endPreview();
    render(win);
  } else if (target.classList.contains("kivo-ws-swatch") && form) {
    pickColor(form, target.dataset.color);
  } else if (target.classList.contains("kivo-ws-more") && form) {
    const box = form.querySelector(".kivo-ws-picker");
    box.hidden = !box.hidden;
    target.setAttribute("aria-expanded", box.hidden ? "false" : "true");
  } else if (target.classList.contains("kivo-ws-delete")) {
    if (target.dataset.confirm) {
      remove(target.dataset.id).then(() => render(win), console.error);
    } else {
      target.dataset.confirm = "1";
      target.textContent = "Delete it?";
    }
  }
}

// ---------- اللون ----------
// المنتقي نفسه في KivoColorPicker (نفسه اللي بيفتح لأي <input type="color"> في Kivo)، جوه القايمة، لأن منتقي Windows
// كان بيقفل القايمة وهو بيفتح.

/** اللون اللي هيتحفظ: دايرته لو من COLORS، وإلا "+" عليها اللون. from: "picker" لو جاي من المنتقي نفسه. */
function pickColor(form, color, { from = null } = {}) {
  form.dataset.color = color;
  for (const swatch of form.querySelectorAll(".kivo-ws-swatch")) {
    swatch.setAttribute("aria-checked", swatch.dataset.color === color ? "true" : "false");
  }
  const more = form.querySelector(".kivo-ws-more");
  more?.setAttribute("aria-pressed", COLORS.includes(color) ? "false" : "true");
  more?.style.setProperty("--kivo-ws-color", color);
  more?.style.setProperty("--kivo-ws-ink", inkOn(color));
  if (from !== "picker") {
    pickers.get(form)?.set(color);
  }
  previewColor(form, color);
}

/**
 * وانت بتعدّل workspace نافذتها مفتوحة: اللون بيبان عليها على طول (الهيدر والأزرار، وصفحات Kivo بعد لحظة عشان
 * السحب مايبعتلهاش مع كل حركة). ولو ماحفظتش (Cancel، أو Escape، أو القايمة اتقفلت) بيرجع (endPreview).
 */
function previewColor(form, color) {
  const ws = find(form.dataset.id);
  const target = ws && windowOf(ws.id);
  if (!target || target.kivoWorkspaceColor === color) {
    return;
  }
  target.kivoWorkspaceColor = color;
  KivoTheme.refresh(target);
  target.clearTimeout(previewPages);
  previewPages = target.setTimeout(() => Services.obs.notifyObservers(target, "kivo-pages-refresh"), 200);
}

/** كل نافذة بترجع للون الـ workspace المتحفظ (updateWindow بيقارن، فاللي ماتغيرش مابيتلمسش). */
function endPreview() {
  refreshAll();
}

function onSubmit(win, event) {
  event.preventDefault();
  const form = event.target;
  const name = form.querySelector(".kivo-ws-input").value;
  if (!trimName(name)) {
    return;
  }
  const color = form.dataset.color;
  if (form.dataset.id) {
    update(form.dataset.id, { name, color }).then(() => render(win), console.error);
    return;
  }
  const useWindow = form.querySelector(".kivo-ws-use-window")?.checked;
  panelFor(win).hidePopup();
  create({ name, color, withWindow: useWindow ? win : null }).catch(console.error);
}

function togglePanel(win, anchor) {
  const panel = panelFor(win);
  if (panel.state === "open") {
    panel.hidePopup();
    return;
  }
  render(win);
  anchor.setAttribute("open", "true");
  panel.openPopup(anchor, { position: "bottomleft topleft" });
}

function createWidget() {
  if (lazy.CustomizableUI.getWidget(WIDGET)?.provider === lazy.CustomizableUI.PROVIDER_API) {
    return;
  }
  lazy.CustomizableUI.createWidget({
    id: WIDGET,
    type: "custom",
    label: "Workspaces",
    tooltiptext: "Workspaces",
    defaultArea: lazy.CustomizableUI.AREA_TABSTRIP,
    onBuild(doc) {
      const win = doc.defaultView;
      const item = doc.createXULElement("toolbaritem");
      item.id = WIDGET;
      item.className = "chromeclass-toolbar-additional";
      item.setAttribute("label", "Workspaces");
      item.setAttribute("removable", "true");
      const button = html(doc, "button", { class: "kivo-ws-button", "aria-haspopup": "dialog" });
      button.addEventListener("click", () => togglePanel(win, button));
      item.append(button);
      // updateWindow بعد ما الزرار يدخل الصفحة.
      win.setTimeout?.(() => updateWindow(win), 0);
      return item;
    },
  });
}

/** أول شريط التابات، مرة واحدة. بعد أول نافذة، لأن CustomizableUI بيرتب المكان من الحالة المحفوظة وقت ما بيبدأ. */
function placeWidget() {
  if (!Services.prefs.getBoolPref(PLACED_PREF, false)) {
    lazy.CustomizableUI.addWidgetToArea(WIDGET, lazy.CustomizableUI.AREA_TABSTRIP, 0);
    Services.prefs.setBoolPref(PLACED_PREF, true);
  }
}

// ---------- البداية ----------

let captureTask = null;

function onWindowReady(win) {
  placeWidget();
  if (isPrivate(win)) {
    return;
  }
  restoreTag(win);
  win.addEventListener("SSWindowRestored", () => restoreTag(win));
  // تاب اتفتح أو اتقفل أو اتنقل أو صفحة اتغيرت: بعد شوية بتتحفظ، عشان حتى لو Kivo وقع تفضل التابات.
  const changed = () => {
    if (win.kivoWorkspaceId) {
      captureTask.arm();
    }
  };
  for (const type of ["TabOpen", "TabClose", "TabMove", "TabSelect", "TabPinned", "TabUnpinned"]) {
    win.gBrowser.tabContainer.addEventListener(type, changed);
  }
  win.gBrowser.addTabsProgressListener({
    onLocationChange: (browser, progress, request, location, flags) => {
      if (!(flags & Ci.nsIWebProgressListener.LOCATION_CHANGE_SAME_DOCUMENT) || progress.isTopLevel) {
        changed();
      }
    },
  });
  win.addEventListener("SSWindowClosing", () => {
    const ws = find(win.kivoWorkspaceId);
    if (!ws) {
      return;
    }
    // Kivo بيقفل: النافذة بترجع تفتح المرة الجاية، والحالة من الـ session store في الآخر. الولد قفلها: بتفضل في
    // القايمة بتاباتها.
    if (!quitting) {
      ws.open = false;
      capture(win).then(scheduleSave);
    }
    scheduleSave();
    win.setTimeout(refreshAll, 0);
  });
}

// ---------- الـ jump list بتاع الـ taskbar ----------

// "Kivo.exe -profile <path> --kivo-workspace <id>" من الـ jump list (KivoTaskbar). لو الـ profile ده مفتوح، Firefox بيبعت
// الـ command line للنسخة المفتوحة، فبتفتح الـ workspace (أو بتروح لنافذتها) من غير نافذة زيادة. ولو مقفول، Kivo
// بيفتح عادي بالـ session، والـ workspace بعده (reopenOnStartup).
const COMMAND_LINE_CONTRACT = "@kivo/workspaces-command-line;1";
let startupWorkspace = null;

const commandLineHandler = {
  QueryInterface: ChromeUtils.generateQI(["nsICommandLineHandler"]),
  helpInfo: "  --kivo-workspace <id>  Open a Kivo workspace.\n",
  handle(cmdLine) {
    const id = cmdLine.handleFlagWithParam("kivo-workspace", false);
    if (id === null) {
      return;
    }
    if (cmdLine.state === Ci.nsICommandLine.STATE_INITIAL_LAUNCH) {
      startupWorkspace = ID.test(id) ? id : null;
      return;
    }
    cmdLine.preventDefault = true;
    // workspace اتمسحت بعد ما الـ jump list اتكتب: Kivo نفسه بييجي قدام بدل ما مايحصلش حاجة.
    const focus = () => lazy.BrowserWindowTracker.getTopWindow()?.focus();
    if (ID.test(id)) {
      open(id).catch(focus);
    } else {
      focus();
    }
  },
};

function registerCommandLine() {
  const factory = { createInstance: iid => commandLineHandler.QueryInterface(iid) };
  Components.manager
    .QueryInterface(Ci.nsIComponentRegistrar)
    .registerFactory(Components.ID("{45e6cd60-5961-4882-b699-82872260f83a}"), "Kivo workspaces command line", COMMAND_LINE_CONTRACT, factory);
  // قبل m-browser (BrowserContentHandler)، اللي كان هيفتح نافذة جديدة كمان.
  Services.catMan.addCategoryEntry("command-line-handler", "m-a-kivo-workspace", COMMAND_LINE_CONTRACT, false, true);
}

/** بعد ما الـ session يرجع النوافذ: الـ workspaces اللي كانت مفتوحة لما Kivo اتقفل بترجع، لو مارجعتش لوحدها. */
async function reopenOnStartup() {
  await loaded;
  const opener = browserWindows()[0] ?? null;
  for (const ws of data.workspaces) {
    if (ws.open && !windowOf(ws.id)) {
      await open(ws.id, opener).catch(console.error);
    }
  }
  // Kivo اتفتح من الـ jump list على workspace.
  if (startupWorkspace) {
    const id = startupWorkspace;
    startupWorkspace = null;
    await open(id, opener).catch(console.error);
  }
}

export const KivoWorkspaces = {
  /** category browser-before-ui-startup. */
  init() {
    loaded = load();
    registerCommandLine();
    // قبل ما النوافذ ترجع، ومن غير ما نستنى: SessionStartup بيمسح الـ state بعد ما الـ session يرجع.
    lazy.SessionStartup.onceInitialized.then(() => {
      if (lazy.SessionStartup.previousSessionCrashed) {
        crashedSessionTime = lazy.SessionStartup.state?.session?.lastUpdate ?? null;
      }
    });
    saveTask = new lazy.DeferredTask(() => write(), 1000);
    captureTask = new lazy.DeferredTask(async () => {
      await captureAll();
      scheduleSave();
    }, 3000);
    lazy.AsyncShutdown.profileBeforeChange.addBlocker("Kivo: save workspaces", async () => {
      await loaded;
      captureTask.disarm();
      captureFromSession();
      await saveTask.finalize();
    });

    createWidget();

    Services.obs.addObserver(subject => loaded.then(() => onWindowReady(subject)), "browser-delayed-startup-finished");
    // الـ session اتكتب: احتياطي لأي تغيير مالوش حدث فوق.
    Services.obs.addObserver(() => captureTask.arm(), "sessionstore-state-write-complete");
    Services.obs.addObserver(() => {
      quitting = true;
    }, "quit-application-granted");
    const restored = () => {
      Services.obs.removeObserver(restored, "sessionstore-windows-restored");
      reopenOnStartup().catch(console.error);
    };
    Services.obs.addObserver(restored, "sessionstore-windows-restored");
  },

  /** للاختبارات والـ bridge: نسخة من القايمة من غير حالة النوافذ. */
  async list() {
    await loaded;
    return data.workspaces.map(({ window: _window, ...ws }) => ({ ...ws, here: !!windowOf(ws.id) }));
  },

  async saveNow() {
    await loaded;
    await captureAll();
    await write();
  },

  open,
  create,
  update,
  remove,
  togglePanel,
};
