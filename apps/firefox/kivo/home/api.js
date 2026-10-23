"use strict";

/* global ExtensionAPI, ChromeUtils */

// browser.kivo.request for the start page (docs/FIREFOX.md, G2). The work is in KivoData.sys.mjs; this only
// passes the message and the tab it came from. Errors reach the page with their message, like
// { ok: false, error } on Windows. Kept ASCII: experiment scripts are loaded as subscripts.
this.kivo = class extends ExtensionAPI {
  getAPI(context) {
    const KivoData = ChromeUtils.importESModule("moz-src:///browser/components/kivo/KivoData.sys.mjs");
    const { ExtensionError } = ChromeUtils.importESModule("resource://gre/modules/ExtensionUtils.sys.mjs").ExtensionUtils;
    const { ExtensionCommon } = ChromeUtils.importESModule("resource://gre/modules/ExtensionCommon.sys.mjs");
    return {
      kivo: {
        async request(message) {
          try {
            return await KivoData.handle(message, context.xulBrowser);
          } catch (e) {
            throw new ExtensionError(String(e?.message ?? e));
          }
        },
        // Kivo itself changed something the page shows (the window's workspace color): read it again.
        onRefresh: new ExtensionCommon.EventManager({
          context,
          name: "kivo.onRefresh",
          register: fire => KivoData.onRefresh(() => context.xulBrowser, () => fire.async()),
        }).api(),
      },
    };
  }
};
