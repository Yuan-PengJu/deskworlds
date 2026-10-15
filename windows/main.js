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
  app, BaseWindow, BrowserWindow, Menu, Tray, dialog, globalShortcut, ipcMain, powerMonitor, protocol,
  screen, session, systemPreferences,
} = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { pathToFileURL } = require('node:url');
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
  // creatures: the scene reads ?creatures= for how many to have (see scenes/*/src).
  { id: 'riverscape', names: { en: 'Riverbed', 'zh-CN': '河床', 'zh-TW': '河床' }, background: '#080e0c', creatures: true, skins: 'fish' },
  { id: 'reefscape', names: { en: 'Coral reef', 'zh-CN': '珊瑚礁', 'zh-TW': '珊瑚礁' }, background: '#0b1825', skins: 'fish' },
  { id: 'bettascape', names: { en: 'Betta', 'zh-CN': '斗鱼', 'zh-TW': '鬥魚' }, background: '#000000' },
  // Only worlds with something to eat have anything to feed; the bonfire is stirred instead.
  { id: 'plasmascape', names: { en: 'Plasma globe', 'zh-CN': '等离子球', 'zh-TW': '電漿球' }, background: '#000000', feed: false, skins: 'core' },
  { id: 'koiscape', names: { en: 'Koi pond', 'zh-CN': '锦鲤池', 'zh-TW': '錦鯉池' }, background: '#040605', creatures: true, skins: 'koi' },
  { id: 'bonfirescape', names: { en: 'Bonfire', 'zh-CN': '篝火', 'zh-TW': '營火' }, background: '#000000', stir: true },
];

/** Your pictures for the built-in worlds' creatures, a folder per world. */
let userSkins = null;
const MEDIA_NAMES = { en: 'Your wallpaper', 'zh-CN': '自定义壁纸', 'zh-TW': '自訂桌布' };

/** A scene's name for the menu: its page title up to the bullet, or its folder's name. */
function sceneTitle(page, fallback) {
  try { return /<title>([^<•]+)/.exec(fs.readFileSync(page, 'utf8'))?.[1]?.trim() || fallback; } catch { return fallback; }
}

/** Whether a picture, video or page has been chosen and is still there to show. */
function mediaReady() {
  const media = settings.media;
  if (!media) return false;
  if (media.kind === 'page') return typeof media.url === 'string' && media.url.length > 0;
  return (media.kind === 'image' || media.kind === 'video') && typeof media.file === 'string' && fs.existsSync(media.file);
}

/**
 * The built-in worlds, then your own scenes, then your own wallpaper if one is chosen.
 * Each world is { id, kind, folder, names, background, feed?, stir?, creatures? }.
 */
function discoverWorlds() {
  const page = (folder) => path.join(ROOT, 'scenes', folder, 'wallpaper.html');
  const found = KNOWN_WORLDS.filter((choice) => fs.existsSync(page(choice.id)))
    .map((choice) => ({ ...choice, kind: 'builtin', folder: choice.id }));
  let folders = [];
  try { folders = fs.readdirSync(path.join(ROOT, 'scenes')).sort(); } catch { /* none */ }
  // Scenes a fork added beside the built-in ones.
  for (const folder of folders) {
    if (found.some((choice) => choice.folder === folder) || !fs.existsSync(page(folder))) continue;
    found.push({ id: folder, kind: 'builtin', folder, names: { en: sceneTitle(page(folder), folder) }, background: '#000000' });
  }
  if (mediaReady()) found.push({ id: 'media', kind: 'media', names: MEDIA_NAMES, background: '#000000', feed: false });
  return found;
}

/**
 * Re-reads the folders, keeping the world shown if it is still there. If it went away
 * (its folder deleted, its video moved), the first world takes its place.
 */
function refreshWorlds() {
  const shown = world?.id;
  worlds = discoverWorlds();
  const same = worlds.find((choice) => choice.id === shown);
  if (same) {
    world = same;
  } else if (worlds.length && shown) {
    log(`${shown} is gone; showing ${worlds[0].id}`);
    showWorld(worlds[0]);
  }
}

