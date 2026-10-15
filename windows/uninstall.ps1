# Deskworlds for Windows: stop it and remove it. The installer never changes the desktop
# picture, so the one underneath is still yours. Add -Purge to also delete the saved
# world choice and the log in %APPDATA%\Deskworlds.
param([switch]$Purge)

$ErrorActionPreference = 'Stop'

$app = Join-Path $env:LOCALAPPDATA 'Programs\Deskworlds'
$exe = Join-Path $app 'Deskworlds.exe'
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$shortcut = Join-Path ([Environment]::GetFolderPath('Programs')) 'Deskworlds.lnk'

# Asked first, so the app restores the desktop picture on its way out.
if (Test-Path $exe) {
  Start-Process -FilePath $exe -ArgumentList '--quit' -WindowStyle Hidden
  for ($i = 0; $i -lt 20 -and (Get-Process -Name 'Deskworlds' -ErrorAction SilentlyContinue); $i++) {
    Start-Sleep -Milliseconds 250
  }
}
Get-Process -Name 'Deskworlds' -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Milliseconds 500

Remove-ItemProperty -Path $runKey -Name 'Deskworlds' -ErrorAction SilentlyContinue
Remove-Item $shortcut -Force -ErrorAction SilentlyContinue
if (Test-Path $app) { Remove-Item $app -Recurse -Force }
if ($Purge) {
  Remove-Item (Join-Path $env:APPDATA 'Deskworlds') -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item (Join-Path $env:APPDATA 'Deskworlds Preview') -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host 'Deskworlds 已卸载。' -ForegroundColor Green
