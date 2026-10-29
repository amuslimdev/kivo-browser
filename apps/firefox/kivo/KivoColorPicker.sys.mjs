// منتقي الألوان الوحيد في Kivo، زي Chrome: مربع للتشبع والفتاحة، وقطّارة (eyedropper) بتاخد لون من أي حتة في نافذة
// Kivo، وشريط الدرجات، وخانة كود بتقبل أي لون CSS بالكتابة أو اللصق (hex و rgb() و hsl() و oklch() والأسامي...).
// نفس المنتقي في مكانين:
// - جوه قايمة الـ workspaces (KivoWorkspaces.sys.mjs بينادي create).
// - أي <input type="color"> في Kivo كله: Kivo Home، والمواقع، وصفحات Firefox. Firefox فيه منتقي HTML بيفتح في panel
//   بدل منتقي Windows (ColorPickerParent، بـ dom.forms.html_color_picker.enabled من firefox-branding.js)، و init
//   بيخلي الـ panel ده يعرض المنتقي ده بدل منتقي Firefox. منتقي Windows كان بيقفل قايمة الـ workspace وهو بيفتح،
//   ومالوش قطّارة، وشكله مش Kivo.
// الشكل في color-picker.css، وبيتحمّل في أي نافذة المنتقي بيظهر فيها.

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  ColorPickerParent: "moz-src:///toolkit/actors/ColorPickerParent.sys.mjs",
});

const XHTML = "http://www.w3.org/1999/xhtml";
const SHEET = "chrome://browser/content/kivo/color-picker.css";
const HEX = /^#[0-9a-f]{6}$/;
// القطّارة: الدايرة المكبّرة 11 × 11 نقطة من الشاشة، كل نقطة 10px.
const LOUPE_CELLS = 11;
const LOUPE_CELL = 10;

// ---------- الألوان ----------

function rgb(hex) {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex(r, g, b) {
  const byte = n => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, "0");
  return `#${byte(r)}${byte(g)}${byte(b)}`;
}

/** #rrggbb لـ [درجة 0..360، تشبع 0..1، فتاحة 0..1]. */
function toHsv(hex) {
  const [r, g, b] = rgb(hex).map(c => c / 255);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  const h = !d ? 0 : max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, max ? d / max : 0, max];
}

