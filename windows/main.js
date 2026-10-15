'use strict';
// A living world as a Windows desktop wallpaper: the counterpart of
// wallpaper/Wallpaper.swift, built on Electron instead of WebKit.
//
// One borderless window per display is parented behind the desktop icons (desktop.js),
// so files and folders stay on top of the scene and keep working normally. The scene
// is the same wallpaper.html page the macOS app shows, served from this app's own copy
// of the scenes over a private scheme so its module imports resolve the way they do
// from a web server.
//
// The window never takes mouse events. The pointer reaches the scene another way: the
// global cursor position is read on a timer and handed to the page as a pointer move,
// so clicking and dragging on the desktop still belongs to Explorer.

const {
  app, BaseWindow, BrowserWindow, Menu, Tray, globalShortcut, ipcMain, powerMonitor, protocol,
  screen, session, systemPreferences,
} = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const desktop = require('./desktop');

const SCHEME = 'deskworlds';
const HOST = 'local';
/** `--window` shows the scene in an ordinary window instead, for trying it out. */
const PREVIEW = process.argv.includes('--window');
// Windows takes the multi-size .ico; the PNG is for trying the preview elsewhere.
const ICON = path.join(__dirname, process.platform === 'win32' ? 'icon.ico' : 'icon.png');

/** The installer bundles the scenes next to this file; a checkout uses the repository's. */
const ROOT = (() => {
  const bundled = path.join(__dirname, 'scene');
  return path.resolve(fs.existsSync(path.join(bundled, 'scenes')) ? bundled : path.join(__dirname, '..'));
})();

// ---------------------------------------------------------------------------
// The worlds, as on macOS. Scenes added by a fork appear too, named after their page.

const KNOWN_WORLDS = [
  { id: 'riverscape', en: 'Riverbed', zh: '河床', background: '#080e0c' },
  { id: 'reefscape', en: 'Coral reef', zh: '珊瑚礁', background: '#0b1825' },
  { id: 'bettascape', en: 'Betta', zh: '斗鱼', background: '#000000' },
  // Only worlds with something to eat have anything to feed; the bonfire is stirred instead.
  { id: 'plasmascape', en: 'Plasma globe', zh: '等离子球', background: '#000000', feed: false },
  { id: 'koiscape', en: 'Koi pond', zh: '锦鲤池', background: '#040605' },
  { id: 'bonfirescape', en: 'Bonfire', zh: '篝火', background: '#000000', stir: true },
];

function discoverWorlds() {
  const page = (id) => path.join(ROOT, 'scenes', id, 'wallpaper.html');
  const worlds = KNOWN_WORLDS.filter((world) => fs.existsSync(page(world.id)));
  let folders = [];
  try { folders = fs.readdirSync(path.join(ROOT, 'scenes')).sort(); } catch { /* none */ }
  for (const id of folders) {
    if (worlds.some((world) => world.id === id) || !fs.existsSync(page(id))) continue;
    let name = id;
    try { name = /<title>([^<•]+)/.exec(fs.readFileSync(page(id), 'utf8'))?.[1]?.trim() || id; } catch { /* keep id */ }
    worlds.push({ id, en: name, zh: name, background: '#000000' });
  }
  return worlds;
}

const TEXT = {
  en: {
    world: 'World', feed: 'Feed', stir: 'Stir the Fire', pause: 'Pause', resume: 'Resume',
    quit: 'Quit', saver: 'Still, for Energy Saver', paused: 'Paused',
    pausedMotion: 'Paused, for reduced animation effects',
    off: 'Still, the screen is off or locked', waiting: 'Waiting for the desktop…',
    resting: 'Resting behind your windows', running: (fps) => `Running at ${fps} frames a second`,
    next: 'Next World', quick: 'Shortcuts', hotkeys: 'Keyboard shortcuts',
    taken: (keys) => `${keys} is used by another app`,
    doubleClick: 'Double-click empty desktop to feed', doubleClickStir: 'Double-click empty desktop to stir the fire',
    login: 'Start at Sign-in',
  },
  zh: {
    world: '世界', feed: '喂食', stir: '拨一拨篝火', pause: '暂停', resume: '继续',
    quit: '退出', saver: '节能模式已开启，画面保持静止', paused: '已暂停',
    pausedMotion: '已暂停（系统关闭了动画效果）',
    off: '屏幕已关闭或锁定，画面保持静止', waiting: '正在等待桌面就绪…',
    resting: '被窗口挡住了，正在休息', running: (fps) => `正在以每秒 ${fps} 帧运行`,
    next: '下一个世界', quick: '快捷操作', hotkeys: '全局快捷键',
    taken: (keys) => `${keys} 被其他程序占用`,
    doubleClick: '双击桌面空白处喂食', doubleClickStir: '双击桌面空白处拨火',
    login: '开机自动启动',
  },
};

