# Kivo على Firefox

Kivo كـ fork من Firefox (قرار 19 أكتوبر 2026). الخطة في [docs/FIREFOX.md](../../docs/FIREFOX.md)، ونتايج التجارب في [docs/SPIKE_RESULTS.md](../../docs/SPIKE_RESULTS.md) (F1 لـ F9).

Firefox نفسه مش في الـ repo. الـ repo فيه **تعديلات Kivo بس**، والسكريبتات بتجيب Firefox بالنسخة اللي في `firefox.lock` وبتحطها عليه.

```text
apps/firefox/
├─ firefox.lock      الفرع (release) والـ revision والنسخة
├─ mozconfig         artifact build + branding بتاع Kivo
├─ branding/kivo/    الاسم والأيقونات (tools/make-branding.ps1 بيعمله)
├─ kivo/             كود Kivo جوه Firefox: بيتنسخ لـ browser/components/kivo
│  ├─ KivoTheme.sys.mjs   ثيم الـ profile على النوافذ (G1)
│  ├─ KivoData.sys.mjs    الـ host بتاع صفحة البداية: الرسايل والتحقق والحفظ (G2)
│  ├─ KivoProfiles.sys.mjs  اسم ولون وأفاتار Kivo في الـ profiles بتاعة Firefox (G3)
│  ├─ KivoProfileMenu.sys.mjs  زرار الـ profile بتاع Kivo وقايمته، مكان حساب Mozilla (G3، profile-menu.css)
│  ├─ KivoWorkspaces.sys.mjs  الـ workspaces لكل profile زي Edge، وزرارها وقايمتها (G4، workspaces.css)
│  ├─ mascot/ و private/  أبطال Kivo مكان التعلب (docs/MASCOT.md)، وصفحة النافذة الخاصة
│  ├─ profiles/           شكل Kivo لصفحات الـ profiles (G3)
│  └─ home/               Kivo Home: extension مدمجة، وملفاتها build بتاع web/ui (sync بيبنيه)
├─ patches/          تعديلات على ملفات Firefox نفسها، patch لكل ملف (tools/export.ps1 بيعمله)
└─ tools/            sync، و mach، و package، و make-branding، و export
```

## أول مرة

1. **MozillaBuild** في `C:\mozilla-build`: الـ installer من `https://ftp.mozilla.org/pub/mozilla/libraries/win32/MozillaBuildSetup-Latest.exe` (متوقّع من Mozilla Corporation). بيتثبت من غير admin:

   ```powershell
   $env:__COMPAT_LAYER = 'RunAsInvoker'
   Start-Process MozillaBuildSetup-Latest.exe -ArgumentList '/S' -Wait
   ```

2. **الكود والأدوات** في `C:\kivo-src` (NTFS؛ D عليه exFAT). `KIVO_SRC` بيغيّر المكان:

   ```powershell
   .\apps\firefox\tools\sync.ps1                # Firefox بالنسخة اللي في الـ lock، و mach bootstrap أول مرة
   .\apps\firefox\tools\mach.ps1 build          # أول build: 10 لـ 17 دقيقة
   .\apps\firefox\tools\package.ps1             # C:\kivo-src\out\Kivo و Kivo-<version>-win64.zip
   ```

## الشغل اليومي