/** The languages the menu speaks, each named in itself. */
const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'zh-CN', name: '简体中文' },
  { code: 'zh-TW', name: '繁體中文' },
];

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
    language: 'Language', system: 'Same as Windows', loading: 'Loading world…',
    settings: "Settings…",
    ui: {
      title: "Deskworlds Settings",
      world: "World",
      builtIn: "Built-in worlds",
      adjust: "Adjust",
      adjustFor: "For {name}",
      brightness: "Brightness",
      contrast: "Contrast",
      saturation: "Saturation",
      hue: "Hue",
      creatures: "Creatures",
      creaturesNote: "The world starts again to change how many creatures it has.",
      reset: "Reset",
      media: "Your Own Wallpaper",
      mediaNote: "Show a picture, a video or a web page instead of a world. Videos play without sound.",
      image: "Choose Picture…",
      video: "Choose Video…",
      htmlFile: "Choose HTML File…",
      pageUrl: "Web page address",
      use: "Show",
      badUrl: "Enter an address starting with http:// or https://",
      showing: "Chosen: {name}",
      pageNote: "While the desktop is covered or paused, a web page is hidden so it uses no power.",
      skinsTitle: "Replace",
      skinRoles: {"fish": "The fish", "koi": "The koi", "core": "The ball in the globe"},
      skinNote: "Put your own pictures in their place. They keep everything the originals do: schooling, shying from the cursor, coming for food. A PNG with a transparent background, facing right, works best; several pictures are mixed.",
      skinAdd: "Add Pictures…",
      skinReset: "Restore the Originals",
      skinRemove: "Remove",
      showMedia: "Show This Wallpaper",
      showingNow: "Showing now: {name}",
    },
  },
  'zh-CN': {
    world: '世界', feed: '喂食', stir: '拨一拨篝火', pause: '暂停', resume: '继续',
    quit: '退出', saver: '节能模式已开启，画面保持静止', paused: '已暂停',
    pausedMotion: '已暂停（系统关闭了动画效果）',
    off: '屏幕已关闭或锁定，画面保持静止', waiting: '正在等待桌面就绪…',
    resting: '被窗口挡住了，正在休息', running: (fps) => `正在以每秒 ${fps} 帧运行`,
    next: '下一个世界', quick: '快捷操作', hotkeys: '全局快捷键',
    taken: (keys) => `${keys} 被其他程序占用`,
    doubleClick: '双击桌面空白处喂食', doubleClickStir: '双击桌面空白处拨火',
    login: '开机自动启动',
    language: '语言', system: '跟随系统', loading: '正在加载世界…',
    settings: "设置…",
    ui: {
      title: "Deskworlds 设置",
      world: "世界",
      builtIn: "内置世界",
      adjust: "调整",
      adjustFor: "当前：{name}",
      brightness: "亮度",
      contrast: "对比度",
      saturation: "饱和度",
      hue: "色相",
      creatures: "生物数量",
      creaturesNote: "修改生物数量时，世界会重新加载。",
      reset: "恢复默认",
      media: "自定义壁纸",
      mediaNote: "用图片、视频或网页代替世界显示在桌面上。视频不会播放声音。",
      image: "选择图片…",
      video: "选择视频…",
      htmlFile: "选择 HTML 文件…",
      pageUrl: "网页地址",
      use: "显示",
      badUrl: "请输入以 http:// 或 https:// 开头的网址",
      showing: "已选择：{name}",
      pageNote: "桌面被挡住或暂停时，网页会被隐藏，不会在后台耗电。",
      skinsTitle: "替换元素",
      skinRoles: {"fish": "鱼", "koi": "锦鲤", "core": "球心的电极球"},
      skinNote: "换成你自己的图片。换上的图片会保留原来的一切行为：成群游动、躲开鼠标、过来抢食。透明背景、朝向右边的 PNG 效果最好；添加多张会混在一起。",
      skinAdd: "添加图片…",
      skinReset: "恢复原样",
      skinRemove: "移除",
      showMedia: "显示这个壁纸",
      showingNow: "正在显示：{name}",
    },
  },
  'zh-TW': {
    world: '世界', feed: '餵食', stir: '撥一撥營火', pause: '暫停', resume: '繼續',
    quit: '結束', saver: '省電模式已開啟，畫面保持靜止', paused: '已暫停',
    pausedMotion: '已暫停（系統關閉了動畫效果）',
    off: '螢幕已關閉或鎖定，畫面保持靜止', waiting: '正在等待桌面就緒…',
    resting: '被視窗擋住了，正在休息', running: (fps) => `正在以每秒 ${fps} 幀執行`,
    next: '下一個世界', quick: '快速操作', hotkeys: '全域快速鍵',
    taken: (keys) => `${keys} 已被其他程式使用`,
    doubleClick: '按兩下桌面空白處餵食', doubleClickStir: '按兩下桌面空白處撥火',
    login: '開機時自動啟動',
    language: '語言', system: '跟隨系統', loading: '正在載入世界…',
    settings: "設定…",
    ui: {
      title: "Deskworlds 設定",
      world: "世界",
      builtIn: "內建世界",
      adjust: "調整",
      adjustFor: "目前：{name}",
      brightness: "亮度",
      contrast: "對比",
      saturation: "飽和度",
      hue: "色相",
      creatures: "生物數量",
      creaturesNote: "修改生物數量時，世界會重新載入。",
      reset: "恢復預設",
      media: "自訂桌布",
      mediaNote: "用圖片、影片或網頁取代世界顯示在桌面上。影片不會播放聲音。",
      image: "選擇圖片…",
      video: "選擇影片…",
      htmlFile: "選擇 HTML 檔案…",
      pageUrl: "網頁網址",
      use: "顯示",
      badUrl: "請輸入以 http:// 或 https:// 開頭的網址",
      showing: "已選擇：{name}",
      pageNote: "桌面被擋住或暫停時，網頁會被隱藏，不會在背景耗電。",
      skinsTitle: "替換元素",
      skinRoles: {"fish": "魚", "koi": "錦鯉", "core": "球心的電極球"},
      skinNote: "換成你自己的圖片。換上的圖片會保留原來的一切行為：成群游動、躲開滑鼠、過來搶食。透明背景、朝向右邊的 PNG 效果最好；新增多張會混在一起。",
      skinAdd: "新增圖片…",
      skinReset: "恢復原樣",
      skinRemove: "移除",
      showMedia: "顯示這個桌布",
      showingNow: "正在顯示：{name}",
    },
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
  // stream: a video wallpaper is read in ranges as it plays.
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
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

const MEDIA_TYPES = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
  '.gif': 'image/gif', '.bmp': 'image/bmp', '.avif': 'image/avif',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/mp4', '.webm': 'video/webm',
};
const HOST_PAGES = path.join(__dirname, 'host');