// ---------------------------------------------------------------------------
// Logging and settings, both in %APPDATA%\Deskworlds.

let logFile = null;
function log(...parts) {
  const line = `${new Date().toISOString()} ${parts
    .map((part) => (part instanceof Error ? part.stack : typeof part === 'string' ? part : JSON.stringify(part)))
    .join(' ')}`;
  console.log(line);
  if (logFile) try { fs.appendFileSync(logFile, `${line}\n`); } catch { /* the log is best effort */ }
}
console.error = (...parts) => log(...parts);

/** The log is for the last few days of trouble, not a history. */
function trimLog() {
  try { if (logFile && fs.statSync(logFile).size > 1_000_000) fs.rmSync(logFile); } catch { /* no log yet */ }
}

let settingsFile = null;
let settings = {};
function loadSettings() {
  settings = {};
  let raw;
  try { raw = fs.readFileSync(settingsFile, 'utf8'); } catch { return; }
  try {
    const parsed = JSON.parse(raw.replace(/^\uFEFF/, ''));
    if (parsed && typeof parsed === 'object') settings = parsed;
  } catch (error) {
    log(`settings.json is not valid JSON, so the defaults are used (${error.message})`);
  }
}
function saveSettings() {
  try { fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2)); } catch (error) { log('could not save settings', error); }
}

// ---------------------------------------------------------------------------
// Chromium decides for itself when a window is covered and stops drawing it. A window
// living behind the desktop icons always looks covered to it, so the scene would never
// start. That decision is switched off here and made by applyRate() instead.
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

protocol.registerSchemesAsPrivileged([{
  scheme: SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
}]);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.glb': 'model/gltf-binary',
  '.ktx2': 'image/ktx2',
  '.txt': 'text/plain; charset=utf-8',
};

