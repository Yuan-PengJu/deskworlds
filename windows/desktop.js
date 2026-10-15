'use strict';
// The Windows desktop, reached through koffi: a C FFI that ships prebuilt binaries, so
// nothing is compiled on install and nothing needs Visual Studio.
//
// A window becomes the wallpaper by being parented into the window Explorer paints the
// still picture in. That window sits underneath SHELLDLL_DefView, the list view that
// holds the desktop icons, so the icons stay on top of the scene and keep every click.
// Explorer only creates it on request (message 0x052C to Progman), and where it puts it
// depends on the Windows build:
//
//   Windows 10 and Windows 11 before 24H2: the icons move into a top-level WorkerW of
//   their own, and the WorkerW right after it in z-order is the layer behind them.
//
//   Windows 11 24H2 and later: the icons stay inside Progman and the wallpaper layer is
//   a WorkerW child of Progman, drawn underneath them.
//
// Every function here fails soft: when anything is missing they return null or false
// and the caller keeps the scene hidden rather than letting it cover the screen.

let api;

function load() {
  if (api !== undefined) return api;
  api = null;
  if (process.platform !== 'win32') return api;
  try {
    const koffi = require('koffi');
    const user32 = koffi.load('user32.dll');
    const kernel32 = koffi.load('kernel32.dll');
    const dwmapi = koffi.load('dwmapi.dll');
    koffi.struct('DW_RECT', { left: 'int32_t', top: 'int32_t', right: 'int32_t', bottom: 'int32_t' });
    koffi.struct('DW_POINT', { x: 'int32_t', y: 'int32_t' });
    koffi.struct('DW_POWER', {
      ac: 'uint8_t', battery: 'uint8_t', percent: 'uint8_t', saver: 'uint8_t',
      lifeTime: 'uint32_t', fullLifeTime: 'uint32_t',
    });
    koffi.proto('bool __stdcall DW_EnumProc(uintptr_t hwnd, intptr_t lParam)');
    const u = (signature) => user32.func(signature);
    api = {
      FindWindowW: u('uintptr_t __stdcall FindWindowW(const char16_t* cls, const char16_t* title)'),
      FindWindowExW: u('uintptr_t __stdcall FindWindowExW(uintptr_t parent, uintptr_t after, const char16_t* cls, const char16_t* title)'),
      SendMessageTimeoutW: u('uintptr_t __stdcall SendMessageTimeoutW(uintptr_t hwnd, uint32_t msg, uintptr_t wParam, intptr_t lParam, uint32_t flags, uint32_t timeout, _Out_ uintptr_t* result)'),
      EnumWindows: u('bool __stdcall EnumWindows(DW_EnumProc* proc, intptr_t lParam)'),
      SetParent: u('uintptr_t __stdcall SetParent(uintptr_t child, uintptr_t parent)'),
      // Not GetParent: for a WS_POPUP window, which Electron's borderless windows are,
      // GetParent answers with the owner, and these have none, so it always says 0.
      GetAncestor: u('uintptr_t __stdcall GetAncestor(uintptr_t hwnd, uint32_t flags)'),
      GetDesktopWindow: u('uintptr_t __stdcall GetDesktopWindow()'),
      SetWindowPos: u('bool __stdcall SetWindowPos(uintptr_t hwnd, uintptr_t after, int x, int y, int cx, int cy, uint32_t flags)'),
      ScreenToClient: u('bool __stdcall ScreenToClient(uintptr_t hwnd, _Inout_ DW_POINT* point)'),
      GetSystemMetrics: u('int __stdcall GetSystemMetrics(int index)'),
      GetCursorPos: u('bool __stdcall GetCursorPos(_Out_ DW_POINT* point)'),
      WindowFromPoint: u('uintptr_t __stdcall WindowFromPoint(DW_POINT point)'),
      GetAsyncKeyState: u('int16_t __stdcall GetAsyncKeyState(int key)'),
      GetDoubleClickTime: u('uint32_t __stdcall GetDoubleClickTime()'),
      IsWindow: u('bool __stdcall IsWindow(uintptr_t hwnd)'),
      IsWindowVisible: u('bool __stdcall IsWindowVisible(uintptr_t hwnd)'),
      IsIconic: u('bool __stdcall IsIconic(uintptr_t hwnd)'),
      GetWindowLongPtrW: u('intptr_t __stdcall GetWindowLongPtrW(uintptr_t hwnd, int index)'),
      GetWindowRect: u('bool __stdcall GetWindowRect(uintptr_t hwnd, _Out_ DW_RECT* rect)'),
      GetClassNameW: u('int __stdcall GetClassNameW(uintptr_t hwnd, void* buffer, int length)'),
      GetWindowThreadProcessId: u('uint32_t __stdcall GetWindowThreadProcessId(uintptr_t hwnd, _Out_ uint32_t* pid)'),
      RedrawWindow: u('bool __stdcall RedrawWindow(uintptr_t hwnd, void* rect, void* region, uint32_t flags)'),
      SystemParametersInfoW: u('bool __stdcall SystemParametersInfoW(uint32_t action, uint32_t param, void* value, uint32_t ini)'),
      RegisterWindowMessageW: u('uint32_t __stdcall RegisterWindowMessageW(const char16_t* name)'),
      RegisterPowerSettingNotification: u('uintptr_t __stdcall RegisterPowerSettingNotification(uintptr_t recipient, void* guid, uint32_t flags)'),
      GetSystemPowerStatus: kernel32.func('bool __stdcall GetSystemPowerStatus(_Out_ DW_POWER* status)'),
      // Copies from a raw address, which is all a window message's lParam gives us.
      RtlMoveMemory: kernel32.func('void __stdcall RtlMoveMemory(void* destination, uintptr_t source, size_t length)'),
      DwmGetWindowAttribute: dwmapi.func('int32_t __stdcall DwmGetWindowAttribute(uintptr_t hwnd, uint32_t attribute, void* value, uint32_t size)'),
    };
  } catch (error) {
    console.error('deskworlds: the Win32 bridge did not load', error);
    api = null;
  }
  return api;
}

