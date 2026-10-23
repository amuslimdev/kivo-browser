// ثيم الـ profile على نوافذ Kivo (docs/FIREFOX.md، G1).
// القيم بس من الـ pref (زي PLAN 3.6): الوضع، واللون، والاستدارة، والمواقع. مفيش CSS حر.
// الألوان بنفس معادلة صفحات Kivo (web/ui/src/theme/apply.ts، chromeColors)، والشكل في kivo.css.
// بيتنادى من category browser-window-before-initial-xul-layout، يعني قبل ما النافذة تترسم.

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  AddonManager: "resource://gre/modules/AddonManager.sys.mjs",
  PrivateBrowsingUtils: "resource://gre/modules/PrivateBrowsingUtils.sys.mjs",
});

const PREF = "kivo.theme";
const CONTENT_SCHEME_PREF = "layout.css.prefers-color-scheme.content-override";
const SHEET = "chrome://browser/content/kivo/kivo.css";

// "Clean" من presets.ts، الثيم الافتراضي لأي profile جديد.
export const DEFAULT_THEME = Object.freeze({ mode: "light", accent: "#7964bc", corners: "round", sites: "theme", font: "readex" });

// زي FONTS في presets.ts. الملفات في fonts.css (من web/ui).
const FALLBACK = '"Segoe UI", Tahoma, system-ui, sans-serif';
const FONTS = new Map([
  ["baloo", `"Baloo Bhaijaan 2", ${FALLBACK}`],
  ["playpen", `"Playpen Sans Arabic", ${FALLBACK}`],
  ["readex", `"Readex Pro", ${FALLBACK}`],
  ["rubik", `Rubik, ${FALLBACK}`],
  ["cairo", `Cairo, ${FALLBACK}`],
  ["alexandria", `Alexandria, ${FALLBACK}`],
  ["changa", `Changa, ${FALLBACK}`],
  ["messiri", `"El Messiri", ${FALLBACK}`],
  ["handjet", `Handjet, ${FALLBACK}`],
]);
// أسامي الخطوط قبل 17 أكتوبر، زي OldFonts في ProfileTheme.cs.
const OLD_FONTS = new Map([
  ["classic", "readex"],
  ["playful", "baloo"],
  ["handwritten", "playpen"],
  ["bold", "changa"],
  ["techy", "handjet"],
]);

const MODES = new Set(["light", "dark", "system"]);
const CORNERS = new Set(["soft", "round", "bubbly"]);
const SITES = new Set(["theme", "light", "dark"]);
const HEX = /^#[0-9a-f]{6}$/i;

/** الثيم من الـ pref بعد التحقق. أي خانة غلط بترجع للافتراضي، ومفيش خانة غير اللي هنا بتتقري. */
export function readTheme() {
  let raw;
  try {
    raw = JSON.parse(Services.prefs.getStringPref(PREF, "{}"));
  } catch {
    raw = {};
  }
  return {
    mode: MODES.has(raw?.mode) ? raw.mode : DEFAULT_THEME.mode,
    accent: HEX.test(raw?.accent ?? "") ? raw.accent.toLowerCase() : DEFAULT_THEME.accent,
    corners: CORNERS.has(raw?.corners) ? raw.corners : DEFAULT_THEME.corners,
    sites: SITES.has(raw?.sites) ? raw.sites : DEFAULT_THEME.sites,
    font: FONTS.has(raw?.font) ? raw.font : (OLD_FONTS.get(raw?.font) ?? DEFAULT_THEME.font),
    // لون الهيدر الثابت، أو null لو الهيدر ماشي مع العالم (README بتاع الثيم، header).
    header: HEX.test(raw?.header ?? "") ? raw.header.toLowerCase() : null,
  };
}

/** الخط بتاع الثيم بالـ fallback بتاعه، زي --kivo-font. */
export function fontFamily(theme) {
  return FONTS.get(theme.font);
}

