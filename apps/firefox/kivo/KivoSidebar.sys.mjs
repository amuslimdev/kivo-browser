// أدوات الـ sidebar (docs/FIREFOX.md): أكتر من chatbot، وأي موقع، و "Add a tool" مكان الـ checkboxes في Customize.
// Firefox فيه chatbot واحد (aichat)، والـ provider بتاعه pref واحد لكل النوافذ. أول chatbot بيفضل هو، لأن معاه
// "Summarize page" و "Ask chatbot" على الكلام المتعلم عليه. وأي chatbot زيادة، أو أي موقع الولد بيضيفه (WhatsApp،
// و Translate...)، panel بتاع Kivo (sidebar-web.html) بلوجوه في الـ launcher. اسمه في sidebar.main.tools زي أي أداة:
// kivochat-<id> (kivochat-gemini)، أو kivosite-<id> والموقع نفسه في kivo.sidebar.sites.
// الأدوات اللي مابتتكررش (History و Bookmarks...) مرة واحدة، وكل chatbot وكل موقع مرة واحدة.
// ترتيب الـ launcher هو ترتيب sidebar.main.tools: اللي بتضيفه بييجي في الآخر، والسحب في Customize بيغيّره.
// من غير patches على كود الـ sidebar: hooks على SidebarController في كل نافذة، و sidebar-tools.mjs جوه صفحة Customize.

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  GenAI: "moz-src:///browser/components/genai/GenAI.sys.mjs",
  setTimeout: "resource://gre/modules/Timer.sys.mjs",
  clearTimeout: "resource://gre/modules/Timer.sys.mjs",
});

const TOOLS_PREF = "sidebar.main.tools";
const CHAT_ENABLED_PREF = "browser.ml.chat.enabled";
const PROVIDER_PREF = "browser.ml.chat.provider";
// المواقع: [{ id, name, url, auto }]. auto يعني الاسم من الموقع نفسه، لأن الولد ماكتبش اسم.
const SITES_PREF = "kivo.sidebar.sites";
// لوجو كل موقع PNG صغير (data:)، في pref لوحده عشان كل pref يفضل تحت 4 KB.
const ICON_PREF = "kivo.sidebar.siteIcon.";
const KIVO_PREFS = "kivo.sidebar.";
const FIREFOX_CHAT = "aichat";
const CHAT = "kivochat-";
const SITE = "kivosite-";
const CHAT_COMMAND = "kivoChatSidebar-";
const SITE_COMMAND = "kivoSiteSidebar-";
const PANEL = "chrome://browser/content/kivo/sidebar-web.html";
const CUSTOMIZE_PAGE = "chrome://browser/content/sidebar/sidebar-customize.html";
const CUSTOMIZE_SCRIPT = "chrome://browser/content/kivo/sidebar-tools.mjs";
// ترتيب الـ chatbots في قايمة Add. أي provider جديد في Firefox بييجي بعدهم.
const ORDER = ["chatgpt", "gemini", "claude", "copilot", "lechat", "huggingchat"];
const ICON_SIZE = 32;
const MAX_PAGE = 2 * 1024 * 1024;
const MAX_ICON = 512 * 1024;
// ألوان اللوجو المؤقت (أول حرف) لحد ما لوجو الموقع يوصل، أو لو مالوش.
const LETTER_COLORS = ["#7964bc", "#e5604d", "#2f9e6e", "#2b7bd6", "#d9822b", "#c2418f"];

/** أسامي الأدوات اللي في الـ launcher، بالترتيب. */
function toolNames() {
  const value = Services.prefs.getStringPref(TOOLS_PREF, "");
  return value ? value.split(",") : [];
}

function setToolNames(names) {
  Services.prefs.setStringPref(TOOLS_PREF, names.join());
}

function idOf(name, prefix) {
  return name.startsWith(prefix) ? name.slice(prefix.length) : null;
}

/**
 * الـ chatbots اللي Kivo بيضيفها: لستة Firefox نفسها (الاسم واللوجو)، من غير localhost. `key` عنوانها في Firefox
 * (قيمة browser.ml.chat.provider)، و `url` من غير query، فـ ?form=MOZCMC بتاع Copilot (كود Mozilla) مابيتبعتش.
 */
