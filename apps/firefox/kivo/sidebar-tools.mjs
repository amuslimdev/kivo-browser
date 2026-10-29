// Customize sidebar (KivoSidebar.sys.mjs): مكان الـ checkboxes بتاعة الأدوات، الأدوات اللي في الـ launcher بس، كل
// واحدة بزرار يشيلها، وبتترتب بالسحب (أو بالأسهم من النقط اللي جنبها). وتحتهم "Add a tool" بقايمة فيها اللي تقدر
// تضيفه: الأدوات اللي لسه مش موجودة، والـ chatbots اللي لسه مش موجودة بلوجوهاتهم، و "Any website…" لأي موقع.
// الأداة بتتضاف في آخر الـ launcher، والـ chatbot والموقع بيتفتحوا على طول عشان تسجّل دخول.
// KivoSidebar بيحمّل الملف ده جوه صفحة Firefox (sidebar-customize.html)، فبيغيّر toolInputTemplate بس، وباقي
// الصفحة (الـ extensions والإعدادات) زي ما هي.

import { html, nothing } from "chrome://global/content/vendor/lit.all.mjs";

const { KivoSidebar } = ChromeUtils.importESModule("moz-src:///browser/components/kivo/KivoSidebar.sys.mjs");
const { GenAI } = ChromeUtils.importESModule("moz-src:///browser/components/genai/GenAI.sys.mjs");

const SHEET = "chrome://browser/content/kivo/sidebar-tools.css";
const MENU = "kivo-sidebar-add-menu";
const FIREFOX_CHAT = "viewGenaiChatSidebar";
const OPEN_TABS = "viewOpenTabsSidebar";
const HOVER_PREVIEW_PREF = "sidebar.openTabsPanel.hoverPreview.enabled";
const ANY_WEBSITE_ICON = "chrome://global/skin/icons/defaultFavicon.svg";

/** اسم الأداة ولوجوها. chatbot Firefox باسم الـ provider بتاعه ولوجوه، زي الـ launcher. */
function describe(page, tool) {
  if (tool.view === FIREFOX_CHAT && GenAI.currentChatProviderInfo.name) {
    const { name, iconUrl } = GenAI.currentChatProviderInfo;
    return { label: name, iconUrl };
  }
  let label = tool.tooltiptext;
  if (!label && tool.l10nId) {
    const [message] = page.fluentStrings.formatMessagesSync([{ id: tool.l10nId }]);
    label = message?.attributes?.find(attr => attr.name === "label")?.value;
  }
  return { label: label || tool.name, iconUrl: tool.iconUrl };
}

/** اللي تقدر تضيفه: الأدوات اللي مابتتكررش لو مش موجودة، وكل chatbot لسه مش موجود، وأي موقع. */
function choices(page, tools) {
  const single = tools
    .filter(tool => tool.disabled && !tool.hidden && !tool.kivoPanel && tool.view !== FIREFOX_CHAT)
    .map(tool => ({ ...describe(page, tool), add: () => KivoSidebar.addTool(tool.name) }));
  const used = KivoSidebar.usedChats();
  const chats = KivoSidebar.providers()
    .filter(provider => !used.has(provider.id))
    .map(provider => ({
      label: provider.name,
      iconUrl: provider.iconUrl,
      add: () => KivoSidebar.addChat(provider.id, page.getWindow()),
    }));
  const site = [{ label: "Any website…", iconUrl: ANY_WEBSITE_ICON, add: () => openSiteForm(page) }];
  return [single, chats, site].filter(group => group.length);
}

/** القايمة في النافذة نفسها (زي قايمة chat.js)، فبتاخد شكل قوايم Kivo (kivo.css). */
function openMenu(page, anchor, groups) {
  const doc = page.getWindow().document;
  let menu = doc.getElementById(MENU);
  if (!menu) {
    menu = doc.getElementById("mainPopupSet").appendChild(doc.createXULElement("menupopup"));
    menu.id = MENU;
    menu.addEventListener("popuphidden", () => menu.kivoAnchor?.setAttribute("aria-expanded", "false"));
  }
  // الزرار بيتعمل من جديد مع كل render، فالقايمة بتفتكر آخر واحد.
  menu.kivoAnchor = anchor;
  menu.replaceChildren();
  groups.forEach((group, i) => {
    if (i) {
      menu.appendChild(doc.createXULElement("menuseparator"));
    }
    for (const choice of group) {
      const item = menu.appendChild(doc.createXULElement("menuitem"));
      item.className = "menuitem-iconic kivo-sidebar-add-item";
      item.setAttribute("label", choice.label);
      item.setAttribute("image", choice.iconUrl);
      item.addEventListener("command", choice.add);
    }
  });
  anchor.setAttribute("aria-expanded", "true");
  menu.openPopup(anchor, "after_start");
}

