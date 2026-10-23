// الـ host بتاع صفحة البداية في Firefox (docs/FIREFOX.md، G2): نفس رسايل shared/bridge/README.md، بس الصفحة extension
// مدمجة (home/) والرسايل جاية من browser.kivo.request.
//
// الصفحة مش موثوقة: أي API هنا المستخدم يقدر يناديه من DevTools، فكله بيانات الـ profile ده بس، ومفيش حاجة تلمس الحماية.
// وأي حاجة جاية منها بتتراجع هنا قبل ما تتحفظ، بنفس قواعد Kivo.Core/Themes (ProfileTheme.cs، و StartTiles.cs،
// و PageWidgets.cs). أي تغيير في القواعد لازم يتعمل في الاتنين لحد ما نسيب WebView2.
// الثيم بيتحفظ في pref kivo.theme، و KivoTheme.sys.mjs بيسمع له ويلوّن النوافذ.

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  Downloads: "resource://gre/modules/Downloads.sys.mjs",
  NewTabUtils: "resource://gre/modules/NewTabUtils.sys.mjs",
  PlacesUtils: "resource://gre/modules/PlacesUtils.sys.mjs",
  SelectableProfileService: "resource:///modules/profiles/SelectableProfileService.sys.mjs",
});

const THEME_PREF = "kivo.theme";

// ---------- الثيم (ProfileTheme.cs) ----------

const MODES = ["light", "dark", "system"];
const SITES = ["theme", "light", "dark"];
const FONTS = ["baloo", "playpen", "readex", "cairo", "alexandria", "rubik", "changa", "messiri", "handjet"];
const OLD_FONTS = { classic: "readex", playful: "baloo", handwritten: "playpen", bold: "changa", techy: "handjet" };
const CORNERS = ["soft", "round", "bubbly"];
const SCENES = ["sky", "space", "ocean", "candy", "jungle", "neon", "aurora"];
const COLOR = /^#[0-9a-fA-F]{6}$/;
const PRESET = /^[a-z0-9-]{1,32}$/;

const isObject = value => typeof value === "object" && value !== null && !Array.isArray(value);
const isInt = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
const isColor = value => typeof value === "string" && COLOR.test(value);

/** strict للي جاي من الصفحة: خانة مش معروفة بترفض. ومن غيره (للي متخزن) بتتجاهل، عشان ثيم من نسخة تانية مايضيعش. */
function checkKeys(object, allowed, strict) {
  if (strict) {
    for (const key of Object.keys(object)) {
      if (!allowed.includes(key)) {
        throw new Error(`Not a Kivo theme: unknown field ${key}`);
      }
    }
  }
}

function cleanBackground(raw, strict) {
  if (!isObject(raw)) {
    throw new Error("Invalid background");
  }
  switch (raw.kind) {
    case "scene":
      checkKeys(raw, ["kind", "scene"], strict);
      if (SCENES.includes(raw.scene)) {
        return { kind: "scene", scene: raw.scene };
      }
      break;
    case "gradient":
      checkKeys(raw, ["kind", "colors", "angle"], strict);
      if (Array.isArray(raw.colors) && raw.colors.length >= 2 && raw.colors.length <= 3 && raw.colors.every(isColor) && isInt(raw.angle, 0, 360)) {
        return { kind: "gradient", colors: [...raw.colors], angle: raw.angle };
      }
      break;
    case "color":
      checkKeys(raw, ["kind", "color"], strict);
      if (isColor(raw.color)) {
        return { kind: "color", color: raw.color };
      }
      break;
    case "photo":
      checkKeys(raw, ["kind", "dim", "blur", "version"], strict);
      if (isInt(raw.dim, 0, 60) && isInt(raw.blur, 0, 20) && Number.isSafeInteger(raw.version) && raw.version > 0) {
        return { kind: "photo", dim: raw.dim, blur: raw.blur, version: raw.version };
      }
      break;
  }
  throw new Error("Invalid background");
}