/** Serves the scenes, and nothing outside them. */
async function serveScenes(request) {
  let file;
  try {
    file = path.resolve(ROOT, `.${decodeURIComponent(new URL(request.url).pathname)}`);
  } catch {
    return new Response('Bad request', { status: 400 });
  }
  if (!file.startsWith(ROOT + path.sep)) return new Response('Forbidden', { status: 403 });
  try {
    const data = await fs.promises.readFile(file);
    const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
    return new Response(data, { headers: { 'content-type': type, 'cache-control': 'no-store' } });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}

// ---------------------------------------------------------------------------

let text = TEXT.en;
let sceneSession = null;
let tray = null;
let messageWindow = null;
let worlds = [];
let world = null;
let wallpapers = [];
let stopped = false;
let locked = false;
let asleep = false;
let displayOff = false;
let quitting = false;
let applied = 0;
let power = { battery: false, saver: false };
let layoutKey = '';
let lastPoint = null;
let forceUntil = 0;
let reduceMotionSeen = false;
let pointerTimer = null;
let pointerRate = 0;
let tickTimer = null;
let ticks = 0;
let rebuildTimer = null;
let attachTimer = null;
let attachDelay = 2000;
let screensTimer = null;
let clickTimer = null;
let clickPress = null;
let lastClick = null;
let buttonWasDown = false;
let doubleClickWindow = 500;
const takenShortcuts = new Set();

const awake = () => !locked && !asleep && !displayOff;
const titleOf = (choice) => (text === TEXT.zh ? choice.zh : choice.en);
const describe = (display) => `${display.bounds.width}×${display.bounds.height}@${display.scaleFactor}x`;

/** "Animation effects" off in Settings › Accessibility, the Windows Reduce Motion. */
function reduceMotion() {
  try { return Boolean(systemPreferences.getAnimationSettings().prefersReducedMotion); } catch { return false; }
}

/** A display's bounds in physical pixels, the unit Win32 positions windows in. */
function physicalRect(display) {
  if (typeof screen.dipToScreenRect === 'function') {
    try { return screen.dipToScreenRect(null, display.bounds); } catch { /* fall through */ }
  }
  const scale = display.scaleFactor || 1;
  const { x, y, width, height } = display.bounds;
  return {
    x: Math.round(x * scale), y: Math.round(y * scale),
    width: Math.round(width * scale), height: Math.round(height * scale),
  };
}

/** Puts whatever the page complains about into the log. */
function onConsole(event) {
  const { level, message = '', sourceId, lineNumber } = event;
  if (level !== 'warning' && level !== 'error') return;
  // Electron's own advice for apps run unpackaged, as `npm start` does; not the scene's.
  if (message.includes('Electron Security Warning')) return;
  log(`page ${level}: ${message} (${sourceId}:${lineNumber})`);
}

/** One display's worth of world. */
class Wallpaper {
  constructor(display, choice) {
    this.display = display;
    this.physical = physicalRect(display);
    this.host = 0;
    this.attached = false;
    this.closing = false;
    this.loaded = false;
    this.inside = false;
    this.rate = 0;
    this.battery = false;
    this.fallback = null;

    const area = display.workArea;
    const bounds = PREVIEW
      ? {
        width: Math.min(1280, area.width), height: Math.min(800, area.height),
        x: area.x + Math.max(0, Math.round((area.width - 1280) / 2)),
        y: area.y + Math.max(0, Math.round((area.height - 800) / 2)),
      }
      : display.bounds;

    this.win = new BrowserWindow({
      ...bounds,
      title: 'Deskworlds',
      icon: ICON,
      show: false,
      frame: PREVIEW,
      // A frameless window keeps invisible resize borders with thickFrame, and Chromium
      // clamps a fixed-size window to the work area when it is created, which would leave
      // a strip under the taskbar. A wallpaper nobody can grab needs neither.
      resizable: true,
      thickFrame: PREVIEW,
      movable: PREVIEW,
      minimizable: PREVIEW,
      maximizable: PREVIEW,
      fullscreenable: PREVIEW,
      skipTaskbar: !PREVIEW,
      focusable: PREVIEW,
      hasShadow: false,
      autoHideMenuBar: true,
      backgroundColor: choice.background,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        session: sceneSession,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
        spellcheck: false,
        devTools: PREVIEW,
      },
    });
    this.win.setMenuBarVisibility(false);

    const contents = this.win.webContents;
    contents.on('console-message', onConsole);
    contents.on('render-process-gone', (_event, details) => {
      log(`the scene's process ended (${details.reason})`);
      scheduleRebuild();
    });
    contents.on('did-fail-load', (_event, code, description, url) => {
      if (code !== -3) log(`the scene did not load: ${description} (${code}) ${url}`);
    });
    // The scene says when it is ready (preload.js). Should that message never come, it
    // is started anyway: a scene that never hears its rate would never move at all.
    contents.on('did-finish-load', () => {
      clearTimeout(this.fallback);
      this.fallback = setTimeout(() => { if (!this.loaded) this.ready(); }, 15000);
    });
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-navigate', (event, url) => {
      if (!url.startsWith(`${SCHEME}://`)) event.preventDefault();
    });

    this.win.on('closed', () => {
      clearTimeout(this.fallback);
      if (this.closing || quitting) return;
      if (PREVIEW) { app.quit(); return; }
      // Explorer restarting takes its desktop windows down, and ours with them.
      log('a wallpaper window was closed from outside');
      scheduleRebuild();
    });
    this.win.once('ready-to-show', () => this.attach());
    this.load(choice);
  }

  load(choice) {
    this.world = choice;
    this.loaded = false;
    this.inside = false;
    if (this.win.isDestroyed()) return;
    this.win.setBackgroundColor(choice.background);
    // Native: full display resolution plugged in, the Balanced profile on battery.
    this.win.loadURL(`${SCHEME}://${HOST}/scenes/${choice.id}/wallpaper.html?quality=native`)
      .catch((error) => { if (error.code !== 'ERR_ABORTED' && !quitting) log(`could not open ${choice.id}`, error); });
  }

  /** Behind the desktop icons, or into plain sight in preview. */
  attach() {
    if (this.win.isDestroyed() || quitting) return false;
    if (PREVIEW) {
      this.win.show();
      this.attached = true;
      applyRate();
      return true;
    }
    const handle = this.win.getNativeWindowHandle();
    const found = desktop.attach(handle, this.physical);
    if (!found) {
      this.attached = false;
      scheduleAttach();
      return false;
    }
    this.host = found.host;
    this.attached = true;
    // Shown only once it is behind the icons, so it never flashes over the screen.
    this.win.showInactive();
    desktop.place(handle, found.host, this.physical);
    log(`attached behind the icons (${found.layout} layout) on ${describe(this.display)}`);
    applyRate();
    return true;
  }

  /** Puts the window back if the desktop was rearranged underneath it. */
  check() {
    if (PREVIEW || !this.attached || this.win.isDestroyed()) return;
    const handle = this.win.getNativeWindowHandle();
    if (desktop.attachedTo(handle, this.host)) return;
    // A window that came loose would be drawn over everything until it is put back.
    const loose = desktop.loose(handle);
    if (loose) this.win.hide();
    if (this.gaveUp) return;
    // Re-attaching hides and shows the scene. Should it keep being needed, something
    // is misjudged, and a desktop that flashes every few seconds is worse than a check
    // that gives up: the scene stays as it is, or stays hidden if it really came loose.
    const now = Date.now();
    this.reattaches = (this.reattaches || []).filter((time) => now - time < 60000);
    if (this.reattaches.length >= 3) {
      if (!this.gaveUp) log(`the scene keeps coming off the desktop on ${describe(this.display)}; no longer re-attaching it`);
      this.gaveUp = true;
      if (loose) this.attached = false;
      return;
    }
    this.reattaches.push(now);
    log(`the desktop changed under the scene; attaching again${loose ? ' (it had come loose)' : ''}`);
    this.attached = false;
    this.attach();
  }

  /** Sends only state changes; ready() resends once the page can hear them. */
  setRate(wanted) {
    if (wanted === this.rate) return false;
    this.rate = wanted;
    if (this.rate === 0 && this.inside) this.pointerOut();
    log(`${this.world.id} on ${describe(this.display)}: ${this.rate} fps`);
    this.send();
    return true;
  }

  setPower(onBattery) {
    if (onBattery === this.battery) return;
    this.battery = onBattery;
    this.send();
  }

  send() {
    this.run(`typeof scenePower === 'function' && scenePower(${this.battery});
      typeof sceneRate === 'function' && sceneRate(${this.rate});`);
  }

  run(code) {
    if (!this.loaded || this.win.isDestroyed()) return Promise.resolve(undefined);
    return this.win.webContents.executeJavaScript(code).catch((error) => {
      log('a host call into the scene failed', error.message);
    });
  }

  /**
   * A pinch of food, asked for from the tray rather than by clicking. Nothing is sent
   * while the scene is still: the food would pile up unseen until it started again.
   */
  feed() {
    if (this.rate > 0) this.run("typeof sceneFeed === 'function' && sceneFeed()");
  }

  /** A cursor position in this display's coordinates, or null when it left the display. */
  setPointer(point) {
    if (!this.loaded || this.rate === 0 || this.win.isDestroyed()) return;
    if (!point) {
      if (this.inside) this.pointerOut();
      return;
    }
    this.inside = true;
    this.win.webContents.send('deskworlds:pointer', point.x, point.y);
  }

  pointerOut() {
    this.inside = false;
    if (this.loaded && !this.win.isDestroyed()) this.win.webContents.send('deskworlds:pointer-out');
  }

  /** The scene has installed its callbacks. */
  ready() {
    this.loaded = true;
    lastPoint = null;
    this.send();
  }

  close() {
    this.closing = true;
    clearTimeout(this.fallback);
    if (!this.win.isDestroyed()) {
      this.win.hide();
      this.win.destroy();
    }
  }

  /** What the page thinks it is doing, for the log. */
  async probe() {
    const state = await this.run(`(() => {
      const canvas = document.querySelector('#scene');
      const context = canvas && canvas.getContext('webgl2');
      return JSON.stringify({
        pixels: canvas && [canvas.width, canvas.height],
        covered: !document.querySelector('#loading')?.hidden,
        webgl2: Boolean(context),
        gpu: context && context.getParameter(context.RENDERER),
        hidden: document.hidden,
      });
    })()`);
    log(`page state on ${describe(this.display)}: ${state}`);
  }
}