/**
 * Everything the pages load: the host's own pages under /host, the chosen picture or
 * video at /media/current, your scenes from your scenes folder, and the rest from the
 * app's copy of the project. Nothing outside those folders.
 */
async function serveScenes(request) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url).pathname);
  } catch {
    return new Response('Bad request', { status: 400 });
  }
  if (pathname === '/media/current') return serveMedia(request);
  const parts = pathname.split('/');
  if (parts[1] === 'host') return serveFile(HOST_PAGES, parts.slice(2).join('/'));
  if (parts[1] === 'skins' && userSkins) return serveFile(userSkins, parts.slice(2).join('/'));
  return serveFile(ROOT, pathname);
}

async function serveFile(root, relative) {
  const file = path.resolve(root, `./${relative}`);
  if (!file.startsWith(root + path.sep)) return new Response('Forbidden', { status: 403 });
  try {
    const data = await fs.promises.readFile(file);
    const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
    return new Response(data, { headers: { 'content-type': type, 'cache-control': 'no-store' } });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}

/** The chosen picture or video, in byte ranges when asked, which video playback needs. */
async function serveMedia(request) {
  const file = settings.media?.file;
  let size;
  try { size = (await fs.promises.stat(file)).size; } catch { return new Response('Not found', { status: 404 }); }
  const headers = {
    'content-type': MEDIA_TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'accept-ranges': 'bytes', 'cache-control': 'no-store',
  };
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') || '');
  if (!range) {
    return new Response(Readable.toWeb(fs.createReadStream(file)), { headers: { ...headers, 'content-length': String(size) } });
  }
  let start = range[1] === '' ? size - Number(range[2]) : Number(range[1]);
  let end = range[1] !== '' && range[2] !== '' ? Number(range[2]) : size - 1;
  start = Math.max(0, start);
  end = Math.min(end, size - 1);
  if (!(start <= end)) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } });
  return new Response(Readable.toWeb(fs.createReadStream(file, { start, end })), {
    status: 206,
    headers: { ...headers, 'content-length': String(end - start + 1), 'content-range': `bytes ${start}-${end}/${size}` },
  });
}

