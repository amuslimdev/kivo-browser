<#
.SYNOPSIS
    بيعمل apps/firefox/branding/kivo من branding/unofficial بتاع Firefox ومن أيقونة Kivo.
.DESCRIPTION
    بيتشغّل بعد sync، ومع كل نسخة Firefox جديدة لو الـ branding بتاعها اتغير. الناتج بيدخل الـ repo،
    فالـ sync مش محتاج الأيقونة الأصلية. كل صورة بتتعمل من جديد بنفس مقاسها، ومفيش صورة من Firefox بتفضل
    (trademark). ملفات الماك بتتشال لأنها مش بتستخدم على Windows.
.PARAMETER Icon
    الأيقونة الأصلية، PNG شفاف مربع. الافتراضي الـ kite اللي اتعتمد في 19 أكتوبر
    (docs/art/app-icon/exploration-concepts/kivo-kite-v2.png: compact body for taskbar sizes).
#>
param([string] $Icon)
. "$PSScriptRoot\common.ps1"
Add-Type -AssemblyName System.Drawing

if (-not $Icon) { $Icon = Join-Path $Repo 'docs\art\app-icon\exploration-concepts\kivo-kite-v2.png' }
$unofficial = Join-Path $Source 'browser\branding\unofficial'
$target = Join-Path $FirefoxApp 'branding\kivo'
if (-not (Test-Path $unofficial)) { throw "Firefox source not synced: $unofficial" }

# خلفية بلاطة Start: أزرق غامق، عشان الـ kite (أزرق وسماوي ونعناعي) يبان عليها والاسم الأبيض يتقري.
$TileColor = '#102052'
$IcoSizes = @(16, 20, 24, 32, 40, 48, 64, 128, 256)
$master = [System.Drawing.Bitmap]::new($Icon)
$utf8 = [Text.UTF8Encoding]::new($false)

# الأيقونات الصغيرة (48 وأقل: الـ taskbar، والتابات، وقوايم Windows) بترسم kite مبسّط بدل ما تصغّر الأصل: من غير ديل،
# مالي المربع، وأربع ألوان flat بتباين عالي، عشان الـ gradient والديل بيبقوا دوشة في 24. اتعتمد في 22 أكتوبر
# (نسخة A، docs/art/app-icon/kivo-kite-small.svg). النقط على شبكة 48: شمال، فوق، يمين، تحت، ونقطة تقاطع العيدان.
$SmallMax = 48
$SmallKite = @{ L = 0.5, 18; T = 30, 0.5; R = 47.5, 27; B = 17, 47.5; C = 23.9, 22.5 }
$SmallFaces = @(
    @('L', 'T', '#34D7A4'),
    @('T', 'R', '#3CC8F8'),
    @('R', 'B', '#2B93F2'),
    @('B', 'L', '#1A44D8'))

function Draw-SmallKite([System.Drawing.Graphics] $Graphics, [int] $Size) {
    $scale = $Size / 48.0
    $point = { param($k) [System.Drawing.PointF]::new($SmallKite[$k][0] * $scale, $SmallKite[$k][1] * $scale) }
    # الشكل كله الأول بلون من الوشوش، عشان حواف الوشوش اللي جنب بعض ماتسيبش خط شفاف بينهم.
    $under = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml('#2B93F2'))
    $Graphics.FillPolygon($under, [System.Drawing.PointF[]]@((& $point 'L'), (& $point 'T'), (& $point 'R'), (& $point 'B')))
    $under.Dispose()
    foreach ($face in $SmallFaces) {
        $brush = [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml($face[2]))
        $Graphics.FillPolygon($brush, [System.Drawing.PointF[]]@((& $point $face[0]), (& $point $face[1]), (& $point 'C')))
        $brush.Dispose()
    }
}

function New-Picture([int] $Width, [int] $Height, [double] $Fill, [System.Drawing.Color] $Background) {
    $bitmap = [System.Drawing.Bitmap]::new($Width, $Height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
        $graphics.Clear($Background)
        $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
        if ($Width -eq $Height -and $Width -le $SmallMax -and $Fill -eq 1.0) { Draw-SmallKite $graphics $Width }
        else {
            $mark = [int][Math]::Round([Math]::Min($Width, $Height) * $Fill)
            $graphics.DrawImage($master, [System.Drawing.Rectangle]::new([int](($Width - $mark) / 2), [int](($Height - $mark) / 2), $mark, $mark))
        }
    }
    finally { $graphics.Dispose() }
    return $bitmap
}

function Get-PngBytes([int] $Size) {
    $bitmap = New-Picture $Size $Size 1.0 ([System.Drawing.Color]::Transparent)
    $stream = [System.IO.MemoryStream]::new()
    try {
        $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
        return , $stream.ToArray()
    }
    finally { $stream.Dispose(); $bitmap.Dispose() }
}

# ICO بصور PNG، زي tools/windows/generate-icons.ps1.
function Write-Ico([string] $Path) {
    $payloads = @(foreach ($size in $IcoSizes) { , (Get-PngBytes $size) })
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
        $picture = New-Picture $width $height $fill $background
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

    foreach ($file in Get-ChildItem $target -Recurse -Filter *.ico) { Write-Ico $file.FullName }

    # SVG فيه PNG، عشان الشكل يبقى نفس الأيقونة بالظبط.
    $png = [Convert]::ToBase64String((Get-PngBytes 256))
    $logo = "<svg xmlns=`"http://www.w3.org/2000/svg`" xmlns:xlink=`"http://www.w3.org/1999/xlink`" viewBox=`"0 0 256 256`"><image width=`"256`" height=`"256`" xlink:href=`"data:image/png;base64,$png`"/></svg>`n"
    foreach ($svg in 'about-logo.svg', 'document_pdf.svg') { [IO.File]::WriteAllText((Join-Path $target "content\$svg"), $logo, $utf8) }
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

'@
    }
}
finally { $master.Dispose() }

$left = Get-ChildItem $target -Recurse -File -Exclude *.png, *.bmp, *.jpg, *.ico |
    Select-String -Pattern 'Nightly|Mozilla Developer Preview' | Where-Object { $_.Line -notmatch '^\s*(#|//|;)' } |
    ForEach-Object { $_.Path.Substring($target.Length + 1) } | Sort-Object -Unique
if ($left) { Write-Warning "still mentions Nightly: $($left -join ', ')" }
Write-Host "Kivo branding written to $target"
