// الـ profiles بتاعة Kivo (docs/FIREFOX.md، G3) مبنية على الـ profiles الجديدة بتاعة Firefox (selectable profiles): نفس
// قاعدة البيانات، وصفحة الاختيار، والقايمة، وكل profile في نافذة لوحده. الملف ده بيخلي اللي Firefox بيعرضه هو بتاع Kivo:
// - اللون: themeBg و themeFg بتوع الـ profile هما لون الثيم واللون اللي بيتقري عليه، بدل ألوان ثيم Firefox. كارت الـ
//   profile في صفحة الاختيار بيتلوّن بيهم. ثيمات Firefox مالهاش دعوة، فـ themeId بيبقى "kivo"، وده كمان بيمنع صفحة
//   الـ profile الجديد إنها تختار ثيم Firefox عشوائي (setRandomTheme بيشتغل بس مع الثيم الافتراضي).
// - الصورة: أفاتار Kivo (حرف، أو emoji، أو صورة) بيترسم PNG مدوّر وبيبقى الـ custom avatar بتاع الـ profile، في صفحة
//   الاختيار والقايمة وأيقونة الـ taskbar.
// - الاسم: أول profile اسمه اسم حساب Windows بدل "Original profile". الاسم بيتغير من صفحة تعديل الـ profile.
// - الهوية: Firefox بيفتح الـ profile التاني بالمحرك نفسه من غير -app، يعني بهوية Firefox (بياناته وقاعدة الـ profiles
//   بتاعته). Kivo.exe بيحط KIVO_APP_FILE، و execProcess بيبعته -app.
// - المسح: زرار المسح على كارت profile تاني في صفحة الاختيار بيمسحه من مكانه، من غير ما يفتحه (onDeleteProfile تحت).
// شكل الصفحات نفسها في kivo/profiles (jar.mn).
//
// Firefox مالوش hooks للحاجات دي، فبنغيّر 4 methods في SelectableProfileService (hook تحت). لو Firefox غيّر أساميهم،
// الـ console بيقول، و tools/profiles-check.mjs بيفشل.

import { DEFAULT_THEME, chromeColors, fontFamily, readTheme } from "moz-src:///browser/components/kivo/KivoTheme.sys.mjs";
import { readProfile, windowsUserName } from "moz-src:///browser/components/kivo/KivoData.sys.mjs";

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  SelectableProfileService: "resource:///modules/profiles/SelectableProfileService.sys.mjs",
});

const KIVO_THEME_ID = "kivo";
const THEME_PREF = "kivo.theme";
// آخر أفاتار اترسم للـ profile ده: { key, avatar }. avatar اسم الملف عند Firefox، عشان لو اتغير من برا يترسم تاني.
const AVATAR_PREF = "kivo.profiles.avatar";
// أول profile اتسمى باسم Windows خلاص. لو اتسمى "Original profile" بعد كده بإيد الولد، يفضل.
const NAMED_PREF = "kivo.profiles.named";
const AVATAR_SIZE = 256;
const EMOJI_FONT = '"Segoe UI Emoji", "Segoe UI Symbol", sans-serif';
const PICKER = "about:profilemanager";
// كلام صفحة المسح بتاعة Firefox (about:deleteprofile).
const PROFILES_L10N = ["branding/brand.ftl", "browser/profiles.ftl"];