// ---------------------------------------------------------------------------
// Adjustments, kept per world: light and colour apply to any page as a CSS filter, live;
// the number of creatures is read by the scene when it loads.

const TWEAKS = {
  brightness: { initial: 100, min: 40, max: 160 },
  contrast: { initial: 100, min: 50, max: 150 },
  saturation: { initial: 100, min: 0, max: 200 },
  hue: { initial: 0, min: -180, max: 180 },
  creatures: { initial: 100, min: 25, max: 250 },
};

function tweaksFor(choice) {
  const saved = settings.tweaks?.[choice.id] || {};
  const tweaks = {};
  for (const [key, { initial, min, max }] of Object.entries(TWEAKS)) {
    const value = Number(saved[key]);
    tweaks[key] = Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : initial;
  }
  return tweaks;
}

/** The CSS filter for a world's light and colour, or '' when nothing was changed. */
function filterFor(choice) {
  const { brightness, contrast, saturation, hue } = tweaksFor(choice);
  return [
    brightness !== 100 && `brightness(${brightness}%)`,
    contrast !== 100 && `contrast(${contrast}%)`,
    saturation !== 100 && `saturate(${saturation}%)`,
    hue !== 0 && `hue-rotate(${hue}deg)`,
  ].filter(Boolean).join(' ');
}

/** Where a world's page is: a scene of either kind, the viewer, or the chosen web page. */
function pageFor(choice) {
  if (choice.kind === 'media') {
    const media = settings.media;
    if (media.kind === 'page') return media.url;
    return `${SCHEME}://${HOST}/host/media.html?kind=${media.kind}`;
  }
  const { creatures } = tweaksFor(choice);
  const share = choice.creatures && creatures !== 100 ? `&creatures=${creatures / 100}` : '';
  const pictures = skinsFor(choice).map((file) => `/skins/${choice.id}/${encodeURIComponent(file)}`);
  const skins = pictures.length ? `&skins=${encodeURIComponent(JSON.stringify(pictures))}` : '';
  // Native: full display resolution plugged in, the Balanced profile on battery.
  return `${SCHEME}://${HOST}/scenes/${encodeURIComponent(choice.folder)}/wallpaper.html?quality=native${share}${skins}`;
}

/** The pictures chosen to stand in for a world's creatures, those still on disk. */
function skinsFor(choice) {
  if (!choice?.skins || !userSkins) return [];
  const files = Array.isArray(settings.skins?.[choice.id]) ? settings.skins[choice.id] : [];
  return files.filter((file) => typeof file === 'string' && fs.existsSync(path.join(userSkins, choice.id, file))).slice(0, 12);
}

const showsWebPage = (choice) => choice?.kind === 'media' && settings.media?.kind === 'page';

// ---------------------------------------------------------------------------

let language = 'en';
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
const titleOf = (choice) => choice.names[language] || choice.names.en;

/**
 * The language chosen in the menu, or with none chosen the closest to Windows' own
 * preferences, taken in order: Traditional Chinese for Taiwan, Hong Kong and Macao.
 */