// ---------------------------------------------------------------------------
// How fast to draw.

/** How much of a display ordinary windows leave uncovered, from none to all of it. */
function exposure(rect, blockers) {
  if (!blockers.length) return 1;
  const columns = 16, rows = 10;
  let free = 0;
  for (let column = 0; column < columns; column++) {
    for (let row = 0; row < rows; row++) {
      const x = rect.x + (rect.width * (column + 0.5)) / columns;
      const y = rect.y + (rect.height * (row + 0.5)) / rows;
      if (!blockers.some((b) => x >= b.left && x < b.right && y >= b.top && y < b.bottom)) free++;
    }
  }
  return free / (columns * rows);
}

/**
 * Full speed while the wallpaper is in plain sight, a slow beat when windows leave only
 * part of it showing, and nothing at all behind a full screen of work, with Energy
 * Saver on, or while the display is off or locked.
 */
function applyRate() {
  if (quitting) return;
  let onBattery = false;
  try { onBattery = powerMonitor.isOnBatteryPower(); } catch { /* assume mains */ }
  power = desktop.powerStatus() || { battery: onBattery, saver: false };
  const full = power.battery ? 30 : 60;
  const forced = Date.now() < forceUntil;
  const still = !forced && (stopped || power.saver || !awake());
  // Read the window list once for all displays, and never while deliberately still.
  const blockers = still || forced || PREVIEW ? [] : desktop.windowBlockers();
  applied = 0;
  let changed = false;
  for (const wallpaper of wallpapers) {
    if (wallpaper.win.isDestroyed()) continue;
    const showing = exposure(wallpaper.physical, blockers);
    const rate = forced ? 60
      : still || !wallpaper.attached || showing < 0.15 ? 0
        : showing < 0.4 ? 20 : full;
    wallpaper.setPower(power.battery);
    if (wallpaper.setRate(rate)) changed = true;
    applied = Math.max(applied, rate);
  }
  if (changed) lastPoint = null;
  updatePointerTimer();
  updateClickTimer();
}