- **تعديل ملف موجود (JS أو CSS)**: مفيش build. ملفات الـ build المحلي symlinks لكود Firefox، فـ `sync.ps1` (7 ثواني) وافتح Kivo تاني. ده لكود Kivo (`apps/firefox/kivo`) ولملفات Firefox نفسها.
- **ملف جديد أو تعديل `jar.mn` أو `moz.build`**: `.\apps\firefox\tools\mach.ps1 build faster` (دقيقتين). `mach build <فولدر>` بيتجاهل `browser/components/kivo`.
- **صفحة البداية (Kivo Home)**: `sync.ps1` بيبني `web/ui` (`pnpm`) وبيحطه في الـ extension. الـ extensions المدمجة **مابتشتغلش في الـ build المحلي** (ولا بتاعة Firefox نفسه): ملفاتها symlinks، و process الـ extensions مابيقراهاش. فتتجرب على نسخة متغلفة: `package.ps1 -Destination C:\kivo-spike\pkg-test` (لو Kivo مفتوح من `out`)، وبعدين `node apps\firefox\tools\home-check.mjs --kivo C:\kivo-spike\pkg-test\Kivo\Kivo.exe --out <فولدر> --preset space` (24 اختبار، وصور للصفحة والنافذة).
- **الـ profiles (G3)**: `node apps\firefox\tools\profiles-check.mjs --kivo <Kivo.exe متغلف> --out <فولدر>`. بيشغّل Kivo بهوية اختبار (`KivoTest`، بياناتها في `%APPDATA%\KivoTest` وبتتمسح كل مرة)، من غير `-profile`، لأن الـ profiles بتاعة Firefox مابتشتغلش غير مع profile متسجل في `profiles.ini`. وبيفتح profile تاني بنفس كود Firefox، وبيقفله في الآخر.
- **G5**: `node apps\firefox\tools\pages-check.mjs --kivo <Kivo.exe متغلف> --out <فولدر>`. شكل الإعدادات والقوايم، و Ctrl+J، وصفحات History و Downloads بتاعة Kivo بالبيانات والمسح، وصور.
- **Kivo يومي**: `node apps\firefox\tools\daily-check.mjs --kivo <Kivo.exe متغلف> --out <فولدر>`. لينك من برنامج تاني (بمحرك وهمي جنب نسخة من `Kivo.exe`، فمفيش Kivo حقيقي بيفتح)، و "Make Default"، وتنبيه التحديث، و Widevine، والـ Sync الاختياري.
- **التحديثات (G6)**: `node apps\firefox\tools\updates-check.mjs --kivo <Kivo.exe متغلف> --out <فولدر>`. `Kivo.exe` بمفتاح تجربة ومحرك وهمي (التركيب، والـ zip المتلعّب فيه، والنسخة الأقدم، و Kivo مفتوح، و `--kivo-restart`)، و Kivo headless بيحمّل من سيرفر محلي. Kivo المتثبت وفولدر تحديثاته مابيتلمسوش (`kivo-bidi` بيحط `kivo.update.url` فاضي و `KIVO_UPDATES_DIR` مؤقت لكل الاختبارات).
- **الـ workspaces (G4)**: `node apps\firefox\tools\workspaces-check.mjs --kivo <Kivo.exe متغلف> --out <فولدر>`. بيفتح Kivo مرتين على نفس الـ profile (مؤقت، وبيتمسح في الآخر)، عشان يتأكد إن التابات بترجع بعد ما Kivo يتقفل (`kivo-bidi` بيقفله زي الولد، `quit()`). وبيصوّر القايمة مترسومة من الـ layout بتاعها (`PANEL_SHOT`).
- **أماكن الأبطال**: `node apps\firefox\tools\mascot-review.mjs --kivo <Kivo.exe متغلف> --out <فولدر>` بيصوّر كل مكان فيه طفل مكان التعلب، جوه النافذة.
- **بعد كل نسخة Firefox جديدة**: `node apps\firefox\tools\fox-scan.mjs --kivo <Kivo.exe>` بيدوّر على تعلب Firefox أو شعاره في القايمة الرئيسية وقايمة الحساب والإعدادات، وبيجرد كل صورة تعلب في الـ build إن ليها `override`. أي صورة جديدة تتضاف في الحالة المناسبة في `kivo/jar.mn` وفي [docs/MASCOT.md](../../docs/MASCOT.md) (خريطة أماكن التعلب، عشان شخصية Kivo).
- **صورة للواجهة من غير ما نافذة تظهر**: `node apps\firefox\tools\shot.mjs --kivo C:\kivo-src\firefox\obj-kivo\dist\bin\firefox.exe --out shot.png --preset candy --preset space` (العوالم بأسمائها، و `--scale 2` للتفاصيل).
- **تشغيل الـ build**: `.\apps\firefox\tools\mach.ps1 run`. ماتفتحش `obj-kivo\dist\bin\firefox.exe` بدبل كليك: ملفاته symlinks لفولدر الكود، والـ sandbox بيعلّق التابات (`mach run` بيظبط ده). نسخة `package.ps1` مالهاش المشكلة دي.
- **تعديل ملف من Firefox نفسه**: عدّله في `C:\kivo-src\firefox`، وبعدين `.\apps\firefox\tools\export.ps1` يطلّعه patch.
- **من غير C++**: أي تعديل C++ بيلغي الـ artifact build. لازم يتناقش الأول.

## نسخة Firefox جديدة (كل 4 أسابيع)

Kivo بيقول لوحده لما فيه Firefox أحدث (تنبيه فوق الصفحة، `KivoShell.sys.mjs`). والتحديث كله أمر واحد:

```powershell
.\apps\firefox\tools\update.ps1          # sync -Update، و mach build، و package، و install. -Check بيقول بس
```

أو خطوة خطوة:

```powershell
.\apps\firefox\tools\sync.ps1 -Update   # الـ lock لآخر revision في release، وبيطبّق الـ patches
.\apps\firefox\tools\make-branding.ps1  # لو branding/unofficial بتاع Firefox اتغير
.\apps\firefox\tools\mach.ps1 build
```

لو patch مااتطبقش، صلّح الملف في `C:\kivo-src\firefox` وشغّل `export.ps1`.

## الـ package

`package.ps1` بيعمل `mach package`، وبعدين:

