# ./mach على كود Firefox بتاع Kivo، بالـ mozconfig بتاعنا.
# .\apps\firefox\tools\mach.ps1 build browser/themes
. "$PSScriptRoot\common.ps1"
Invoke-Mach @args
