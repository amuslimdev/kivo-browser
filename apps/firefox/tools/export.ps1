<#
.SYNOPSIS
    بيطلّع تعديلات Kivo على ملفات Firefox نفسها لـ apps/firefox/patches، patch لكل ملف.
.DESCRIPTION
    patch لكل ملف عشان لما نسخة Firefox جديدة تتعارض مع حاجة، نعرف هي أنهي ملف ونصلّحه لوحده.
    الملفات الجديدة مش patches: بتتحط في apps/firefox (branding/kivo و kivo)، والـ sync بينسخها.
    الـ patches بتتعمل من الـ working tree، فعدّل في نسخة Firefox نفسها، مش في apps/firefox/kivo.
#>
. "$PSScriptRoot\common.ps1"

$patches = Join-Path $FirefoxApp 'patches'
$ErrorActionPreference = 'Continue'
$changed = @(& git -C $Source diff --name-only HEAD | Where-Object { $_ })
$untracked = @(& git -C $Source ls-files --others --exclude-standard |
    Where-Object { $_ -notlike 'browser/branding/kivo/*' -and $_ -notlike 'browser/components/kivo/*' })
$ErrorActionPreference = 'Stop'

if (Test-Path $patches) { Get-ChildItem $patches -Filter *.patch | Remove-Item -Force }
if ($changed.Count -gt 0) { New-Item -ItemType Directory -Force $patches | Out-Null }

foreach ($file in $changed) {
    $name = ($file -replace '[\\/]', '__') + '.patch'
    # --output عشان PowerShell 5.1 بيكتب الـ redirection بـ UTF-16.
    Invoke-Git -C $Source diff --binary "--output=$(Join-Path $patches $name)" HEAD -- $file
    Write-Host "patch: $name"
}

if ($untracked.Count -gt 0) {
    Write-Warning "new files in the Firefox tree are not exported (put them under apps/firefox and copy them in sync.ps1):"
    $untracked | ForEach-Object { Write-Warning "  $_" }
}
Write-Host "$($changed.Count) patches in $patches"
