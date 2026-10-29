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
  PrivateBrowsingUtils: "resource://gre/modules/PrivateBrowsingUtils.sys.mjs",
  SelectableProfileService: "resource:///modules/profiles/SelectableProfileService.sys.mjs",
  SessionStore: "moz-src:///browser/components/sessionstore/SessionStore.sys.mjs",
  KivoWorkspaces: "moz-src:///browser/components/kivo/KivoWorkspaces.sys.mjs",
  clearTimeout: "resource://gre/modules/Timer.sys.mjs",
  setTimeout: "resource://gre/modules/Timer.sys.mjs",
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
const GUID = /^[A-Za-z0-9_-]{12}$/;
const guid = value => typeof value === "string" && GUID.test(value);
// قايمة المهام: سطر لكل مهمة، "[ ] " أو "[x] " وبعدها الكلام، و 50 بالكتير (web/ui/src/widgets/tasks.ts).
const TASK = /^\[[ x]\] [^\r\n]{1,200}$/;
const tasks = value => typeof value === "string" && value.length <= 10_500 && (value === "" || (value.split("\n").length <= 50 && value.split("\n").every(line => TASK.test(line))));
const CURRENCY = /^[A-Z]{3}$/;
const currency = value => typeof value === "string" && CURRENCY.test(value);
const feedUrl = value => typeof value === "string" && value.length <= 500 && webUrl(value) !== null;

