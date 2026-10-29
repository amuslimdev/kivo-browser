<#
.SYNOPSIS
    نسخة Kivo portable: mach package، وبعدين Kivo.exe بأيقونته، من غير البرامج اللي بتكلّم Mozilla.
.DESCRIPTION
    الناتج في C:\kivo-src\out: فولدر Kivo بيتفتح بدبل كليك، و zip منه.
    الـ artifact build بييجي بهوية Firefox متبنية جوه الـ exe (مكان الـ profiles، ومسار الـ policies في الـ registry)،
    ودي بتتغير بـ -app و application.ini بتاع Kivo مع اختيار الـ profile (G3 في docs/FIREFOX.md).
.PARAMETER SkipMach
    من غير mach package، من آخر zip اتعمل.
.PARAMETER Destination
    فولدر تاني للناتج، مثلًا للاختبار وفيه Kivo مفتوح من C:\kivo-src\out (ملفاته بتبقى مقفولة).
#>
param([switch] $SkipMach, [string] $Destination)
. "$PSScriptRoot\common.ps1"
if ($Destination) { $Out = $Destination }

if (-not $SkipMach) { Invoke-Mach package }

$zip = Get-ChildItem (Join-Path $ObjDir 'dist') -Filter 'firefox-*.win64.zip' |
    Where-Object Name -NotMatch 'xpt_artifacts' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $zip) { throw "no package zip in $ObjDir\dist (run without -SkipMach)" }

$stage = Join-Path $Out 'stage'
$app = Join-Path $Out 'Kivo'
New-Item -ItemType Directory -Force $Out | Out-Null
foreach ($dir in $stage, $app) { if (Test-Path $dir) { Remove-Item $dir -Recurse -Force } }
Expand-Archive $zip.FullName $stage
Move-Item (Join-Path $stage 'firefox') $app
Remove-Item $stage -Recurse -Force

# هوية Kivo (G3): المحرك (firefox.exe من الـ artifact build) فيه هوية Firefox متبنية جواه، وبياخد هوية تانية
# من "-app <application.ini>" بس. فالمحرك بقى kivo-browser.exe، و Kivo.exe هو الـ launcher (Launcher.cs) اللي
# بيشغّله بـ browser\application.ini دايمًا.
Rename-Item (Join-Path $app 'firefox.exe') 'kivo-browser.exe'
# Windows بيدوّر على <اسم الـ exe>.VisualElementsManifest.xml عشان بلاطة Start، والاختصارات بتشاور على Kivo.exe.
Rename-Item (Join-Path $app 'firefox.VisualElementsManifest.xml') 'Kivo.VisualElementsManifest.xml'

# من application.ini بتاع الـ build نفسه: النسخة والـ BuildID ونسخ Gecko. والـ ID بيفضل بتاع Firefox، عشان
# الإضافات والمتجر يعرفوا إنه Firefox.
$built = Get-Content (Join-Path $app 'application.ini')
function Get-IniValue([string] $name) {
    ($built | Where-Object { $_ -match "^$name=" } | Select-Object -First 1) -replace "^$name=", ''
}
# المحرك (xul.dll) جاي جاهز من Mozilla للنسخة اللي اتبنت فعلًا، والـ application.ini من الكود. لو الكود على "version bump"
# لنسخة لسه مانزلتش، المحرك بيرفض الهوية برسالة خطأ على الشاشة ومابيفتحش (29 أكتوبر 2026: هوية 159.0.1 على محرك 159.0).
$engine = (Get-Item (Join-Path $app 'xul.dll')).VersionInfo.ProductVersion
if ($engine -ne (Get-IniValue 'MaxVersion')) {
    throw "The engine is Gecko $engine but the source says $(Get-IniValue 'MaxVersion'). Lock firefox.lock on a release tag (sync.ps1 -Update)."
}
# BuildID جديد لكل package: الـ artifact build بيدّي نفس الـ BuildID كل مرة، و Firefox مابيمسحش الـ startup cache
# (السكريبتات المتخزنة في الـ profile) غير لما النسخة أو الـ BuildID يتغيروا، فبعد التثبيت كان بيشغّل الكود القديم.
# بالتوقيت (UTC)، فكل نسخة أكبر من اللي قبلها ومفيش "downgrade".
$buildId = (Get-Date).ToUniversalTime().ToString('yyyyMMddHHmmss')
# UAName: الـ user agent بيتبني من Name لو مفيش UAName (nsHttpHandler)، فكان "Gecko/20100101 Kivo/158.0.1" من غير
# Firefox خالص، وجوجل كان بيبعت نسخته البسيطة القديمة. Kivo للمواقع Firefox بالظبط.
$identity = @"
; Kivo's identity (apps/firefox/tools/package.ps1). Kivo.exe starts kivo-browser.exe with -app <this file>.
; Data lives in %APPDATA%\Kivo, policies in Software\Policies\Mozilla\Kivo, and nothing reports to Mozilla.
; UAName keeps the user agent exactly Firefox's, so sites like Google don't fall back to their basic pages.
[App]
Vendor=Kivo
Name=Kivo
UAName=Firefox
RemotingName=kivo
Profile=Kivo
Version=$(Get-IniValue 'Version')
BuildID=$buildId
ID=$(Get-IniValue 'ID')

