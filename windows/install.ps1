# Deskworlds for Windows: install.
#
# Fetches Electron and koffi, assembles the app under %LOCALAPPDATA%\Programs\Deskworlds
# with its own copy of the scenes, starts it now and at every sign-in, and adds a Start
# menu shortcut. The Windows counterpart of wallpaper/install.sh. Run it again to update.
#
# The scenes come from the Deskworlds checkout this folder sits in. When it sits on its
# own instead, they are downloaded from GitHub for the install and the download is
# removed afterwards.

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$here = $PSScriptRoot
$project = Split-Path -Parent $here
$app = Join-Path $env:LOCALAPPDATA 'Programs\Deskworlds'
$exe = Join-Path $app 'Deskworlds.exe'
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$shortcut = Join-Path ([Environment]::GetFolderPath('Programs')) 'Deskworlds.lnk'

function Step([string]$text) { Write-Host "==> $text" -ForegroundColor Cyan }

function Stop-Deskworlds {
  # Asked first, so the app restores the desktop picture on its way out.
  if (Test-Path $exe) {
    Start-Process -FilePath $exe -ArgumentList '--quit' -WindowStyle Hidden
    for ($i = 0; $i -lt 20 -and (Get-Process -Name 'Deskworlds' -ErrorAction SilentlyContinue); $i++) {
      Start-Sleep -Milliseconds 250
    }
  }
  Get-Process -Name 'Deskworlds' -ErrorAction SilentlyContinue | Stop-Process -Force
  Start-Sleep -Milliseconds 500
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "需要 Node.js 20 或更新版本（只在安装时用到）。请先从 https://nodejs.org 安装 LTS 版本，然后重新运行。"
}
$major = [int]((node --version).TrimStart('v').Split('.')[0])
if ($major -lt 20) {
  throw "Node.js 版本太旧（$(node --version)），需要 20 或更新版本。"
}

$download = $null
if (-not (Test-Path (Join-Path $project 'scenes'))) {
  Step '这个文件夹不在 Deskworlds 仓库里，正在从 GitHub 下载场景（约 60 MB）'
  $archive = 'https://github.com/chaseleantj/deskworlds/archive/refs/heads/main.zip'
  $download = Join-Path ([IO.Path]::GetTempPath()) ("deskworlds-source-" + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $download -Force | Out-Null
  $zip = Join-Path $download 'deskworlds.zip'
  # Windows PowerShell 5.1 may still default to TLS 1.0, which GitHub refuses.
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
  try {
    Invoke-WebRequest -Uri $archive -OutFile $zip -UseBasicParsing
  } catch {
    throw "下载场景失败：$($_.Exception.Message)`n也可以手动下载 $archive ，解压后把 windows 文件夹放进解压出来的 deskworlds-main 文件夹里（与 scenes 同级），再运行 install.cmd。"
  }
  Expand-Archive -Path $zip -DestinationPath $download -Force
  $project = Get-ChildItem -Path $download -Directory |
    Where-Object { Test-Path (Join-Path $_.FullName 'scenes') } |
    Select-Object -First 1 -ExpandProperty FullName
  if (-not $project) {
    throw "下载的压缩包里没有找到 scenes 文件夹。请改用手动方式：下载 $archive ，解压后把 windows 文件夹放进去再运行。"
  }
}

Step '下载 Electron 和 koffi（第一次约 100 MB，之后走缓存）'
Push-Location $here
try {
  npm install --no-fund --no-audit
  if ($LASTEXITCODE -ne 0) { throw 'npm install 失败。网络不好时可先运行：npm config set registry https://registry.npmmirror.com' }
  # Electron fetches its runtime on first use rather than at install time.
  node node_modules/electron/install.js
  if ($LASTEXITCODE -ne 0) {
    throw 'Electron 运行时下载失败。在国内可以先运行：$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/" 然后在同一个窗口里重新运行 install.ps1'
  }
} finally {
  Pop-Location
}
$dist = Join-Path $here 'node_modules\electron\dist'
if (-not (Test-Path (Join-Path $dist 'electron.exe'))) {
  throw "没有找到 $dist\electron.exe，Electron 下载可能不完整。删除 windows\node_modules 后重试。"
}

Step '关闭正在运行的 Deskworlds'
Stop-Deskworlds

Step "安装到 $app"
if (Test-Path $app) { Remove-Item $app -Recurse -Force }
New-Item -ItemType Directory -Path $app -Force | Out-Null
Copy-Item -Path (Join-Path $dist '*') -Destination $app -Recurse -Force
Rename-Item -Path (Join-Path $app 'electron.exe') -NewName 'Deskworlds.exe'
# Electron starts resources\app when it is there; its own default app is not needed.
Remove-Item (Join-Path $app 'resources\default_app.asar') -Force -ErrorAction SilentlyContinue

$resources = Join-Path $app 'resources\app'
New-Item -ItemType Directory -Path $resources -Force | Out-Null
foreach ($file in 'main.js', 'desktop.js', 'preload.js', 'settings-preload.js', 'package.json', 'icon.ico', 'icon.png') {
  Copy-Item -Path (Join-Path $here $file) -Destination $resources
}
Copy-Item -Path (Join-Path $here 'host') -Destination $resources -Recurse
# koffi, and the prebuilt binary npm picked for this machine beside it.
$modules = Join-Path $resources 'node_modules'
New-Item -ItemType Directory -Path $modules -Force | Out-Null
Copy-Item -Path (Join-Path $here 'node_modules\koffi') -Destination $modules -Recurse
Copy-Item -Path (Join-Path $here 'node_modules\@koromix') -Destination $modules -Recurse

# The app's own copy of the scenes, without their tests.
$scene = Join-Path $resources 'scene'
$scenes = Join-Path $scene 'scenes'
New-Item -ItemType Directory -Path $scenes -Force | Out-Null
Get-ChildItem -Path (Join-Path $project 'scenes') -Directory | ForEach-Object {
  Copy-Item -Path $_.FullName -Destination $scenes -Recurse
}
Copy-Item -Path (Join-Path $project 'vendor'), (Join-Path $project 'ui') -Destination $scene -Recurse
Get-ChildItem -Path $scenes -Directory | ForEach-Object {
  $tests = Join-Path $_.FullName 'tests'
  if (Test-Path $tests) { Remove-Item $tests -Recurse -Force }
}

if ($download) { Remove-Item $download -Recurse -Force -ErrorAction SilentlyContinue }

Step '设置开机自动启动，并添加开始菜单快捷方式'
Set-ItemProperty -Path $runKey -Name 'Deskworlds' -Value "`"$exe`""
$shell = New-Object -ComObject WScript.Shell
$link = $shell.CreateShortcut($shortcut)
$link.TargetPath = $exe
$link.WorkingDirectory = $app
$link.IconLocation = (Join-Path $resources 'icon.ico')
$link.Description = 'Deskworlds：会动的 3D 桌面壁纸'
$link.Save()

Step '启动'
Start-Process -FilePath $exe

Write-Host ''
Write-Host "Deskworlds 已安装：$app" -ForegroundColor Green
Write-Host '第一帧大约 20 秒后出现。托盘图标在任务栏右下角（可能收在 ^ 里），点它切换世界、喂食或暂停。'
Write-Host '桌面壁纸本身没有被修改，世界是画在它上面的。'