const num = (value) => Number(value);

/** The window's real parent in the window tree (GA_PARENT), never its owner. */
const parentOf = (a, hwnd) => num(a.GetAncestor(hwnd, 1));

/** The HWND inside Electron's getNativeWindowHandle() buffer. */
function hwndOf(handle) {
  return handle.length >= 8 ? Number(handle.readBigUInt64LE(0)) : handle.readUInt32LE(0);
}

function className(a, hwnd) {
  const buffer = Buffer.alloc(512);
  const length = a.GetClassNameW(hwnd, buffer, 256);
  return length > 0 ? buffer.toString('utf16le', 0, length * 2) : '';
}

/** The window behind the desktop icons, or null while Explorer has not made one. */
function locateHost(a, progman) {
  const icons = num(a.FindWindowExW(progman, 0, 'SHELLDLL_DefView', null));
  const inner = num(a.FindWindowExW(progman, 0, 'WorkerW', null));
  if (icons && inner) return { host: inner, layout: 'progman' };
  // Only a WorkerW that really holds the icons counts. Progman itself can hold them too
  // before Explorer has split the desktop, and the WorkerW after Progman is not on screen.
  let host = 0;
  a.EnumWindows((candidate) => {
    try {
      const hwnd = num(candidate);
      if (!num(a.FindWindowExW(hwnd, 0, 'SHELLDLL_DefView', null))) return true;
      if (className(a, hwnd) !== 'WorkerW') return true;
      host = num(a.FindWindowExW(0, hwnd, 'WorkerW', null));
      return false;
    } catch {
      return true;
    }
  }, 0);
  return host ? { host, layout: 'workerw' } : null;
}

function findHost() {
  const a = load();
  if (!a) return null;
  const progman = num(a.FindWindowW('Progman', null));
  if (!progman) return null;
  const result = [0];
  // lParam 1 is the request current builds expect. On 24H2 Explorer counts these
  // requests and lParam 0 releases the layer again a moment later, so the older form is
  // only tried when the first one produced nothing.
  a.SendMessageTimeoutW(progman, 0x052c, 0xd, 0x1, 0, 1000, result);
  let found = locateHost(a, progman);
  if (!found) {
    a.SendMessageTimeoutW(progman, 0x052c, 0, 0, 0, 1000, result);
    found = locateHost(a, progman);
  }
  return found && { ...found, progman };
}

const SWP_NOZORDER = 0x0004, SWP_NOACTIVATE = 0x0010, SWP_NOOWNERZORDER = 0x0200;

/** Sizes an attached window to one display, given in physical screen pixels. */
function place(handle, host, rect) {
  const a = load();
  if (!a) return false;
  // The host spans every display, so screen coordinates are turned into its own.
  const origin = { x: rect.x, y: rect.y };
  if (!a.ScreenToClient(host, origin)) {
    origin.x = rect.x - a.GetSystemMetrics(76 /* SM_XVIRTUALSCREEN */);
    origin.y = rect.y - a.GetSystemMetrics(77 /* SM_YVIRTUALSCREEN */);
  }
  return a.SetWindowPos(
    hwndOf(handle), 0, origin.x, origin.y, rect.width, rect.height,
    SWP_NOZORDER | SWP_NOACTIVATE | SWP_NOOWNERZORDER);
}

/**
 * Moves a window behind the desktop icons and over one display. Returns the host it now
 * belongs to, or null when the desktop is not ready (Explorer still starting, say).
 */
