<#
.SYNOPSIS
    بيثبّت Kivo للمستخدم ده: %LOCALAPPDATA%\Programs\Kivo، واختصار في Start، ومدخل في Settings > Apps.
.DESCRIPTION
    من غير admin، زي Chrome و VS Code لما يتثبتوا للمستخدم. الـ uninstall من Settings > Apps بيشيل البرنامج
    والاختصار، وبيسيب بيانات الـ profiles في %APPDATA%\Kivo.

    الاختصار ليه System.AppUserModel.ID ثابت (Kivo.Browser)، والمحرك بياخد نفس الـ ID من
    HKCU\Software\Mozilla\Kivo\TaskBarIDs (WinTaskbar.cpp)، فنوافذ Kivo بتتجمع تحت الاختصار، والـ pin في الـ
    taskbar بيفتح Kivo.exe بهويته، مش المحرك لوحده.

    لازم يتشغّل من PowerShell عادي. Claude desktop متغلف MSIX، وأي كتابة منه في AppData أو HKCU بتروح لفولدره هو،
    فمن Claude استخدم -ViaExplorer: بيشغّل السكريبت عن طريق Explorer (برا الـ MSIX) ويستنى النتيجة.
.PARAMETER Build
    نسخة Kivo اللي package.ps1 عملها. الافتراضي C:\kivo-src\out\Kivo.
.PARAMETER Log
    ملف بيتكتب فيه اللي حصل، لأن التشغيل من Explorer مالوش console.
#>
param([string] $Build, [string] $Log, [switch] $ViaExplorer)
. "$PSScriptRoot\common.ps1"

if (-not $Build) { $Build = Join-Path $Out 'Kivo' }
$Destination = Join-Path $env:LOCALAPPDATA 'Programs\Kivo'
$AppId = 'Kivo.Browser'

