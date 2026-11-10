// زرار Kivo Home اللي على صفحة Firefox البسيطة (KivoSimplePageChild). التاب بتاعه هو اللي بيرجع لـ Kivo Home.
import { handle } from "moz-src:///browser/components/kivo/KivoData.sys.mjs";

export class KivoSimplePageParent extends JSWindowActorParent {
  receiveMessage() {
    return handle({ type: "home.page", payload: { page: "kivo" } }, this.browsingContext.top.embedderElement);
  }
}