/** الثيم بعد التحقق، أو exception بالسبب بالإنجليزي (ProfileTheme.Problem). */
export function cleanTheme(raw, strict = true) {
  if (!isObject(raw)) {
    throw new Error("Not a Kivo theme");
  }
  checkKeys(raw, ["version", "preset", "mode", "accent", "font", "corners", "background", "start", "sites", "header", "home"], strict);
  if (raw.version !== 1) {
    throw new Error(`Unsupported theme version ${raw.version}`);
  }
  if (typeof raw.preset !== "string" || !PRESET.test(raw.preset)) {
    throw new Error("Invalid preset");
  }
  const font = OLD_FONTS[raw.font] ?? raw.font;
  if (!MODES.includes(raw.mode) || !FONTS.includes(font) || !CORNERS.includes(raw.corners)) {
    throw new Error("Unknown mode, font, or corners");
  }
  const sites = raw.sites ?? "theme";
  if (!SITES.includes(sites)) {
    throw new Error("Unknown look for websites");
  }
  if (!isColor(raw.accent)) {
    throw new Error("The accent must be a #rrggbb color");
  }
  if (raw.header !== undefined && raw.header !== null && !isColor(raw.header)) {
    throw new Error("The top bar must be a #rrggbb color");
  }
  if (!isObject(raw.start)) {
    throw new Error("Missing start page widgets");
  }
  checkKeys(raw.start, ["buddy", "clock", "fact", "tiles"], strict);
  const start = {};
  for (const key of ["buddy", "clock", "fact", "tiles"]) {
    if (raw.start[key] !== undefined && typeof raw.start[key] !== "boolean") {
      throw new Error("Missing start page widgets");
    }
    start[key] = raw.start[key] === true;
  }

  const theme = {
    version: 1,
    preset: raw.preset,
    mode: raw.mode,
    accent: raw.accent.toLowerCase(),
    font,
    corners: raw.corners,
    background: cleanBackground(raw.background, strict),
    start,
    sites,
  };
  if (raw.header) {
    theme.header = raw.header.toLowerCase();
  }

  if (raw.home !== undefined && raw.home !== null) {
    if (!isObject(raw.home)) {
      throw new Error("Invalid home layout dimensions");
    }
    checkKeys(raw.home, ["width", "rowHeight", "columnGap", "rowGap", "padding"], strict);
    const home = { width: 1280, rowHeight: 44, columnGap: 12, rowGap: 12, padding: 32, ...raw.home };
    if (
      !(home.width === 0 || isInt(home.width, 800, 2560)) ||
      !isInt(home.rowHeight, 24, 96) ||
      !isInt(home.columnGap, 0, 40) ||
      !isInt(home.rowGap, 0, 40) ||
      !isInt(home.padding, 0, 80)
    ) {
      throw new Error("Invalid home layout dimensions");
    }
    theme.home = { width: home.width, rowHeight: home.rowHeight, columnGap: home.columnGap, rowGap: home.rowGap, padding: home.padding };
  }
  return theme;
}

/** الثيم المتخزن، أو null لو الولد لسه مااختارش (أو اتلخبط)، والصفحة ساعتها بتعرض الترحيب. */
export function storedTheme() {
  const json = Services.prefs.getStringPref(THEME_PREF, "");
  if (!json) {
    return null;
  }
  try {
    return cleanTheme(JSON.parse(json), false);
  } catch {
    return null;
  }
}

// ---------- الاختصارات (StartTiles.cs) ----------

const MAX_TILES = 12;

function trimText(text, max) {
  // eslint-disable-next-line no-control-regex
  const clean = String(text).replace(/[\u0000-\u001f\u007f-\u009f]/g, "").trim();
  return clean.length > max ? clean.slice(0, max) : clean;
}