function resolveLanguage() {
  if (TEXT[settings.language]) return settings.language;
  const preferred = [...(app.getPreferredSystemLanguages?.() || []), app.getLocale()];
  for (const tag of preferred.map((entry) => String(entry).toLowerCase())) {
    if (/^zh-(hant|tw|hk|mo)/.test(tag)) return 'zh-TW';
    if (tag.startsWith('zh')) return 'zh-CN';
    if (tag.startsWith('en')) return 'en';
  }
  return 'en';
}

/** Puts the language in force everywhere it shows: the menu, the tooltip, the pages. */
function applyLanguage() {
  language = resolveLanguage();
  text = TEXT[language];
  if (world) tray?.setToolTip(`Deskworlds · ${titleOf(world)}`);
  for (const wallpaper of wallpapers) wallpaper.localize();
}

/** null goes back to following Windows. */
function chooseLanguage(code) {
  if (code) settings.language = code;
  else delete settings.language;
  saveSettings();
  applyLanguage();
  log(`language: ${code || `same as Windows (${language})`}`);
  notifySettings();
}
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
    contents.on('dom-ready', () => { this.localize(); this.applyLook(); });
    // A wallpaper never makes a sound, whatever page or video it shows.
    contents.setAudioMuted(true);
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    // A web page chosen as the wallpaper may move between its own pages; scenes stay put.
    contents.on('will-navigate', (event, url) => {
      if (!url.startsWith(`${SCHEME}://`) && !showsWebPage(this.world)) event.preventDefault();
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
    this.win.loadURL(pageFor(choice))
      .catch((error) => { if (error.code !== 'ERR_ABORTED' && !quitting) log(`could not open ${choice.id}`, error); });
  }

  /** Light and colour, sent again whenever they are adjusted. */
  applyLook() {
    if (!this.win.isDestroyed()) this.win.webContents.send('deskworlds:filter', filterFor(this.world));
  }

  /** The scene's "Loading world…", which shows for a while, in the menu's language. */
  localize() {
    if (!this.win.isDestroyed()) this.win.webContents.send('deskworlds:loading-text', text.loading);
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
    // A web page knows nothing of frame rates, so while it should be still it is hidden,
    // which stops it drawing; the desktop is covered then anyway, or paused.
    if (showsWebPage(this.world) && this.attached && !PREVIEW && !this.win.isDestroyed()) {
      if (this.rate === 0) this.win.hide();
      else this.win.showInactive();
    }
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

  /**
   * A double-click on empty desktop, at a point in this display's own coordinates. A
   * scene that knows where things are takes it there (sceneTap); the others are fed.
   */
  tap(x, y) {
    if (this.rate === 0) return;
    this.run(`typeof sceneTap === 'function' ? sceneTap(${Math.round(x)}, ${Math.round(y)})
      : typeof sceneFeed === 'function' && sceneFeed()`);
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

/** Taps the world on the display that was double-clicked, at the spot double-clicked. */
function feedAt(point) {
  const wallpaper = wallpapers.find((w) => {
    const b = w.display.bounds;
    return !w.win.isDestroyed() && point.x >= b.x && point.x < b.x + b.width && point.y >= b.y && point.y < b.y + b.height;
  });
  wallpaper?.tap(point.x - wallpaper.display.bounds.x, point.y - wallpaper.display.bounds.y);
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
// The settings window: worlds, your own scenes, adjustments and your own wallpaper.
// It is a page served like the scenes, with its own small bridge (settings-preload.js),
// so the Mac app can show the same page.

let settingsWindow = null;
let saveTimer = null;
let reloadTimer = null;

function openSettings() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 720, height: 680, minWidth: 560, minHeight: 480, show: false, icon: ICON,
    title: text.ui.title, autoHideMenuBar: true, backgroundColor: '#17191e',
    webPreferences: {
      preload: path.join(__dirname, 'settings-preload.js'), session: sceneSession,
      sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false,
    },
  });
  settingsWindow.setMenuBarVisibility(false);
  settingsWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  settingsWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  settingsWindow.once('ready-to-show', () => settingsWindow?.show());
  settingsWindow.on('closed', () => { settingsWindow = null; });
  settingsWindow.loadURL(`${SCHEME}://${HOST}/host/settings.html`);
}

/** Tells an open settings window that something it shows has changed. */
function notifySettings() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.setTitle(text.ui.title);
    settingsWindow.webContents.send('settings:changed');
  }
}

