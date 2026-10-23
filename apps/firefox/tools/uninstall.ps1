# بيتنسخ جنب Kivo وقت التثبيت (install.ps1)، و Settings > Apps بيشغّله. بيشيل البرنامج والاختصار ومدخلات
# الـ registry، وبيسيب بيانات الـ profiles في %APPDATA%\Kivo. الرسايل إنجليزي (Windows PowerShell 5.1 encoding).
$ErrorActionPreference = 'Stop'
$dir = $PSScriptRoot

$running = Get-Process kivo-browser, Kivo -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($dir, [StringComparison]::OrdinalIgnoreCase) }
if ($running) {
    $null = (New-Object -ComObject WScript.Shell).Popup('Close Kivo, then uninstall it again.', 0, 'Kivo', 48)
    exit 1
}

$startMenu = Join-Path ([Environment]::GetFolderPath('Programs')) 'Kivo.lnk'
if (Test-Path $startMenu) { Remove-Item $startMenu -Force }
Remove-Item 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Kivo' -Recurse -Force -ErrorAction SilentlyContinue
Remove-ItemProperty 'HKCU:\Software\Mozilla\Kivo\TaskBarIDs' -Name $dir -ErrorAction SilentlyContinue
# تسجيل Kivo كمتصفح (install.ps1). لو كان الافتراضي، Windows بيرجع يسأل عن متصفح تاني.
foreach ($key in 'HKCU:\Software\Classes\KivoURL', 'HKCU:\Software\Classes\KivoHTML', 'HKCU:\Software\Classes\KivoPDF', 'HKCU:\Software\Clients\StartMenuInternet\Kivo') {
    Remove-Item $key -Recurse -Force -ErrorAction SilentlyContinue
}
Remove-ItemProperty 'HKCU:\Software\RegisteredApplications' -Name 'Kivo' -ErrorAction SilentlyContinue

# الفولدر فيه السكريبت ده نفسه، فبيتمسح بعد ما يخلص.
Start-Process cmd.exe -ArgumentList "/c ping -n 3 127.0.0.1 >nul & rmdir /s /q `"$dir`"" -WindowStyle Hidden