- **هوية Kivo (G3)**: `firefox.exe` بيبقى `kivo-browser.exe` (المحرك)، و `Kivo.exe` launcher صغير (`tools/Launcher.cs`، بيتبني بـ `csc` بتاع .NET Framework اللي في Windows) بيشغّله بـ `-app browser\application.ini`. الـ ini ده بيتكتب وقت الـ package: `Vendor=Kivo` و `Name=Kivo` و `Profile=Kivo`، فالبيانات في `%APPDATA%\Kivo` والـ policies من `Software\Policies\Mozilla\Kivo` بس. المحرك بيحفظ `XUL_APP_FILE` للـ restart، فالـ restart بيفضل Kivo. والـ profile التاني بيتفتح في process جديد من غير `-app` (`launchInstance` بتاع Firefox)، فـ `Kivo.exe` بيحط `KIVO_APP_FILE`، و `KivoProfiles.sys.mjs` بيبعته `-app`.
- **`BuildID` جديد لكل package** (التوقيت بالـ UTC): الـ artifact build بيدّي نفس الـ BuildID كل مرة، و Firefox مابيمسحش الـ startup cache بتاع الـ profile غير لما النسخة أو الـ BuildID يتغيروا. من غيره، Kivo بعد التثبيت كان بيشغّل الـ `.sys.mjs` القديمة من الـ cache (20 أكتوبر: لون الهيدر الثابت كان بيترفض كأنه مش موجود).
- أيقونات المحرك كلها بتتبدل بأيقونة Kivo (`tools/ExeIcon.cs`)، ومنه أيقونة النافذة والـ taskbar. و `Kivo.exe` بيتبني بنفس الأيقونة.
- بيشيل `crashreporter.exe`، و `pingsender.exe`، و `default-browser-agent.exe`، والـ updater و maintenance service، و `private_browsing.exe`.
- `distribution\policies.json`: `DisableAppUpdate`، و `DisableTelemetry`، و `DisableFirefoxStudies`، و `DisableDefaultBrowserAgent`، و `UserMessaging.FirefoxLabs`. حساب Mozilla مش مقفول: الـ Sync اختياري لكل profile من قايمة Kivo.

## التثبيت

```powershell
.\apps\firefox\tools\install.ps1 -Build C:\kivo-src\out\Kivo -ViaExplorer
```

- للمستخدم ده بس ومن غير admin: `%LOCALAPPDATA%\Programs\Kivo`، واختصار في Start بـ AppUserModelID `Kivo.Browser`، و Kivo في Apps & features (`uninstall.ps1`، بيسيب `%APPDATA%\Kivo`). و `HKCU\Software\Mozilla\Kivo\TaskBarIDs` بيخلي المحرك ياخد نفس الـ AppUserModelID، فالنوافذ بتتجمع تحت الاختصار.
- Kivo بيتسجّل كمتصفح (`KivoURL` و `KivoHTML` و `KivoPDF`، و `StartMenuInternet\Kivo`، و `RegisteredApplications`)، فبيظهر في Settings > Default apps، و "Make Default" في إعدادات Kivo بيفتح صفحته هناك. و `uninstall.ps1` بيشيل التسجيل.
- `-ViaExplorer`: Claude desktop متغلف MSIX، فأي كتابة منه في AppData أو HKCU بتروح فولدر تاني بتاعه. السكريبت بيشغّل نفسه من explorer (اختصار في `C:\kivo-src`) عشان التثبيت يبقى حقيقي، وبيستنى النتيجة في `C:\kivo-src\install.log`. من terminal عادي مش محتاجه.
- لازم Kivo يكون مقفول.

## الـ release والتحديث التلقائي (G6)

```powershell
.\apps\firefox\tools\release.ps1             # بيوقّع ويجهّز في C:\kivo-src\out\release من غير نشر
.\apps\firefox\tools\release.ps1 -Publish    # الـ repo العام amuslimdev/kivo-browser والـ release
```

- `Kivo.exe` بيتبني بـ `tools/build-launcher.ps1` (`Launcher.cs` و `Updater.cs`، والمفتاح العام `release-key.pub.xml` جواه). المفتاح الخاص في `%USERPROFILE%\.kivo-release` (أو `KIVO_RELEASE_KEY`)، ومايدخلش الـ repo أبدًا.
- Kivo بيقرا `kivo.update.url` (آخر release) كل 6 ساعات، وبينزّل في `%LOCALAPPDATA%\Kivo\updates`، و `Kivo.exe` بيركّب وهو بيفتح، و `update.log` في نفس الفولدر بيقول اللي حصل.
- الـ repo العام فيه `public/README.md` و `public/LICENSE` فوق، و `apps/firefox` من نفس الـ commit. و `-Publish` بيرفض لو `apps/firefox` فيه تعديلات مش متسجلة.

## الرخصة

Firefox تحت MPL-2.0. أي ملف من Firefox بنعدّله (`patches/`، و `branding/kivo` اللي أصله `branding/unofficial`) لازم كوده يبقى متاح للي بياخد Kivo لما نوزّعه. واسم Firefox وشعاره trademarks، فمايظهروش في Kivo.