/** Pointer sampling need not outrun the animation, nor wake a stopped wallpaper. */
function updatePointerTimer() {
  const wanted = PREVIEW ? 0 : Math.min(30, applied);
  if (wanted === pointerRate) return;
  clearInterval(pointerTimer);
  pointerTimer = null;
  pointerRate = wanted;
  if (wanted > 0) pointerTimer = setInterval(trackPointer, Math.round(1000 / wanted));
}

/** The cursor belongs to Explorer, so its position is read rather than captured. */
function trackPointer() {
  let point;
  try { point = screen.getCursorScreenPoint(); } catch { return; }
  if (lastPoint && Math.abs(point.x - lastPoint.x) <= 0.2 && Math.abs(point.y - lastPoint.y) <= 0.2) return;
  lastPoint = point;
  for (const wallpaper of wallpapers) {
    if (wallpaper.win.isDestroyed()) continue;
    const b = wallpaper.display.bounds;
    const inside = point.x >= b.x && point.x < b.x + b.width && point.y >= b.y && point.y < b.y + b.height;
    wallpaper.setPointer(inside ? { x: point.x - b.x, y: point.y - b.y } : null);
  }
}

/** Once a second: the rate, a look at the desktop now and then, and Reduce Motion. */
function tick() {
  ticks++;
  // Animation effects is a lasting choice about the whole machine, so like Reduce Motion
  // on macOS it only decides how the wallpaper starts, unless somebody already chose.
  if (typeof settings.paused !== 'boolean') {
    const reduce = reduceMotion();
    if (reduce !== reduceMotionSeen) {
      reduceMotionSeen = reduce;
      stopped = reduce;
    }
  }
  if (ticks % 3 === 0) for (const wallpaper of wallpapers) wallpaper.check();
  if (ticks % 3600 === 0) trimLog();
  applyRate();
}

// ---------------------------------------------------------------------------
// Windows come and go with the displays, and with Explorer.

const layoutOf = (displays) =>
  JSON.stringify(displays.map((d) => [d.id, d.bounds, d.scaleFactor, d.rotation]));

function build() {
  clearTimeout(rebuildTimer);
  clearTimeout(attachTimer);
  attachTimer = null;
  attachDelay = 2000;
  for (const wallpaper of wallpapers) wallpaper.close();
  const all = screen.getAllDisplays();
  layoutKey = layoutOf(all);
  // Each display runs a world of its own rather than one scene stretched across them.
  wallpapers = (PREVIEW ? [screen.getPrimaryDisplay()] : all).map((display) => new Wallpaper(display, world));
  applyRate();
}

function scheduleRebuild(delay = 1500) {
  if (quitting || PREVIEW) return;
  clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(() => {
    log('rebuilding the wallpaper windows');
    build();
  }, delay);
}

/** Explorer can still be starting at sign-in; keep trying, ever more slowly. */
function scheduleAttach() {
  if (quitting || attachTimer) return;
  if (attachDelay === 2000) log('the desktop is not ready for the scene yet; trying again');
  attachTimer = setTimeout(() => {
    attachTimer = null;
    const waiting = wallpapers.filter((w) => !w.attached && !w.win.isDestroyed());
    let all = true;
    for (const wallpaper of waiting) all = wallpaper.attach() && all;
    if (all) attachDelay = 2000;
  }, attachDelay);
  attachDelay = Math.min(Math.round(attachDelay * 1.5), 15000);
}

// Putting a full-screen window up can change the work area and fire these events, so the
// arrangement is compared before anything is rebuilt.
function screensChanged() {
  if (PREVIEW) return;
  clearTimeout(screensTimer);
  screensTimer = setTimeout(() => {
    if (layoutOf(screen.getAllDisplays()) === layoutKey) return;
    log('the displays changed');
    build();
  }, 750);
}

// ---------------------------------------------------------------------------
// Quicker than the tray: keyboard shortcuts, and double-clicking the desktop itself.

