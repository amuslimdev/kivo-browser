// زرار الـ profile بتاع Kivo (docs/FIREFOX.md، G3): أفاتار الـ profile في شريط الأدوات زي Chrome، وقايمة بشكل Kivo.
// الـ profiles لوكال (الـ selectable profiles بتاعة Firefox، على الجهاز بس). Firefox كان حاطط الـ profiles جوه قايمة
// الحساب جنب "Sign in" و "Sync"، فكانت تبان معتمدة على الحساب، فده المكان الوحيد: زرار الحساب و "Profiles" في القايمة
// الرئيسية متخفيين (profile-menu.css).
// الـ Sync اختياري لكل profile (مرحلة "Kivo يومي"): الـ profile لوكال لحد ما تربطه بحساب Mozilla من هنا، زي حساب جوجل
// في Chrome، وبعدها كلمات السر والـ bookmarks والـ history والتابات على كل أجهزتك، مشفّرة بكلمة سرك.

import { readTheme } from "moz-src:///browser/components/kivo/KivoTheme.sys.mjs";
import { readProfile } from "moz-src:///browser/components/kivo/KivoData.sys.mjs";
import { drawAvatar } from "moz-src:///browser/components/kivo/KivoProfiles.sys.mjs";

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  BrowserWindowTracker: "resource:///modules/BrowserWindowTracker.sys.mjs",
  CustomizableUI: "moz-src:///browser/components/customizableui/CustomizableUI.sys.mjs",
  SelectableProfileService: "resource:///modules/profiles/SelectableProfileService.sys.mjs",
  UIState: "resource://services-sync/UIState.sys.mjs",
});

const XHTML = "http://www.w3.org/1999/xhtml";
const WIDGET = "kivo-profile-button";
const PANEL = "kivo-profile-panel";
// مكان زرار الحساب، مرة واحدة. بعد كده مكانه زي ما الولد يحب (تخصيص الأدوات).
const PLACED_PREF = "kivo.profiles.buttonPlaced";
// Kivo Home (G2) على Make it yours (#customize في NewTab.vue).
const CUSTOMIZE = "moz-extension://9d4b610d-d083-4703-8d31-c7178f7ba2e8/index.html#customize";
// صورة "Create a new profile" (العبقري الصغير بلبس الفضاء، docs/MASCOT.md).
const NEW_PROFILE_PICTURE = "chrome://browser/content/profiles/assets/kit-profiles-light.svg";

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

// ---------- الأفاتار ----------

let drawn = null;

/**
 * صورة الـ profile الحالي: الأفاتار اللي KivoProfiles بيرسمه في الـ profiles بتاعة Firefox، أو نفس الرسمة هنا لو
 * لسه مفيش غير profile واحد من غير قاعدة بيانات.
 */
async function currentAvatar() {
  const profile = lazy.SelectableProfileService.currentProfile;
  if (profile?.hasCustomAvatar) {
    return PathUtils.toFileURI(profile.getAvatarPath());
  }
  const kivo = await readProfile();
  const theme = readTheme();
  const key = JSON.stringify([kivo.avatar, kivo.name, theme.accent, theme.font]);
  if (drawn?.key !== key) {
    const file = await drawAvatar(kivo, theme);
    if (!file) {
      return drawn?.url ?? "";
    }
    if (drawn) {
      URL.revokeObjectURL(drawn.url);
    }
    drawn = { key, url: URL.createObjectURL(file) };
  }
  return drawn.url;
}

/** profile تاني: أفاتاره من Kivo (لو اتفتح قبل كده)، أو أيقونة Firefox بلونه. */
function avatarOf(doc, profile, size) {
  if (profile.hasCustomAvatar) {
    return html(doc, "img", { class: "kivo-pm-avatar", alt: "", src: PathUtils.toFileURI(profile.getAvatarPath()) });
  }
  const { themeBg, themeFg } = profile.theme;
  return html(doc, "img", {
    class: "kivo-pm-avatar",
    alt: "",
    src: profile.getAvatarPath(size),
    style: { fill: themeBg, stroke: themeFg },
  });
}

// ---------- الزرار ----------

async function updateWindow(win) {
  const button = win.document.getElementById(WIDGET)?.querySelector(".kivo-pm-button");
  if (!button) {
    return;
  }
  const [url, kivo] = await Promise.all([currentAvatar(), readProfile()]);
  if (win.closed) {
    return;
  }
  const img = button.querySelector("img") ?? button.appendChild(html(win.document, "img", { alt: "" }));
  if (url) {
    img.src = url;
  }
  button.setAttribute("aria-label", `${kivo.name}: profiles`);
  button.setAttribute("title", kivo.name);
}

function refreshAll() {
  for (const win of lazy.BrowserWindowTracker.orderedWindows) {
    updateWindow(win).catch(console.error);
    if (win.document.getElementById(PANEL)?.state === "open") {
      render(win).catch(console.error);
    }
  }
}