[Gecko]
MinVersion=$(Get-IniValue 'MinVersion')
MaxVersion=$(Get-IniValue 'MaxVersion')

[XRE]
EnableProfileMigrator=0

[Crash Reporter]
Enabled=0
"@
[IO.File]::WriteAllText((Join-Path $app 'browser\application.ini'), (($identity -replace "`r`n", "`n") + "`n"), [Text.UTF8Encoding]::new($false))
# النسخة اللي فوق "not used"، وبتلخبط لو حد قراها.
Remove-Item (Join-Path $app 'application.ini')

& (Join-Path $PSScriptRoot 'build-launcher.ps1') -Output (Join-Path $app 'Kivo.exe')

# اللي بيبعت لـ Mozilla (crash reports، و pings، و default browser agent)، والتحديثات من Mozilla،
# و private_browsing.exe اللي بيفتح firefox.exe بالاسم وعليه شعار Firefox.
$remove = @(
    'crashreporter.exe', 'default-browser-agent.exe', 'pingsender.exe',
    'updater.exe', 'updater.ini', 'update-settings.ini', 'precomplete', 'removed-files',
    'maintenanceservice.exe', 'maintenanceservice_installer.exe',
    'private_browsing.exe', 'private_browsing.VisualElementsManifest.xml'
)
foreach ($name in $remove) {
    $path = Join-Path $app $name
    if (Test-Path $path) { Remove-Item $path -Force } else { Write-Warning "not in package: $name" }
}

if (-not ('KivoExeIcon' -as [type])) {
    Add-Type -TypeDefinition (Get-Content (Join-Path $PSScriptRoot 'ExeIcon.cs') -Raw -Encoding UTF8)
}
# النوافذ والـ taskbar بياخدوا أيقونة المحرك نفسه.
$groups = [KivoExeIcon]::Replace((Join-Path $app 'kivo-browser.exe'), (Join-Path $FirefoxApp 'branding\kivo\firefox.ico'))
Write-Host "kivo-browser.exe: $groups icon groups replaced"

# التعلب اللي برا omni.ja (docs/MASCOT.md): kit.gif بيظهر فوق إعدادات Windows وهو بيشاور على Kivo
# (WindowsUIOverlayImage.cpp). بيتحمّل بـ WIC، اللي بيعرف نوع الصورة من محتواها، فـ PNG شفاف بنفس المقاس بيشتغل
# مكان الـ GIF، بعلامة Kivo في النص.
Add-Type -AssemblyName System.Drawing
$overlay = Join-Path $app 'browser\components\shell\assets\kit.gif'
if (Test-Path $overlay) {
    $original = [System.Drawing.Image]::FromFile($overlay)
    $width = $original.Width; $height = $original.Height
    $original.Dispose()
    $mark = [System.Drawing.Image]::FromFile((Join-Path $FirefoxApp 'branding\kivo\default256.png'))
    $picture = [System.Drawing.Bitmap]::new($width, $height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($picture)
    try {
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $side = [int][Math]::Min($height * 0.9, $width)
        $graphics.DrawImage($mark, [System.Drawing.Rectangle]::new([int](($width - $side) / 2), [int](($height - $side) / 2), $side, $side))
    }
    finally { $graphics.Dispose(); $mark.Dispose() }
    $picture.Save($overlay, [System.Drawing.Imaging.ImageFormat]::Png)
    $picture.Dispose()
    Write-Host "kit.gif: Kivo mark ${width}x${height}"
}

# عامة على الـ installation، زي Firefox. الـ policies لكل profile جاية في G7.
# Firefox Labs (تجارب Firefox) مالوش pref، بيتقفل من UserMessaging بس.
# حساب Mozilla مش مقفول: الـ Sync اختياري لكل profile من قايمة Kivo (KivoProfileMenu.sys.mjs)، والـ profiles لوكال
# لحد ما تتربط.
$distribution = Join-Path $app 'distribution'
New-Item -ItemType Directory -Force $distribution | Out-Null
$policies = @'
{
  "policies": {
    "DisableAppUpdate": true,
    "DisableTelemetry": true,
    "DisableFirefoxStudies": true,
    "DisableDefaultBrowserAgent": true,
    "UserMessaging": { "FirefoxLabs": false }
  }
}
'@
[IO.File]::WriteAllText((Join-Path $distribution 'policies.json'), ($policies -replace "`r`n", "`n"), [Text.UTF8Encoding]::new($false))

$archive = Join-Path $Out "Kivo-$($Lock.version)-win64.zip"
if (Test-Path $archive) { Remove-Item $archive -Force }
Compress-Archive -Path $app -DestinationPath $archive
Write-Host "Kivo $($Lock.version): $app"
Write-Host "zip: $archive ($([math]::Round((Get-Item $archive).Length / 1MB)) MB)"