function fromHsv(h, s, v) {
  const channel = n => {
    const k = (n + h / 60) % 6;
    return (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255;
  };
  return toHex(channel(5), channel(3), channel(1));
}

/**
 * أي لون CSS لـ #rrggbb، أو null لو مش لون: hex بـ 3 و 4 و 6 و 8 أرقام (بـ # أو من غيرها)، و rgb() و rgba() و hsl()
 * و hwb() و lab() و lch() و oklab() و oklch() و color()، والأسامي (red)، وتلات أرقام لوحدهم (255, 0, 0). وبيقبل اللي
 * بيتنسخ من CSS زي "color: #fff;". الشفافية بتتشال، لأن ألوان Kivo مصمتة، والألوان اللي برّه sRGB بتتقرّب لأقرب لون.
 */
function parseColor(text) {
  let value = String(text ?? "")
    .trim()
    .replace(/^[\w-]+\s*:\s*/, "")
    .replace(/[;,\s]+$/, "")
    .replace(/^(["'`])(.*)\1$/, "$2")
    .trim();
  if (!value || value.length > 100) {
    return null;
  }
  if (/^(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value)) {
    value = `#${value}`;
  } else if (/^\d{1,3}(?:\s*[,\s]\s*\d{1,3}){2}$/.test(value)) {
    value = `rgb(${value})`;
  }
  let color = null;
  try {
    color = InspectorUtils.colorToRGBA(value);
  } catch {}
  // transparent (أو أي لون شفاف خالص) مش لون ينفع لحاجة في Kivo.
  return color && color.a > 0 ? toHex(color.r, color.g, color.b) : null;
}

// ---------- المنتقي ----------

function html(doc, tag, props = {}, children = []) {
  const el = doc.createElementNS(XHTML, tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "class") {
      el.className = value;
    } else if (key === "text") {
      el.textContent = value;
    } else if (value !== false && value !== null && value !== undefined) {
      el.setAttribute(key, value === true ? "" : value);
    }
  }
  el.append(...children);
  return el;
}

const styled = new WeakSet();

function ensureSheet(win) {
  if (!styled.has(win)) {
    styled.add(win);
    win.windowUtils.loadSheetUsingURIString(SHEET, win.windowUtils.AUTHOR_SHEET);
  }
}

/**
 * منتقي جديد في doc. onInput(color) بيتنادى مع كل تغيير من المنتقي نفسه، باللون #rrggbb. بيرجّع العنصر، و set(color)
 * لما اللون يتغير من برّه (دايرة من الألوان الجاهزة مثلًا، ومن غير onInput)، و color، و focus().
 */
function create(doc, { color, onInput = () => {} } = {}) {
  const win = doc.defaultView;
  ensureSheet(win);
  const start = HEX.test(color ?? "") ? color : "#7964bc";
  const [h, s, v] = toHsv(start);
  const state = { color: start, h, s, v };

  const sv = html(
    doc,
    "div",
    { class: "kivo-picker-sv", tabindex: "0", role: "group", "aria-label": "Strength and lightness. Arrow keys change them." },
    [html(doc, "span", { class: "kivo-picker-dot" })]
  );
  const eyedropper = html(doc, "button", {
    type: "button",
    class: "kivo-picker-eyedropper",
    title: "Pick a color from the window",
    "aria-label": "Pick a color from the window",
    "aria-pressed": "false",
  });
  const hue = html(doc, "input", { type: "range", class: "kivo-picker-hue", min: "0", max: "359", "aria-label": "Hue" });
  const code = html(doc, "input", {
    type: "text",
    class: "kivo-picker-code",
    maxlength: "100",
    spellcheck: "false",
    placeholder: "Paste any color",
    title: "Type or paste any color: #hex, rgb(), hsl(), oklch(), or a name like red",
    "aria-label": "Color code. Type or paste any color: #hex, rgb(), hsl(), oklch(), or a name like red.",
  });
  const root = html(doc, "div", { class: "kivo-picker" }, [
    sv,
    html(doc, "div", { class: "kivo-picker-row" }, [eyedropper, html(doc, "span", { class: "kivo-picker-preview", "aria-hidden": "true" }), hue]),
    code,
  ]);

  /** بيعرض اللي في state. keepCode: الولد لسه بيكتب في الخانة، فالكلام بتاعه يفضل لحد ما يخلص. */
  const show = ({ keepCode = false } = {}) => {
    root.style.setProperty("--kivo-picker-color", state.color);
    sv.style.setProperty("--kivo-picker-hue", `hsl(${Math.round(state.h)} 100% 50%)`);
    sv.style.setProperty("--x", `${state.s * 100}%`);
    sv.style.setProperty("--y", `${(1 - state.v) * 100}%`);
    hue.value = String(Math.round(state.h));
    if (!keepCode) {
      code.value = state.color;
      code.removeAttribute("aria-invalid");
    }
  };

  const set = (next, { keepCode = false } = {}) => {
    if (!HEX.test(next ?? "")) {
      return;
    }
    const [nh, ns, nv] = toHsv(next);
    // الأبيض والأسود والرمادي مالهمش درجة، فاللي كانت متختارة بتفضل.
    if (ns && nv) {
      state.h = nh;
    }
    state.s = ns;
    state.v = nv;
    state.color = next;
    show({ keepCode });
  };

  const fromState = () => {
    state.color = fromHsv(state.h, state.s, state.v);
    show();
    onInput(state.color);
  };

  // سحب في المربع: يمين أكتر = لون أقوى، وفوق أكتر = أفتح.
  sv.addEventListener("pointerdown", event => {
    if (event.button !== 0) {
      return;
    }
    const clamp = n => Math.min(1, Math.max(0, n));
    const move = e => {
      const r = sv.getBoundingClientRect();
      state.s = clamp((e.clientX - r.left) / r.width);
      state.v = 1 - clamp((e.clientY - r.top) / r.height);
      fromState();
    };
    const up = () => {
      sv.removeEventListener("pointermove", move);
      sv.removeEventListener("pointerup", up);
      sv.removeEventListener("lostpointercapture", up);
    };
    sv.setPointerCapture(event.pointerId);
    sv.addEventListener("pointermove", move);
    sv.addEventListener("pointerup", up);
    sv.addEventListener("lostpointercapture", up);
    sv.focus();
    move(event);
    event.preventDefault();
  });

  sv.addEventListener("keydown", event => {
    const step = { ArrowLeft: [-0.05, 0], ArrowRight: [0.05, 0], ArrowUp: [0, 0.05], ArrowDown: [0, -0.05] }[event.key];
    if (!step) {
      return;
    }
    const clamp = n => Math.min(1, Math.max(0, n));
    state.s = clamp(state.s + step[0]);
    state.v = clamp(state.v + step[1]);
    fromState();
    event.preventDefault();
    event.stopPropagation();
  });

  hue.addEventListener("input", () => {
    state.h = Number(hue.value);
    fromState();
  });

  // أي صيغة: اللون بيتطبق أول ما الكلام يبقى لون. اللصق بيتحوّل للـ hex على طول، والكتابة لما يخلص (change).
  code.addEventListener("input", event => {
    const parsed = parseColor(code.value);
    code.setAttribute("aria-invalid", parsed || !code.value.trim() ? "false" : "true");
    if (!parsed) {
      return;
    }
    set(parsed, { keepCode: !["insertFromPaste", "insertFromDrop"].includes(event.inputType) });
    onInput(parsed);
  });
  code.addEventListener("change", () => show());

  eyedropper.addEventListener("click", async event => {
    if (eyedropper.getAttribute("aria-pressed") === "true") {
      return;
    }
    eyedropper.setAttribute("aria-pressed", "true");
    try {
      // من الكيبورد (مفيش مكان للماوس) الدايرة بتبدأ في نص النافذة.
      const at = event.screenX || event.screenY ? [event.clientX, event.clientY] : null;
      const picked = await pickFromWindow(win, at);
      if (picked && root.isConnected) {
        set(picked);
        onInput(picked);
      }
    } finally {
      eyedropper.setAttribute("aria-pressed", "false");
      // الـ focus على المربع مش على القطّارة، فـ Enter بعدها بيقفل المنتقي باللون بدل ما يفتح القطّارة تاني.
      if (root.isConnected) {
        sv.focus();
      }
    }
  });

  show();
  return {
    element: root,
    set,
    get color() {
      return state.color;
    },
    focus() {
      sv.focus();
    },
  };
}

// ---------- القطّارة ----------

/**
 * لون من أي حتة في النافذة win: الواجهة والصفحة والـ sidebar. صورة للنافذة كلها (drawSnapshot، بالصفحات اللي جوه)،
 * فوقيها panel بنفس مكانها ومقاسها، ودايرة مكبّرة بتمشي مع الماوس وتحتها كود اللون. كليك بياخد اللون، و Escape أو
 * كليك يمين أو كليك برّه النافذة بيلغي. والأسهم بتحرّك نقطة نقطة (و Shift عشرة)، و Enter بياخد.
 * الـ panel فوق القايمة اللي فاتحة المنتقي، فالكليك عليه مابيقفلهاش (Firefox بيقفل القوايم لما تدوس برّه أي واحدة
 * فيهم بس). برّه نافذة Kivo (سطح المكتب وبرامج تانية) مش متاح: Firefox مابيصوّرش الشاشة من غير ما يسأل.
 * at: [x, y] مكان الماوس في النافذة لما القطّارة اتفتحت. بيرجّع #rrggbb، أو null لو اتلغت.
 */
async function pickFromWindow(win, at = null) {
  const doc = win.document;
  const scale = win.devicePixelRatio;
  let bitmap;
  try {
    bitmap = await win.browsingContext.currentWindowGlobal.drawSnapshot(null, scale, "white");
  } catch (e) {
    console.error(e);
    return null;
  }
  ensureSheet(win);
  const source = doc.createElementNS(XHTML, "canvas");
  source.width = bitmap.width;
  source.height = bitmap.height;
  const sourceContext = source.getContext("2d", { willReadFrequently: true });
  sourceContext.drawImage(bitmap, 0, 0);
  bitmap.close();

  const shot = html(doc, "canvas", { class: "kivo-eyedropper-shot", tabindex: "-1" });
  shot.width = source.width;
  shot.height = source.height;
  shot.style.width = `${source.width / scale}px`;
  shot.style.height = `${source.height / scale}px`;
  shot.getContext("2d").drawImage(source, 0, 0);
  const zoom = html(doc, "canvas", { class: "kivo-eyedropper-zoom" });
  zoom.width = zoom.height = Math.round(LOUPE_CELLS * LOUPE_CELL * scale);
  const label = html(doc, "span", { class: "kivo-eyedropper-code" });
  const loupe = html(doc, "div", { class: "kivo-eyedropper-loupe", hidden: true }, [zoom, label]);
  const box = html(doc, "div", { class: "kivo-eyedropper-box" }, [shot, loupe]);
  const panel = doc.createXULElement("panel");
  panel.className = "kivo-eyedropper";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Pick a color: click anywhere in the window, or press Escape to stop");
  panel.append(box);
  (doc.getElementById("mainPopupSet") ?? doc.querySelector("popupset") ?? doc.documentElement).append(panel);

  const width = source.width / scale;
  const height = source.height / scale;
  const clampAt = ([x, y]) => [Math.min(width - 1, Math.max(0, x)), Math.min(height - 1, Math.max(0, y))];
  const pixel = ([x, y]) => [
    Math.min(source.width - 1, Math.max(0, Math.floor(x * scale))),
    Math.min(source.height - 1, Math.max(0, Math.floor(y * scale))),
  ];
  const colorAt = point => {
    const [r, g, b] = sourceContext.getImageData(...pixel(point), 1, 1).data;
    return toHex(r, g, b);
  };

  return new Promise(resolve => {
    let done = false;
    const show = () => {
      const color = colorAt(at);
      const [px, py] = pixel(at);
      const half = Math.floor(LOUPE_CELLS / 2);
      const cell = zoom.width / LOUPE_CELLS;
      const z = zoom.getContext("2d");
      z.imageSmoothingEnabled = false;
      z.fillStyle = "#fff";
      z.fillRect(0, 0, zoom.width, zoom.height);
      z.drawImage(source, px - half, py - half, LOUPE_CELLS, LOUPE_CELLS, 0, 0, zoom.width, zoom.height);
      // النقطة اللي هتتاخد: مربع أبيض حواليه أسود، يبان على أي لون.
      z.lineWidth = Math.max(1, Math.round(scale));
      z.strokeStyle = "#000";
      z.strokeRect(half * cell - z.lineWidth, half * cell - z.lineWidth, cell + 2 * z.lineWidth, cell + 2 * z.lineWidth);
      z.strokeStyle = "#fff";
      z.strokeRect(half * cell, half * cell, cell, cell);
      label.textContent = color;
      loupe.style.setProperty("--kivo-picker-color", color);
      const r = box.getBoundingClientRect();
      loupe.style.transform = `translate(${at[0] - r.left}px, ${at[1] - r.top}px)`;
      loupe.hidden = false;
    };
    const finish = color => {
      if (done) {
        return;
      }
      done = true;
      resolve(color);
      panel.hidePopup();
    };

    panel.addEventListener(
      "popupshown",
      () => {
        // الصورة مكان النافذة بالظبط، حتى لو الـ panel اتزق (لو حتة من النافذة برّه الشاشة مثلًا).
        const r = shot.getBoundingClientRect();
        if (r.left || r.top) {
          const context = shot.getContext("2d");
          context.clearRect(0, 0, shot.width, shot.height);
          context.drawImage(source, -r.left * scale, -r.top * scale);
        }
        shot.focus();
        if (at) {
          at = clampAt(at);
          show();
        }
      },
      { once: true }
    );
    panel.addEventListener(
      "popuphidden",
      () => {
        finish(null);
        panel.remove();
      },
      { once: true }
    );
    shot.addEventListener("mousemove", event => {
      at = clampAt([event.clientX, event.clientY]);
      show();
    });
    shot.addEventListener("click", event => {
      if (event.button === 0) {
        finish(colorAt(clampAt([event.clientX, event.clientY])));
      }
    });
    shot.addEventListener("contextmenu", event => {
      event.preventDefault();
      finish(null);
    });
    panel.addEventListener("keydown", event => {
      const step = event.shiftKey ? 10 : 1;
      const move = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];
      if (move) {
        at = clampAt(at ? [at[0] + move[0], at[1] + move[1]] : [width / 2, height / 2]);
        show();
      } else if (event.key === "Enter" || event.key === " ") {
        if (at) {
          finish(colorAt(at));
        } else {
          at = [width / 2, height / 2];
          show();
        }
      } else if (event.key === "Escape") {
        finish(null);
      } else {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    });
    panel.openPopupAtScreen(win.mozInnerScreenX, win.mozInnerScreenY, false);
  });
}

// ---------- <input type="color"> ----------

/**
 * بدل ColorPickerPanel بتاع Firefox (iframe فيه منتقيه): نفس الـ panel وبنفس الرسايل للصفحة، والمنتقي ده جواه.
 * InputPickerValueChanged مع كل تغيير (الصفحة بتاخد input على طول، و change لما الـ panel يقفل)، و
 * InputPickerValueCleared بيرجّع اللون اللي كان قبل ما المنتقي يفتح (Escape). Enter بيقفل باللون الجديد، وكليك برّه
 * كمان.
 */
class InputPanel {
  #panel;
  #alpha = 1;
  #abort = null;

  constructor(panel) {
    this.#panel = panel;
  }

  /** detail.value من ColorPickerChild: مكونات sRGB من 0 لـ 1، و alpha (NaN لو الـ input مالوش alpha). */
  openPicker(type, rect, detail) {
    const panel = this.#panel;
    const value = detail?.value ?? {};
    this.#alpha = Number.isFinite(value.alpha) ? value.alpha : 1;
    const color = toHex(...[value.component1, value.component2, value.component3].map(c => (c ?? 0) * 255));
    const picker = create(panel.ownerDocument, { color, onInput: next => this.#changed(next) });
    this.#abort = new AbortController();
    const { signal } = this.#abort;
    panel.classList.add("kivo-picker-panel");
    panel.replaceChildren(picker.element);
    // الـ panel بيفتح من غير focus (noautofocus)، فبنحطه في المنتقي عشان الأسهم و Escape و Enter يوصلوله.
    panel.addEventListener("popupshown", () => picker.focus(), { once: true, signal });
    panel.addEventListener("keydown", event => this.#onKey(event), { signal });
    panel.openPopupAtScreenRect("after_start", rect.left, rect.top, rect.width, rect.height, false, false);
  }

  #changed(hex) {
    const [r, g, b] = rgb(hex).map(c => c / 255);
    this.#panel.dispatchEvent(new CustomEvent("InputPickerValueChanged", { detail: { rgb: [r, g, b, this.#alpha] } }));
  }

  #onKey(event) {
    if (event.key === "Escape") {
      this.closePicker(true);
    } else if (event.key === "Enter" && !event.target.closest?.("button")) {
      this.closePicker(false);
    } else {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  }

  closePicker(clear) {
    if (clear) {
      this.#panel.dispatchEvent(new CustomEvent("InputPickerValueCleared"));
    }
    this.#abort?.abort();
    this.#abort = null;
    this.#panel.hidePopup();
  }
}

export const KivoColorPicker = {
  /** category browser-before-ui-startup: أي <input type="color"> بيفتح المنتقي ده. */
  init() {
    const proto = lazy.ColorPickerParent.prototype;
    if (typeof proto.createPickerImpl !== "function") {
      console.error("Kivo: Firefox's color picker changed, so <input type=color> shows Firefox's picker");
      return;
    }
    proto.createPickerImpl = panel => new InputPanel(panel);
  },

  create,
  parseColor,
  pickFromWindow,
};
