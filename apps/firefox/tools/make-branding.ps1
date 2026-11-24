<#
.SYNOPSIS
    بيعمل apps/firefox/branding/kivo من branding/unofficial بتاع Firefox ومن أيقونة Kivo.
.DESCRIPTION
    بيتشغّل بعد sync، ومع كل نسخة Firefox جديدة لو الـ branding بتاعها اتغير. الناتج بيدخل الـ repo،
    فالـ sync مش محتاج الأيقونة الأصلية. كل صورة بتتعمل من جديد بنفس مقاسها، ومفيش صورة من Firefox بتفضل
    (trademark). ملفات الماك بتتشال لأنها مش بتستخدم على Windows.
.PARAMETER Icon
    Transparent square PNG. Defaults to the compact Malek-with-magnifier icon
    approved on 2026-11-05.
.PARAMETER PrivateIcon
    The private windows' icon (pbmode.ico, IDI_PBMODE in kivo-browser.exe), same kind of PNG. Defaults to Malek
    in a violet hood, from 2026-11-18.
#>
param([string] $Icon, [string] $PrivateIcon)
. "$PSScriptRoot\common.ps1"
Add-Type -AssemblyName System.Drawing

if (-not $Icon) { $Icon = Join-Path $Repo 'docs\art\app-icon\2026-11-05\malek-magnifier-v2.png' }
if (-not $PrivateIcon) { $PrivateIcon = Join-Path $Repo 'docs\art\app-icon\2026-11-18\malek-private-hood-v1.png' }
$unofficial = Join-Path $Source 'browser\branding\unofficial'
$target = Join-Path $FirefoxApp 'branding\kivo'
if (-not (Test-Path $unofficial)) { throw "Firefox source not synced: $unofficial" }

# Dark Start tile background keeps the icon and white app name readable.
$TileColor = '#102052'
$IcoSizes = @(16, 20, 24, 32, 40, 48, 64, 128, 256)
$master = [System.Drawing.Bitmap]::new($Icon)
$privateMaster = [System.Drawing.Bitmap]::new($PrivateIcon)
$utf8 = [Text.UTF8Encoding]::new($false)

# الصور اللي بتاعة النافذة الخاصة: أيقونتها في المحرك، وبلاطات private_browsing.exe (Kivo مابيشحنهوش، بس بتفضل
# متظبطة لو رجع).
function Get-Master([string] $Name) {
    if ($Name -match '^(pbmode\.ico|PrivateBrowsing_)') { $privateMaster } else { $master }
}

function New-Picture([int] $Width, [int] $Height, [double] $Fill, [System.Drawing.Color] $Background, [System.Drawing.Image] $Art = $master) {
    $bitmap = [System.Drawing.Bitmap]::new($Width, $Height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
        $graphics.Clear($Background)
        $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
        $mark = [int][Math]::Round([Math]::Min($Width, $Height) * $Fill)
        $graphics.DrawImage($Art, [System.Drawing.Rectangle]::new([int](($Width - $mark) / 2), [int](($Height - $mark) / 2), $mark, $mark))
    }
    finally { $graphics.Dispose() }
    return $bitmap
}

function Get-PngBytes([int] $Size, [System.Drawing.Image] $Art = $master) {
    $bitmap = New-Picture $Size $Size 1.0 ([System.Drawing.Color]::Transparent) $Art
    $stream = [System.IO.MemoryStream]::new()
    try {
        $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
        return , $stream.ToArray()
    }
    finally { $stream.Dispose(); $bitmap.Dispose() }
}

# ICO بصور PNG، زي tools/windows/generate-icons.ps1.
function Write-Ico([string] $Path, [System.Drawing.Image] $Art = $master) {
    $payloads = @(foreach ($size in $IcoSizes) { , (Get-PngBytes $size $Art) })
    $writer = [System.IO.BinaryWriter]::new([System.IO.File]::Create($Path))
    try {
        $writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]$IcoSizes.Count)
        $offset = 6 + 16 * $IcoSizes.Count
        for ($i = 0; $i -lt $IcoSizes.Count; $i++) {
            $dimension = if ($IcoSizes[$i] -eq 256) { 0 } else { $IcoSizes[$i] }
            $writer.Write([byte]$dimension); $writer.Write([byte]$dimension); $writer.Write([byte]0); $writer.Write([byte]0)
            $writer.Write([uint16]1); $writer.Write([uint16]32)
            $writer.Write([uint32]$payloads[$i].Length); $writer.Write([uint32]$offset)
            $offset += $payloads[$i].Length
        }
        foreach ($payload in $payloads) { $writer.Write($payload) }
    }
    finally { $writer.Dispose() }
}

function Set-Text([string] $Path, [scriptblock] $Transform) {
    $text = [IO.File]::ReadAllText($Path) -replace "`r`n", "`n"
    [IO.File]::WriteAllText($Path, (& $Transform $text), $utf8)
}

