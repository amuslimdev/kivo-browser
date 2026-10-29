// panel بتاع Kivo في الـ sidebar (KivoSidebar.sys.mjs): chatbot زيادة أو أي موقع الولد ضافه. الأداة من العنوان
// (sidebar-web.html?tool=kivochat-gemini)، زي chat.html بتاع Firefox بس من غير ما يغيّر chatbot Firefox ولا النوافذ
// التانية. الـ sidebar بيفتح panel واحد في المرة، فالـ panel بيفتكر آخر صفحة كان فيها في النافذة دي (المحادثة)،
// ولما ترجعله بيفتحها تاني بدل محادثة جديدة.

const { KivoSidebar } = ChromeUtils.importESModule("moz-src:///browser/components/kivo/KivoSidebar.sys.mjs");

const { topChromeWindow } = window.browsingContext;
const tool = new URLSearchParams(location.search).get("tool");
const panel = KivoSidebar.describe(tool);
const home = panel ? new URL(panel.url) : null;

function createBrowser() {
  // نفس اللي chat.js بيعمله، ونفس الـ group: الـ prompts بتاعة الموقع (alert، و "Leave page?") بتظهر على الـ sidebar.
  const browser = document.createXULElement("browser");
  const attributes = {
    disableglobalhistory: "true",
    maychangeremoteness: "true",
    messagemanagergroup: "chatbot-browser",
    nodefaultsrc: "true",
    remote: "true",
    type: "content",
  };
  for (const [name, value] of Object.entries(attributes)) {
    browser.setAttribute(name, value);
  }
  return document.getElementById("browser-container").appendChild(browser);
}

function load(browser, url) {
  browser.fixupAndLoadURIString(url, {
    triggeringPrincipal: Services.scriptSecurityManager.createNullPrincipal({}),
  });
}

/** الصفحة اللي الـ panel فيها، لو على موقعه نفسه (مش صفحة تسجيل الدخول على موقع تاني مثلًا، دي بتبدأ من الأول). */
function remember(browser) {
  const uri = browser.currentURI;
  if (/^https?$/.test(uri?.scheme ?? "") && uri.host === home.host) {
    KivoSidebar.rememberPlace(topChromeWindow, tool, uri.spec);
  }
}

function closeSidebar() {
  const controller = topChromeWindow.SidebarController;
  // زي زرار القفل في باقي الـ panels: في وضع "من غير launcher" الـ panel بيفضل متفتكر.
  controller.hide({ dismissPanel: !controller._state.launcherHiddenWithPanel });
}

/** الاسم واللوجو. لوجو الموقع واسمه بييجوا بعد ما يتضاف بشوية (kivo.sidebar.*). */
function showLook() {
  const current = KivoSidebar.describe(tool);
  if (current) {
    document.title = current.name;
    document.getElementById("title").textContent = current.name;
    document.getElementById("icon").src = current.iconUrl;
  }
}

document.getElementById("close").addEventListener("click", closeSidebar);

if (panel) {
  showLook();
  document.getElementById("switcher").setAttribute("view", panel.commandID);
  Services.prefs.addObserver("kivo.sidebar.", showLook);
  addEventListener("unload", () => Services.prefs.removeObserver("kivo.sidebar.", showLook), { once: true });

  addEventListener("load", () => {
    const browser = createBrowser();
    load(browser, KivoSidebar.place(topChromeWindow, tool) ?? panel.url);
    document.getElementById("reload").addEventListener("click", () => browser.reload());
    addEventListener("SidebarFocused", () => browser.focus());
    // panel تاني هيتفتح مكانه، أو الـ sidebar بيتقفل.
    addEventListener("SidebarWillShow", () => remember(browser));
    addEventListener("pagehide", () => remember(browser));
  });
} else {
  document.getElementById("missing").hidden = false;
  document.getElementById("reload").hidden = true;
}