// ---------- الترتيب ----------
// بالسحب على أي سطر، أو بالأسهم من النقط اللي جنبه. الترتيب هو ترتيب sidebar.main.tools، فالـ launcher بيتغير معاه.

let dragging = null;

function rowsOf(page) {
  return [...page.renderRoot.querySelectorAll(".kivo-tool")];
}

function clearDropMarks(page) {
  for (const row of rowsOf(page)) {
    row.classList.remove("kivo-drop-before", "kivo-drop-after");
  }
}

/** النص التحتاني من السطر يعني بعده. */
function dropsAfter(row, event) {
  const box = row.getBoundingClientRect();
  return event.clientY > box.top + box.height / 2;
}

async function moveAndFocus(page, name, target, after) {
  KivoSidebar.moveTool(name, target, after);
  await page.updateComplete;
  page.renderRoot.querySelector(`.kivo-tool[data-tool="${CSS.escape(name)}"] .kivo-tool-grip`)?.focus();
}

function onGripKey(page, name, event) {
  if (event.key !== "ArrowUp" && event.key !== "ArrowDown") {
    return;
  }
  event.preventDefault();
  const names = rowsOf(page).map(row => row.dataset.tool);
  const index = names.indexOf(name);
  const up = event.key === "ArrowUp";
  const target = names[up ? index - 1 : index + 1];
  if (target) {
    moveAndFocus(page, name, target, !up);
  }
}

const dragHandlers = (page, name) => ({
  start(event) {
    dragging = name;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/x-kivo-sidebar-tool", name);
    event.currentTarget.classList.add("kivo-dragging");
  },
  over(event) {
    if (!dragging || dragging === name) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const after = dropsAfter(event.currentTarget, event);
    clearDropMarks(page);
    event.currentTarget.classList.add(after ? "kivo-drop-after" : "kivo-drop-before");
  },
  leave(event) {
    if (!event.currentTarget.contains(event.relatedTarget)) {
      event.currentTarget.classList.remove("kivo-drop-before", "kivo-drop-after");
    }
  },
  drop(event) {
    event.preventDefault();
    const moved = dragging;
    clearDropMarks(page);
    if (moved && moved !== name) {
      KivoSidebar.moveTool(moved, name, dropsAfter(event.currentTarget, event));
    }
  },
  end(event) {
    dragging = null;
    event.currentTarget.classList.remove("kivo-dragging");
    clearDropMarks(page);
  },
});

function toolRow(page, tool) {
  const { label, iconUrl } = describe(page, tool);
  const drag = dragHandlers(page, tool.name);
  return html`
    <div
      class="kivo-tool"
      data-tool=${tool.name}
      draggable="true"
      @dragstart=${drag.start}
      @dragover=${drag.over}
      @dragleave=${drag.leave}
      @drop=${drag.drop}
      @dragend=${drag.end}
    >
      <span
        class="kivo-tool-grip"
        role="button"
        tabindex="0"
        title="Drag to move, or use the arrow keys"
        aria-label=${`Move ${label}`}
        @keydown=${e => onGripKey(page, tool.name, e)}
      ></span>
      <img class="kivo-tool-icon" src=${iconUrl} role="presentation" draggable="false" />
      <span class="kivo-tool-label text-truncated-ellipsis">${label}</span>
      <moz-button
        class="kivo-tool-remove"
        type="icon ghost"
        size="small"
        iconsrc="chrome://global/skin/icons/close.svg"
        title=${`Remove ${label}`}
        aria-label=${`Remove ${label}`}
        @click=${() => KivoSidebar.removeTool(tool.name)}
      ></moz-button>
    </div>
    ${tool.view === OPEN_TABS
      ? html`
          <moz-checkbox
            class="kivo-tool-option"
            id="hover-preview"
            name="hover-preview"
            data-l10n-id="sidebar-show-preview-on-hover"
            ?checked=${page.hoverPreviewEnabled}
            @change=${e => Services.prefs.setBoolPref(HOVER_PREVIEW_PREF, e.target.checked)}
          ></moz-checkbox>
        `
      : nothing}
  `;
}