/** http و https بس، واسم قصير، و sticker قصير، و 12 بالكتير. الباقي بيتشال من غير خطأ. */
export function cleanTiles(tiles) {
  if (!Array.isArray(tiles)) {
    return [];
  }
  const clean = [];
  for (const tile of tiles) {
    if (!isObject(tile) || typeof tile.url !== "string" || tile.url.length > 2048) {
      continue;
    }
    let url;
    try {
      url = new URL(tile.url);
    } catch {
      continue;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      continue;
    }
    const title = typeof tile.title === "string" && tile.title.trim() ? tile.title : url.host;
    const emoji = typeof tile.emoji === "string" && tile.emoji.trim() && tile.emoji.length <= 16 ? tile.emoji : undefined;
    clean.push(emoji ? { title: trimText(title, 40), url: tile.url, emoji } : { title: trimText(title, 40), url: tile.url });
    if (clean.length === MAX_TILES) {
      break;
    }
  }
  return clean;
}

// ---------- الـ widgets (PageWidgets.cs) ----------

const COLUMNS = 24;
const MAX_ROWS = 60;
const MAX_WIDGETS = 24;
const WIDGET_ID = /^[a-z0-9-]{1,24}$/;
const NAME = /^[a-z0-9-]{1,40}$/;
const POSITIONS = /^(100|[1-9]?[0-9])(,(100|[1-9]?[0-9])){1,3}$/;

const oneOf = (...values) => value => typeof value === "string" && values.includes(value);
const int = (min, max) => value => isInt(value, min, max);
const oneOfInt = (...values) => value => Number.isInteger(value) && values.includes(value);
const bool = value => typeof value === "boolean";
const text = max => value => typeof value === "string" && value.length <= max;
const name = value => typeof value === "string" && NAME.test(value);

// كل نوع والخانات المسموحة في الـ settings بتاعته، زي PageWidgets.Types و web/ui/src/widgets/registry.ts.
const WIDGET_TYPES = {
  clock: { city: name, face: oneOf("analog", "digital") },
  prayer: {
    city: name,
    method: oneOf("auto", "egypt", "makkah", "mwl", "karachi", "isna", "dubai", "kuwait", "qatar", "gulf", "jordan", "tunisia", "algeria", "morocco", "turkey", "tehran", "jakim", "kemenag", "singapore", "france", "russia"),
    asr: oneOf("auto", "standard", "hanafi"),
  },
  quran: { sura: int(1, 114), aya: int(1, 286), auto: bool, done: int(0, 100_000) },
  sebha: {
    mode: oneOf("prayer", "free"),
    phrase: oneOf("subhan", "hamd", "akbar", "tahleel", "istighfar", "bihamdih", "hawqala", "salat"),
    target: oneOfInt(0, 33, 100),
    count: int(0, 1_000_000),
    step: int(0, 3),
    today: int(0, 1_000_000),
    day: int(0, 99_991_231),
  },
  azkar: { time: oneOf("auto", "morning", "evening"), mi: int(0, 50), mc: int(0, 100), ei: int(0, 50), ec: int(0, 100), day: int(0, 99_991_231) },
  ramadan: { city: name },
  study: {
    mode: oneOf("pomodoro", "timer"),
    focus: int(1, 120),
    minutes: int(1, 180),
    scene: oneOf("auto", "kawaii-panda", "kawaii-bunny", "kawaii-fox", "lofi-rain", "lofi-cairo", "cartoon-room"),
    face: oneOf("auto", "cute", "box", "clean"),
    phase: oneOf("idle", "focus", "break", "long", "done"),
    endsAt: int(0, 100_000_000_000_000),
    left: int(0, 180 * 60_000),
    round: int(0, 3),
    today: int(0, 10_000),
    day: int(0, 99_991_231),
    sceneIndex: int(0, 1_000_000),
  },
  snakes: {
    mode: oneOf("kivo", "friends"),
    count: int(2, 4),
    pos: value => typeof value === "string" && POSITIONS.test(value),
    turn: int(0, 3),
    winner: int(-1, 3),
    six: bool,
    wins: int(0, 100_000),
  },
  fact: {},
  note: { title: text(40), text: text(600) },
  search: {},
  hero: {},
  greeting: {},
  shortcuts: {},
  buddy: {},
};