function createWidget() {
  if (lazy.CustomizableUI.getWidget(WIDGET)?.provider === lazy.CustomizableUI.PROVIDER_API) {
    return;
  }
  lazy.CustomizableUI.createWidget({
    id: WIDGET,
    type: "custom",
    label: "Profiles",
    tooltiptext: "Profiles",
    defaultArea: lazy.CustomizableUI.AREA_NAVBAR,
    onBuild(doc) {
      const win = doc.defaultView;
      const item = doc.createXULElement("toolbaritem");
      item.id = WIDGET;
      item.className = "chromeclass-toolbar-additional";
      item.setAttribute("label", "Profiles");
      item.setAttribute("removable", "true");
      const button = html(doc, "button", { class: "kivo-pm-button", "aria-haspopup": "dialog" }, [
        html(doc, "img", { alt: "" }),
      ]);
      button.addEventListener("click", () => togglePanel(win, button));
      item.append(button);
      win.setTimeout?.(() => updateWindow(win).catch(console.error), 0);
      return item;
    },
  });
}

/** مكان زرار الحساب، اللي بقى متخفي. */
function placeWidget() {
  if (Services.prefs.getBoolPref(PLACED_PREF, false)) {
    return;
  }
  const { CustomizableUI } = lazy;
  const account = CustomizableUI.getPlacementOfWidget("fxa-toolbar-menu-button");
  if (account?.area === CustomizableUI.AREA_NAVBAR) {
    CustomizableUI.addWidgetToArea(WIDGET, CustomizableUI.AREA_NAVBAR, account.position);
    CustomizableUI.removeWidgetFromArea("fxa-toolbar-menu-button");
  } else {
    CustomizableUI.addWidgetToArea(WIDGET, CustomizableUI.AREA_NAVBAR);
  }
  Services.prefs.setBoolPref(PLACED_PREF, true);
}

// ---------- القايمة ----------

function panelFor(win) {
  const doc = win.document;
  let panel = doc.getElementById(PANEL);
  if (!panel) {
    panel = doc.createXULElement("panel");
    panel.id = PANEL;
    panel.setAttribute("type", "arrow");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Profiles");
    panel.className = "kivo-pm-panel";
    panel.append(html(doc, "div", { class: "kivo-pm" }));
    panel.addEventListener("click", event => onClick(win, event));
    panel.addEventListener("popuphidden", () => {
      doc.getElementById(WIDGET)?.querySelector(".kivo-pm-button")?.removeAttribute("open");
    });
    doc.getElementById("mainPopupSet").append(panel);
  }
  return panel;
}

let profilesById = new Map();

async function render(win) {
  const doc = win.document;
  const body = panelFor(win).querySelector(".kivo-pm");
  const S = lazy.SelectableProfileService;
  const enabled = S.isEnabled;
  const [kivo, url] = await Promise.all([readProfile(), currentAvatar()]);
  const all = enabled && S.initialized ? await S.getAllProfiles() : [];
  const current = S.currentProfile;
  const others = all.filter(profile => profile.id !== current?.id);
  const sync = lazy.UIState.get();
  const synced = sync.status === lazy.UIState.STATUS_SIGNED_IN;
  profilesById = new Map(others.map(profile => [String(profile.id), profile]));

  const children = [
    html(doc, "div", { class: "kivo-pm-me" }, [
      html(doc, "img", { class: "kivo-pm-me-avatar", alt: "", src: url }),
      html(doc, "div", { class: "kivo-pm-name", text: kivo.name }),
      html(doc, "div", { class: "kivo-pm-sub", text: synced ? "Synced with your other devices" : "This is your Kivo, on this computer only" }),
      html(doc, "div", { class: "kivo-pm-actions" }, [
        html(doc, "button", { class: "kivo-pm-look", "data-action": "look", text: "Change my look" }),
        enabled ? html(doc, "button", { class: "kivo-pm-rename", "data-action": "rename", text: "Rename" }) : "",
      ]),
    ]),
    syncBlock(doc, sync),
  ];

  if (others.length) {
    children.push(
      html(doc, "div", { class: "kivo-pm-title", text: "Switch to" }),
      html(
        doc,
        "div",
        { class: "kivo-pm-list", role: "list" },
        others.map(profile =>
          html(doc, "button", { class: "kivo-pm-profile", "data-action": "switch", "data-id": String(profile.id), role: "listitem" }, [
            avatarOf(doc, profile, 48),
            html(doc, "span", { class: "kivo-pm-profile-name", text: profile.name }),
          ])
        )
      )
    );
  } else if (enabled) {
    children.push(
      html(doc, "div", { class: "kivo-pm-promo" }, [
        html(doc, "img", { alt: "", src: NEW_PROFILE_PICTURE }),
        html(doc, "span", { text: "Everyone in the family can have their own Kivo, with their own look, tabs and workspaces." }),
      ])
    );
  }

  if (enabled) {
    children.push(
      html(doc, "button", { class: "kivo-pm-add", "data-action": "add", text: "Add a profile" }),
      html(doc, "button", { class: "kivo-pm-manage", "data-action": "manage", text: "Manage profiles" })
    );
  }
  body.replaceChildren(...children);
}