/** عنوان http أو https من غير اسم ولا باسورد جواه، أو null. */
function webUrl(text, base = undefined) {
  try {
    const url = new URL(text, base);
    return (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
}

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
  continue: { show: oneOf("closed", "recent", "top") },
  bookmarks: { folder: guid },
  tasks: { title: text(40), tasks },
  workspaces: {},
  downloads: {},
  weather: { city: name, unit: oneOf("c", "f") },
  rates: { from: currency, to: currency },
  news: { feed: feedUrl },
  search: { simple: bool },
  hero: {},
  greeting: {},
  shortcuts: { source: oneOf("favorites", "top"), showTitle: bool },
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

// ---------- Saved home presets (per profile) ----------

const HOME_PRESETS_FILE = "home-presets.json";
const HOME_PRESET_ID = /^(original-home|previous-home|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i;

function cleanPresetHome(raw) {
  const base = storedTheme() ?? { version: 1, preset: "clean", mode: "light", accent: "#7964bc", font: "readex", corners: "round", background: { kind: "color", color: "#f5f4f0" }, start: {}, sites: "theme" };
  return cleanTheme({ ...base, home: raw ?? {} }, true).home;
}

function cleanHomePreset(raw, id, createdAt = Date.now()) {
  if (!isObject(raw) || typeof raw.name !== "string" || !Array.isArray(raw.widgets)) throw new Error("Invalid home preset");
  const name = trimText(raw.name, 48);
  if (!name) throw new Error("Give your preset a name.");
  return {
    id, name, home: cleanPresetHome(raw.home),
    widgets: cleanWidgets(raw.widgets).filter(widget => widget.x !== undefined),
    createdAt, updatedAt: Date.now(),
  };
}

async function homePresets(current = null) {
  if (!await IOUtils.exists(kivoPath(HOME_PRESETS_FILE))) {
    const widgets = await readJson("widgets.json") ?? current?.widgets;
    const presets = Array.isArray(widgets)
      ? [cleanHomePreset({ name: "My home", widgets, home: storedTheme()?.home ?? current?.home }, "original-home")]
      : [];
    await writeJson(HOME_PRESETS_FILE, presets);
    return presets;
  }
  const raw = await readJson(HOME_PRESETS_FILE);
  if (!Array.isArray(raw)) throw new Error("Could not read your saved home presets.");
  const ids = new Set();
  return raw.slice(0, 51).map(preset => {
    if (!HOME_PRESET_ID.test(preset?.id) || ids.has(preset.id)) throw new Error("Invalid saved home preset");
    ids.add(preset.id);
    const cleaned = cleanHomePreset(preset, preset.id, preset.createdAt);
    return { ...cleaned, updatedAt: preset.updatedAt };
  });
}

async function saveHomePreset(raw) {
  const presets = await homePresets();
  const existing = presets.find(preset => preset.id === raw?.id);
  if (raw?.id && (!existing || existing.id === "previous-home")) throw new Error("That saved preset is not available.");
  if (!existing && presets.filter(preset => preset.id !== "previous-home").length >= 50) throw new Error("You can save up to 50 home presets.");
  const id = existing?.id ?? Services.uuid.generateUUID().toString().slice(1, -1);
  const preset = cleanHomePreset(raw, id, existing?.createdAt);
  const saved = existing ? presets.map(item => item.id === id ? preset : item) : [...presets, preset];
  await writeJson(HOME_PRESETS_FILE, saved);
  return { presets: saved };
}

async function deleteHomePreset(id) {
  const presets = await homePresets();
  if (!presets.some(preset => preset.id === id)) throw new Error("That saved preset is not available.");
  const saved = presets.filter(preset => preset.id !== id);
  await writeJson(HOME_PRESETS_FILE, saved);
  return { presets: saved };
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

// Draft photos belong to the tab and its Appearance session. Picking or canceling never replaces a saved file.
const appearancePhotos = new WeakMap();

function appearanceSession(payload) {
  if (typeof payload.session !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(payload.session)) {
    throw new Error("Invalid appearance session");
  }
  return payload.session;
}

/** صورة من الجهاز، بنفس طريقة WebView2: الأفاتار 256×256 PNG، والخلفية JPEG أطول ضلع فيها 2560. null لو الولد لغى. */
async function pickPhoto(browser, file, { size, cover, type }, session = null) {
  const win = browserWindow(browser);
  const picker = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
  picker.init(win.browsingContext, "Choose a photo", Ci.nsIFilePicker.modeOpen);
  picker.appendFilters(Ci.nsIFilePicker.filterImages);
  const result = await new Promise(resolve => picker.open(resolve));
  if (result !== Ci.nsIFilePicker.returnOK || !picker.file) {
    return null;
  }

  const bytes = await IOUtils.read(picker.file.path);
  if (bytes.length > 40 * 1024 * 1024) throw new Error("Pick a photo under 40 MB.");
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
  const output = new Uint8Array(await blob.arrayBuffer());
  const version = Date.now();
  if (session) {
    let draft = appearancePhotos.get(browser);
    if (draft?.session !== session) {
      draft = { session, photos: new Map() };
      appearancePhotos.set(browser, draft);
    }
    draft.photos.set(file, { version, bytes: output });
    return { version, url: bytesDataUrl(output, type) };
  }
  await IOUtils.makeDirectory(kivoPath(), { ignoreExisting: true });
  await IOUtils.write(kivoPath(file), output, { tmpPath: kivoPath(`${file}.tmp`) });
  return version;
}

function bytesDataUrl(bytes, mime) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

async function fileDataUrl(file, mime) {
  try {
    const bytes = await IOUtils.read(kivoPath(file));
    return bytesDataUrl(bytes, mime);
  } catch {
    return null;
  }
}

async function saveAppearance(payload, browser, homePreset = false) {
  const session = appearanceSession(payload);
  const theme = cleanTheme(payload.theme, true);
  const current = await readProfile();
  const raw = payload.avatar;
  let avatar;
  if (raw?.kind === "initial") {
    avatar = { kind: "initial" };
  } else if (raw?.kind === "emoji" && typeof raw.emoji === "string" && raw.emoji.trim() && raw.emoji.length <= 16) {
    avatar = { kind: "emoji", emoji: raw.emoji };
  } else if (raw?.kind === "photo" && Number.isSafeInteger(raw.version) && raw.version > 0) {
    avatar = { kind: "photo", version: raw.version };
  } else {
    throw new Error("Invalid avatar");
  }
  const draft = appearancePhotos.get(browser);
  const photos = draft?.session === session ? draft.photos : new Map();
  const writes = new Map();
  for (const [file, selected, existing] of [
    ["avatar.png", avatar, current.avatar],
    ["background.jpg", theme.background, storedTheme()?.background],
  ]) {
    if (selected.kind !== "photo") continue;
    const photo = photos.get(file);
    if (photo?.version === selected.version) {
      writes.set(file, photo.bytes);
    } else if (existing?.kind !== "photo" || existing.version !== selected.version) {
      throw new Error("That photo preview has expired. Choose it again.");
    }
  }
  const profile = (await readJson("profile.json")) ?? {};
  const encode = value => new TextEncoder().encode(JSON.stringify(value));
  writes.set("profile.json", encode({ ...profile, avatar }));
  const widgets = payload.widgets === undefined ? undefined : cleanWidgets(payload.widgets);
  if (widgets) writes.set("widgets.json", encode(widgets));
  if (homePreset) {
    if (!widgets) throw new Error("Missing home layout widgets");
    const presets = await homePresets(payload.previous);
    const previous = cleanHomePreset({
      name: "Previous home", home: storedTheme()?.home ?? payload.previous?.home,
      widgets: await readJson("widgets.json") ?? payload.previous?.widgets ?? [],
    }, "previous-home");
    writes.set(HOME_PRESETS_FILE, encode([...presets.filter(preset => preset.id !== "previous-home"), previous]));
  }
  const originals = new Map();
  for (const file of writes.keys()) {
    originals.set(file, await IOUtils.exists(kivoPath(file)) ? await IOUtils.read(kivoPath(file)) : null);
  }
  const oldTheme = Services.prefs.getStringPref(THEME_PREF, "");
  await IOUtils.makeDirectory(kivoPath(), { ignoreExisting: true });
  try {
    for (const [file, bytes] of writes) {
      await IOUtils.write(kivoPath(file), bytes, { tmpPath: kivoPath(`${file}.tmp`) });
    }
    Services.prefs.setStringPref(THEME_PREF, JSON.stringify(theme));
  } catch (error) {
    for (const [file, bytes] of originals) {
      if (bytes === null) await IOUtils.remove(kivoPath(file), { ignoreAbsent: true });
      else await IOUtils.write(kivoPath(file), bytes, { tmpPath: kivoPath(`${file}.tmp`) });
    }
    if (oldTheme) Services.prefs.setStringPref(THEME_PREF, oldTheme);
    else Services.prefs.clearUserPref(THEME_PREF);
    throw error;
  }
  if (appearancePhotos.get(browser) === draft) appearancePhotos.delete(browser);
  Services.obs.notifyObservers(null, "kivo-profile-changed");
  return { theme, profile: await readProfile(), ...(widgets ? { widgets } : {}) };
}

let appearanceSaveQueue = Promise.resolve();

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

// ---------- كمّل من مكانك ----------
// widget الـ continue: التابات اللي اتقفلت زي "Recently closed" في Firefox View، وآخر الصفحات اللي اتفتحت.

const WORKSPACE_KEY = "kivo-workspace";
// صفحات الويب بس في الاستعلامات. Sqlite.sys.mjs بيرفض LIKE بنص ثابت، فالأنماط bindings.
const WEB = { http: "http://%", https: "https://%" };

/**
 * الأحدث الأول. تابات نافذة workspace اتقفلت مش منهم: دي لسه محفوظة في الـ workspace نفسها (KivoWorkspaces).
 * والنافذة الخاصة تاباتها بس، لأن التاب مايتنقلش بين الخاص والعادي.
 * من Firefox 159 النافذة لازم تتبعت { sourceWindow }: النافذة لوحدها بقت بتتجاهل، والقايمة كانت بترجع فاضية.
 */
function closedTabs(win) {
  const tabs = lazy.SessionStore.getClosedTabData({ sourceWindow: win });
  if (!lazy.PrivateBrowsingUtils.isWindowPrivate(win) && Services.prefs.getBoolPref("browser.sessionstore.closedTabsFromClosedWindows", true)) {
    const workspaces = new Set(lazy.SessionStore.getClosedWindowData().filter(w => w.extData?.[WORKSPACE_KEY]).map(w => w.closedId));
    tabs.push(...lazy.SessionStore.getClosedTabDataFromClosedWindows().filter(tab => !workspaces.has(tab.sourceClosedId)));
  }
  return tabs.sort((a, b) => b.closedAt - a.closedAt);
}

/** الصفحة اللي كان التاب واقف عليها. */
function closedTabUrl(tab) {
  const entries = tab.state?.entries ?? [];
  const index = Math.min(Math.max((tab.state?.index ?? entries.length) - 1, 0), entries.length - 1);
  return entries[index]?.url ?? "";
}

function sessionsClosed(browser, payload) {
  const limit = isInt(payload.limit, 1, 50) ? payload.limit : 20;
  const items = [];
  for (const tab of closedTabs(browserWindow(browser))) {
    const url = closedTabUrl(tab);
    // صفحة البداية نفسها وصفحات المتصفح مش منهم.
    if (!/^https?:/.test(url)) {
      continue;
    }
    items.push({ id: tab.closedId, url, title: trimText(tab.title || url, 200), closedAt: tab.closedAt });
    if (items.length === limit) {
      break;
    }
  }
  return { items };
}

/**
 * التاب بيرجع زي ما كان، بالـ back والـ forward بتوعه. لو صفحة البداية في تاب جديد فاضي، التاب ده نفسه بيبقى اللي
 * اتقفل (زي Ctrl+Shift+T من تاب فاضي، من غير تاب زيادة)، وإلا بيفتح في تاب جديد.
 */
function sessionsReopen(browser, payload) {
  const win = browserWindow(browser);
  const closed = isInt(payload.id, 0, Number.MAX_SAFE_INTEGER) ? closedTabs(win).find(tab => tab.closedId === payload.id) : null;
  if (!closed) {
    throw new Error("No such closed tab");
  }
  const source = closed.sourceClosedId === undefined ? {} : { sourceClosedId: closed.sourceClosedId };
  const home = win.gBrowser?.getTabForBrowser(browser);
  const fresh = home && !home.pinned && !browser.canGoBack && !browser.canGoForward;
  if (fresh && !closed.state.pinned && (closed.state.userContextId ?? 0) === home.userContextId) {
    lazy.SessionStore.setTabState(home, closed.state);
    lazy.SessionStore.forgetClosedTabById(closed.closedId, source);
  } else if (closed.sourceClosedId === undefined) {
    lazy.SessionStore.undoCloseById(closed.closedId, false, win);
  } else {
    lazy.SessionStore.undoClosedTabFromClosedWindow(source, closed.closedId, win);
  }
  return null;
}

/** آخر الصفحات اللي اتفتحت في آخر 30 يوم، كل صفحة مرة واحدة بآخر زيارة ليها. */
async function sitesRecent(payload) {
  const limit = isInt(payload.limit, 1, 50) ? payload.limit : 20;
  const db = await lazy.PlacesUtils.promiseDBConnection();
  const rows = await db.executeCached(
    `SELECT h.url, h.title, MAX(v.visit_date) AS visited
       FROM moz_historyvisits v JOIN moz_places h ON h.id = v.place_id
      WHERE v.visit_type NOT IN (${HIDDEN_VISITS}) AND h.hidden = 0 AND v.visit_date > :since
        AND (h.url LIKE :http OR h.url LIKE :https)
      GROUP BY h.id
      ORDER BY visited DESC
      LIMIT :limit`,
    { since: (Date.now() - 30 * 86_400_000) * 1000, limit, ...WEB }
  );
  return {
    items: rows.map(row => ({
      url: row.getResultByName("url"),
      title: trimText(row.getResultByName("title") ?? "", 200),
      visitedAt: Math.floor(row.getResultByName("visited") / 1000),
    })),
  };
}

// ---------- فولدر bookmarks ----------
// widget الـ bookmarks بيعرض فولدر واحد. قراية بس: إدارة الـ bookmarks بتفضل مكتبة Firefox.

/** عدد اللينكات اللي الـ widget بيعرضها جوه فولدر: http و https بس، من غير bookmarklets. */
const linksIn = parent => `(SELECT count(*) FROM moz_bookmarks c JOIN moz_places p ON p.id = c.fk
              WHERE c.parent = ${parent} AND c.type = 1 AND (p.url LIKE :http OR p.url LIKE :https))`;

function folderTitle(guid, title) {
  return trimText(lazy.PlacesUtils.bookmarks.getLocalizedTitle({ guid, title: title ?? "" }) || "Untitled folder", 80);
}

/** كل الفولدرات للاختيار، بالترتيب اللي في المكتبة: الـ toolbar الأول، والـ mobile لو فيه حاجة بس. */
async function bookmarkFolders() {
  const db = await lazy.PlacesUtils.promiseDBConnection();
  const rows = await db.executeCached(
    `WITH RECURSIVE tree(id, guid, title, depth, path) AS (
       SELECT id, guid, title, 0,
              CASE guid WHEN 'toolbar_____' THEN '0' WHEN 'menu________' THEN '1' WHEN 'unfiled_____' THEN '2' ELSE '3' END
         FROM moz_bookmarks WHERE guid IN ('toolbar_____', 'menu________', 'unfiled_____', 'mobile______')
       UNION ALL
       SELECT b.id, b.guid, b.title, t.depth + 1, t.path || '/' || printf('%06d', b.position)
         FROM moz_bookmarks b JOIN tree t ON b.parent = t.id
        WHERE b.type = 2 AND t.depth < 8
     )
     SELECT guid, title, depth,
            ${linksIn("tree.id")} AS links,
            (SELECT count(*) FROM moz_bookmarks c WHERE c.parent = tree.id) AS children
       FROM tree ORDER BY path LIMIT 500`,
    WEB
  );
  return {
    items: rows
      .filter(row => row.getResultByName("guid") !== "mobile______" || row.getResultByName("children") > 0)
      .map(row => ({
        id: row.getResultByName("guid"),
        title: folderTitle(row.getResultByName("guid"), row.getResultByName("title")),
        depth: row.getResultByName("depth"),
        count: row.getResultByName("links"),
      })),
  };
}

/** اللي جوه فولدر بترتيبه: لينكات http و https، وفولدرات. من غير الـ tags، ولا bookmarklets. */
async function bookmarkFolder(payload) {
  const db = await lazy.PlacesUtils.promiseDBConnection();
  const [folder] = await db.executeCached(
    `SELECT id, guid, title FROM moz_bookmarks
      WHERE guid = :guid AND type = 2 AND guid NOT IN ('root________', 'tags________')
        AND parent <> (SELECT id FROM moz_bookmarks WHERE guid = 'tags________')`,
    { guid: guid(payload.id) ? payload.id : "toolbar_____" }
  );
  if (!folder) {
    throw new Error("No such folder");
  }
  const rows = await db.executeCached(
    `SELECT b.guid, b.type, b.title, h.url,
            ${linksIn("b.id")} AS links
       FROM moz_bookmarks b LEFT JOIN moz_places h ON h.id = b.fk
      WHERE b.parent = :id AND b.type IN (1, 2)
      ORDER BY b.position LIMIT 200`,
    { id: folder.getResultByName("id"), ...WEB }
  );
  const items = [];
  for (const row of rows) {
    if (row.getResultByName("type") === 2) {
      items.push({ kind: "folder", id: row.getResultByName("guid"), title: folderTitle(row.getResultByName("guid"), row.getResultByName("title")), count: row.getResultByName("links") });
    } else if (/^https?:/.test(row.getResultByName("url") ?? "")) {
      items.push({ kind: "link", url: row.getResultByName("url"), title: trimText(row.getResultByName("title") ?? "", 200) });
    }
  }
  return { id: folder.getResultByName("guid"), title: folderTitle(folder.getResultByName("guid"), folder.getResultByName("title")), items };
}

// ---------- الـ workspaces ----------
// widget الـ workspaces: نفس اللي في قايمة الـ workspaces (KivoWorkspaces)، ودوسة بتفتح الـ workspace أو بتروح لنافذتها.

const WORKSPACE_ID = /^[a-z0-9]{6,24}$/;

async function workspacesList(browser) {
  const here = browserWindow(browser)?.kivoWorkspaceId;
  const list = await lazy.KivoWorkspaces.list();
  return { items: list.map(ws => ({ id: ws.id, name: ws.name, color: ws.color, tabs: ws.tabs, open: ws.here, current: ws.id === here })) };
}

/** قايمة الـ workspaces نفسها، من زرارها في النافذة دي (لو الولد ماشالوش من الأدوات). */
function workspacesManage(browser) {
  const win = browserWindow(browser);
  const button = win?.document.querySelector("#kivo-workspaces-button .kivo-ws-button");
  if (button?.checkVisibility()) {
    lazy.KivoWorkspaces.togglePanel(win, button);
  }
}

// ---------- من النت ----------
// widgets الطقس والعملات والأخبار. الصفحة مابتطلبش من النت بنفسها: الـ host بيطلب عناوين معروفة بس (والـ feed اللي
// الولد كتبه)، من غير cookies، وبيرجّع قيم متنضفة مش الرد نفسه. وكل رد بيفضل في الذاكرة شوية، فالتاب الجديد
// مابيطلبش تاني. العناوين من prefs عشان الاختبار يدّي سيرفر محلي (widgets-check.mjs).

const WEATHER_PREF = "kivo.widgets.weatherUrl";
const RATES_PREF = "kivo.widgets.ratesUrls";
const WEATHER_URL = "https://api.open-meteo.com/v1/forecast";
// fawazahmed0/exchange-api (CC0، من غير مفتاح): jsDelivr، والتاني لو الأول وقع. {date} هو latest أو YYYY-MM-DD.
const RATES_URLS = "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@{date}/v1/currencies/{base}.json https://{date}.currency-api.pages.dev/v1/currencies/{base}.json";
const MAX_BYTES = 3_000_000;
const MAX_CACHED = 60;

const netCache = new Map();

/** نفس المفتاح في الوقت ده بيرجع نفس الرد (حتى لو لسه جاي). الغلط مابيتحفظش. */
function cached(key, ttl, load) {
  const hit = netCache.get(key);
  if (hit && Date.now() - hit.at < ttl) {
    return hit.value;
  }
  const value = load().catch(e => {
    netCache.delete(key);
    throw e;
  });
  netCache.set(key, { at: Date.now(), value });
  if (netCache.size > MAX_CACHED) {
    netCache.delete(netCache.keys().next().value);
  }
  return value;
}

/** نص الرد، في 10 ثواني و 3 MB بالكتير، من غير cookies. */
async function download(url, accept) {
  const controller = new AbortController();
  const timer = lazy.setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(url, { credentials: "omit", referrerPolicy: "no-referrer", headers: { Accept: accept }, signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    if (Number(response.headers.get("content-length")) > MAX_BYTES) {
      throw new Error("Too big");
    }
    const body = await response.text();
    if (body.length > MAX_BYTES) {
      throw new Error("Too big");
    }
    return { body, url: response.url || url };
  } catch (e) {
    throw new Error(e?.name === "AbortError" ? "Timed out" : String(e?.message ?? e));
  } finally {
    lazy.clearTimeout(timer);
  }
}

const finite = value => (Number.isFinite(value) ? value : null);
const round1 = value => (Number.isFinite(value) ? Math.round(value * 10) / 10 : null);

/** الجو دلوقتي والأيام الجاية، بالـ WMO codes بتاعة Open-Meteo. الإحداثيات بتتقرّب لحد 2 بعد العلامة. */
function weatherGet(payload) {
  const lat = Number(payload.lat);
  const lon = Number(payload.lon);
  if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) {
    throw new Error("Invalid place");
  }
  const unit = payload.unit === "f" ? "f" : "c";
  const query = new URLSearchParams({
    latitude: lat.toFixed(2),
    longitude: lon.toFixed(2),
    current: "temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,is_day,wind_speed_10m",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
    timezone: "auto",
    forecast_days: "6",
    temperature_unit: unit === "f" ? "fahrenheit" : "celsius",
    wind_speed_unit: unit === "f" ? "mph" : "kmh",
  });
  const base = Services.prefs.getStringPref(WEATHER_PREF, WEATHER_URL);
  return cached(`weather ${query}`, 20 * 60_000, async () => {
    const data = JSON.parse((await download(`${base}?${query}`, "application/json")).body);
    const current = data.current ?? {};
    const daily = data.daily ?? {};
    const days = (Array.isArray(daily.time) ? daily.time : []).slice(0, 6).map((date, i) => ({
      date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "",
      code: Number.isInteger(daily.weather_code?.[i]) ? daily.weather_code[i] : null,
      max: round1(daily.temperature_2m_max?.[i]),
      min: round1(daily.temperature_2m_min?.[i]),
      rain: finite(daily.precipitation_probability_max?.[i]),
    }));
    if (!Number.isFinite(current.temperature_2m)) {
      throw new Error("No weather for this place");
    }
    return {
      unit,
      current: {
        temp: round1(current.temperature_2m),
        feels: round1(current.apparent_temperature),
        humidity: finite(current.relative_humidity_2m),
        wind: round1(current.wind_speed_10m),
        code: Number.isInteger(current.weather_code) ? current.weather_code : null,
        day: current.is_day !== 0,
      },
      days,
      updatedAt: Date.now(),
    };
  });
}

/** أسعار كل العملات قصاد base في يوم (latest أو YYYY-MM-DD)، من أول عنوان يرد. */
async function ratesOn(base, date) {
  const urls = Services.prefs.getStringPref(RATES_PREF, RATES_URLS).split(/\s+/).filter(Boolean);
  let error = null;
  for (const template of urls) {
    try {
      const url = template.replaceAll("{date}", date).replaceAll("{base}", base.toLowerCase());
      const data = JSON.parse((await download(url, "application/json")).body);
      const table = data?.[base.toLowerCase()];
      if (!isObject(table) || !/^\d{4}-\d{2}-\d{2}$/.test(data.date ?? "")) {
        throw new Error("Not a rates table");
      }
      const rates = {};
      for (const [code, rate] of Object.entries(table)) {
        if (/^[a-z]{3}$/.test(code) && Number.isFinite(rate) && rate > 0) {
          rates[code.toUpperCase()] = rate;
        }
      }
      return { date: data.date, rates };
    } catch (e) {
      error = e;
    }
  }
  throw error ?? new Error("No rates");
}

/** النهارده وامبارح، عشان الـ widget يقول السعر طلع ولا نزل. امبارح لو مارجعش بيبقى null. */
function ratesGet(payload) {
  const base = currency(payload.base) ? payload.base : "USD";
  return cached(`rates ${base}`, 3 * 3_600_000, async () => {
    const today = await ratesOn(base, "latest");
    const day = new Date(`${today.date}T12:00:00Z`);
    day.setUTCDate(day.getUTCDate() - 1);
    const before = await ratesOn(base, day.toISOString().slice(0, 10)).catch(() => null);
    return { base, date: today.date, rates: today.rates, previous: before?.rates ?? null, updatedAt: Date.now() };
  });
}

const childNamed = (el, name) => [...(el?.children ?? [])].find(c => c.localName === name) ?? null;
// العناوين ساعات فيها HTML جوه CDATA: الكلام بس.
const plain = (text, max) => trimText(String(text ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " "), max);

/** RSS 2.0 و RSS 1.0 و Atom: العنوان، وموقعه، وأول 30 خبر (عنوان ولينك http أو https وتاريخ). */
function parseFeed(xml, from) {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const root = doc.documentElement;
  if (!root || root.localName === "parsererror" || doc.getElementsByTagName("parsererror").length) {
    return null;
  }
  const channel = childNamed(root, "channel") ?? root;
  const linkOf = el => {
    const links = [...el.children].filter(c => c.localName === "link");
    const atom = links.find(l => l.getAttribute("href") && (!l.getAttribute("rel") || l.getAttribute("rel") === "alternate"));
    const href = atom?.getAttribute("href") ?? links.find(l => !l.getAttribute("href"))?.textContent?.trim() ?? childNamed(el, "guid")?.textContent?.trim();
    return href ? webUrl(href, from)?.href ?? null : null;
  };
  const dateOf = el => {
    for (const name of ["pubDate", "published", "updated", "date"]) {
      const time = Date.parse(childNamed(el, name)?.textContent?.trim() ?? "");
      if (Number.isFinite(time)) {
        return time;
      }
    }
    return null;
  };
  const entries = [...root.getElementsByTagNameNS("*", "item"), ...root.getElementsByTagNameNS("*", "entry")];
  if (!["rss", "RDF", "feed"].includes(root.localName)) {
    return null;
  }
  const items = [];
  for (const entry of entries) {
    const url = linkOf(entry);
    const title = plain(childNamed(entry, "title")?.textContent, 200);
    if (url && title) {
      items.push({ title, url, date: dateOf(entry) });
    }
    if (items.length === 30) {
      break;
    }
  }
  return { title: plain(childNamed(channel, "title")?.textContent, 80), site: linkOf(channel), items };
}

/** الـ feed، أو لو العنوان صفحة عادية الـ feed اللي بتعلن عنه (<link rel="alternate" type="application/rss+xml">). */
function feedGet(payload) {
  const url = typeof payload.url === "string" && payload.url.length <= 500 ? webUrl(payload.url) : null;
  if (!url) {
    throw new Error("Not a web address");
  }
  return cached(`feed ${url.href}`, 30 * 60_000, async () => {
    const accept = "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, text/html;q=0.5";
    const first = await download(url.href, accept);
    let feed = parseFeed(first.body, first.url);
    if (!feed) {
      const html = new DOMParser().parseFromString(first.body, "text/html");
      const link = [...html.querySelectorAll('link[rel~="alternate"][href]')].find(l => /(rss|atom)\+xml/.test(l.getAttribute("type") ?? ""));
      const found = link ? webUrl(link.getAttribute("href"), first.url) : null;
      if (found) {
        const second = await download(found.href, accept);
        feed = parseFeed(second.body, second.url);
      }
    }
    if (!feed) {
      throw new Error("No news feed at this address");
    }
    return { ...feed, title: feed.title || url.host, site: feed.site ?? url.origin, updatedAt: Date.now() };
  });
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
    case "appearance.save": {
      const saved = appearanceSaveQueue.then(() => saveAppearance(payload, browser));
      appearanceSaveQueue = saved.catch(() => {});
      return saved;
    }
    case "homePresets.list":
    case "homePresets.save":
    case "homePresets.delete":
    case "homePresets.apply": {
      const saved = appearanceSaveQueue.then(async () => {
        if (type === "homePresets.list") return { presets: await homePresets(payload.current) };
        if (type === "homePresets.save") return saveHomePreset(payload.preset);
        if (type === "homePresets.delete") return deleteHomePreset(payload.id);
        return saveAppearance(payload, browser, true);
      });
      appearanceSaveQueue = saved.catch(() => {});
      return saved;
    }
    case "appearance.cancel": {
      const session = appearanceSession(payload);
      if (appearancePhotos.get(browser)?.session === session) appearancePhotos.delete(browser);
      return null;
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
      if (payload.preview === true) {
        return pickPhoto(browser, "avatar.png", { size: 256, cover: true, type: "image/png" }, appearanceSession(payload));
      }
      const version = await pickPhoto(browser, "avatar.png", { size: 256, cover: true, type: "image/png" });
      return version === null ? null : writeAvatar({ kind: "photo", version });
    }
    case "background.pickPhoto": {
      if (payload.preview === true) {
        return pickPhoto(browser, "background.jpg", { size: 2560, cover: false, type: "image/jpeg" }, appearanceSession(payload));
      }
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
    case "sessions.closed":
      return sessionsClosed(browser, payload);
    case "sessions.reopen":
      return sessionsReopen(browser, payload);
    case "sites.recent":
      return sitesRecent(payload);
    case "bookmarks.folders":
      return bookmarkFolders();
    case "bookmarks.folder":
      return bookmarkFolder(payload);
    case "workspaces.list":
      return workspacesList(browser);
    case "workspaces.open":
      if (typeof payload.id !== "string" || !WORKSPACE_ID.test(payload.id)) {
        throw new Error("No such workspace");
      }
      await lazy.KivoWorkspaces.open(payload.id, browserWindow(browser));
      return null;
    case "workspaces.manage":
      workspacesManage(browser);
      return null;
    case "weather.get":
      return weatherGet(payload);
    case "rates.get":
      return ratesGet(payload);
    case "feed.get":
      return feedGet(payload);
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