// ---------- أي موقع ----------
// خانتين تحت "Add a tool": العنوان، والاسم (اختياري، وإلا من الموقع نفسه). Enter بيضيف و Escape بيقفل.

function openSiteForm(page) {
  page.kivoSite = { error: "" };
  page.requestUpdate();
  page.updateComplete.then(() => page.renderRoot.querySelector(".kivo-site input[name=address]")?.focus());
}

function closeSiteForm(page) {
  page.kivoSite = null;
  page.requestUpdate();
}

function submitSite(page) {
  const form = page.renderRoot.querySelector(".kivo-site");
  const address = form.querySelector("input[name=address]").value;
  const name = form.querySelector("input[name=name]").value;
  const { error } = KivoSidebar.addSite({ address, name }, page.getWindow());
  if (error) {
    page.kivoSite = { error };
    page.requestUpdate();
    return;
  }
  page.kivoSite = null;
  page.requestUpdate();
}

function onSiteKey(page, event) {
  if (event.key === "Enter" && event.target.localName === "input") {
    event.preventDefault();
    submitSite(page);
  } else if (event.key === "Escape") {
    event.preventDefault();
    closeSiteForm(page);
  }
}

function siteForm(page) {
  if (!page.kivoSite) {
    return nothing;
  }
  return html`
    <div class="kivo-site" role="group" aria-label="Add any website" @keydown=${e => onSiteKey(page, e)}>
      <label class="kivo-site-field">
        <span>Address</span>
        <input name="address" type="text" inputmode="url" placeholder="web.whatsapp.com" autocomplete="off" spellcheck="false" />
      </label>
      <label class="kivo-site-field">
        <span>Name</span>
        <input name="name" type="text" placeholder="Optional" maxlength="40" autocomplete="off" />
      </label>
      ${page.kivoSite.error ? html`<p class="kivo-site-error" role="alert">${page.kivoSite.error}</p>` : nothing}
      <div class="kivo-site-buttons">
        <moz-button type="primary" label="Add" @click=${() => submitSite(page)}></moz-button>
        <moz-button label="Cancel" @click=${() => closeSiteForm(page)}></moz-button>
      </div>
    </div>
  `;
}

function addButton(page, tools) {
  const groups = choices(page, tools);
  return html`
    <link rel="stylesheet" href=${SHEET} />
    <moz-button
      class="kivo-add"
      iconsrc="chrome://global/skin/icons/plus.svg"
      label="Add a tool"
      aria-haspopup="menu"
      aria-expanded="false"
      @click=${e => openMenu(page, e.currentTarget, groups)}
    ></moz-button>
    ${siteForm(page)}
  `;
}

await customElements.whenDefined("sidebar-customize");
const Customize = customElements.get("sidebar-customize");
const firefoxTemplate = Customize.prototype.toolInputTemplate;

Customize.prototype.toolInputTemplate = function (tool) {
  // الـ extensions بتفضل checkboxes: كل extension ليها مكان واحد أصلًا.
  if (tool.extensionId) {
    return firefoxTemplate.call(this, tool);
  }
  const tools = this.getWindow().SidebarController.getTools();
  const row = tool.disabled || tool.hidden ? nothing : toolRow(this, tool);
  // render() بتاع Firefox بينادي ده لكل أداة جوه نفس الـ fieldset، فزرار Add بييجي بعد آخر واحدة.
  return tools.at(-1)?.commandID === tool.commandID ? html`${row}${addButton(this, tools)}` : row;
};

// chatbot Firefox بيتغير اسمه ولوجوه مع الـ provider.
const rerender = () => {
  for (const page of document.querySelectorAll("sidebar-customize")) {
    page.requestUpdate();
  }
};
Services.prefs.addObserver("browser.ml.chat.provider", rerender);
addEventListener("unload", () => Services.prefs.removeObserver("browser.ml.chat.provider", rerender), { once: true });
rerender();