function attach(handle, rect) {
  const a = load();
  if (!a) return null;
  try {
    const found = findHost();
    if (!found) return null;
    const hwnd = hwndOf(handle);
    a.SetParent(hwnd, found.host);
    if (parentOf(a, hwnd) !== found.host) return null;
    place(handle, found.host, rect);
    return found;
  } catch (error) {
    console.error('deskworlds: attaching to the desktop failed', error);
    return null;
  }
}

/** Whether the window is still where attach() put it. */
function attachedTo(handle, host) {
  const a = load();
  if (!a) return false;
  try {
    return Boolean(a.IsWindow(host)) && parentOf(a, hwndOf(handle)) === host;
  } catch {
    return false;
  }
}

/** Whether the window has come loose and would now be drawn over everything. */
function loose(handle) {
  const a = load();
  if (!a) return false;
  try {
    const parent = parentOf(a, hwndOf(handle));
    return parent === 0 || parent === num(a.GetDesktopWindow());
  } catch {
    return false;
  }
}

/**
 * Asks Explorer to paint the desktop picture again once the scene is gone, so the last
 * frame does not linger. The picture is set to itself, without writing the choice back
 * to the profile, so a slideshow or Spotlight keeps its own settings.
 */
function refreshWallpaper() {
  const a = load();
  if (!a) return;
  try {
    const buffer = Buffer.alloc(1040);
    if (a.SystemParametersInfoW(0x0073 /* SPI_GETDESKWALLPAPER */, 520, buffer, 0)) {
      const file = buffer.toString('utf16le').split('\0')[0];
      if (file) {
        a.SystemParametersInfoW(0x0014 /* SPI_SETDESKWALLPAPER */, 0,
          Buffer.from(`${file}\0`, 'utf16le'), 0x02 /* SPIF_SENDCHANGE */);
      }
    }
    const progman = num(a.FindWindowW('Progman', null));
    // RDW_INVALIDATE | RDW_ERASE | RDW_ALLCHILDREN | RDW_UPDATENOW
    if (progman) a.RedrawWindow(progman, null, null, 0x0001 | 0x0004 | 0x0080 | 0x0100);
  } catch (error) {
    console.error('deskworlds: could not refresh the desktop picture', error);
  }
}

const IGNORED_CLASSES = new Set([
  'Progman', 'WorkerW', 'Shell_TrayWnd', 'Shell_SecondaryTrayWnd', '#32768',
]);

/**
 * Rectangles, in physical pixels, of the ordinary windows on screen. Windows on other
 * virtual desktops are cloaked by DWM, tool windows and click-through overlays are
 * mostly see-through, and the taskbar never covers enough to matter.
 */
function windowBlockers() {
  const a = load();
  if (!a) return [];
  const blockers = [];
  const cloaked = Buffer.alloc(4);
  const frame = Buffer.alloc(16);
  try {
    a.EnumWindows((candidate) => {
      try {
        const hwnd = num(candidate);
        if (!a.IsWindowVisible(hwnd) || a.IsIconic(hwnd)) return true;
        cloaked.writeUInt32LE(0, 0);
        if (a.DwmGetWindowAttribute(hwnd, 14 /* DWMWA_CLOAKED */, cloaked, 4) === 0
          && cloaked.readUInt32LE(0) !== 0) return true;
        const extended = num(a.GetWindowLongPtrW(hwnd, -20 /* GWL_EXSTYLE */));
        if (extended & 0x80 /* WS_EX_TOOLWINDOW */) return true;
        if ((extended & 0x20 /* WS_EX_TRANSPARENT */) && (extended & 0x80000 /* WS_EX_LAYERED */)) return true;
        const pid = [0];
        a.GetWindowThreadProcessId(hwnd, pid);
        if (pid[0] === process.pid) return true;
        if (IGNORED_CLASSES.has(className(a, hwnd))) return true;
        let rect;
        // The extended frame leaves out the invisible resize borders around a window.
        if (a.DwmGetWindowAttribute(hwnd, 9 /* DWMWA_EXTENDED_FRAME_BOUNDS */, frame, 16) === 0) {
          rect = {
            left: frame.readInt32LE(0), top: frame.readInt32LE(4),
            right: frame.readInt32LE(8), bottom: frame.readInt32LE(12),
          };
        } else {
          rect = {};
          if (!a.GetWindowRect(hwnd, rect)) return true;
        }
        if (rect.right - rect.left > 0 && rect.bottom - rect.top > 0) blockers.push(rect);
      } catch {
        // A window that closes mid-walk is simply skipped.
      }
      return true;
    }, 0);
  } catch (error) {
    console.error('deskworlds: could not list windows', error);
  }
  return blockers;
}

