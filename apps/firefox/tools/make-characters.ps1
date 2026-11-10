<#
.SYNOPSIS
    بيعمل صور الشخصيات (ولد وبنت) اللي الـ profile بيختار منها أيقونة Kivo بتاعته.
.DESCRIPTION
    الأصل في docs/art/app-icon. الناتج بيدخل الـ repo:
    - web/ui/public/characters: وش الشخصية في الترحيب و "Make it yours".
    - apps/firefox/kivo/characters: الأيقونة اللي KivoTaskbar بيرسمها. مالك مش فيها، لأن أيقونته هي أيقونة Kivo نفسها.
#>
. "$PSScriptRoot\common.ps1"
Add-Type -AssemblyName System.Drawing

$art = Join-Path $Repo 'docs\art\app-icon'
$web = Join-Path $Repo 'web\ui\public\characters'
$chrome = Join-Path $FirefoxApp 'kivo\characters'
$masters = @{
    'young-genius'   = Join-Path $art '2026-11-05\malek-magnifier-v2.png'
    'energetic-girl' = Join-Path $art '2026-11-06\energetic-girl-magnifier-v1.png'
}

function Save-Picture([string] $Master, [int] $Size, [string] $Path) {
    $source = [System.Drawing.Bitmap]::new($Master)
    $picture = [System.Drawing.Bitmap]::new($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($picture)
    try {
        $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $graphics.DrawImage($source, 0, 0, $Size, $Size)
        $picture.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
    }
    finally { $graphics.Dispose(); $picture.Dispose(); $source.Dispose() }
}

New-Item -ItemType Directory -Force $web, $chrome | Out-Null
foreach ($id in $masters.Keys) { Save-Picture $masters[$id] 192 (Join-Path $web "$id.png") }
Save-Picture $masters['energetic-girl'] 512 (Join-Path $chrome 'energetic-girl.png')
Get-ChildItem $web, $chrome -Filter *.png | ForEach-Object { '{0}  {1:N0} KB' -f $_.FullName, ($_.Length / 1KB) }