/** Sliders send many small changes; the file is written once they settle. */
function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveSettings, 400);
}

function settingsState() {
  refreshWorlds();
  const media = settings.media && mediaReady() ? settings.media : null;
  return {
    language,
    ui: text.ui,
    worlds: worlds.map((choice) => ({ id: choice.id, kind: choice.kind, title: titleOf(choice) })),
    current: world.id,
    currentTitle: titleOf(world),
    skins: world.skins ? { role: world.skins, files: skinsFor(world).map((file) => ({ file, url: `/skins/${world.id}/${encodeURIComponent(file)}` })) } : null,
    tweaks: tweaksFor(world),
    ranges: TWEAKS,
    creatures: Boolean(world.creatures),
    media: media && {
      kind: media.kind,
      name: media.kind === 'page' && !media.file ? media.url : path.basename(media.file || media.url),
      showing: world.kind === 'media',
    },
  };
}


/** Shows the chosen picture, video or page, replacing what was shown before. */
function showMedia(media) {
  settings.media = media;
  refreshWorlds();
  const choice = worlds.find((entry) => entry.kind === 'media');
  if (choice) showWorld(choice);
  log(`your wallpaper: ${media.kind} ${media.file || media.url}`);
}

const PICKERS = {
  image: { extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'avif'], label: 'image' },
  video: { extensions: ['mp4', 'webm', 'mov', 'm4v'], label: 'video' },
  html: { extensions: ['html', 'htm'], label: 'htmlFile' },
};