function rgb(hex) {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(accent, gray, amount) {
  const channel = c => Math.round(c * amount + gray * (1 - amount)).toString(16).padStart(2, "0");
  return `#${rgb(accent).map(channel).join("")}`;
}

function luminance(hex) {
  const [r, g, b] = rgb(hex).map(c => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const WHITE = "#ffffff";
const DARK = "#15151c";

/** Lc بتاع APCA (مسودة WCAG 3، 0.0.98G) لكلام لونه text على خلفية bg، زي contrast في web/ui/src/theme/ink.ts. */
function apca(text, bg) {
  const y = hex => {
    const [r, g, b] = rgb(hex).map(c => (c / 255) ** 2.4);
    return 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  };
  const clamp = v => (v > 0.022 ? v : v + (0.022 - v) ** 1.414);
  const t = clamp(y(text));
  const b = clamp(y(bg));
  if (Math.abs(b - t) < 0.0005) {
    return 0;
  }
  if (b > t) {
    const s = (b ** 0.56 - t ** 0.57) * 1.14;
    return s < 0.1 ? 0 : (s - 0.027) * 100;
  }
  const s = (b ** 0.65 - t ** 0.62) * 1.14;
  return s > -0.1 ? 0 : (s + 0.027) * 100;
}

/**
 * أوضح لون كلام على الخلفية دي، أبيض ولا غامق. بـ APCA مش WCAG 2، لأن WCAG 2 بيختار الغامق على الألوان المتوسطة
 * (البينك والأزرق والبرتقالي) والعين بتشوف الأبيض أوضح عليها. زي textOn في web/ui/src/theme/ink.ts.
 */
export function inkOn(hex) {
  return Math.abs(apca(WHITE, hex)) >= Math.abs(apca(DARK, hex)) ? WHITE : DARK;
}

/** شريط التابات وشريط الأدوات من لون الـ profile والوضع، زي ShellWindow.ApplyChrome و chromeColors. */
export function chromeColors(theme, dark) {
  const tabs = dark ? mix(theme.accent, 0x14, 0.36) : mix(theme.accent, 0xff, 0.32);
  const toolbar = dark ? mix(theme.accent, 0x20, 0.22) : mix(theme.accent, 0xff, 0.16);
  return { tabs, toolbar, tabsInk: inkOn(tabs), toolbarInk: inkOn(toolbar), onAccent: inkOn(theme.accent), dark };
}

/**
 * هيدر بلون ثابت (header في الثيم، أو لون الـ workspace)، زي headerColors في apply.ts. شريط التابات هو اللون
 * نفسه، وشريط الأدوات والتاب المختار نسخة فاتحة منه زي Chrome. اللون الغامق جدًا شريط أدواته أفتح شوية بس،
 * والنافذة ساعتها بالليل.
 */
export function headerColors(theme, color) {
  const dark = luminance(color) < 0.05;
  const tabs = color;
  const toolbar = dark ? mix(color, 0xff, 0.86) : mix(color, 0xff, 0.3);
  return { tabs, toolbar, tabsInk: inkOn(tabs), toolbarInk: inkOn(toolbar), onAccent: inkOn(theme.accent), dark };
}

/**
 * ألوان الهيدر للنافذة دي. الأول لون الـ workspace (KivoWorkspaces، عشان الولد يعرف هو في أنهي واحدة)، وبعدين
 * الهيدر الثابت من الثيم، وإلا من لون الـ profile والوضع، فبيتغير مع العالم.
 * النافذة الخاصة دايمًا بالليل، بلون الـ profile (ثيم Firefox البنفسجي ليها مقفول، firefox-branding.js)، عشان تبان
 * مختلفة عن العادية. صفحتها بنفس الشكل (kivo/private).
 */
function windowColors(window, theme, workspace) {
  if (lazy.PrivateBrowsingUtils.isWindowPrivate(window)) {
    return chromeColors(theme, true);
  }
  const fixed = workspace ?? theme.header;
  if (fixed) {
    return headerColors(theme, fixed);
  }
  const dark =
    theme.mode === "system" ? window.matchMedia("(prefers-color-scheme: dark)").matches : theme.mode === "dark";
  return chromeColors(theme, dark);
}

/** لون الـ workspace اللي النافذة فيها (KivoWorkspaces)، أو null. */
function workspaceColor(window) {
  return HEX.test(window.kivoWorkspaceColor ?? "") ? window.kivoWorkspaceColor.toLowerCase() : null;
}

function apply(window) {
  const stored = readTheme();
  // نافذة الـ workspace لونها هو لون الـ workspace في كل حاجة (الأزرار، والقوايم، وصفحات Kivo عن طريق KivoData)،
  // مش الهيدر بس. والنافذة الخاصة مالهاش workspace.
  const workspace = lazy.PrivateBrowsingUtils.isWindowPrivate(window) ? null : workspaceColor(window);
  const theme = workspace ? { ...stored, accent: workspace } : stored;
  const colors = windowColors(window, theme, workspace);
  const root = window.document.documentElement;
  root.setAttribute("kivo-theme", "");
  root.setAttribute("kivo-mode", colors.dark ? "dark" : "light");
  root.setAttribute("kivo-corners", theme.corners);
  root.style.setProperty("--kivo-accent", theme.accent);
  root.style.setProperty("--kivo-on-accent", colors.onAccent);
  root.style.setProperty("--kivo-tabs", colors.tabs);
  root.style.setProperty("--kivo-tabs-ink", colors.tabsInk);
  root.style.setProperty("--kivo-toolbar", colors.toolbar);
  root.style.setProperty("--kivo-toolbar-ink", colors.toolbarInk);
  root.style.setProperty("--kivo-font", FONTS.get(theme.font));

  // المواقع: زي الثيم، أو فاتح، أو غامق (README بتاع الثيم، sites). 0 غامق، 1 فاتح، 2 زي Windows.
  const sites = theme.sites === "theme" ? theme.mode : theme.sites;
  const scheme = { dark: 0, light: 1, system: 2 }[sites];
  if (Services.prefs.getIntPref(CONTENT_SCHEME_PREF, 2) !== scheme) {
    Services.prefs.setIntPref(CONTENT_SCHEME_PREF, scheme);
  }
}

// Kivo Home (G2) بعنوان ثابت (firefox-branding.js، extensions.webextensions.uuids).
const HOME = "moz-extension://9d4b610d-d083-4703-8d31-c7178f7ba2e8/";

/** kivo-home على النافذة وصفحة البداية قدام، عشان شريط العنوان مايكتبش "Extension (Kivo Home)". */
function watchHome(window) {
  const { gBrowser } = window;
  if (!gBrowser) {
    return;
  }
  const update = () =>
    window.document.documentElement.toggleAttribute("kivo-home", gBrowser.currentURI?.spec.startsWith(HOME) ?? false);
  const listener = {
    onLocationChange: update,
    QueryInterface: ChromeUtils.generateQI(["nsIWebProgressListener", "nsISupportsWeakReference"]),
  };
  gBrowser.addProgressListener(listener);
  update();
  window.addEventListener("unload", () => gBrowser.removeProgressListener(listener), { once: true });
}

// ---------- ثيمات Firefox ----------
// شكل Kivo من ثيم Kivo (فوق). ثيم Firefox تاني (الغامق مثلًا، والـ Sync كان بيجيبه من Firefox على جهاز تاني) بيلوّن
// القوايم والـ popups بس، والنافذة بتفضل بشكل Kivo، فبيبان متلخبط. فـ Kivo بيرجع لثيم Firefox الافتراضي على طول،
// والـ Sync مابيجيبش الثيم (firefox-branding.js).

const FIREFOX_THEME_PREF = "extensions.activeThemeID";
const FIREFOX_DEFAULT_THEME = "default-theme@mozilla.org";
let guarding = false;

async function useFirefoxDefaultTheme() {
  if (Services.prefs.getStringPref(FIREFOX_THEME_PREF, FIREFOX_DEFAULT_THEME) === FIREFOX_DEFAULT_THEME) {
    return;
  }
  const theme = await lazy.AddonManager.getAddonByID(FIREFOX_DEFAULT_THEME);
  await theme?.enable();
}

function guardFirefoxTheme() {
  if (guarding) {
    return;
  }
  guarding = true;
  // الـ AddonManager جاهز بعد أول نافذة.
  const ready = () => {
    Services.obs.removeObserver(ready, "browser-delayed-startup-finished");
    useFirefoxDefaultTheme().catch(console.error);
  };
  Services.obs.addObserver(ready, "browser-delayed-startup-finished");
  Services.prefs.addObserver(FIREFOX_THEME_PREF, () => useFirefoxDefaultTheme().catch(console.error));
}

// ---------- صفحات Firefox جوه Kivo (G5) ----------
// الإعدادات والـ sidebars بخط Kivo ولونه واستدارته (pages.css). اللون بتاع الـ workspace لو الصفحة في نافذتها.

const PAGES_SHEET = "chrome://browser/content/kivo/pages.css";
const STYLED_PAGES = [
  /^about:preferences/,
  /^chrome:\/\/browser\/content\/sidebar\/sidebar-(history|bookmarks)\.html/,
  /^chrome:\/\/browser\/content\/places\/(history|bookmarks)Sidebar\.xhtml/,
];
const RADIUS = { soft: 6, round: 10, bubbly: 14 };
let watchingPages = false;

function stylePage(doc) {
  const win = doc.defaultView;
  try {
    win.windowUtils.loadSheetUsingURIString(PAGES_SHEET, win.windowUtils.AUTHOR_SHEET);
  } catch {
    return;
  }
  const paint = () => {
    const chrome = win.browsingContext?.topChromeWindow;
    const theme = readTheme();
    const accent = (HEX.test(chrome?.kivoWorkspaceColor ?? "") && chrome.kivoWorkspaceColor) || theme.accent;
    const root = doc.documentElement;
    root.style.setProperty("--kivo-accent", accent);
    root.style.setProperty("--kivo-on-accent", inkOn(accent));
    root.style.setProperty("--kivo-font", FONTS.get(theme.font));
    root.style.setProperty("--kivo-radius", `${RADIUS[theme.corners]}px`);
  };
  paint();
  const refresh = subject => {
    if (!subject || subject === win.browsingContext?.topChromeWindow) {
      paint();
    }
  };
  Services.prefs.addObserver(PREF, paint);
  Services.obs.addObserver(refresh, "kivo-pages-refresh");
  win.addEventListener(
    "unload",
    () => {
      Services.prefs.removeObserver(PREF, paint);
      Services.obs.removeObserver(refresh, "kivo-pages-refresh");
    },
    { once: true }
  );
}

function watchPages() {
  if (watchingPages) {
    return;
  }
  watchingPages = true;
  Services.obs.addObserver(doc => {
    if (doc.defaultView && STYLED_PAGES.some(page => page.test(doc.documentURI ?? ""))) {
      stylePage(doc);
    }
  }, "document-element-inserted");
}

export const KivoTheme = {
  /** يطبّق الثيم تاني على النافذة، لما حاجة تخصها بس تتغير (لون الـ workspace مثلًا). */
  refresh(window) {
    if (window.document?.documentElement?.hasAttribute("kivo-theme")) {
      apply(window);
    }
  },

  init(window) {
    guardFirefoxTheme();
    watchPages();
    window.windowUtils.loadSheetUsingURIString(SHEET, window.windowUtils.AUTHOR_SHEET);
    const update = () => apply(window);
    update();
    // gBrowser بيتعمل في DOMContentLoaded، بعد الـ category دي.
    window.addEventListener("DOMContentLoaded", () => watchHome(window), { once: true });

    // تغيير الثيم أو وضع Windows بيتطبّق على طول على كل النوافذ.
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", update);
    Services.prefs.addObserver(PREF, update);
    window.addEventListener(
      "unload",
      () => {
        media.removeEventListener("change", update);
        Services.prefs.removeObserver(PREF, update);
      },
      { once: true }
    );
  },
};