/** Mains or battery, and whether Energy Saver (Battery Saver on Windows 10) is on. */
function powerStatus() {
  const a = load();
  if (!a) return null;
  try {
    const status = {};
    if (!a.GetSystemPowerStatus(status)) return null;
    return { battery: status.ac === 0, saver: status.saver === 1 };
  } catch {
    return null;
  }
}

/**
 * Whether the button that clicks is held down right now. Only that one button is read,
 * never the keyboard. GetAsyncKeyState reports the physical buttons, so for someone who
 * swapped them in Settings the one that clicks is the right-hand one.
 */
function clickButtonDown() {
  const a = load();
  if (!a) return false;
  try {
    const swapped = a.GetSystemMetrics(23 /* SM_SWAPBUTTON */) !== 0;
    return (a.GetAsyncKeyState(swapped ? 0x02 : 0x01) & 0x8000) !== 0;
  } catch {
    return false;
  }
}

/** The longest gap Windows allows between the two clicks of a double-click, in ms. */
function doubleClickTime() {
  const a = load();
  try { return a ? a.GetDoubleClickTime() : 500; } catch { return 500; }
}

/**
 * The desktop's icon view, when that is what the cursor is over rather than a window, the
 * taskbar or anything else. 0 otherwise. The view is the SysListView32 inside
 * SHELLDLL_DefView, wherever Explorer keeps that on this build.
 */
function desktopUnderCursor() {
  const a = load();
  if (!a) return 0;
  try {
    const point = {};
    if (!a.GetCursorPos(point)) return 0;
    const hwnd = num(a.WindowFromPoint(point));
    if (!hwnd || className(a, hwnd) !== 'SysListView32') return 0;
    return className(a, parentOf(a, hwnd)) === 'SHELLDLL_DefView' ? hwnd : 0;
  } catch {
    return 0;
  }
}

/**
 * How many desktop icons are selected, or -1 when Explorer does not answer. A click on an
 * icon selects it and a click on empty desktop clears the selection, so right after a
 * click this tells the two apart. LVM_GETSELECTEDCOUNT carries no pointers, so it can be
 * asked across processes.
 */
function selectedIcons(listView) {
  const a = load();
  if (!a) return -1;
  try {
    const result = [0];
    const answered = a.SendMessageTimeoutW(listView, 0x1032 /* LVM_GETSELECTEDCOUNT */, 0, 0,
      0x2 /* SMTO_ABORTIFHUNG */, 200, result);
    return num(answered) ? num(result[0]) : -1;
  } catch {
    return -1;
  }
}

// GUID_CONSOLE_DISPLAY_STATE, {6FE69556-704A-47A0-8F24-C28D936FDA47}
function displayStateGuid() {
  const guid = Buffer.alloc(16);
  guid.writeUInt32LE(0x6fe69556, 0);
  guid.writeUInt16LE(0x704a, 4);
  guid.writeUInt16LE(0x47a0, 6);
  Buffer.from([0x8f, 0x24, 0xc2, 0x8d, 0x93, 0x6f, 0xda, 0x47]).copy(guid, 8);
  return guid;
}

const pointerIn = (buffer) =>
  buffer.length >= 8 ? Number(buffer.readBigUInt64LE(0)) : buffer.readUInt32LE(0);

/**
 * Listens, through a hidden top-level window, for the two things only a window hears:
 * the display turning off or on, and Explorer restarting (the taskbar is recreated,
 * and with it the desktop windows the scenes were living in).
 */
function watchSystem(win, { onDisplay, onExplorer }) {
  const a = load();
  if (!a) return;
  try {
    const restarted = a.RegisterWindowMessageW('TaskbarCreated');
    if (restarted) win.hookWindowMessage(restarted, () => onExplorer());

    const guid = displayStateGuid();
    win.hookWindowMessage(0x0218 /* WM_POWERBROADCAST */, (wParam, lParam) => {
      try {
        if (pointerIn(wParam) !== 0x8013 /* PBT_POWERSETTINGCHANGE */) return;
        const setting = Buffer.alloc(24);
        a.RtlMoveMemory(setting, pointerIn(lParam), 24);
        if (!setting.subarray(0, 16).equals(guid)) return;
        // 0 is off, 1 on and 2 dimmed. A dimmed display is still showing the desktop.
        onDisplay(setting.readUInt32LE(20) !== 0);
      } catch (error) {
        console.error('deskworlds: unreadable power broadcast', error);
      }
    });
    a.RegisterPowerSettingNotification(hwndOf(win.getNativeWindowHandle()), guid, 0);
  } catch (error) {
    console.error('deskworlds: could not watch the display state', error);
  }
}

module.exports = {
  available: () => Boolean(load()),
  attach,
  place,
  attachedTo,
  loose,
  refreshWallpaper,
  windowBlockers,
  powerStatus,
  watchSystem,
  clickButtonDown,
  doubleClickTime,
  desktopUnderCursor,
  selectedIcons,
};