function rgbString(hex) {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

/** لون الكارت: لون الثيم، والكلام والخطوط عليه بالأبيض أو الغامق. */
function profileColors(theme = readTheme()) {
  return { themeBg: rgbString(theme.accent), themeFg: rgbString(chromeColors(theme, false).onAccent) };
}

function hook(service) {
  const missing = ["getColorsForDefaultTheme", "updateProfileThemeColors", "insertProfile", "execProcess"].filter(
    name => typeof service[name] !== "function"
  );
  if (missing.length) {
    console.error(`Kivo profiles: SelectableProfileService has no ${missing.join(", ")}`);
    return;
  }
  // ثيمات Firefox مابتغيّرش لون الـ profile. Kivo بيحطه من الثيم بتاعه (sync)، والـ profile الجديد بلون Kivo
  // الافتراضي لحد ما يفتح ويختار شكله.
  service.updateProfileThemeColors = () => {};
  service.getColorsForDefaultTheme = () => profileColors();
  const insertProfile = service.insertProfile.bind(service);
  service.insertProfile = data => insertProfile({ ...data, themeId: KIVO_THEME_ID, ...profileColors(DEFAULT_THEME) });

  // -app لازم يبقى أول argument (nsBrowserApp.cpp). من غير KIVO_APP_FILE (المحرك اتفتح لوحده) زي Firefox.
  const execProcess = service.execProcess.bind(service);
  service.execProcess = args => {
    const app = Services.env.get("KIVO_APP_FILE");
    execProcess(app ? ["-app", app, ...args] : args);
  };
}

async function nameFirstProfile(profile) {
  if (Services.prefs.getBoolPref(NAMED_PREF, false)) {
    return;
  }
  const original = await new Localization(["browser/profiles.ftl"]).formatValue("original-profile-name");
  const name = windowsUserName();
  if (profile.name === original && name) {
    await profile.setNameAsync(name);
  }
  Services.prefs.setBoolPref(NAMED_PREF, true);
}

async function syncColors(profile) {
  const colors = profileColors();
  const { themeId, themeFg, themeBg } = profile.theme;
  if (themeId !== KIVO_THEME_ID || themeFg !== colors.themeFg || themeBg !== colors.themeBg) {
    await profile.setThemeAsync({ themeId: KIVO_THEME_ID, ...colors });
  }
}

/** أفاتار Kivo PNG مدوّر، زي AvatarView.vue: الصورة، أو الـ emoji، أو أول حرف من الاسم على لون الثيم. */
export async function drawAvatar(kivo, theme) {
  const win = Services.wm.getMostRecentBrowserWindow();
  if (!win) {
    return null;
  }
  const canvas = win.document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
  canvas.width = canvas.height = AVATAR_SIZE;
  const context = canvas.getContext("2d");
  const half = AVATAR_SIZE / 2;
  context.beginPath();
  context.arc(half, half, half, 0, 2 * Math.PI);
  context.clip();
  context.fillStyle = theme.accent;
  context.fillRect(0, 0, AVATAR_SIZE, AVATAR_SIZE);

  if (kivo.avatar.kind === "photo") {
    try {
      const bytes = await IOUtils.read(PathUtils.join(PathUtils.profileDir, "kivo", "avatar.png"));
      const bitmap = await win.createImageBitmap(new win.Blob([bytes]));
      context.drawImage(bitmap, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
      bitmap.close();
      return toFile(win, canvas);
    } catch {
      // الصورة مش موجودة: أول حرف بدلها.
    }
  }

  const emoji = kivo.avatar.kind === "emoji";
  const text = emoji ? kivo.avatar.emoji : (kivo.name.trim()[0] ?? "?").toUpperCase();
  const font = emoji ? `${Math.round(AVATAR_SIZE * 0.62)}px ${EMOJI_FONT}` : `700 ${half}px ${fontFamily(theme)}`;
  try {
    // خطوط Kivo في kivo.css على النافذة، بس بتتحمّل لما حاجة تستخدمها.
    await win.document.fonts.load(font, text);
  } catch {}
  context.font = font;
  context.fillStyle = chromeColors(theme, false).onAccent;
  context.textAlign = "center";
  const box = context.measureText(text);
  context.fillText(text, half, half + (box.actualBoundingBoxAscent - box.actualBoundingBoxDescent) / 2);
  return toFile(win, canvas);
}

async function toFile(win, canvas) {
  const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
  return new win.File([blob], "kivo-avatar.png", { type: "image/png" });
}

async function syncAvatar(profile) {
  const theme = readTheme();
  const kivo = await readProfile();
  const initial = kivo.avatar.kind === "initial" ? (kivo.name.trim()[0] ?? "").toUpperCase() : "";
  const key = JSON.stringify([kivo.avatar, initial, theme.accent, kivo.avatar.kind === "initial" ? theme.font : ""]);
  let last = {};
  try {
    last = JSON.parse(Services.prefs.getStringPref(AVATAR_PREF, "{}"));
  } catch {}
  if (last.key === key && last.avatar === profile.avatar && profile.hasCustomAvatar) {
    return;
  }

  const file = await drawAvatar(kivo, theme);
  if (!file) {
    return;
  }
  const old = profile.hasCustomAvatar ? profile.avatar : null;
  const oldPath = old ? profile.getAvatarPath() : null;
  await profile.setAvatar(file);
  Services.prefs.setStringPref(AVATAR_PREF, JSON.stringify({ key, avatar: profile.avatar }));

  // Firefox بيحط كل custom avatar في ملف جديد. القديم بيتمسح لو مفيش profile تاني بيستخدمه (نسخة من الـ profile مثلًا).
  if (old && old !== profile.avatar) {
    const others = await lazy.SelectableProfileService.getAllProfiles();
    if (!others.some(p => p.id !== profile.id && p.avatar === old)) {
      await IOUtils.remove(oldPath, { ignoreAbsent: true });
    }
  }
}

// ---------- المسح من صفحة الاختيار ----------
// Firefox بيمسح الـ profile من جواه بس: زرار المسح على الكارت بيفتح الـ profile ده بصفحة about:deleteprofile (عدد
// النوافذ والتابات والـ bookmarks...)، وتأكيد المسح هناك بيقفله. فالولد بيدوس "Delete" والـ profile بيتفتح. Kivo بيمسح
// الـ profile المقفول من مكانه: تأكيد بكلام صفحة Firefox، وبعدين deleteProfile بتاع Firefox (الفولدرات وقاعدة البيانات).
// الـ profile ده نفسه، أو المفتوح في نافذة، بيفضلوا بصفحة Firefox، لأن مسحهم لازم يقفلهم. وكمان صفحة الاختيار اللي
// بتظهر و Kivo بيفتح، لأن لسه مفيش profile شغال (deleteProfile محتاجه).

/** الـ profile مفتوح في نافذة؟ زي #notifyRunningInstances: الرسالة بتوصل بس لو هو شغال، وبتخليه يقرا قاعدة البيانات تاني. */
function isOpen(profile) {
  try {
    lazy.SelectableProfileService.sendCommandLine(profile.path, ["--profiles-updated"], false);
    return true;
  } catch {
    return false;
  }
}

/** DeleteProfile من كارت في صفحة الاختيار، قبل profile-selector اللي بيفتح الـ profile. */
function onDeleteProfile(event) {
  const S = lazy.SelectableProfileService;
  const profile = event.detail;
  if (!S.currentProfile || !profile || profile.id === S.currentProfile.id || isOpen(profile)) {
    return;
  }
  event.stopImmediatePropagation();
  deleteClosedProfile(event.currentTarget, profile).catch(e => console.error("Kivo profiles:", e));
}

async function deleteClosedProfile(win, profile) {
  const S = lazy.SelectableProfileService;
  const [title, description, ...rest] = await new Localization(PROFILES_L10N).formatValues([
    { id: "delete-profile-header-2", args: { profilename: profile.name } },
    "delete-profile-description",
    "delete-profile-bookmarks",
    "delete-profile-history",
    "delete-profile-autofill",
    "delete-profile-logins",
    "delete-profile-confirm",
    "delete-profile-cancel",
  ]);
  const [confirm, cancel] = rest.splice(-2);
  const P = Services.prompt;
  // Cancel هو الافتراضي، عشان Enter مايمسحش. و useTitle بيخلي السؤال عنوان التأكيد بدل "Kivo".
  const result = await P.asyncConfirmEx(
    win.browsingContext,
    P.MODAL_TYPE_TAB,
    title,
    [description, ...rest.map(item => `• ${item}`)].join("\n"),
    P.BUTTON_POS_0 * P.BUTTON_TITLE_IS_STRING + P.BUTTON_POS_1 * P.BUTTON_TITLE_IS_STRING + P.BUTTON_POS_1_DEFAULT,
    confirm,
    cancel,
    null,
    null,
    false,
    { useTitle: true }
  );
  if (result.get("buttonNumClicked") !== 0) {
    return;
  }
  if (isOpen(profile)) {
    // اتفتح والتأكيد ظاهر: صفحة Firefox جواه.
    S.launchInstance(profile, ["about:deleteprofile"]);
    return;
  }

  const avatar = profile.hasCustomAvatar ? { name: profile.avatar, path: profile.getAvatarPath() } : null;
  // Kivo بيفتح على الـ profile الافتراضي، فلازم مايبقاش اللي هيتمسح.
  await S.setDefaultProfileForGroup();
  await S.deleteProfile(profile);
  const profiles = await S.getAllProfiles();
  // الأفاتار اللي Kivo رسمه (syncAvatar) في فولدر مشترك، ومحدش بيمسحه.
  if (avatar && !profiles.some(p => p.avatar === avatar.name)) {
    await IOUtils.remove(avatar.path, { ignoreAbsent: true });
  }

  // profile-selector بيقرا الـ profiles مرة واحدة، والكارت بياخد صورته أول مرة بس: لستة فاضية الأول، فالكروت بتتعمل
  // من جديد بدل ما كارت ياخد profile التاني بصورة القديم.
  const selector = win.closed ? null : win.document.querySelector("profile-selector");
  if (selector) {
    selector.profiles = [];
    await selector.updateComplete;
    selector.profiles = profiles;
  }
}

function watchPicker() {
  Services.obs.addObserver(doc => {
    if (doc.documentURI === PICKER && doc.defaultView) {
      // capture على النافذة: قبل الـ listener بتاع profile-selector على الـ document.
      doc.defaultView.addEventListener("DeleteProfile", onDeleteProfile, true);
    }
  }, "document-element-inserted");
}

// ---------- الاسم واللون والأفاتار ----------

let queue = Promise.resolve();

/** الاسم واللون والأفاتار بتوع الـ profile ده في قاعدة البيانات، لو اتغيروا. بالدور، عشان التغييرات ماتتداخلش. */
function sync() {
  queue = queue
    .then(async () => {
      const profile = lazy.SelectableProfileService.currentProfile;
      if (!profile) {
        // profile واحد لسه، من غير قاعدة بيانات.
        return;
      }
      // اللون الأول: صفحة الـ profile الجديد بتقرا themeId، ولازم تلاقيه kivo قبل ما تختار ثيم Firefox عشوائي.
      await syncColors(profile);
      await nameFirstProfile(profile);
      if (Services.wm.getMostRecentBrowserWindow()) {
        // الأفاتار بيترسم في نافذة.
        await syncAvatar(profile);
      }
    })
    .catch(e => console.error("Kivo profiles:", e));
  return queue;
}

export const KivoProfiles = {
  /** category browser-before-ui-startup: قبل أول نافذة، عشان أول تحديث لثيم Firefox يلاقي الـ hooks. */
  init() {
    hook(lazy.SelectableProfileService);
    watchPicker();

    // تغييرات من الـ instance ده أو من instance تاني (الاسم من صفحة التعديل مثلًا)، والثيم، والأفاتار من صفحة البداية.
    Services.obs.addObserver(sync, "sps-profiles-updated");
    Services.obs.addObserver(sync, "kivo-profile-changed");
    Services.prefs.addObserver(THEME_PREF, sync);

    // بدري، قبل ما أول نافذة تفتح صفحة الـ profile الجديد. والأفاتار بعد ما النافذة تخلص.
    lazy.SelectableProfileService.init().then(sync);
    const ready = () => {
      Services.obs.removeObserver(ready, "browser-delayed-startup-finished");
      sync();
    };
    Services.obs.addObserver(ready, "browser-delayed-startup-finished");
  },

  sync,
};