function handleSettings() {
  // Only the settings window may change settings; the wallpapers, which can show any web
  // page, have no way to reach these, and are refused even if one tried.
  const handle = (channel, run) => ipcMain.handle(channel, (event, ...args) => {
    if (!settingsWindow || settingsWindow.isDestroyed() || event.sender !== settingsWindow.webContents) {
      throw new Error('not the settings window');
    }
    return run(...args);
  });

  handle('settings:state', () => settingsState());
  handle('settings:world', (id) => {
    const choice = worlds.find((entry) => entry.id === id);
    if (choice) selectWorld(choice);
    return settingsState();
  });
  handle('settings:tweak', (key, value) => {
    if (!TWEAKS[key] || !Number.isFinite(Number(value))) return settingsState();
    settings.tweaks = settings.tweaks || {};
    settings.tweaks[world.id] = { ...settings.tweaks[world.id], [key]: Number(value) };
    saveSoon();
    if (key === 'creatures') {
      // Read only as the scene loads, so it starts again once the slider settles.
      clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => { for (const wallpaper of wallpapers) wallpaper.load(world); }, 600);
    } else {
      for (const wallpaper of wallpapers) wallpaper.applyLook();
    }
    return null;
  });
  handle('settings:reset', () => {
    const hadCreatures = settings.tweaks?.[world.id]?.creatures !== undefined;
    if (settings.tweaks) delete settings.tweaks[world.id];
    saveSettings();
    for (const wallpaper of wallpapers) {
      if (hadCreatures && world.creatures) wallpaper.load(world);
      else wallpaper.applyLook();
    }
    return settingsState();
  });
  handle('settings:pick', async (kind) => {
    const picker = PICKERS[kind];
    if (!picker) return settingsState();
    const result = await dialog.showOpenDialog(settingsWindow, {
      title: text.ui[picker.label].replace(/…$/, ''),
      properties: ['openFile'],
      filters: [{ name: text.ui[picker.label].replace(/…$/, ''), extensions: picker.extensions }],
    });
    const file = result.filePaths?.[0];
    if (!result.canceled && file) {
      showMedia(kind === 'html' ? { kind: 'page', url: pathToFileURL(file).href, file } : { kind, file });
    }
    return settingsState();
  });
  handle('settings:page', (address) => {
    let url;
    try { url = new URL(String(address).trim()); } catch { return { error: text.ui.badUrl }; }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return { error: text.ui.badUrl };
    showMedia({ kind: 'page', url: url.href });
    return settingsState();
  });
  // Back to the chosen picture, video or page after showing a world.
  handle('settings:show-media', () => {
    const choice = worlds.find((entry) => entry.kind === 'media');
    if (choice) selectWorld(choice);
    return settingsState();
  });

  // Your pictures in place of the world's creatures: added, taken away, or all cleared.
  const reloadSkins = () => { saveSettings(); for (const wallpaper of wallpapers) wallpaper.load(world); return settingsState(); };
  handle('settings:skin-add', async () => {
    if (!world.skins) return settingsState();
    const result = await dialog.showOpenDialog(settingsWindow, {
      title: text.ui.skinAdd.replace(/…$/, ''), properties: ['openFile', 'multiSelections'],
      filters: [{ name: text.ui.skinAdd.replace(/…$/, ''), extensions: ['png', 'webp', 'gif', 'jpg', 'jpeg'] }],
    });
    if (result.canceled || !result.filePaths?.length) return settingsState();
    const folder = path.join(userSkins, world.id);
    fs.mkdirSync(folder, { recursive: true });
    const chosen = skinsFor(world);
    for (const source of result.filePaths.slice(0, 12 - chosen.length)) {
      const extension = path.extname(source).toLowerCase();
      const stem = path.basename(source, path.extname(source)).replace(/[^\w\u4e00-\u9fff-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'picture';
      let name = `${stem}${extension}`;
      for (let n = 2; fs.existsSync(path.join(folder, name)); n++) name = `${stem}-${n}${extension}`;
      fs.copyFileSync(source, path.join(folder, name));
      chosen.push(name);
    }
    settings.skins = { ...settings.skins, [world.id]: chosen };
    log(`pictures for ${world.id}: ${chosen.join(', ')}`);
    return reloadSkins();
  });
  handle('settings:skin-remove', (file) => {
    settings.skins = { ...settings.skins, [world.id]: skinsFor(world).filter((entry) => entry !== file) };
    fs.rmSync(path.join(userSkins, world.id, path.basename(String(file))), { force: true });
    return reloadSkins();
  });
  handle('settings:skin-reset', () => {
    if (settings.skins) delete settings.skins[world.id];
    fs.rmSync(path.join(userSkins, world.id), { recursive: true, force: true });
    return reloadSkins();
  });

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
  refreshWorlds();
  applyRate();
  const item = (choice) => ({
    label: titleOf(choice), type: 'radio', checked: choice === world, click: () => selectWorld(choice),
  });
  const mine = worlds.filter((choice) => choice.kind !== 'builtin');
  return Menu.buildFromTemplate([
    { label: statusLine(), enabled: false },
    { type: 'separator' },
    {
      label: text.world,
      submenu: [
        ...worlds.filter((choice) => choice.kind === 'builtin').map(item),
        ...(mine.length ? [{ type: 'separator' }, ...mine.map(item)] : []),
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
    { label: text.settings, click: openSettings },
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
    {
      label: text.language,
      // One radio group, so no separator inside: following Windows is a choice like the others.
      submenu: [
        { label: text.system, type: 'radio', checked: !TEXT[settings.language], click: () => chooseLanguage(null) },
        ...LANGUAGES.map(({ code, name }) => ({
          label: name, type: 'radio', checked: settings.language === code, click: () => chooseLanguage(code),
        })),
      ],
    },
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
  showWorld(choice);
}

/** Shows a world on every display, even the one already shown, whose content may be new. */
function showWorld(choice) {
  world = choice;
  settings.world = choice.id;
  saveSettings();
  tray?.setToolTip(`Deskworlds · ${titleOf(choice)}`);
  for (const wallpaper of wallpapers) wallpaper.load(choice);
  notifySettings();
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

  settingsFile = path.join(data, 'settings.json');
  loadSettings();
  applyLanguage();
  userSkins = path.join(data, 'skins');
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
  handleSettings();

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