function providers() {
  const list = [];
  for (const [key, data] of lazy.GenAI.chatProviders) {
    if (!data.iconUrl || !/^[a-z]+$/.test(data.id ?? "")) {
      continue;
    }
    const url = new URL(key);
    url.search = "";
    list.push({ id: data.id, name: data.name, key, url: url.href, iconUrl: data.iconUrl });
  }
  const rank = p => (ORDER.includes(p.id) ? ORDER.indexOf(p.id) : ORDER.length);
  return list.sort((a, b) => rank(a) - rank(b));
}

/** الـ provider بتاع chatbot Firefox (aichat)، لو اتختار وكان من اللستة. */
function firefoxChatId() {
  return lazy.GenAI.chatProviders.get(Services.prefs.getStringPref(PROVIDER_PREF, ""))?.id ?? null;
}

// ---------- المواقع ----------

/** عنوان موقع من اللي الولد كتبه: http أو https بس، و https لو ماكتبش. */
function siteUrl(address) {
  const text = String(address ?? "").trim();
  if (!text || /\s/.test(text)) {
    return null;
  }
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`);
    const host = url.hostname;
    if (!["http:", "https:"].includes(url.protocol) || !(host.includes(".") || host === "localhost")) {
      return null;
    }
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}

/** نفس الموقع: نفس الـ host والمسار، من غير / في الآخر. */
function sameSite(a, b) {
  const key = url => {
    const u = new URL(url);
    return `${u.host.toLowerCase()}${u.pathname.replace(/\/+$/, "")}`;
  };
  return key(a) === key(b);
}

/** المواقع من الـ pref بعد التحقق. أي موقع ناقص أو غلط بيتشال. */
function readSites() {
  let raw;
  try {
    raw = JSON.parse(Services.prefs.getStringPref(SITES_PREF, "[]"));
  } catch {
    raw = [];
  }
  const sites = [];
  for (const site of Array.isArray(raw) ? raw : []) {
    const url = siteUrl(site?.url);
    if (/^[a-z0-9]{1,12}$/.test(site?.id ?? "") && url && typeof site.name === "string" && site.name.trim()) {
      sites.push({ id: site.id, name: site.name.trim().slice(0, 40), url: url.href, auto: site.auto === true });
    }
  }
  return sites;
}

function writeSites(sites) {
  Services.prefs.setStringPref(SITES_PREF, JSON.stringify(sites));
}

/** اللوجو المؤقت: أول حرف من الاسم على مربع ملوّن. */
function letterIcon(name) {
  const letter = [...name.trim()][0]?.toUpperCase() ?? "?";
  const escaped = letter.replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`);
  const color = LETTER_COLORS[[...name].reduce((sum, c) => sum + c.codePointAt(0), 0) % LETTER_COLORS.length];
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" rx="4" fill="${color}"/>` +
    `<text x="8" y="11.6" font-family="Segoe UI, sans-serif" font-size="10" font-weight="600" text-anchor="middle" fill="#fff">${escaped}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function siteIcon(site) {
  const icon = Services.prefs.getStringPref(ICON_PREF + site.id, "");
  return icon.startsWith("data:image/png;base64,") ? icon : letterIcon(site.name);
}

/** رد من غير cookies، في 10 ثواني بالكتير. */
async function get(url, accept, max) {
  const controller = new AbortController();
  const timer = lazy.setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(url, { credentials: "omit", referrerPolicy: "no-referrer", headers: { Accept: accept }, signal: controller.signal });
    if (!response.ok || Number(response.headers.get("content-length")) > max) {
      throw new Error(`Cannot use ${url}`);
    }
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > max) {
      throw new Error(`Too big: ${url}`);
    }
    return { bytes, type: response.headers.get("content-type") ?? "", url: response.url || url };
  } finally {
    lazy.clearTimeout(timer);
  }
}

/** صورة اللوجو PNG مربع ICON_SIZE، مرسومة جوه نافذة Kivo (فيها canvas). */
async function drawIcon(win, href) {
  const { bytes, type } = await get(href, "image/*", MAX_ICON);
  if (!/^image\//.test(type) && !/\.ico(\?|$)/i.test(href)) {
    throw new Error(`Not an image: ${href}`);
  }
  const src = win.URL.createObjectURL(new win.Blob([bytes], { type: type || "image/x-icon" }));
  try {
    const img = win.document.createElementNS("http://www.w3.org/1999/xhtml", "img");
    img.src = src;
    await img.decode();
    const ratio = img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : 1;
    const width = ratio >= 1 ? ICON_SIZE : ICON_SIZE * ratio;
    const height = ratio >= 1 ? ICON_SIZE / ratio : ICON_SIZE;
    const canvas = win.document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
    canvas.width = canvas.height = ICON_SIZE;
    const context = canvas.getContext("2d");
    context.imageSmoothingQuality = "high";
    context.drawImage(img, (ICON_SIZE - width) / 2, (ICON_SIZE - height) / 2, width, height);
    return canvas.toDataURL("image/png");
  } finally {
    win.URL.revokeObjectURL(src);
  }
}

/** حجم اللوجو من sizes (أكبر رقم)، و any بيتحسب كبير. */
function iconSize(link) {
  const sizes = (link.getAttribute("sizes") ?? "").toLowerCase();
  if (sizes.includes("any")) {
    return 512;
  }
  return Math.max(0, ...sizes.split(/\s+/).map(s => Number.parseInt(s, 10) || 0));
}

/**
 * لوجو الموقع واسمه من صفحته: <link rel="icon"> (و apple-touch-icon)، وإلا /favicon.ico. الأحسن الأول: SVG، وبعده
 * الأقرب لـ 64 ومش أصغر من 32. والاسم (og:site_name، أو application-name، أو العنوان) لو الولد ماكتبش اسم.
 */
async function fetchLook(site) {
  const win = Services.wm.getMostRecentBrowserWindow();
  if (!win) {
    return;
  }
  const candidates = [];
  let title = null;
  let base = site.url;
  try {
    const page = await get(site.url, "text/html", MAX_PAGE);
    base = page.url;
    const doc = new DOMParser().parseFromString(new TextDecoder().decode(page.bytes), "text/html");
    for (const link of doc.querySelectorAll("link[rel][href]")) {
      const rel = link.getAttribute("rel").toLowerCase().split(/\s+/);
      if (!rel.some(r => ["icon", "apple-touch-icon", "apple-touch-icon-precomposed"].includes(r))) {
        continue;
      }
      try {
        const href = new URL(link.getAttribute("href"), base);
        if (["http:", "https:", "data:"].includes(href.protocol)) {
          const svg = /svg/.test(link.getAttribute("type") ?? "") || /\.svg$/i.test(href.pathname);
          candidates.push({ href: href.href, score: svg ? 1000 : 500 - Math.abs(Math.max(iconSize(link), 16) - 64) - (iconSize(link) < 32 ? 200 : 0) });
        }
      } catch {}
    }
    title =
      doc.querySelector('meta[property="og:site_name"]')?.getAttribute("content") ||
      doc.querySelector('meta[name="application-name"]')?.getAttribute("content") ||
      doc.title;
  } catch (e) {
    console.warn("Kivo sidebar: no page for", site.url, e);
  }
  candidates.sort((a, b) => b.score - a.score);
  candidates.push({ href: new URL("/favicon.ico", base).href });
  for (const { href } of candidates) {
    const icon = await drawIcon(win, href).catch(() => null);
    if (icon && icon.length < 16_000) {
      Services.prefs.setStringPref(ICON_PREF + site.id, icon);
      break;
    }
  }
  const name = title?.replace(/\s+/g, " ").trim().slice(0, 40);
  if (name) {
    const sites = readSites();
    const current = sites.find(s => s.id === site.id);
    if (current?.auto) {
      current.name = name;
      current.auto = false;
      writeSites(sites);
    }
  }
}

// ---------- الـ panels ----------

/** الأداة بتاعة Kivo دي: الاسم، والعنوان، واللوجو، والـ command. أو null لو مش معروفة. */
function describe(tool) {
  const chat = idOf(tool ?? "", CHAT);
  if (chat) {
    const provider = providers().find(p => p.id === chat);
    return provider && { tool, commandID: CHAT_COMMAND + chat, name: provider.name, url: provider.url, iconUrl: provider.iconUrl };
  }
  const siteId = idOf(tool ?? "", SITE);
  if (siteId) {
    const site = readSites().find(s => s.id === siteId);
    return site && { tool, commandID: SITE_COMMAND + siteId, name: site.name, url: site.url, iconUrl: siteIcon(site) };
  }
  return null;
}

/** الـ panels بتاعة Kivo اللي في sidebar.main.tools، من غير تكرار. */
function wantedPanels() {
  const names = [...new Set(toolNames().filter(n => n.startsWith(CHAT) || n.startsWith(SITE)))];
  return names.map(describe).filter(Boolean);
}

function panelFor(panel) {
  return [
    panel.commandID,
    {
      name: panel.tool,
      kivoPanel: panel.tool,
      title: panel.name,
      label: panel.name,
      url: `${PANEL}?tool=${panel.tool}`,
      iconUrl: panel.iconUrl,
      menuId: `menu_${panel.commandID}`,
    },
  ];
}

/** نفس شكل الأداة اللي getTools بيرجّعها، عشان الـ launcher و Customize يعاملوها زي أدوات Firefox. */
function toolFor(commandID, sidebar) {
  return {
    commandID,
    view: commandID,
    name: sidebar.name,
    iconUrl: sidebar.iconUrl,
    tooltiptext: sidebar.label,
    kivoPanel: sidebar.kivoPanel,
    disabled: false,
    hidden: false,
    attention: false,
  };
}

function kivoTools(controller) {
  const tools = [];
  for (const [commandID, sidebar] of controller.sidebars) {
    if (sidebar.kivoPanel) {
      tools.push(toolFor(commandID, sidebar));
    }
  }
  return tools;
}

/** بترتيب sidebar.main.tools، واللي مش فيه (المقفول) في الآخر بترتيبه. الـ sort ثابت. */
function byToolOrder(items, nameOf) {
  const order = toolNames();
  const rank = item => {
    const index = order.indexOf(nameOf(item));
    return index === -1 ? order.length : index;
  };
  return [...items].sort((a, b) => rank(a) - rank(b));
}

/** الـ launcher بيرسم الأدوات بترتيب الـ Map، فبيترتب هنا. بيرجّع true لو الترتيب اتغير. */
function reorder(map) {
  const entries = [...map];
  const sorted = byToolOrder(entries, ([, tool]) => tool.name);
  if (sorted.every((entry, i) => entry === entries[i])) {
    return false;
  }
  map.clear();
  for (const [commandID, tool] of sorted) {
    map.set(commandID, tool);
  }
  return true;
}

function addMenuItem(window, controller, commandID, sidebar) {
  // قبل init، الـ init نفسه بيعمل عناصر القايمة لكل الـ sidebars.
  if (controller.initialized) {
    window.document.getElementById("viewSidebarMenu")?.appendChild(controller.createMenuItem(commandID, sidebar));
  }
}

/**
 * الـ panels بتاعة Kivo في النافذة دي زي الـ prefs: اللي اتضاف، واللي اتشال، واسم الموقع ولوجوه لما يوصلوا.
 * بيرجّع true لو حاجة اتغيرت.
 */
function sync(window, controller) {
  const sidebars = controller.sidebars;
  const tools = controller._toolsAndExtensions;
  const wanted = new Map(wantedPanels().map(panelFor));
  let changed = false;
  for (const [commandID, sidebar] of [...sidebars]) {
    if (sidebar.kivoPanel && !wanted.has(commandID)) {
      if (controller.currentID === commandID) {
        controller.hide();
      }
      sidebars.delete(commandID);
      tools?.delete(commandID);
      window.document.getElementById(sidebar.menuId)?.remove();
      changed = true;
    }
  }
  for (const [commandID, sidebar] of wanted) {
    const current = sidebars.get(commandID);
    if (!current) {
      sidebars.set(commandID, sidebar);
      tools?.set(commandID, toolFor(commandID, sidebar));
      addMenuItem(window, controller, commandID, sidebar);
      changed = true;
    } else if (current.label !== sidebar.label || current.iconUrl !== sidebar.iconUrl) {
      Object.assign(current, { title: sidebar.title, label: sidebar.label, iconUrl: sidebar.iconUrl });
      tools?.set(commandID, toolFor(commandID, current));
      window.document.getElementById(current.menuId)?.setAttribute("label", current.label);
      changed = true;
    }
  }
  return (tools ? reorder(tools) : false) || changed;
}

/** صفحة Customize بتاعة Firefox بتحمّل sidebar-tools.mjs، اللي بيغيّر لستة الأدوات (من غير patch). */
let watchingCustomize = false;
function watchCustomize() {
  if (watchingCustomize) {
    return;
  }
  watchingCustomize = true;
  Services.obs.addObserver(doc => {
    const win = doc.defaultView;
    if (!win || !doc.documentURI?.startsWith(CUSTOMIZE_PAGE)) {
      return;
    }
    win.addEventListener(
      "DOMContentLoaded",
      () => {
        const script = doc.createElement("script");
        script.type = "module";
        script.src = CUSTOMIZE_SCRIPT;
        doc.head.append(script);
      },
      { once: true }
    );
  }, "document-element-inserted");
}

// آخر صفحة كان فيها كل panel، لكل نافذة (sidebar-web.mjs). الـ sidebar بيفتح panel واحد في المرة، فالرجوع من panel
// تاني بيرجّعك لنفس المحادثة بدل محادثة جديدة. بتتنسي لما Kivo يتقفل.
const places = new WeakMap();

export const KivoSidebar = {
  providers,
  describe,

  provider(id) {
    return providers().find(p => p.id === id) ?? null;
  },

  /** الـ chatbots اللي في الـ sidebar دلوقتي (chatbot Firefox والزيادة)، عشان قايمة Add ماتعرضهمش تاني. */
  usedChats() {
    const names = toolNames();
    const used = new Set(names.map(name => idOf(name, CHAT)).filter(Boolean));
    const firefox = firefoxChatId();
    if (firefox && names.includes(FIREFOX_CHAT) && Services.prefs.getBoolPref(CHAT_ENABLED_PREF, false)) {
      used.add(firefox);
    }
    return used;
  },

  /**
   * يضيف chatbot. أول واحد بيبقى chatbot Firefox نفسه بالـ provider ده (لو مش في الـ launcher أو لسه مااختارش
   * provider)، والباقي panels بتاعة Kivo. ولو فيه window، الـ chatbot بيتفتح فيها على طول عشان تسجّل دخول، زي ما
   * Firefox بيفتح بتاعه لما الـ provider يتغير (browser.ml.chat.openSidebarOnProviderChange).
   */
  addChat(id, window = null) {
    const provider = this.provider(id);
    if (!provider) {
      return;
    }
    const names = toolNames();
    const firefoxFree = !names.includes(FIREFOX_CHAT) || !firefoxChatId();
    let view = CHAT_COMMAND + id;
    if (Services.prefs.getBoolPref(CHAT_ENABLED_PREF, false) && firefoxFree) {
      Services.prefs.setStringPref(PROVIDER_PREF, provider.key);
      if (!names.includes(FIREFOX_CHAT)) {
        names.push(FIREFOX_CHAT);
      }
      view = "viewGenaiChatSidebar";
    } else if (!names.includes(CHAT + id)) {
      names.push(CHAT + id);
    }
    setToolNames(names);
    window?.SidebarController.show(view);
  },

  /**
   * يضيف أي موقع (WhatsApp، و Translate...). عنوان chatbot معروف بيتضاف chatbot. بيرجّع { error } لو العنوان غلط
   * أو الموقع موجود. بيتفتح على طول زي الـ chatbot، ولوجوه واسمه بييجوا من الموقع بعدها.
   */
  addSite({ address, name = "" }, window = null) {
    const url = siteUrl(address);
    if (!url) {
      return { error: "Type a web address, like web.whatsapp.com" };
    }
    const provider = providers().find(p => new URL(p.url).host === url.host);
    if (provider) {
      if (this.usedChats().has(provider.id)) {
        return { error: `${provider.name} is already in your sidebar` };
      }
      this.addChat(provider.id, window);
      return {};
    }
    const sites = readSites();
    const names = toolNames();
    const same = sites.find(s => sameSite(s.url, url.href) && names.includes(SITE + s.id));
    if (same) {
      return { error: `${same.name} is already in your sidebar` };
    }
    let id;
    do {
      id = Math.random().toString(36).slice(2, 8);
    } while (sites.some(s => s.id === id));
    const typed = String(name).replace(/\s+/g, " ").trim().slice(0, 40);
    const site = { id, name: typed || url.hostname.replace(/^www\./, ""), url: url.href, auto: !typed };
    writeSites([...sites, site]);
    this.addTool(SITE + id);
    window?.SidebarController.show(SITE_COMMAND + id);
    fetchLook(site).catch(console.error);
    return {};
  },

  addTool(name) {
    const names = toolNames();
    if (!names.includes(name)) {
      setToolNames([...names, name]);
    }
  },

  /** يشيل الأداة من الـ launcher، والموقع ولوجوه لو كانت موقع. */
  removeTool(name) {
    setToolNames(toolNames().filter(n => n !== name));
    const siteId = idOf(name, SITE);
    if (siteId) {
      writeSites(readSites().filter(s => s.id !== siteId));
      Services.prefs.clearUserPref(ICON_PREF + siteId);
    }
  },

  /** ينقل الأداة قبل target، أو بعده لو after. باقي الأدوات (حتى المخفية والـ extensions) بتفضل مكانها. */
  moveTool(name, target, after = false) {
    if (name === target) {
      return;
    }
    const names = toolNames().filter(n => n !== name);
    const index = names.indexOf(target);
    if (index === -1) {
      return;
    }
    names.splice(after ? index + 1 : index, 0, name);
    setToolNames(names);
  },

  rememberPlace(window, tool, url) {
    if (!places.has(window)) {
      places.set(window, new Map());
    }
    places.get(window).set(tool, url);
  },

  place(window, tool) {
    return places.get(window)?.get(tool) ?? null;
  },

  /** من category browser-window-before-initial-xul-layout، قبل SidebarController.init. */
  init(window) {
    const controller = window.SidebarController;
    if (!controller) {
      return;
    }
    watchCustomize();

    const generateSidebarsMap = controller.generateSidebarsMap;
    controller.generateSidebarsMap = function () {
      const map = generateSidebarsMap.call(this);
      for (const panel of wantedPanels()) {
        map.set(...panelFor(panel));
      }
      return map;
    };

    const getTools = controller.getTools;
    controller.getTools = function () {
      return byToolOrder([...getTools.call(this), ...kivoTools(this)], tool => tool.name);
    };

    const tools = Object.getOwnPropertyDescriptor(controller, "toolsAndExtensions");
    Object.defineProperty(controller, "toolsAndExtensions", {
      configurable: true,
      enumerable: tools.enumerable,
      get() {
        const fresh = !this._toolsAndExtensions;
        const map = tools.get.call(this);
        if (fresh) {
          reorder(map);
        }
        return map;
      },
    });

    // sidebar.main.tools اتغير (من أي نافذة): Firefox بيقفل ويفتح أدواته، و Kivo بيضيف ويشيل الـ panels بتوعه.
    const refreshTools = controller.refreshTools;
    controller.refreshTools = function () {
      const changed = sync(window, this);
      refreshTools.call(this);
      if (changed) {
        window.dispatchEvent(new window.CustomEvent("SidebarItemChanged"));
      }
    };

    // اسم موقع أو لوجوه وصل (kivo.sidebar.*).
    const refreshLook = () => {
      if (!controller.uninitializing && controller._sidebars && sync(window, controller)) {
        window.dispatchEvent(new window.CustomEvent("SidebarItemChanged"));
      }
    };
    Services.prefs.addObserver(KIVO_PREFS, refreshLook);
    window.addEventListener("unload", () => Services.prefs.removeObserver(KIVO_PREFS, refreshLook), { once: true });

    // More tools (الـ launcher صف واحد، sidebar-main.css): Firefox بيعمل نسخة من كل أيقونة مش باينة في قايمته،
    // ومابيشيلش نسخة أداة اتشالت وهي جوه، فكانت بتفضل في القايمة وماتفتحش حاجة.
    const pruneOverflow = () => {
      const list = window.document.getElementById("tools-overflow-list");
      const tools = controller._toolsAndExtensions;
      if (!list || !tools) {
        return;
      }
      const live = new Set([...tools.values()].filter(t => !t.disabled && !t.hidden).map(t => t.view));
      live.add("viewCustomizeSidebar");
      for (const copy of [...list.children]) {
        if (!live.has(copy.getAttribute("view"))) {
          copy.remove();
        }
      }
    };
    // و Firefox بيحط النسخة في آخر القايمة ساعة ما الأيقونة تستخبى، مش مكانها في الـ launcher، فبعد الترتيب بالسحب
    // القايمة كانت بترتيب تاني (بان مع Passwords في Firefox 159). فبتترتب زي الـ launcher، و Customize آخر واحد.
    const sortOverflow = () => {
      const list = window.document.getElementById("tools-overflow-list");
      const main = window.document.querySelector("sidebar-main");
      if (!list || !main?.shadowRoot) {
        return;
      }
      const order = [...main.shadowRoot.querySelectorAll(".tools-and-extensions:not(.overflow-button) > moz-button[view]")].map(b => b.getAttribute("view"));
      const rank = copy => {
        const view = copy.getAttribute("view");
        return view === "viewCustomizeSidebar" ? Infinity : order.indexOf(view) + 1 || order.length + 1;
      };
      const copies = [...list.children];
      const sorted = copies.toSorted((a, b) => rank(a) - rank(b));
      if (sorted.some((copy, i) => copy !== copies[i])) {
        list.append(...sorted);
      }
    };
    const overflowList = window.document.getElementById("tools-overflow-list");
    if (overflowList) {
      new window.MutationObserver(sortOverflow).observe(overflowList, { childList: true });
    }
    for (const type of ["SidebarItemAdded", "SidebarItemChanged", "SidebarItemRemoved"]) {
      window.addEventListener(type, pruneOverflow);
      // الـ launcher بيترسم تاني بعد الـ event، فالترتيب بعده.
      window.addEventListener(type, () => window.document.querySelector("sidebar-main")?.updateComplete?.then(sortOverflow));
    }

    // الـ extensions بتتسجل بعد الأدوات، فبتترتب لما تيجي.
    const addOrUpdateExtension = controller.addOrUpdateExtension;
    controller.addOrUpdateExtension = function (...args) {
      addOrUpdateExtension.apply(this, args);
      if (this._toolsAndExtensions && reorder(this._toolsAndExtensions)) {
        window.dispatchEvent(new window.CustomEvent("SidebarItemChanged"));
      }
    };

    // View > Sidebar: Firefox بياخد الاسم من Fluent، والـ panels بتاعة Kivo اسمها اسم الـ chatbot أو الموقع.
    const createMenuItem = controller.createMenuItem;
    controller.createMenuItem = function (commandID, sidebar) {
      const item = createMenuItem.call(this, commandID, sidebar);
      if (sidebar.kivoPanel) {
        item.setAttribute("label", sidebar.label);
      }
      return item;
    };

    // قايمة الـ panels في وضع "من غير launcher": Firefox بياخد اسم كل أداة من Fluent، فبتوع Kivo بيتحطوا بعد أدواته.
    const getRevampSwitcherItems = controller.getRevampSwitcherItems;
    controller.getRevampSwitcherItems = async function () {
      const firefoxOnly = Object.create(this, { getTools: { value: () => getTools.call(this) } });
      const items = await getRevampSwitcherItems.call(firefoxOnly);
      const count = getTools.call(this).filter(tool => !tool.hidden).length;
      items.splice(count, 0, ...kivoTools(this).map(tool => ({ view: tool.view, label: tool.tooltiptext })));
      return items;
    };

    if (controller._sidebars) {
      sync(window, controller);
    }
  },
};
