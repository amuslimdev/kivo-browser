<#
.SYNOPSIS
    بينشر نسخة Kivo اللي package.ps1 عملها كـ release في الـ repo العام (G6 في docs/FIREFOX.md).
.DESCRIPTION
    بيوقّع الـ zip بالمفتاح الخاص (Kivo.exe بيرفض أي تحديث من غيره)، ويكتب update.json اللي Kivo بيقراه كل 6 ساعات
    (kivo.update.url = releases/latest/download/update.json). والـ repo العام فيه كود apps/firefox من نفس الـ commit،
    مع README و LICENSE من apps/firefox/public (رخصة MPL: الكود اللي اتغير في Firefox لازم يبقى متاح لأي حد عنده
    النسخة)، ونفس الكود zip في الـ release.
    من غير -Publish بيجهّز الملفات بس في C:\kivo-src\out\release.
.PARAMETER GitHubRepo
    الـ repo العام (owner/name). (مش Repo: common.ps1 بيستخدم الاسم ده.)
.PARAMETER KeyFile
    المفتاح الخاص. الافتراضي %USERPROFILE%\.kivo-release\release-key.xml. في GitHub Actions بييجي من KIVO_RELEASE_KEY.
.PARAMETER Publish
    يحدّث الـ repo العام ويرفع الـ release بـ gh. بيرفض لو apps/firefox فيه تعديلات مش متسجلة في git.
#>
param([string] $GitHubRepo = 'amuslimdev/kivo-browser', [string] $KeyFile, [switch] $Publish)
. "$PSScriptRoot\common.ps1"

$app = Join-Path $Out 'Kivo'
$ini = Get-Content (Join-Path $app 'browser\application.ini')
function Get-IniValue([string] $name) { ($ini | Where-Object { $_ -match "^$name=" } | Select-Object -First 1) -replace "^$name=", '' }
$version = Get-IniValue 'Version'
$buildId = Get-IniValue 'BuildID'
$zipName = "Kivo-$version-win64.zip"
$zip = Join-Path $Out $zipName
if (-not (Test-Path $zip)) { throw "No $zipName in $Out (run package.ps1)." }