const DEFAULT_KEYS = { feed: 'Control+Alt+F', pause: 'Control+Alt+P', world: 'Control+Alt+W' };
/** Each can be changed, or set to "" to free it, under "keys" in settings.json. */
const keyFor = (action) => {
  const chosen = settings.keys?.[action];
  return typeof chosen === 'string' ? chosen : DEFAULT_KEYS[action];
};
const hotkeysOn = () => settings.hotkeys !== false;
const doubleClickOn = () => settings.doubleClickFeed !== false;

function feedEveryScreen() {
  for (const wallpaper of wallpapers) wallpaper.feed();
}

function nextWorld() {
  selectWorld(worlds[(worlds.indexOf(world) + 1) % worlds.length]);
}

/**
 * Global shortcuts belong to whichever app took them first, so one that is already in
 * use is skipped, logged, and marked in the menu, rather than taken from that app.
 */
function registerShortcuts() {
  globalShortcut.unregisterAll();
  takenShortcuts.clear();
  if (!hotkeysOn()) return;
  const actions = {
    feed: feedEveryScreen,
    pause: () => { if (!power.saver) togglePause(); },
    world: nextWorld,
  };
  for (const [action, run] of Object.entries(actions)) {
    const keys = keyFor(action);
    if (!keys) continue;
    let registered = false;
    try {
      registered = globalShortcut.register(keys, run);
    } catch (error) {
      log(`"${keys}" in settings.json is not a key combination Electron understands (${error.message})`);
      continue;
    }
    if (!registered) {
      takenShortcuts.add(action);
      log(`${keys} could not be registered; another app may be using it`);
    }
  }
}

/** The shortcut as shown beside a menu item, when it is actually working. */
function accelerator(action) {
  const keys = keyFor(action);
  return hotkeysOn() && keys && !takenShortcuts.has(action)
    ? { accelerator: keys, registerAccelerator: false }
    : {};
}

/**
 * Double-clicking empty desktop does nothing in Explorer, so it is free to mean "feed".
 * The click itself still goes to Explorer; this only watches the button, 60 times a
 * second while a world is moving, and only acts when the double-click landed on the
 * desktop's own icon view and left no icon selected, which is what an icon would be.
 */
function updateClickTimer() {
  const wanted = !PREVIEW && doubleClickOn() && applied > 0 && world?.feed !== false && desktop.available();
  if (wanted === Boolean(clickTimer)) return;
  clearInterval(clickTimer);
  clickTimer = null;
  clickPress = lastClick = null;
  buttonWasDown = false;
  if (wanted) {
    doubleClickWindow = desktop.doubleClickTime();
    clickTimer = setInterval(pollClicks, 16);
  }
}

function pollClicks() {
  const down = desktop.clickButtonDown();
  if (down === buttonWasDown) return;
  buttonWasDown = down;
  let point;
  try { point = screen.getCursorScreenPoint(); } catch { return; }
  const now = Date.now();
  if (down) {
    clickPress = { point, view: desktop.desktopUnderCursor() };
    return;
  }
  const press = clickPress;
  clickPress = null;
  // Pressed somewhere else, or dragged a selection box: not a click on the desktop.
  if (!press || !press.view || Math.hypot(point.x - press.point.x, point.y - press.point.y) > 4) {
    lastClick = null;
    return;
  }
  const first = lastClick;
  // The window is measured release to release here, so a little slack covers the polling.
  if (first && now - first.time <= doubleClickWindow + 80
    && Math.hypot(point.x - first.point.x, point.y - first.point.y) <= 6) {
    lastClick = null;
    if (desktop.selectedIcons(press.view) === 0) feedAt(point);
    return;
  }
  lastClick = { point, time: now };
}

/** Feeds the world on the display that was double-clicked. */
function feedAt(point) {
  const wallpaper = wallpapers.find((w) => {
    const b = w.display.bounds;
    return !w.win.isDestroyed() && point.x >= b.x && point.x < b.x + b.width && point.y >= b.y && point.y < b.y + b.height;
  });
  wallpaper?.feed();
}

// ---------------------------------------------------------------------------
// Starting at sign-in. The installer turns it on; the tray can turn it off. It is the
// same Run entry either way, named Deskworlds, and Task Manager's Startup switch counts.

const LOGIN_ITEM = { path: process.execPath, args: [], name: 'Deskworlds' };
/** Only an installed copy has an executable worth starting at sign-in. */
const canStartAtLogin = () => process.platform === 'win32' && app.isPackaged && !PREVIEW;

function startsAtLogin() {
  try { return app.getLoginItemSettings(LOGIN_ITEM).executableWillLaunchAtLogin; } catch { return false; }
}