try {
    $expected = [IO.Path]::GetFullPath((Join-Path $Repo 'apps\firefox\branding\kivo'))
    if ([IO.Path]::GetFullPath($target) -ne $expected) { throw "Unexpected branding target: $target" }
    if (Test-Path $target) { Remove-Item $target -Recurse -Force }
    Copy-Item $unofficial $target -Recurse

    # الماك بس.
    Get-ChildItem $target -Recurse -Include *.icns, *.car, dsstore, background.png | Remove-Item -Recurse -Force

    foreach ($file in Get-ChildItem $target -Recurse -Include *.png, *.bmp, *.jpg) {
        $original = [System.Drawing.Image]::FromFile($file.FullName)
        $width = $original.Width; $height = $original.Height
        $original.Dispose()
        $name = $file.Name
        # البلاطات بتاعة Start فيها اسم البرنامج تحت، فالأيقونة أصغر. وصور الـ installer مالهاش شفافية.
        $opaque = $file.Extension -ne '.png'
        $fill = if ($opaque) { 0.6 }
                elseif ($name -match 'Tile|Wide310|Square150|VisualElements|PrivateBrowsing') { 0.66 }
                elseif ($width -ne $height) { 0.7 }
                else { 1.0 }
        $background = if ($opaque) { [System.Drawing.Color]::White } else { [System.Drawing.Color]::Transparent }
        $picture = New-Picture $width $height $fill $background (Get-Master $name)
        $format = switch ($file.Extension) {
            '.bmp' { [System.Drawing.Imaging.ImageFormat]::Bmp }
            '.jpg' { [System.Drawing.Imaging.ImageFormat]::Jpeg }
            default { [System.Drawing.Imaging.ImageFormat]::Png }
        }
        if ($opaque) {
            # BMP بتاع NSIS لازم 24-bit.
            $flat = $picture.Clone([System.Drawing.Rectangle]::new(0, 0, $width, $height), [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
            $picture.Dispose(); $picture = $flat
        }
        $picture.Save($file.FullName, $format)
        $picture.Dispose()
    }

    foreach ($file in Get-ChildItem $target -Recurse -Filter *.ico) { Write-Ico $file.FullName (Get-Master $file.Name) }

    # SVG فيه PNG، عشان الشكل يبقى نفس الأيقونة بالظبط.
    $png = [Convert]::ToBase64String((Get-PngBytes 256))
    $logo = "<svg xmlns=`"http://www.w3.org/2000/svg`" xmlns:xlink=`"http://www.w3.org/1999/xlink`" viewBox=`"0 0 256 256`"><image width=`"256`" height=`"256`" xlink:href=`"data:image/png;base64,$png`"/></svg>`n"
    foreach ($svg in 'about-logo.svg', 'document_pdf.svg') { [IO.File]::WriteAllText((Join-Path $target "content\$svg"), $logo, $utf8) }
    # مالك بالـ hood للنافذة الخاصة: كبير في صفحتها، وصغير في التاب وزرار الـ indicator (متصغّر هنا أنضف من تصغير
    # المحرك). kivo/jar.mn بيحطهم مكان pbm-logo.svg و favicon.svg بتوع Firefox.
    foreach ($pair in @(@('malek-private.svg', 256), @('malek-private-small.svg', 32))) {
        $size = $pair[1]
        $png = [Convert]::ToBase64String((Get-PngBytes $size $privateMaster))
        [IO.File]::WriteAllText((Join-Path $FirefoxApp "kivo\private\$($pair[0])"),
            "<svg xmlns=`"http://www.w3.org/2000/svg`" xmlns:xlink=`"http://www.w3.org/1999/xlink`" viewBox=`"0 0 $size $size`"><image width=`"$size`" height=`"$size`" xlink:href=`"data:image/png;base64,$png`"/></svg>`n", $utf8)
    }
    # الـ wordmark بنفس viewBox بتاع Firefox، واللون من الصفحة (context-fill).
    $font = "font-family=`"Segoe UI Variable Display, Segoe UI, sans-serif`" font-weight=`"700`" font-size=`"104`" text-anchor=`"middle`""
    [IO.File]::WriteAllText((Join-Path $target 'content\about-wordmark.svg'),
        "<svg xmlns=`"http://www.w3.org/2000/svg`" viewBox=`"0 0 372 99`"><text x=`"186`" y=`"84`" fill=`"context-fill`" $font>Kivo</text></svg>`n", $utf8)
    [IO.File]::WriteAllText((Join-Path $target 'content\firefox-wordmark.svg'),
        "<svg xmlns=`"http://www.w3.org/2000/svg`" viewBox=`"0 0 372 99`"><style>:root { color-scheme: light dark }</style><text x=`"186`" y=`"84`" fill=`"context-fill light-dark(#20123a, #fbfbfe)`" $font>Kivo</text></svg>`n", $utf8)

    Set-Text (Join-Path $target 'configure.sh') { param($t) $t -replace '(?m)^MOZ_APP_DISPLAYNAME=.*$', 'MOZ_APP_DISPLAYNAME=Kivo' -replace '(?m)^MOZ_MACBUNDLE_ID=.*$', 'MOZ_MACBUNDLE_ID=kivo' }
    Set-Text (Join-Path $target 'locales\en-US\brand.ftl') { param($t) $t -replace '(?m)^(-brand-(shorter|short|shortcut|full|product)-name|-vendor-short-name) = .*$', '$1 = Kivo' }
    Set-Text (Join-Path $target 'locales\en-US\brand.properties') { param($t) $t -replace '(?m)^(brandShorterName|brandShortName|brandFullName)=.*$', '$1=Kivo' }
    Set-Text (Join-Path $target 'branding.nsi') { param($t) $t -replace '(?m)^!define (BrandFullNameInternal|BrandFullName|CompanyName)(\s+)".*"$', '!define $1$2"Kivo"' }
    foreach ($manifest in Get-ChildItem $target -Filter *.VisualElementsManifest.xml) {
        Set-Text $manifest.FullName { param($t) $t -replace "BackgroundColor='[^']*'", "BackgroundColor='$TileColor'" }
    }
    Set-Text (Join-Path $target 'pref\firefox-branding.js') {
        param($t)
        ($t -replace 'https://nightly\.mozilla\.org', '') + @'

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

// Private windows: Kivo's own dark gray look (KivoTheme.sys.mjs) instead of Firefox's purple private theme, which
// painted only part of the window over Kivo's colors.
pref("browser.theme.dark-private-windows", false);
// Kivo makes the Start shortcut of private windows itself (KivoTaskbar.sys.mjs, through Kivo.exe). Firefox's pointed
// at private_browsing.exe, which Kivo doesn't ship, and Windows drew the private windows' taskbar button from it, blank.
pref("browser.privacySegmentation.createdShortcut", true);

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

// Find in page (Ctrl+F) like Chrome (kivo/findbar.css): every match in yellow and the current one in orange,
// instead of Firefox's pink and green. "Highlight All" starts on, like Chrome (it is under the box's options button).
pref("findbar.highlightAll", true);
pref("ui.textHighlightBackground", "#ffff00");
pref("ui.textHighlightForeground", "#000000");
pref("ui.textSelectAttentionBackground", "#ff9632");
pref("ui.textSelectAttentionForeground", "#000000");

// One color picker everywhere (kivo/KivoColorPicker.sys.mjs): every <input type="color"> (Kivo Home, websites, Firefox
// pages) opens Kivo's picker in a menu, with an eyedropper and a box that takes any CSS color, instead of the Windows
// dialog. This is Firefox's in-page color picker (on in Nightly only), and Kivo shows its own picker inside it.
pref("dom.forms.html_color_picker.enabled", true);

// Kivo writes the taskbar Jump Lists (kivo/KivoTaskbar.sys.mjs, through Kivo.exe): one per profile button, with its
// workspaces. Firefox's writes only the main button's list, and its items started the engine without Kivo's identity.
pref("browser.taskbar.lists.enabled", false);
// Five sites, one item each, under the workspaces and the profiles (Firefox shows seven pages).
pref("browser.taskbar.lists.maxListItemCount", 5);

// Kivo updates itself from its public releases (KivoShell.sys.mjs, tools/release.ps1); Kivo.exe installs only
// builds signed with Kivo's release key.
pref("kivo.update.url", "https://github.com/amuslimdev/kivo-browser/releases/latest/download/update.json");

// Safe Browsing with Kivo's own Google key (apps/firefox/mozconfig), checked by tools/safebrowsing-check.mjs.
// - Google gives a non-Mozilla key the lists for deceptive sites, malware, unwanted software and harmful apps, but
//   not the two download lists (V5 mwb-4b and csdda-32b: 404). Firefox asks for every list in one request, so with
//   them in the list nothing updated at all (8 Nov 2026).
// - The phishing table is goog-phish-proto, as in Mozilla's builds: the engine of an artifact build is Mozilla's
//   official one, and it only knows that name for V5 (se-4b). These prefs are built without MOZILLA_OFFICIAL and
//   said googpub-phish-proto, which the engine dropped from the request, so deceptive sites were never blocked.
// - Google's remote download check answers 403 to this key, so it is off: it only sent the details of each
//   downloaded program to Google for nothing.
pref("urlclassifier.phishTable", "goog-phish-proto,moztest-phish-simple");
pref("browser.safebrowsing.provider.google5.lists", "goog-phish-proto,goog-malware-proto,goog-unwanted-proto,goog-harmful-proto,goog-globalcache-proto");
pref("browser.safebrowsing.provider.google4.lists", "goog-phish-proto,googpub-phish-proto,goog-malware-proto,goog-unwanted-proto,goog-harmful-proto");
pref("browser.safebrowsing.downloads.remote.enabled", false);

'@
    }
}
finally { $master.Dispose(); $privateMaster.Dispose() }

$left = Get-ChildItem $target -Recurse -File -Exclude *.png, *.bmp, *.jpg, *.ico |
    Select-String -Pattern 'Nightly|Mozilla Developer Preview' | Where-Object { $_.Line -notmatch '^\s*(#|//|;)' } |
    ForEach-Object { $_.Path.Substring($target.Length + 1) } | Sort-Object -Unique
if ($left) { Write-Warning "still mentions Nightly: $($left -join ', ')" }
Write-Host "Kivo branding written to $target"
