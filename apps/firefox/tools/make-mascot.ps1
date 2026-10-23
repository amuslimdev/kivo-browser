<#
.SYNOPSIS
    بيعمل صور أبطال Kivo (docs/MASCOT.md) اللي بتتحط مكان تعلب Firefox: apps/firefox/kivo/mascot/<name>.svg.
.DESCRIPTION
    الأسامي من kivo/jar.mn: <صورة>.svg مربعة، و <صورة>-<شكل>.svg بنسبة صورة Firefox اللي بتتحط مكانها (-tall 0.62، و
    -4x3 1.3، و -3x2 1.6، و -wide 2.2). Firefox بيبني أماكن كتير على نسبة صورته (قايمة الإضافات بارتفاع الصورة نفسها،
    والإعدادات بـ cover)، فالطفل بيتحط في النص بنفس النسبة، والأطراف فاضية.
    كل صورة أصلية (PNG شفاف مربع، من ChatGPT) بتصغر لـ 400، وبيتحط حواليها حرف أبيض رفيع زي الـ sticker عشان تبان
    على الخلفيات الغامقة، وبتتلف في SVG. mask.svg و none.svg مرسومين بإيد، والسكريبت مابيلمسهمش.
.PARAMETER Pictures
    فولدر الصور الأصلية، <name>.png. الافتراضي docs/art/mascot/heroes.
#>
param([string] $Pictures)
. "$PSScriptRoot\common.ps1"
Add-Type -AssemblyName System.Drawing

if (-not $Pictures) { $Pictures = Join-Path $Repo 'docs\art\mascot\heroes' }
$target = Join-Path $FirefoxApp 'kivo\mascot'
$Size = 400
$Outline = 3
$Shapes = @{ '' = 1.0; 'tall' = 0.62; '4x3' = 1.3; '3x2' = 1.6; 'wide' = 2.2 }
$HandDrawn = @('mask', 'none')

if (-not ('KivoSticker' -as [type])) {
    Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public static class KivoSticker
{
    // A white border around the opaque pixels: the alpha grown by radius, white under the picture.
    public static Bitmap Outline(Bitmap source, int radius)
    {
        int w = source.Width, h = source.Height;
        var rect = new Rectangle(0, 0, w, h);
        var data = source.LockBits(rect, ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
        var pixels = new byte[w * h * 4];
        Marshal.Copy(data.Scan0, pixels, 0, pixels.Length);
        source.UnlockBits(data);

        var grown = new byte[w * h];
        for (int y = 0; y < h; y++)
        for (int x = 0; x < w; x++)
        {
            int best = 0;
            for (int dy = -radius; dy <= radius && best < 255; dy++)
            for (int dx = -radius; dx <= radius; dx++)
            {
                if (dx * dx + dy * dy > radius * radius) continue;
                int sx = x + dx, sy = y + dy;
                if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
                int a = pixels[(sy * w + sx) * 4 + 3];
                if (a > best) best = a;
            }
            grown[y * w + x] = (byte)best;
        }

        var result = new byte[w * h * 4];
        for (int i = 0; i < w * h; i++)
        {
            // Picture over a white silhouette.
            float a = pixels[i * 4 + 3] / 255f, under = grown[i] / 255f;
            float outA = a + under * (1 - a);
            for (int c = 0; c < 3; c++)
            {
                float value = outA > 0 ? (pixels[i * 4 + c] * a + 255 * under * (1 - a)) / outA : 0;
                result[i * 4 + c] = (byte)Math.Round(value);
            }
            result[i * 4 + 3] = (byte)Math.Round(outA * 255);
        }
        var bitmap = new Bitmap(w, h, PixelFormat.Format32bppArgb);
        var outData = bitmap.LockBits(rect, ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
        Marshal.Copy(result, 0, outData.Scan0, result.Length);
        bitmap.UnlockBits(outData);
        return bitmap;
    }
}
'@
}


# The picture at $Size with a white sticker outline, as base64 PNG.
function Get-StickerPng([string] $Path) {
    if (-not (Test-Path $Path)) { throw "No picture $Path" }
    $original = [System.Drawing.Bitmap]::new($Path)
    $small = [System.Drawing.Bitmap]::new($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($small)
    try {
        $graphics.Clear([System.Drawing.Color]::Transparent)
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
        $graphics.DrawImage($original, [System.Drawing.Rectangle]::new(0, 0, $Size, $Size))
    }
    finally { $graphics.Dispose(); $original.Dispose() }
    $sticker = [KivoSticker]::Outline($small, $Outline)
    $small.Dispose()
    $stream = [System.IO.MemoryStream]::new()
    try {
        $sticker.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
        return [Convert]::ToBase64String($stream.ToArray())
    }
    finally { $sticker.Dispose(); $stream.Dispose() }
}

# Every mascot/<name>.svg that jar.mn packages.
$jar = [IO.File]::ReadAllText((Join-Path $FirefoxApp 'kivo\jar.mn'))
$names = [regex]::Matches($jar, '(?m)^\s+content/browser/kivo/mascot/([a-z0-9-]+)\.svg ') | ForEach-Object { $_.Groups[1].Value }
$names = @($names | Where-Object { $HandDrawn -notcontains $_ })
if (-not $names) { throw 'jar.mn packages no mascot pictures' }
New-Item -ItemType Directory -Force $target | Out-Null
$utf8 = [Text.UTF8Encoding]::new($false)

# Pictures that jar.mn no longer uses.
foreach ($old in Get-ChildItem $target -Filter *.svg) {
    if ($names -notcontains $old.BaseName -and $HandDrawn -notcontains $old.BaseName) { Remove-Item $old.FullName }
}

$cache = @{}
foreach ($name in $names) {
    $match = [regex]::Match($name, '^(.+?)(?:-(tall|4x3|3x2|wide))?$')
    $picture = $match.Groups[1].Value
    $ratio = $Shapes[$match.Groups[2].Value]
    if (-not $cache.ContainsKey($picture)) { $cache[$picture] = Get-StickerPng (Join-Path $Pictures "$picture.png") }
    $png = $cache[$picture]
    # The square picture in the middle of a box with the proportions of the Firefox image.
    if ($ratio -ge 1) { $width = [int][Math]::Round($Size * $ratio); $height = $Size }
    else { $width = $Size; $height = [int][Math]::Round($Size / $ratio) }
    $x = [int](($width - $Size) / 2); $y = [int](($height - $Size) / 2)
    $svg = "<svg xmlns=`"http://www.w3.org/2000/svg`" xmlns:xlink=`"http://www.w3.org/1999/xlink`" viewBox=`"0 0 $width $height`"><image x=`"$x`" y=`"$y`" width=`"$Size`" height=`"$Size`" xlink:href=`"data:image/png;base64,$png`"/></svg>`n"
    [IO.File]::WriteAllText((Join-Path $target "$name.svg"), $svg, $utf8)
    Write-Host ("{0}.svg {1}x{2} {3:N0} KB" -f $name, $width, $height, ($svg.Length / 1KB))
}
Write-Host "Kivo mascot written to $target"