# الكود المنشور لازم يبقى هو اللي اتبنى: apps/firefox متسجل في git ومفيش تعديلات.
$dirty = & git -C $FirefoxApp status --porcelain -- .
$commit = (& git -C $FirefoxApp rev-parse HEAD).Trim()
if ($dirty -and $Publish) { throw "apps/firefox has changes that are not committed:`n$($dirty -join "`n")" }

$keyXml = if ($env:KIVO_RELEASE_KEY) { $env:KIVO_RELEASE_KEY } else {
    if (-not $KeyFile) { $KeyFile = Join-Path $env:USERPROFILE '.kivo-release\release-key.xml' }
    Get-Content $KeyFile -Raw
}
$rsa = [System.Security.Cryptography.RSACng]::new()
$rsa.FromXmlString($keyXml)
$trusted = (Get-Content (Join-Path $FirefoxApp 'release-key.pub.xml') -Raw).Trim()
if ($rsa.ToXmlString($false) -ne $trusted) { throw 'This is not the key in release-key.pub.xml, so Kivo would refuse the update.' }

$sha256 = [System.Security.Cryptography.HashAlgorithmName]::SHA256
$pkcs1 = [System.Security.Cryptography.RSASignaturePadding]::Pkcs1
$stream = [IO.File]::OpenRead($zip)
try { $signature = [Convert]::ToBase64String($rsa.SignData($stream, $sha256, $pkcs1)) } finally { $stream.Dispose() }

$release = Join-Path $Out 'release'
if (Test-Path $release) { Remove-Item $release -Recurse -Force }
New-Item -ItemType Directory -Force $release | Out-Null
Copy-Item $zip $release
$tag = "$version-$buildId"
$update = [ordered]@{
    version = $version
    buildId = $buildId
    url = "https://github.com/$GitHubRepo/releases/download/$tag/$zipName"
    size = (Get-Item $zip).Length
    sha256 = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLowerInvariant()
    signature = $signature
}
[IO.File]::WriteAllText((Join-Path $release 'update.json'), (($update | ConvertTo-Json) -replace "`r`n", "`n") + "`n", [Text.UTF8Encoding]::new($false))

# شكل الـ repo العام: README و LICENSE فوق، و apps/firefox زي ما هو في الـ commit ده (من غير public).
$public = Join-Path $release 'public'
$archive = Join-Path $release 'apps-firefox.zip'
# من أول الـ repo: من فولدر جواه، git archive بيدوّر على نفس الفولدر جوه الـ tree ويطلع فاضي.
Invoke-Git -C $Repo archive --format=zip --prefix=apps/firefox/ -o $archive "${commit}:apps/firefox"
Expand-Archive $archive $public
Remove-Item $archive -Force
foreach ($file in 'README.md', 'LICENSE') {
    $from = Join-Path $public "apps\firefox\public\$file"
    # تجربة من غير -Publish قبل ما public يتسجل في git.
    if (-not (Test-Path $from)) { $from = Join-Path $FirefoxApp "public\$file" }
    Copy-Item $from $public
}
$inner = Join-Path $public 'apps\firefox\public'
if (Test-Path $inner) { Remove-Item $inner -Recurse -Force }
$sourceName = "Kivo-$version-source.zip"
Compress-Archive -Path (Join-Path $public '*') -DestinationPath (Join-Path $release $sourceName)
Write-Host "Kivo $version ($buildId), commit $commit"
Get-ChildItem $release -File | ForEach-Object { Write-Host "  $($_.Name) ($([math]::Round($_.Length / 1MB, 1)) MB)" }
if (-not $Publish) { return }

# الـ repo العام: نفس الكود، commit لكل release، بهوية الـ repo الخاص (مش هوية الجهاز).
$name = (& git -C $FirefoxApp config --local user.name)
$email = (& git -C $FirefoxApp config --local user.email)
if (-not $name -or -not $email) { throw 'Set user.name and user.email in this repo (git config --local) first.' }
$mirror = Join-Path $KivoSrc 'kivo-browser'
if (-not (Test-Path (Join-Path $mirror '.git'))) { Invoke-Git clone --quiet "https://github.com/$GitHubRepo.git" $mirror }
Invoke-Git -C $mirror fetch --quiet origin
$ErrorActionPreference = 'Continue'
& git -C $mirror rev-parse --verify --quiet origin/main | Out-Null
$hasMain = -not $LASTEXITCODE
$ErrorActionPreference = 'Stop'
if ($hasMain) { Invoke-Git -C $mirror checkout --quiet -B main origin/main } else { Invoke-Git -C $mirror symbolic-ref HEAD refs/heads/main }
$ErrorActionPreference = 'Continue'
$null = & robocopy $public $mirror /MIR /XD .git /NFL /NDL /NJH /NJS /NP
$copy = $LASTEXITCODE
$ErrorActionPreference = 'Stop'
if ($copy -ge 8) { throw "Copy to $mirror failed (robocopy $copy)." }
Invoke-Git -C $mirror add -A
if (& git -C $mirror status --porcelain) {
    Invoke-Git -C $mirror -c "user.name=$name" -c "user.email=$email" commit --quiet -m "Kivo $version (build $buildId)"
}
Invoke-Git -C $mirror -c credential.helper= -c 'credential.helper=!gh auth git-credential' push --quiet origin main
$target = (& git -C $mirror rev-parse HEAD).Trim()

$notes = @"
Kivo $version (Firefox $version), build $buildId.

Kivo updates itself: it downloads this release in the background and installs it the next time it opens.
$sourceName is this repository at $target. Firefox itself is $($Lock.repo) at $($Lock.revision).
"@
$ErrorActionPreference = 'Continue'
& gh release create $tag (Join-Path $release $zipName) (Join-Path $release 'update.json') (Join-Path $release $sourceName) --repo $GitHubRepo --target $target --title "Kivo $version" --notes $notes --latest
$ErrorActionPreference = 'Stop'
if ($LASTEXITCODE) { throw "gh release create failed ($LASTEXITCODE)" }
Write-Host "Published https://github.com/$GitHubRepo/releases/tag/$tag"