// شكل أي widget، زي PresentationFields.
const PRESENTATION = {
  uiSurface: oneOf("auto", "card", "glass", "clear"),
  uiColor: value => oneOf("auto", "theme")(value) || isColor(value),
  uiRadius: value => value === "auto" || isInt(value, 0, 48),
};

/**
 * نوع معروف، و id مش متكرر، ومكان جوه الـ grid (أو عمود وحجم من لوحة العمودين القديمة)، و 24 بالكتير.
 * الـ settings اللي مش معروفة أو قيمتها غلط بتتشال لوحدها، والباقي بيتشال من غير خطأ (PageWidgets.Clean).
 */
export function cleanWidgets(widgets) {
  if (!Array.isArray(widgets)) {
    return [];
  }
  const ids = new Set();
  const clean = [];
  for (const widget of widgets) {
    if (!isObject(widget) || typeof widget.id !== "string" || !WIDGET_ID.test(widget.id) || ids.has(widget.id)) {
      continue;
    }
    const fields = Object.hasOwn(WIDGET_TYPES, widget.type) ? WIDGET_TYPES[widget.type] : null;
    if (!fields) {
      continue;
    }

    const { x, y, w, h } = widget;
    let placed;
    if (isInt(x, 0, COLUMNS - 1) && isInt(y, 0, MAX_ROWS - 1) && Number.isInteger(w) && w >= 1 && Number.isInteger(h) && h >= 1 && x + w <= COLUMNS && y + h <= MAX_ROWS) {
      placed = { id: widget.id, type: widget.type, x, y, w, h };
    } else if (x == null && y == null && w == null && h == null && ["left", "right"].includes(widget.column) && ["small", "large"].includes(widget.size)) {
      placed = { id: widget.id, type: widget.type, column: widget.column, size: widget.size };
    } else {
      continue;
    }
    ids.add(widget.id);

    const settings = {};
    if (isObject(widget.settings)) {
      for (const [key, value] of Object.entries(widget.settings)) {
        const valid = (Object.hasOwn(fields, key) && fields[key]) || (Object.hasOwn(PRESENTATION, key) && PRESENTATION[key]);
        if (valid && valid(value)) {
          settings[key] = value;
        }
      }
    }
    placed.settings = settings;
    clean.push(placed);
    if (clean.length === MAX_WIDGETS) {
      break;
    }
  }
  return clean;
}

// ---------- الملفات في فولدر الـ profile ----------

function kivoPath(...parts) {
  return PathUtils.join(PathUtils.profileDir, "kivo", ...parts);
}

async function readJson(file) {
  try {
    return await IOUtils.readJSON(kivoPath(file));
  } catch {
    return undefined;
  }
}

async function writeJson(file, value) {
  await IOUtils.makeDirectory(kivoPath(), { ignoreExisting: true });
  await IOUtils.writeJSON(kivoPath(file), value, { tmpPath: kivoPath(`${file}.tmp`) });
}

// ---------- الـ profile ----------

