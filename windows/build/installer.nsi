; Deskworlds for Windows: the installer. Built by build-installer.mjs, which passes
;   VERSION      shown to people, e.g. 1.1.0
;   VERSION4     the four-part file version, e.g. 1.1.0.4
;   STAGE_FILES  the assembled app, as a wildcard over its folder
;   OUTFILE      where the installer is written
;   ICON         the app icon
;
; Installs for the current user under %LOCALAPPDATA%\Programs\Deskworlds, so it needs no
; administrator rights, the way the Mac app lives in ~/Applications. Everything the app
; needs is inside; nothing is downloaded while installing.

Unicode true
SetCompressor /SOLID lzma
; A dictionary larger than the default 8 MB lets LZMA find repeats across the whole app.
SetCompressorDictSize 64
RequestExecutionLevel user
ManifestDPIAware true

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"

!define APP "Deskworlds"
!define EXE "Deskworlds.exe"
!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\Deskworlds"
!define RUN_KEY "Software\Microsoft\Windows\CurrentVersion\Run"
!define STARTUP_APPROVED "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run"

Name "${APP}"
OutFile "${OUTFILE}"
InstallDir "$LOCALAPPDATA\Programs\${APP}"
BrandingText "${APP} ${VERSION}"
ShowInstDetails nevershow
ShowUninstDetails nevershow

!define MUI_ICON "${ICON}"
!define MUI_UNICON "${ICON}"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "$(WelcomeTitle)"
!define MUI_WELCOMEPAGE_TEXT "$(WelcomeText)"
!define MUI_FINISHPAGE_TITLE "$(FinishTitle)"
!define MUI_FINISHPAGE_TEXT "$(FinishText)"
!define MUI_FINISHPAGE_RUN "$INSTDIR\${EXE}"
!define MUI_FINISHPAGE_RUN_TEXT "$(RunText)"
; NSIS's usual second finish-page checkbox, put to work for the desktop shortcut.
!define MUI_FINISHPAGE_SHOWREADME ""
!define MUI_FINISHPAGE_SHOWREADME_TEXT "$(DesktopText)"
!define MUI_FINISHPAGE_SHOWREADME_FUNCTION CreateDesktopShortcut

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

; The first language is the fallback; Windows set to Chinese gets Chinese.
!insertmacro MUI_LANGUAGE "English"
!insertmacro MUI_LANGUAGE "SimpChinese"

LangString WelcomeTitle ${LANG_ENGLISH} "Install Deskworlds"
LangString WelcomeTitle ${LANG_SIMPCHINESE} "安装 Deskworlds"
LangString WelcomeText ${LANG_ENGLISH} "Deskworlds puts a small living 3D world on your desktop, behind your icons. The creatures react to your cursor, and you can feed them.$\r$\n$\r$\nIt installs for you only and needs no administrator rights. Your desktop picture is not changed; the world draws on top of it."
LangString WelcomeText ${LANG_SIMPCHINESE} "Deskworlds 会在桌面图标后面放一个会动的 3D 小世界。里面的生物会对鼠标做出反应，你还可以给它们喂食。$\r$\n$\r$\n只为当前用户安装，不需要管理员权限。你的桌面壁纸不会被修改，世界是画在它上面的。"
LangString FinishTitle ${LANG_ENGLISH} "Deskworlds is installed"
LangString FinishTitle ${LANG_SIMPCHINESE} "Deskworlds 已安装"
LangString FinishText ${LANG_ENGLISH} "The first frame takes about 20 seconds to appear. The Deskworlds icon in the notification area switches worlds, feeds and pauses. Ctrl+Alt+F feeds, Ctrl+Alt+P pauses, Ctrl+Alt+W changes the world, and double-clicking empty desktop feeds too.$\r$\n$\r$\nIt starts at sign-in; untick that in its menu if you would rather not."
LangString FinishText ${LANG_SIMPCHINESE} "第一帧大约 20 秒后出现。点任务栏右下角的 Deskworlds 图标，可以切换世界、喂食、暂停。也可以用 Ctrl+Alt+F 喂食、Ctrl+Alt+P 暂停、Ctrl+Alt+W 换世界，或者双击桌面空白处喂食。$\r$\n$\r$\n它会开机自动启动。不需要的话，在托盘菜单里取消勾选即可。"
LangString RunText ${LANG_ENGLISH} "Start Deskworlds now"
LangString RunText ${LANG_SIMPCHINESE} "立即启动 Deskworlds"
LangString DesktopText ${LANG_ENGLISH} "Create a desktop shortcut"
LangString DesktopText ${LANG_SIMPCHINESE} "在桌面创建快捷方式"