if ($ViaExplorer) {
    $logFile = Join-Path $KivoSrc 'install.log'
    if (Test-Path $logFile) { Remove-Item $logFile -Force }
    # اختصار عادي لـ PowerShell، و Explorer هو اللي بيفتحه، فالسكريبت بيشتغل برا الـ MSIX بتاع Claude.
    $runner = Join-Path $KivoSrc 'install-kivo.lnk'
    $shell = New-Object -ComObject WScript.Shell
    $link = $shell.CreateShortcut($runner)
    $link.TargetPath = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $link.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$PSCommandPath`" -Build `"$Build`" -Log `"$logFile`""
    $link.WindowStyle = 7
    $link.Save()
    Start-Process explorer.exe -WindowStyle Hidden -ArgumentList "`"$runner`""
    $started = Get-Date
    while (((Get-Date) - $started).TotalSeconds -lt 180) {
        if ((Test-Path $logFile) -and (Get-Content $logFile -Raw) -match '(?m)^(DONE|FAILED)') { break }
        Start-Sleep -Milliseconds 500
    }
    Remove-Item $runner -Force -ErrorAction SilentlyContinue
    if (-not (Test-Path $logFile)) { throw 'The installer did not start (no log).' }
    $text = Get-Content $logFile -Raw
    Write-Host $text
    if ($text -notmatch '(?m)^DONE') { throw 'Install failed.' }
    return
}

function Say([string] $message) {
    Write-Host $message
    if ($Log) { Add-Content -Path $Log -Value $message -Encoding UTF8 }
}

try {
    if (-not (Test-Path (Join-Path $Build 'Kivo.exe'))) { throw "No Kivo build in $Build (run package.ps1)." }
    $running = Get-Process kivo-browser, Kivo -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($Destination, [StringComparison]::OrdinalIgnoreCase) }
    if ($running) { throw 'Kivo is running from the install folder. Close it and run the installer again.' }

    $ErrorActionPreference = 'Continue'
    $null = & robocopy $Build $Destination /MIR /NFL /NDL /NJH /NJS /NP
    $copy = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    if ($copy -ge 8) { throw "Copy failed (robocopy $copy)." }
    Copy-Item (Join-Path $PSScriptRoot 'uninstall.ps1') $Destination -Force
    Say "Copied to $Destination"

    $taskbar = 'HKCU:\Software\Mozilla\Kivo\TaskBarIDs'
    New-Item -Path $taskbar -Force | Out-Null
    New-ItemProperty -Path $taskbar -Name $Destination -Value $AppId -PropertyType String -Force | Out-Null

    if (-not ('KivoShortcut' -as [type])) {
        Add-Type -TypeDefinition (Get-Content (Join-Path $PSScriptRoot 'Shortcut.cs') -Raw -Encoding UTF8)
    }
    $startMenu = Join-Path ([Environment]::GetFolderPath('Programs')) 'Kivo.lnk'
    [KivoShortcut]::Create($startMenu, (Join-Path $Destination 'Kivo.exe'), $Destination, 'Kivo', $AppId)
    Say "Start menu: $startMenu"

    # Kivo كمتصفح في Windows (Settings > Default apps): ProgIDs للينكات والصفحات والـ PDF، و StartMenuInternet، و
    # RegisteredApplications. اللينك من برنامج تاني بيوصل "-osint -url <link>" زي Firefox (Launcher.cs).
    $exe = Join-Path $Destination 'Kivo.exe'
    $command = "`"$exe`" -osint -url `"%1`""
    $progIds = [ordered]@{ KivoURL = 'Kivo URL'; KivoHTML = 'Kivo HTML Document'; KivoPDF = 'Kivo PDF Document' }
    foreach ($id in $progIds.Keys) {
        $key = "HKCU:\Software\Classes\$id"
        New-Item -Path "$key\shell\open\command" -Force | Out-Null
        New-Item -Path "$key\DefaultIcon" -Force | Out-Null
        Set-Item -Path $key -Value $progIds[$id]
        New-ItemProperty -Path $key -Name FriendlyTypeName -Value $progIds[$id] -PropertyType String -Force | Out-Null
        New-ItemProperty -Path $key -Name AppUserModelID -Value $AppId -PropertyType String -Force | Out-Null
        Set-Item -Path "$key\DefaultIcon" -Value "$exe,0"
        Set-Item -Path "$key\shell\open\command" -Value $command
    }
    New-ItemProperty -Path 'HKCU:\Software\Classes\KivoURL' -Name 'URL Protocol' -Value '' -PropertyType String -Force | Out-Null
    $client = 'HKCU:\Software\Clients\StartMenuInternet\Kivo'
    foreach ($sub in 'Capabilities\URLAssociations', 'Capabilities\FileAssociations', 'Capabilities\StartMenu', 'DefaultIcon', 'shell\open\command') {
        New-Item -Path "$client\$sub" -Force | Out-Null
    }
    Set-Item -Path $client -Value 'Kivo'
    Set-Item -Path "$client\DefaultIcon" -Value "$exe,0"
    Set-Item -Path "$client\shell\open\command" -Value "`"$exe`""
    $capabilities = "$client\Capabilities"
    foreach ($pair in @(@('ApplicationName', 'Kivo'), @('ApplicationDescription', 'Kivo, your own browser'), @('ApplicationIcon', "$exe,0"))) {
        New-ItemProperty -Path $capabilities -Name $pair[0] -Value $pair[1] -PropertyType String -Force | Out-Null
    }
    New-ItemProperty -Path "$capabilities\StartMenu" -Name StartMenuInternet -Value 'Kivo' -PropertyType String -Force | Out-Null
    foreach ($scheme in 'http', 'https') {
        New-ItemProperty -Path "$capabilities\URLAssociations" -Name $scheme -Value 'KivoURL' -PropertyType String -Force | Out-Null
    }
    foreach ($extension in '.htm', '.html', '.shtml', '.xht', '.xhtml', '.svg', '.webp', '.avif') {
        New-ItemProperty -Path "$capabilities\FileAssociations" -Name $extension -Value 'KivoHTML' -PropertyType String -Force | Out-Null
    }
    New-ItemProperty -Path "$capabilities\FileAssociations" -Name '.pdf' -Value 'KivoPDF' -PropertyType String -Force | Out-Null
    New-Item -Path 'HKCU:\Software\RegisteredApplications' -Force | Out-Null
    New-ItemProperty -Path 'HKCU:\Software\RegisteredApplications' -Name 'Kivo' -Value 'Software\Clients\StartMenuInternet\Kivo\Capabilities' -PropertyType String -Force | Out-Null
    if (-not ('KivoShellNotify' -as [type])) {
        Add-Type -Namespace '' -Name KivoShellNotify -MemberDefinition '[System.Runtime.InteropServices.DllImport("shell32.dll")] public static extern void SHChangeNotify(int eventId, uint flags, System.IntPtr item1, System.IntPtr item2);'
    }
    # SHCNE_ASSOCCHANGED: Windows يقرا التسجيل الجديد من غير restart.
    [KivoShellNotify]::SHChangeNotify(0x08000000, 0, [IntPtr]::Zero, [IntPtr]::Zero)
    Say 'Default apps: Kivo is a browser now'

    $version = ((Get-Content (Join-Path $Destination 'browser\application.ini')) | Where-Object { $_ -match '^Version=' } | Select-Object -First 1) -replace '^Version=', ''
    $sizeKb = [int]((Get-ChildItem $Destination -Recurse -File | Measure-Object Length -Sum).Sum / 1KB)
    $uninstall = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Kivo'
    New-Item -Path $uninstall -Force | Out-Null
    $values = @{
        DisplayName = 'Kivo'
        DisplayVersion = $version
        Publisher = 'Kivo'
        DisplayIcon = (Join-Path $Destination 'Kivo.exe')
        InstallLocation = $Destination
        UninstallString = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$(Join-Path $Destination 'uninstall.ps1')`""
    }
    foreach ($name in $values.Keys) { New-ItemProperty -Path $uninstall -Name $name -Value $values[$name] -PropertyType String -Force | Out-Null }
    foreach ($name in 'NoModify', 'NoRepair') { New-ItemProperty -Path $uninstall -Name $name -Value 1 -PropertyType DWord -Force | Out-Null }
    New-ItemProperty -Path $uninstall -Name EstimatedSize -Value $sizeKb -PropertyType DWord -Force | Out-Null
    Say "Settings > Apps: Kivo $version"
    Say 'DONE'
}
catch {
    Say "FAILED: $($_.Exception.Message)"
    exit 1
}
