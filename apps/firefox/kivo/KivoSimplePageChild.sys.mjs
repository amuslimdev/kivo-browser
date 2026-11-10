// صفحة Firefox البسيطة (about:home و about:newtab) بوش صاحب الـ profile واسمه، زي هيدر Kivo Home. الصفحة في process
// لوحدها، و React بيرسم اللوجو من جديد، فبنحط stylesheet بدل ما نغيّر الصفحة نفسها. الوش والاسم من KivoShell (sharedData).
// كلمة Kivo في Firefox صورة عرضها ثابت، وعشان كده كانت بعيدة عن الوش.
// وزرار Kivo Home فوق قلم Firefox: مفيش غيره يرجّع من هنا، لأن زرار Home نفسه بيحوّل للصفحة دي. React مابيلمسش غير #root.

export class KivoSimplePageChild extends JSWindowActorChild {
  handleEvent(event) {
    if (event.type === "DOMContentLoaded") {
      const button = this.document.createElement("button");
      button.className = "kivo-home-button";
      button.textContent = "Kivo Home";
      button.addEventListener("click", () => this.sendAsyncMessage("KivoSimplePage:KivoHome"));
      this.document.body.append(button);
      return;
    }
    const look = Services.cpmm.sharedData.get("kivo:simple-page");
    if (!look) {
      return;
    }
    const face = look.face ? `.logo-and-wordmark .logo { background-image: url(${JSON.stringify(look.face)}) !important; }` : "";
    const css = `${face}
      .logo-and-wordmark .wordmark {
        width: auto !important;
        max-width: 40vw;
        margin-inline-start: 12px !important;
        background: none !important;
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
      }
      .logo-and-wordmark .wordmark::after {
        content: ${JSON.stringify(look.greeting)};
        font-size: 32px;
        font-weight: 700;
        line-height: 64px;
        color: var(--newtab-text-primary-color);
      }
      .kivo-home-button {
        position: fixed;
        z-index: 5;
        inset-block-end: calc(var(--space-xlarge) + 40px);
        inset-inline-end: var(--space-xlarge);
        height: 32px;
        padding-inline: 12px;
        border: 0;
        border-radius: 16px;
        background-color: var(--newtab-background-color-secondary);
        color: var(--newtab-text-primary-color);
        box-shadow: 0 2px 6px rgba(58, 57, 68, 20%);
        font: inherit;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
      }
      .kivo-home-button:hover {
        background-color: color-mix(in srgb, var(--newtab-background-color-secondary) 88%, var(--newtab-text-primary-color));
      }`;
    const utils = this.contentWindow.windowUtils;
    utils.loadSheetUsingURIString(`data:text/css;charset=utf-8,${encodeURIComponent(css)}`, utils.AUTHOR_SHEET);
  }
}
