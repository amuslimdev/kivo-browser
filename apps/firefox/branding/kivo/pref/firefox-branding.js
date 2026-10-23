/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// This file contains branding-specific prefs.

pref("startup.homepage_override_url", "");
pref("startup.homepage_welcome_url", "");
pref("startup.homepage_welcome_url.additional", "");
// The time interval between checks for a new version (in seconds)
pref("app.update.interval", 86400); // 24 hours
// Give the user x seconds to react before showing the big UI. default=24 hours
pref("app.update.promptWaitTime", 86400);
// URL user can browse to manually if for some reason all update installation
// attempts fail.
pref("app.update.url.manual", "");
// A default value for the "More information about this update" link
// supplied in the "An update is available" page of the update wizard.
pref("app.update.url.details", "");

// The number of days a binary is permitted to be old
// without checking for an update.  This assumes that
// app.update.checkInstallTime is true.
pref("app.update.checkInstallTime.days", 2);

// Give the user x seconds to reboot before showing a badge on the hamburger
// button. default=immediately
pref("app.update.badgeWaitTime", 0);

// Number of usages of the web console.
// If this is less than 5, then pasting code into the web console is disabled
pref("devtools.selfxss.count", 5);

// Kivo: no telemetry, studies, or crash reports to Mozilla from a build that is not theirs.
pref("datareporting.healthreport.uploadEnabled", false);
pref("datareporting.policy.dataSubmissionEnabled", false);
pref("app.shield.optoutstudies.enabled", false);
pref("app.normandy.enabled", false);
pref("browser.discovery.enabled", false);
pref("breakpad.reportURL", "");
pref("browser.crashReports.unsubmittedCheck.autoSubmit2", false);
pref("browser.tabs.crashReporting.sendReport", false);

// Kivo Home (built-in, kivo/home) sets the new tab page and the home page. Like add-ons from a
// distribution, it should not ask "an extension changed your new tab page".
pref("extensions.installedDistroAddon.home@kivo", true);
// A fixed address for Kivo Home, so the very first window opens it before the add-on has started.
// It has no web_accessible_resources, so sites cannot see it. KivoTheme.sys.mjs uses the same UUID.
pref("extensions.webextensions.uuids", "{\"home@kivo\":\"9d4b610d-d083-4703-8d31-c7178f7ba2e8\"}");
pref("browser.startup.homepage", "moz-extension://9d4b610d-d083-4703-8d31-c7178f7ba2e8/index.html");

// Kivo is not Firefox: no Firefox onboarding, recommendations, "More from Mozilla", or Mozilla product
// offers in the account menu. Firefox Labs only goes away with a policy (package.ps1). Kivo's profiles
// (G3) are built on Firefox's selectable profiles, so browser.profiles.enabled stays on.
pref("browser.aboutwelcome.enabled", false);
pref("browser.newtabpage.activity-stream.asrouter.userprefs.cfr.addons", false);
pref("browser.newtabpage.activity-stream.asrouter.userprefs.cfr.features", false);
pref("browser.preferences.moreFromMozilla", false);
pref("identity.fxaccounts.toolbar.pxiToolbarEnabled", false);

// Private windows: Kivo's own night look (KivoTheme.sys.mjs) instead of Firefox's purple private theme, which
// painted only part of the window over Kivo's colors.
pref("browser.theme.dark-private-windows", false);

// Sync is optional per profile (a Mozilla account, from Kivo's profile menu), and Kivo's own look syncs with it.
// Firefox's theme does not: Kivo always uses Firefox's default theme (KivoTheme.sys.mjs), and a dark Firefox
// theme from another device only darkened the menus.
pref("services.sync.prefs.sync.kivo.theme", true);
pref("services.sync.prefs.sync.extensions.activeThemeID", false);

// Kivo asks to be the default browser from Settings only (KivoShell.sys.mjs), not with a bar at startup.
pref("browser.shell.checkDefaultBrowser", false);

// The sidebar tools. Firefox's default is empty and it only fills the list for people who never used the new
// sidebar, so a profile that had Kivo's old list (before Synced tabs came back) was left with no icons at all.
pref("sidebar.main.tools", "opentabs,bookmarks,aichat,history,syncedtabs");

// Kivo updates itself from its public releases (KivoShell.sys.mjs, tools/release.ps1); Kivo.exe installs only
// builds signed with Kivo's release key.
pref("kivo.update.url", "https://github.com/amuslimdev/kivo-browser/releases/latest/download/update.json");
