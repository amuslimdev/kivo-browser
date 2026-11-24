# المسارات والأدوات المشتركة بين سكريبتات apps/firefox. بيتعمله dot-source: . "$PSScriptRoot\common.ps1"
# Windows PowerShell 5.1 بيقرا الملفات اللي من غير BOM بـ codepage 1252، فالشدّة مثلًا بتتقري علامة تنصيص.
# عشان كده الـ strings في السكريبتات دي إنجليزي، والعربي في الـ comments بس.
$ErrorActionPreference = 'Stop'

$FirefoxApp = Split-Path $PSScriptRoot -Parent
$Repo = (Resolve-Path (Join-Path $FirefoxApp '..\..')).Path
$Lock = Get-Content (Join-Path $FirefoxApp 'firefox.lock') -Raw | ConvertFrom-Json

# الكود والـ build برا الـ repo، على NTFS (D عليه exFAT). KIVO_FIREFOX_SRC بيغيّر المكان.
$KivoSrc = if ($env:KIVO_SRC) { $env:KIVO_SRC } else { 'C:\kivo-src' }
$Source = if ($env:KIVO_FIREFOX_SRC) { $env:KIVO_FIREFOX_SRC } else { Join-Path $KivoSrc 'firefox' }
$ObjDir = Join-Path $Source 'obj-kivo'
$Out = Join-Path $KivoSrc 'out'
$MozillaBuild = 'C:\mozilla-build'

function ConvertTo-Msys([string] $Path) {
    '/' + $Path.Substring(0, 1).ToLower() + $Path.Substring(2).Replace('\', '/')
}

# Safe Browsing: النسخة اللي في $App فيها مفتاح Google ولا لأ (المفتاح من الـ mozconfig، و Firefox بيحطه في
# AppConstants جوه omni.ja). بيرجّع true أو false بس، والمفتاح نفسه مابيطلعش.
function Test-SafeBrowsingKey([string] $App) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $omni = [IO.Compression.ZipFile]::OpenRead((Join-Path $App 'omni.ja'))
    try {
        $entry = $omni.GetEntry('modules/AppConstants.sys.mjs')
        if (-not $entry) { throw "No modules/AppConstants.sys.mjs in $App\omni.ja" }
        $reader = [IO.StreamReader]::new($entry.Open())
        try { $text = $reader.ReadToEnd() } finally { $reader.Dispose() }
    } finally { $omni.Dispose() }
    $match = [regex]::Match($text, 'MOZ_GOOGLE_SAFEBROWSING_API_KEY:\s*"([^"]*)"')
    if (-not $match.Success) { throw 'No MOZ_GOOGLE_SAFEBROWSING_API_KEY in AppConstants.sys.mjs' }
    $key = $match.Groups[1].Value
    [bool] ($key -and $key -ne 'no-google-safebrowsing-api-key')
}

function Invoke-Git {
    $ErrorActionPreference = 'Continue'
    & git -c core.longpaths=true -c core.autocrlf=false @args
    if ($LASTEXITCODE) { throw "git $($args -join ' ') failed ($LASTEXITCODE)" }
}

# ./mach جوه بيئة MozillaBuild من غير mintty، زي start-shell.bat بس من غير shell تفاعلي.
function Invoke-Mach {
    if (-not (Test-Path (Join-Path $MozillaBuild 'start-shell.bat'))) {
        throw "MozillaBuild is not installed in $MozillaBuild (see apps/firefox/README.md)"
    }
    $env:MOZILLABUILD = "$MozillaBuild\"
    $env:MSYS2_PATH_TYPE = 'inherit'
    $env:CHERE_INVOKING = '1'
    # الأدوات اللي bootstrap بينزّلها جنب الكود، مش في فولدر المستخدم.
    $env:MOZBUILD_STATE_PATH = Join-Path $KivoSrc 'mozbuild'
    $mozconfig = ConvertTo-Msys (Join-Path $FirefoxApp 'mozconfig')
    $ErrorActionPreference = 'Continue'
    & (Join-Path $MozillaBuild 'msys2\usr\bin\bash.exe') --login -c "export MOZCONFIG='$mozconfig'; cd '$(ConvertTo-Msys $Source)' && ./mach $($args -join ' ')"
    if ($LASTEXITCODE) { throw "mach $($args -join ' ') failed ($LASTEXITCODE)" }
}
