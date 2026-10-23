<#
.SYNOPSIS
    بيعمل مفتاح التوقيع بتاع نسخ Kivo (G6 في docs/FIREFOX.md). مرة واحدة بس.
.DESCRIPTION
    Kivo.exe بيركّب أي تحديث بس لو موقّع بالمفتاح ده. العام بيتحفظ في apps/firefox/release-key.pub.xml وبيدخل جوه
    Kivo.exe وقت الـ package، والخاص في فولدر برا الـ repo، وبيتحط في secrets بتاعة GitHub عشان GitHub Actions يوقّع.
    لو المفتاح الخاص ضاع، النسخ المتثبتة مش هتقبل تحديثات جديدة، فلازم يتحفظ في مكان آمن.
.PARAMETER KeyFolder
    فولدر المفتاح الخاص. الافتراضي %USERPROFILE%\.kivo-release. (مش Out: common.ps1 بيستخدم الاسم ده.)
#>
param([string] $KeyFolder = (Join-Path $env:USERPROFILE '.kivo-release'))
. "$PSScriptRoot\common.ps1"

$private = Join-Path $KeyFolder 'release-key.xml'
$public = Join-Path $FirefoxApp 'release-key.pub.xml'
if (Test-Path $private) { throw "A release key already exists in $KeyFolder. Keep it: every installed Kivo trusts it." }

$rsa = [System.Security.Cryptography.RSACng]::new(3072)
New-Item -ItemType Directory -Force $KeyFolder | Out-Null
[IO.File]::WriteAllText($private, $rsa.ToXmlString($true), [Text.UTF8Encoding]::new($false))
[IO.File]::WriteAllText($public, $rsa.ToXmlString($false) + "`n", [Text.UTF8Encoding]::new($false))
Write-Host "Private key: $private (back it up, and never commit it)"
Write-Host "Public key: $public"
