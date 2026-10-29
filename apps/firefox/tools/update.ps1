<#
.SYNOPSIS
    بيحدّث Kivo لآخر Firefox (مرحلة "Kivo يومي" في docs/FIREFOX.md، لحد التحديث التلقائي في G6).
.DESCRIPTION
    بيسأل Mozilla عن آخر Firefox، ولو أحدث من firefox.lock: sync.ps1 -Update (الـ tag بتاع النسخة دي، والـ patches)،
    و mach build، و package.ps1، و install.ps1. Kivo نفسه بيقول لما فيه نسخة أحدث (KivoShell.sys.mjs).
    لو Firefox نزّل نسخة كبيرة (159 مثلًا) والـ patches مابقتش بتركب، sync بيقف ويقول أنهي patch.
.PARAMETER Check
    بيقول بس فيه تحديث ولا لأ.
.PARAMETER NoInstall
    من غير install في الآخر (لو Kivo مفتوح مثلًا): النسخة بتفضل في C:\kivo-src\out\Kivo.
#>
param([switch] $Check, [switch] $NoInstall)
. "$PSScriptRoot\common.ps1"

# Windows PowerShell 5.1 بيبدأ من غير TLS 1.2.
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$latest = (Invoke-RestMethod 'https://product-details.mozilla.org/1.0/firefox_versions.json' -UseBasicParsing).LATEST_FIREFOX_VERSION
$current = $Lock.version
if ([version]$latest -le [version]$current) {
    Write-Host "Kivo is on Firefox $current, the latest. Nothing to update."
    return
}
Write-Host "Firefox $latest is out (Kivo is on $current)."
if ($Check) { return }

& (Join-Path $PSScriptRoot 'sync.ps1') -Update -NoBootstrap
$updated = (Get-Content (Join-Path $FirefoxApp 'firefox.lock') -Raw | ConvertFrom-Json).version
if ([version]$updated -lt [version]$latest) {
    throw "firefox.lock is still on Firefox $updated (expected $latest)."
}
Invoke-Mach build
& (Join-Path $PSScriptRoot 'package.ps1')
if ($NoInstall) {
    Write-Host "Kivo $updated is ready in $(Join-Path $Out 'Kivo'). Install it with install.ps1 when Kivo is closed."
    return
}
& (Join-Path $PSScriptRoot 'install.ps1') -ViaExplorer
Write-Host "Kivo is on Firefox $updated now."