function toggleStartAtLogin() {
  const on = !startsAtLogin();
  try {
    app.setLoginItemSettings({ ...LOGIN_ITEM, openAtLogin: on, enabled: on });
    log(`start at sign-in ${on ? 'on' : 'off'}`);
  } catch (error) {
    log('could not change start at sign-in', error);
  }
}

// ---------------------------------------------------------------------------
// The tray icon, the app's only visible piece.

/** Says what the wallpaper is doing, and why: unexplained stillness reads as a fault. */
function statusLine() {
  if (power.saver) return text.saver;
  if (stopped) return reduceMotion() ? text.pausedMotion : text.paused;
  if (!awake()) return text.off;
  if (applied === 0 && wallpapers.some((w) => !w.attached)) return text.waiting;
  if (applied === 0) return text.resting;
  return text.running(applied);
}

function menu() {
  applyRate();
  return Menu.buildFromTemplate([
    { label: statusLine(), enabled: false },
    { type: 'separator' },
    {
      label: text.world,
      submenu: [
        ...worlds.map((choice) => ({
          label: titleOf(choice), type: 'radio', checked: choice === world, click: () => selectWorld(choice),
        })),
        { type: 'separator' },
        { label: text.next, click: nextWorld, ...accelerator('world') },
      ],
    },
    { type: 'separator' },
    {
      label: world.stir ? text.stir : text.feed,
      // Food that nothing is going to draw would sit unseen and then arrive all at once.
      enabled: applied > 0 && world.feed !== false,
      click: feedEveryScreen,
      ...accelerator('feed'),
    },
    // With Energy Saver on nothing is going to draw, so Resume would be a false promise.
    { label: stopped ? text.resume : text.pause, enabled: !power.saver, click: togglePause, ...accelerator('pause') },
    { type: 'separator' },
    {
      label: text.quick,
      submenu: [
        {
          label: text.hotkeys, type: 'checkbox', checked: hotkeysOn(),
          click: () => { settings.hotkeys = !hotkeysOn(); saveSettings(); registerShortcuts(); },
        },
        ...[...takenShortcuts].map((action) => ({ label: text.taken(keyFor(action)), enabled: false })),
        ...(PREVIEW ? [] : [{
          label: world.stir ? text.doubleClickStir : text.doubleClick,
          type: 'checkbox', checked: doubleClickOn(),
          click: () => { settings.doubleClickFeed = !doubleClickOn(); saveSettings(); updateClickTimer(); },
        }]),
      ],
    },
    { type: 'separator' },
    ...(canStartAtLogin()
      ? [{ label: text.login, type: 'checkbox', checked: startsAtLogin(), click: toggleStartAtLogin }]
      : []),
    { label: text.quit, click: () => app.quit() },
  ]);
}

/** The menu, at the tray icon when that was clicked, otherwise at the cursor. */
function showMenu() {
  if (tray && !tray.isDestroyed()) tray.popUpContextMenu(menu());
}

function addTray() {
  try {
    tray = new Tray(ICON);
  } catch (error) {
    log('no tray icon', error);
    return;
  }
  tray.setToolTip(`Deskworlds · ${titleOf(world)}`);
  tray.on('click', showMenu);
  tray.on('right-click', showMenu);
}

/** Every display changes together, so the menu's check mark is never a half-truth. */
function selectWorld(choice) {
  if (choice === world) return;
  world = choice;
  settings.world = choice.id;
  saveSettings();
  tray?.setToolTip(`Deskworlds · ${titleOf(choice)}`);
  for (const wallpaper of wallpapers) wallpaper.load(choice);
}

/** The choice outlives a restart, so a paused world is still paused after signing in. */
function togglePause() {
  stopped = !stopped;
  settings.paused = stopped;
  saveSettings();
  applyRate();
}

/** `Deskworlds.exe --snapshot` saves what the first display shows to %TEMP%. */
async function snapshot() {
  const first = wallpapers.find((w) => !w.win.isDestroyed());
  if (!first) return;
  forceUntil = Date.now() + 6000;
  applyRate();
  await new Promise((resolve) => setTimeout(resolve, 4000));
  await first.probe();
  try {
    const image = await first.win.webContents.capturePage();
    const file = path.join(os.tmpdir(), 'deskworlds.png');
    fs.writeFileSync(file, image.toPNG());
    log(`wrote ${file}`);
  } catch (error) {
    log('snapshot failed', error);
  }
  forceUntil = 0;
  applyRate();
}

// ---------------------------------------------------------------------------