/** اسم حساب Windows بحرف كبير في الأول، اسم أول profile. */
export function windowsUserName() {
  const name = Services.env.get("USERNAME") || "";
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** الـ profile اللي شغال في Firefox (G3)، أو null لو فيه profile واحد ولسه ماتعملش data store للـ profiles. */
function selectableProfile() {
  return lazy.SelectableProfileService.currentProfile ?? null;
}

// الاسم من الـ profiles بتاعة Firefox (G3، KivoProfiles.sys.mjs)، عشان يبقى نفس الاسم في صفحة الاختيار والقايمة.
// لو لسه مفيش غير profile واحد، اسم حساب Windows. لون دايرة الأفاتار هو لون الثيم، زي كارت الـ profile.
export async function readProfile() {
  const stored = (await readJson("profile.json")) ?? {};
  const avatar = isObject(stored.avatar) ? stored.avatar : { kind: "initial" };
  const current = selectableProfile();
  return {
    id: current ? String(current.id) : "default",
    name: current?.name ? trimText(current.name, 40) : windowsUserName(),
    color: storedTheme()?.accent ?? "#7964bc",
    avatar:
      avatar.kind === "emoji" && typeof avatar.emoji === "string" && avatar.emoji.length <= 16
        ? { kind: "emoji", emoji: avatar.emoji }
        : avatar.kind === "photo" && Number.isSafeInteger(avatar.version) && avatar.version > 0
          ? { kind: "photo", version: avatar.version }
          : { kind: "initial" },
  };
}

async function writeAvatar(avatar) {
  const stored = (await readJson("profile.json")) ?? {};
  stored.avatar = avatar;
  await writeJson("profile.json", stored);
  // KivoProfiles بيرسم الأفاتار الجديد لصفحة الاختيار والقايمة.
  Services.obs.notifyObservers(null, "kivo-profile-changed");
  return readProfile();
}

// ---------- الصور ----------

/** صورة من الجهاز، بنفس طريقة WebView2: الأفاتار 256×256 PNG، والخلفية JPEG أطول ضلع فيها 2560. null لو الولد لغى. */
async function pickPhoto(browser, file, { size, cover, type }) {
  const win = browserWindow(browser);
  const picker = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
  picker.init(win.browsingContext, "Choose a photo", Ci.nsIFilePicker.modeOpen);
  picker.appendFilters(Ci.nsIFilePicker.filterImages);
  const result = await new Promise(resolve => picker.open(resolve));
  if (result !== Ci.nsIFilePicker.returnOK || !picker.file) {
    return null;
  }

  const bytes = await IOUtils.read(picker.file.path);
  const bitmap = await win.createImageBitmap(new win.Blob([bytes]));
  let width;
  let height;
  let sx = 0;
  let sy = 0;
  let sw = bitmap.width;
  let sh = bitmap.height;
  if (cover) {
    // مربع من نص الصورة.
    const side = Math.min(bitmap.width, bitmap.height);
    sx = (bitmap.width - side) / 2;
    sy = (bitmap.height - side) / 2;
    sw = sh = side;
    width = height = size;
  } else {
    const scale = Math.min(1, size / Math.max(bitmap.width, bitmap.height));
    width = Math.round(bitmap.width * scale);
    height = Math.round(bitmap.height * scale);
  }
  const canvas = win.document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, sx, sy, sw, sh, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise(resolve => canvas.toBlob(resolve, type, 0.88));
  await IOUtils.makeDirectory(kivoPath(), { ignoreExisting: true });
  await IOUtils.write(kivoPath(file), new Uint8Array(await blob.arrayBuffer()), { tmpPath: kivoPath(`${file}.tmp`) });
  return Date.now();
}

async function fileDataUrl(file, mime) {
  try {
    const bytes = await IOUtils.read(kivoPath(file));
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return `data:${mime};base64,${btoa(binary)}`;
  } catch {
    return null;
  }
}

const HOST = /^[a-z0-9.-]{1,253}(:\d{1,5})?$/i;

/** أيقونة موقع من السجل، زي me/favicon.png?host= على Windows. */
async function faviconDataUrl(host) {
  if (!HOST.test(host)) {
    return null;
  }
  for (const scheme of ["https", "http"]) {
    try {
      const favicon = await lazy.PlacesUtils.favicons.getFaviconForPage(Services.io.newURI(`${scheme}://${host}/`), 64);
      if (favicon?.dataURI) {
        return favicon.dataURI.spec;
      }
    } catch {
      // مفيش أيقونة للعنوان ده، جرّب التاني.
    }
  }
  return null;
}

/** me/<path>: avatar.png، و background.jpg، و favicon.png?host=. أي مسار تاني null (زي الـ 404 على Windows). */
async function meUrl(path) {
  if (typeof path !== "string") {
    return null;
  }
  const [name, query = ""] = path.split("?", 2);
  switch (name) {
    case "avatar.png":
      return fileDataUrl("avatar.png", "image/png");
    case "background.jpg":
      return fileDataUrl("background.jpg", "image/jpeg");
    case "favicon.png":
      return faviconDataUrl(new URLSearchParams(query).get("host") ?? "");
    default:
      return null;
  }
}

// ---------- التنقل ----------

/** tab.navigate: زي الكتابة في شريط العنوان. عنوان http أو https، أو بحث بمحرك البحث العادي. */
function navigate(browser, input) {
  const text = typeof input === "string" ? input.trim() : "";
  if (!text || text.length > 2048) {
    return;
  }
  const info = Services.uriFixup.getFixupURIInfo(
    text,
    Ci.nsIURIFixup.FIXUP_FLAG_ALLOW_KEYWORD_LOOKUP | Ci.nsIURIFixup.FIXUP_FLAG_FIX_SCHEME_TYPOS
  );
  const uri = info.preferredURI;
  // من غير javascript: ولا file: ولا صفحات المتصفح نفسه، عشان الصفحة ماتفتحش حاجة أعلى من صلاحياتها.
  if (!uri || (!uri.schemeIs("http") && !uri.schemeIs("https"))) {
    return;
  }
  const win = browserWindow(browser);
  if (win && browser) {
    win.openTrustedLinkIn(uri.spec, "current", { targetBrowser: browser });
  }
}

/** نافذة التاب اللي الصفحة فيه (context.xulBrowser). Firefox 158 غيّر اسم ownerGlobal لـ documentGlobal. */
function browserWindow(browser) {
  return browser?.documentGlobal ?? browser?.ownerGlobal ?? browser?.ownerDocument?.defaultView ?? Services.wm.getMostRecentBrowserWindow();
}

/** الـ workspace اللي نافذة الصفحة فيها (KivoWorkspaces): لونها بيبقى لون الصفحة بدل لون الـ profile. */
function windowWorkspace(browser) {
  const win = browserWindow(browser);
  return /^#[0-9a-f]{6}$/i.test(win?.kivoWorkspaceColor ?? "") ? { name: String(win.kivoWorkspaceName ?? ""), color: win.kivoWorkspaceColor } : null;
}

const REFRESH_TOPIC = "kivo-pages-refresh";

/**
 * الصفحات اللي في نافذة لازم تقرا تاني (لون الـ workspace اتغير مثلًا). subject هو النافذة، أو null لكل النوافذ.
 * getBrowser دالة لأن التاب ممكن يتنقل لنافذة تانية.
 */
export function onRefresh(getBrowser, callback) {
  const observer = subject => {
    if (!subject || browserWindow(getBrowser()) === subject) {
      callback();
    }
  };
  Services.obs.addObserver(observer, REFRESH_TOPIC);
  return () => Services.obs.removeObserver(observer, REFRESH_TOPIC);
}

// ---------- السجل (G5) ----------
// صفحة History بتاعة Kivo (web/ui/src/History.vue) بدل نافذة المكتبة. زيارة زيارة زي Chrome، من قاعدة بيانات Firefox.

// زيارات مش من الولد: مدمجة في صفحة، وتحميل، و frame، وإعادة تحميل (nsINavHistoryService.TRANSITION_*).
const HIDDEN_VISITS = "0, 4, 7, 8, 9";

async function historyQuery(payload) {
  const limit = isInt(payload.limit, 1, 500) ? payload.limit : 100;
  const text = typeof payload.text === "string" ? payload.text.trim().slice(0, 200) : "";
  const before = Number.isFinite(payload.before) && payload.before > 0 ? Math.floor(payload.before) * 1000 : null;
  const db = await lazy.PlacesUtils.promiseDBConnection();
  const pattern = `%${text.replace(/[/%_]/g, "/$&")}%`;
  const rows = await db.executeCached(
    `SELECT v.id, h.url, h.title, v.visit_date
       FROM moz_historyvisits v JOIN moz_places h ON h.id = v.place_id
      WHERE v.visit_type NOT IN (${HIDDEN_VISITS}) AND h.hidden = 0
        AND (:before IS NULL OR v.visit_date < :before)
        AND (:text = '' OR h.url LIKE :pattern ESCAPE '/' OR h.title LIKE :pattern ESCAPE '/')
      ORDER BY v.visit_date DESC
      LIMIT :limit`,
    { before, text, pattern, limit }
  );
  return {
    items: rows
      .map(row => ({
        id: row.getResultByName("id"),
        url: row.getResultByName("url"),
        title: trimText(row.getResultByName("title") ?? "", 200),
        visitedAt: Math.floor(row.getResultByName("visit_date") / 1000),
      }))
      .filter(item => /^https?:/.test(item.url)),
  };
}

async function historyDelete(payload) {
  const ids = Array.isArray(payload.ids) ? payload.ids.filter(id => isInt(id, 1, Number.MAX_SAFE_INTEGER)).slice(0, 500) : [];
  if (!ids.length) {
    return { deleted: 0 };
  }
  const db = await lazy.PlacesUtils.promiseDBConnection();
  const rows = await db.execute(
    `SELECT h.url, v.visit_date FROM moz_historyvisits v JOIN moz_places h ON h.id = v.place_id WHERE v.id IN (${ids.map(Number).join(",")})`
  );
  let deleted = 0;
  for (const row of rows) {
    // الزيارة دي بس: نفس العنوان في نفس الـ millisecond.
    const date = new Date(Math.floor(row.getResultByName("visit_date") / 1000));
    if (await lazy.PlacesUtils.history.removeVisitsByFilter({ url: row.getResultByName("url"), beginDate: date, endDate: date })) {
      deleted++;
    }
  }
  return { deleted };
}

// ---------- التحميلات (G5) ----------
// صفحة Downloads بتاعة Kivo (web/ui/src/Downloads.vue) بدل about:downloads. القايمة الصغيرة تحت السهم بتاعة Firefox.

const downloadIds = new WeakMap();
const downloadsById = new Map();
let nextDownloadId = 1;

function downloadId(download) {
  if (!downloadIds.has(download)) {
    downloadIds.set(download, nextDownloadId);
    downloadsById.set(nextDownloadId, new WeakRef(download));
    nextDownloadId++;
  }
  return downloadIds.get(download);
}

function downloadState(download) {
  if (download.succeeded) {
    return download.target.exists === false ? "missing" : "done";
  }
  if (download.error) {
    return download.error.becauseBlocked ? "blocked" : "failed";
  }
  if (download.canceled) {
    return download.hasPartialData ? "paused" : "canceled";
  }
  return download.stopped ? "canceled" : "downloading";
}

async function downloadsList() {
  const list = await lazy.Downloads.getList(lazy.Downloads.ALL);
  const all = await list.getAll();
  return {
    items: all
      .map(download => ({
        id: downloadId(download),
        name: PathUtils.filename(download.target.path),
        url: download.source.url,
        size: download.totalBytes || download.target.size || 0,
        received: download.currentBytes || 0,
        progress: download.hasProgress ? download.progress : null,
        speed: download.speed || 0,
        state: downloadState(download),
        startedAt: download.startTime ? download.startTime.getTime() : 0,
      }))
      .sort((a, b) => b.startedAt - a.startedAt),
  };
}

function findDownload(payload) {
  const download = downloadsById.get(payload.id)?.deref();
  if (!download) {
    throw new Error("No such download");
  }
  return download;
}

async function downloadAction(type, payload) {
  const download = findDownload(payload);
  switch (type) {
    case "downloads.open":
      await download.launch();
      break;
    case "downloads.show":
      await download.showContainingDirectory();
      break;
    case "downloads.retry":
      download.start().catch(() => {});
      break;
    case "downloads.cancel":
      await download.cancel();
      break;
    case "downloads.remove": {
      // من اللستة بس، والملف بيفضل مكانه.
      const list = await lazy.Downloads.getList(lazy.Downloads.ALL);
      await list.remove(download);
      await download.finalize(false);
      break;
    }
  }
  return downloadsList();
}

// ---------- الرسايل ----------

function systemMode(browser) {
  const win = browserWindow(browser);
  return win?.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** رسالة من الصفحة ورد ليها، زي shared/bridge/README.md. browser هو التاب اللي الصفحة فيه. */
export async function handle(message, browser) {
  const type = message?.type;
  const payload = isObject(message?.payload) ? message.payload : {};
  switch (type) {
    case "bridge.ping":
      return { type: "bridge.pong", replyTo: null, host: "firefox", profile: selectableProfile() ? String(selectableProfile().id) : "default" };
    case "tab.navigate":
      navigate(browser, payload.text);
      return null;
    case "theme.get":
      return { theme: storedTheme(), system: systemMode(browser), workspace: windowWorkspace(browser) };
    case "theme.set": {
      const theme = cleanTheme(payload.theme, true);
      // KivoTheme بيسمع للـ pref، فكل النوافذ بتتلوّن على طول.
      Services.prefs.setStringPref(THEME_PREF, JSON.stringify(theme));
      return { theme };
    }
    case "tiles.get": {
      const tiles = await readJson("start.json");
      return { tiles: tiles === undefined ? null : cleanTiles(tiles) };
    }
    case "tiles.set": {
      const tiles = cleanTiles(payload.tiles);
      await writeJson("start.json", tiles);
      return { tiles };
    }
    case "widgets.get": {
      const widgets = await readJson("widgets.json");
      return { widgets: widgets === undefined ? null : cleanWidgets(widgets) };
    }
    case "widgets.set": {
      const widgets = cleanWidgets(payload.widgets);
      await writeJson("widgets.json", widgets);
      return { widgets };
    }
    case "sites.top": {
      const limit = isInt(payload.limit, 1, 24) ? payload.limit : 8;
      const links = await lazy.NewTabUtils.activityStreamLinks.getTopSites({ numItems: limit, onePerDomain: true, includeFavicon: false });
      return {
        items: links
          .filter(link => /^https?:/.test(link.url))
          .slice(0, limit)
          .map(link => ({ url: link.url, title: trimText(link.title || new URL(link.url).host, 80) })),
      };
    }
    case "profile.get":
      return readProfile();
    case "avatar.set": {
      const avatar = payload.avatar;
      if (avatar?.kind === "emoji" && typeof avatar.emoji === "string" && avatar.emoji.trim() && avatar.emoji.length <= 16) {
        return writeAvatar({ kind: "emoji", emoji: avatar.emoji });
      }
      if (avatar?.kind === "initial") {
        return writeAvatar({ kind: "initial" });
      }
      throw new Error("Invalid avatar");
    }
    case "avatar.pickPhoto": {
      const version = await pickPhoto(browser, "avatar.png", { size: 256, cover: true, type: "image/png" });
      return version === null ? null : writeAvatar({ kind: "photo", version });
    }
    case "background.pickPhoto": {
      const version = await pickPhoto(browser, "background.jpg", { size: 2560, cover: false, type: "image/jpeg" });
      return version === null ? null : { version };
    }
    case "me.get":
      return { url: await meUrl(payload.path) };
    case "history.query":
      return historyQuery(payload);
    case "history.delete":
      return historyDelete(payload);
    case "history.clear":
      await lazy.PlacesUtils.history.clear();
      return {};
    case "downloads.list":
      return downloadsList();
    case "downloads.open":
    case "downloads.show":
    case "downloads.retry":
    case "downloads.cancel":
    case "downloads.remove":
      return downloadAction(type, payload);
    case "downloads.clearDone": {
      const list = await lazy.Downloads.getList(lazy.Downloads.ALL);
      await list.removeFinished();
      return downloadsList();
    }
    case "page.open": {
      // صفحة Kivo من صفحة Kivo (مثلًا "Show in History")، أو صفحة المتصفح دي بس.
      const pages = { history: "history.html", downloads: "downloads.html", clearData: "about:preferences#privacy" };
      const page = pages[payload.page];
      if (page) {
        const url = page.startsWith("about:") ? page : browser?.currentURI?.prePath + "/" + page;
        browserWindow(browser)?.switchToTabHavingURI(url, true);
      }
      return null;
    }
    default:
      throw new Error(`Unsupported request: ${String(type).slice(0, 40)}`);
  }
}
