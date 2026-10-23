# Kivo

Kivo is a browser for families, built on Firefox: a full everyday browser that stays safe and friendly for kids.
It runs on Windows, and it is still early: not ready for general use yet.

This repository holds Kivo's releases and the source of Kivo's changes to Firefox.

## What is here

- `apps/firefox/kivo`: Kivo's modules and styles inside Firefox (themes, profiles, workspaces, the profile menu, Windows integration and updates).
- `apps/firefox/patches`: Kivo's changes to Firefox's own files, one patch per file.
- `apps/firefox/branding`: Kivo's name and icons.
- `apps/firefox/tools`: the scripts that fetch Firefox at the revision in `apps/firefox/firefox.lock`, put Kivo on it, build, package and release it.

Firefox itself is not copied here. `firefox.lock` names the branch and revision of [mozilla-firefox/firefox](https://github.com/mozilla-firefox/firefox) each release is built from.
Kivo's own pages (the start page, History and Downloads) come from a separate project and ship built inside each release.

## Releases and updates

Each release has `Kivo-<version>-win64.zip`, `update.json` and `Kivo-<version>-source.zip` (this repository at the commit the release was built from).
An installed Kivo reads `update.json` from the latest release every 6 hours and downloads a newer build in the background.
`Kivo.exe` installs it the next time Kivo opens, and only if the zip is signed with Kivo's release key (the public half is `apps/firefox/release-key.pub.xml`) and is newer than the installed build.

## License

The source code here is under the [Mozilla Public License 2.0](LICENSE), like Firefox.

The Kivo name, the kite icon and Kivo's illustrations (the images in `apps/firefox/branding` and `apps/firefox/kivo/mascot`) are not covered by that license: all rights reserved.

Firefox is a trademark of the Mozilla Foundation. Kivo is not made or endorsed by Mozilla.