/** الـ Sync: "Sync this profile" لحد ما تربطه، وبعدها حالته، أو اللي محتاج تعمله لو وقف. */
function syncBlock(doc, sync) {
  const U = lazy.UIState;
  if (sync.status === U.STATUS_SIGNED_IN) {
    // الإيميل في سطر لوحده (ولو طويل بيتقص)، و Sync now تحته، عشان مايلزقش في الكلام.
    return html(doc, "div", { class: "kivo-pm-sync", on: true }, [
      html(doc, "span", { class: "kivo-pm-sync-icon", "aria-hidden": "true" }),
      html(doc, "span", { class: "kivo-pm-sync-text" }, [
        html(doc, "span", { class: "kivo-pm-sync-title", text: "Sync is on" }),
        html(doc, "span", { class: "kivo-pm-sub kivo-pm-sync-email", text: sync.email ?? "", title: sync.email ?? "" }),
        html(doc, "button", { class: "kivo-pm-sync-now", "data-action": "sync-now", text: sync.syncing ? "Syncing…" : "Sync now", disabled: !!sync.syncing }),
      ]),
      html(doc, "button", { class: "kivo-pm-sync-settings", "data-action": "sync-settings", title: "Sync settings", "aria-label": "Sync settings" }),
    ]);
  }
  const problem = sync.status === U.STATUS_LOGIN_FAILED || sync.status === U.STATUS_NOT_VERIFIED;
  return html(doc, "button", { class: "kivo-pm-sync", "data-action": problem ? "sync-settings" : "sync-start", problem }, [
    html(doc, "span", { class: "kivo-pm-sync-icon", "aria-hidden": "true" }),
    html(doc, "span", { class: "kivo-pm-sync-text" }, [
      html(doc, "span", {
        class: "kivo-pm-sync-title",
        text: !problem ? "Sync this profile" : sync.status === U.STATUS_NOT_VERIFIED ? "Confirm your email to start syncing" : "Sign in again to keep syncing",
      }),
      html(doc, "span", {
        class: "kivo-pm-sub",
        text: problem ? (sync.email ?? "") : "Optional. Your passwords, bookmarks, history and tabs on all your devices, with a Mozilla account.",
      }),
    ]),
  ]);
}

function onClick(win, event) {
  const button = event.target.closest?.("button[data-action]");
  if (!button) {
    return;
  }
  const S = lazy.SelectableProfileService;
  panelFor(win).hidePopup();
  switch (button.dataset.action) {
    case "look":
      win.openTrustedLinkIn(CUSTOMIZE, "tab");
      break;
    case "rename":
      win.openTrustedLinkIn("about:editprofile", "tab");
      break;
    case "switch": {
      const profile = profilesById.get(button.dataset.id);
      if (profile) {
        S.launchInstance(profile);
      }
      break;
    }
    case "add":
      S.createNewProfile().catch(console.error);
      break;
    case "manage":
      win.openTrustedLinkIn("about:profilemanager", "tab");
      break;
    case "sync-start":
      win.gSync.openFxAEmailFirstPage("kivo-profile-menu").catch(console.error);
      break;
    case "sync-now":
      win.gSync.doSync();
      break;
    case "sync-settings":
      win.openPreferences("paneSync");
      break;
  }
}

async function togglePanel(win, anchor) {
  const panel = panelFor(win);
  if (panel.state === "open") {
    panel.hidePopup();
    return;
  }
  await render(win);
  anchor.setAttribute("open", "true");
  panel.openPopup(anchor, { position: "bottomright topright" });
}

export const KivoProfileMenu = {
  /** category browser-before-ui-startup. */
  init() {
    // الـ Sync اتربط أو اتفصل أو خلص: القايمة لو مفتوحة بتتحدث.
    Services.obs.addObserver(() => {
      for (const win of lazy.BrowserWindowTracker.orderedWindows) {
        if (win.document.getElementById(PANEL)?.state === "open") {
          render(win).catch(console.error);
        }
      }
    }, lazy.UIState.ON_UPDATE);
    createWidget();
    const ready = () => {
      Services.obs.removeObserver(ready, "browser-delayed-startup-finished");
      placeWidget();
      // أول رسمة للأفاتار محتاجة نافذة.
      refreshAll();
    };
    Services.obs.addObserver(ready, "browser-delayed-startup-finished");
    // اسم أو أفاتار أو لون اتغير، هنا أو في profile تاني.
    Services.obs.addObserver(refreshAll, "sps-profiles-updated");
    Services.obs.addObserver(refreshAll, "kivo-profile-changed");
    Services.prefs.addObserver("kivo.theme", refreshAll);
  },

  togglePanel,
};