async function start() {
  if (process.platform === 'win32') app.setAppUserModelId('com.chaselean.deskworlds');
  const data = app.getPath('userData');
  fs.mkdirSync(data, { recursive: true });
  logFile = path.join(data, 'deskworlds.log');
  trimLog();
  const language = app.getPreferredSystemLanguages?.()[0] || app.getLocale();
  text = /^zh/i.test(language) ? TEXT.zh : TEXT.en;

  settingsFile = path.join(data, 'settings.json');
  loadSettings();
  worlds = discoverWorlds();
  if (!worlds.length) {
    log(`no scenes found under ${ROOT}`);
    app.quit();
    return;
  }
  world = worlds.find((choice) => choice.id === settings.world) || worlds[0];
  reduceMotionSeen = reduceMotion();
  // Until a choice has been made there is nothing saved at all, which lets a machine
  // with animation effects off start still without overruling a later decision.
  stopped = typeof settings.paused === 'boolean' ? settings.paused : reduceMotionSeen;

  log(`Deskworlds ${app.getVersion()}, Electron ${process.versions.electron}, ${os.type()} ${os.release()}, `
    + `scenes from ${ROOT}${PREVIEW ? ', preview window' : ''}`);
  if (!PREVIEW && !desktop.available()) {
    log('the Win32 bridge is unavailable, so nothing can go behind the icons; `--window` still works');
  }

  // In memory only: the pages hold nothing worth keeping and should leave no traces.
  sceneSession = session.fromPartition('deskworlds-scenes');
  sceneSession.protocol.handle(SCHEME, serveScenes);
  ipcMain.on('deskworlds:ready', (event) => {
    wallpapers.find((w) => !w.win.isDestroyed() && w.win.webContents.id === event.sender.id)?.ready();
  });

  addTray();
  registerShortcuts();

  if (!PREVIEW) {
    // A hidden top-level window, only for the broadcasts the wallpapers can no longer
    // hear now that they are children of Explorer's desktop.
    messageWindow = new BaseWindow({ show: false, width: 1, height: 1, skipTaskbar: true, focusable: false });
    desktop.watchSystem(messageWindow, {
      onDisplay(on) {
        if (displayOff === !on) return;
        displayOff = !on;
        log(`display ${on ? 'on' : 'off'}`);
        applyRate();
      },
      onExplorer() {
        log('Explorer restarted');
        scheduleRebuild(2000);
      },
    });
  }

  // Drawing while the display is asleep or locked would only cost power.
  powerMonitor.on('lock-screen', () => { locked = true; applyRate(); });
  powerMonitor.on('unlock-screen', () => { locked = false; applyRate(); });
  powerMonitor.on('suspend', () => { asleep = true; applyRate(); });
  powerMonitor.on('resume', () => { asleep = false; applyRate(); });
  powerMonitor.on('on-battery', applyRate);
  powerMonitor.on('on-ac', applyRate);
  for (const name of ['display-added', 'display-removed', 'display-metrics-changed']) screen.on(name, screensChanged);

  build();
  tickTimer = setInterval(tick, 1000);
  if (process.argv.includes('--snapshot')) setTimeout(snapshot, 25000);
}

if (PREVIEW) app.setPath('userData', path.join(app.getPath('appData'), 'Deskworlds Preview'));
else app.setPath('userData', path.join(app.getPath('appData'), 'Deskworlds'));

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else if (process.argv.includes('--quit')) {
  // Nothing was running to ask.
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    // `Deskworlds.exe --quit`, from the installer: a clean exit restores the picture.
    if (argv.includes('--quit')) app.quit();
    else if (argv.includes('--snapshot')) snapshot();
    // Opened again while running, from the desktop or the Start menu: rather than
    // nothing at all, the menu appears where the cursor is, its first line saying what
    // the wallpaper is doing. (While a menu is open the main process waits for it, so
    // the app never opens one by itself, only in answer to someone.)
    else showMenu();
  });
  // The tray keeps the app alive; wallpaper windows only vanish when Explorer restarts.
  app.on('window-all-closed', () => { if (PREVIEW) app.quit(); });
  app.on('before-quit', () => {
    if (quitting) return;
    quitting = true;
    clearInterval(tickTimer);
    clearInterval(pointerTimer);
    clearInterval(clickTimer);
    globalShortcut.unregisterAll();
    clearTimeout(rebuildTimer);
    clearTimeout(attachTimer);
    clearTimeout(screensTimer);
    const hadWallpapers = wallpapers.some((w) => w.attached);
    for (const wallpaper of wallpapers) wallpaper.close();
    wallpapers = [];
    // Have Explorer paint the desktop picture over the last frame the scene left behind.
    if (!PREVIEW && hadWallpapers) desktop.refreshWallpaper();
    tray?.destroy();
  });
  app.whenReady().then(start).catch((error) => {
    log('startup failed', error);
    app.quit();
  });
}