VIProductVersion "${VERSION4}"
VIAddVersionKey /LANG=${LANG_ENGLISH} "ProductName" "${APP}"
VIAddVersionKey /LANG=${LANG_ENGLISH} "FileDescription" "${APP} Setup"
VIAddVersionKey /LANG=${LANG_ENGLISH} "FileVersion" "${VERSION4}"
VIAddVersionKey /LANG=${LANG_ENGLISH} "ProductVersion" "${VERSION}"
VIAddVersionKey /LANG=${LANG_ENGLISH} "LegalCopyright" "MIT License"

; A running copy is asked to quit first, so it puts the desktop picture back on its way
; out, and only then stopped outright if it is still there.
!macro CloseRunning
  ${If} ${FileExists} "$INSTDIR\${EXE}"
    ExecWait '"$INSTDIR\${EXE}" --quit'
    Sleep 2000
  ${EndIf}
  nsExec::Exec 'taskkill /F /IM ${EXE}'
  Pop $0
  Sleep 300
!macroend

Var Updating
Var StartAtLogin

Section "Install"
  SetShellVarContext current
  ; Read before anything is replaced: whether this updates an installed copy, and
  ; whether that copy was set to start at sign-in.
  StrCpy $Updating 0
  ${If} ${FileExists} "$INSTDIR\${EXE}"
    StrCpy $Updating 1
  ${EndIf}
  ClearErrors
  ReadRegStr $StartAtLogin HKCU "${RUN_KEY}" "${APP}"
  !insertmacro CloseRunning
  ; An earlier copy, from this installer or from install.cmd, is replaced whole so no
  ; stale files are left beside the new ones.
  ${If} ${FileExists} "$INSTDIR\${EXE}"
    RMDir /r "$INSTDIR"
  ${EndIf}

  SetOutPath "$INSTDIR"
  File /r "${STAGE_FILES}"
  WriteUninstaller "$INSTDIR\Uninstall.exe"

  CreateShortcut "$SMPROGRAMS\${APP}.lnk" "$INSTDIR\${EXE}" "" "$INSTDIR\${EXE}" 0

  ; Start at sign-in, written the way the app's own menu writes it, so the checkbox
  ; there reads it back and can turn it off. A new install turns it on; an update keeps
  ; whatever was chosen, rather than undoing an "off".
  ${If} $Updating == 0
  ${OrIf} $StartAtLogin != ""
    WriteRegStr HKCU "${RUN_KEY}" "${APP}" '"$INSTDIR\${EXE}"'
  ${EndIf}

  ; Apps & features, so it uninstalls like any other app.
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayName" "${APP}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayIcon" "$INSTDIR\${EXE},0"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "Publisher" "Deskworlds"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "URLInfoAbout" "https://github.com/chaseleantj/deskworlds"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKCU "${UNINSTALL_KEY}" "QuietUninstallString" '"$INSTDIR\Uninstall.exe" /S'
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoRepair" 1
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "EstimatedSize" "$0"
SectionEnd

; A silent install (Setup.exe /S), as an updater would run it, has no finish page to
; start the app from.
Function CreateDesktopShortcut
  CreateShortcut "$DESKTOP\${APP}.lnk" "$INSTDIR\${EXE}" "" "$INSTDIR\${EXE}" 0
FunctionEnd

Function .onInstSuccess
  ${If} ${Silent}
    Exec '"$INSTDIR\${EXE}"'
  ${EndIf}
FunctionEnd

; Settings and the log in %APPDATA%\Deskworlds are kept, as the Mac app keeps its
; preferences, so a reinstall picks up the same world.
Section "Uninstall"
  SetShellVarContext current
  !insertmacro CloseRunning
  DeleteRegValue HKCU "${RUN_KEY}" "${APP}"
  DeleteRegValue HKCU "${STARTUP_APPROVED}" "${APP}"
  DeleteRegKey HKCU "${UNINSTALL_KEY}"
  Delete "$SMPROGRAMS\${APP}.lnk"
  Delete "$DESKTOP\${APP}.lnk"
  RMDir /r "$INSTDIR"
SectionEnd
