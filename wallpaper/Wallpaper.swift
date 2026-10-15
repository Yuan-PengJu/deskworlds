// A living world as a desktop wallpaper.
//
// One borderless window per screen sits at the desktop window level: above the still
// wallpaper picture, below the desktop icons, so files and folders stay on top of the
// scene and keep working normally. The scene comes from a web view fed by the copy of
// the scenes inside this app bundle, served over a private scheme so its module
// imports resolve the way they do from a web server.
//
// The window never takes mouse events. The pointer reaches the scene another way: the
// global cursor position is read on a timer and handed to the page as a pointer move,
// so clicking and dragging on the desktop still belongs to the Finder.

import ApplicationServices
import Cocoa
import WebKit
import IOKit.ps

let sceneScheme = "deskworlds"
let sceneHost = "local"

/// The scenes the app can show, each a directory under scenes/ with a wallpaper.html.
enum World: String, CaseIterable {
  case riverscape, reefscape, bettascape, plasmascape, koiscape, bonfirescape

  var title: String { Words.current.worlds[self] ?? rawValue }
  /// Only worlds with something to eat have anything to feed; the bonfire is stirred instead.
  var canFeed: Bool { self != .plasmascape }
  var feedTitle: String { self == .bonfirescape ? Words.current.stir : Words.current.feed }
  var page: String { "/scenes/\(rawValue)/wallpaper.html" }
  /// What shows before the page has drawn anything, matched to each scene's own dark.
  var background: NSColor {
    switch self {
    case .riverscape: NSColor(calibratedRed: 0.031, green: 0.055, blue: 0.047, alpha: 1)
    case .reefscape: NSColor(calibratedRed: 0.043, green: 0.094, blue: 0.145, alpha: 1)
    case .bettascape, .plasmascape, .bonfirescape: .black
    case .koiscape: NSColor(calibratedRed: 0.016, green: 0.024, blue: 0.02, alpha: 1)
    }
  }

  /// Riverbed until somebody picks otherwise. The choice outlives a restart.
  static var selected: World {
    get { UserDefaults.standard.string(forKey: "world").flatMap(World.init) ?? .riverscape }
    set { UserDefaults.standard.set(newValue.rawValue, forKey: "world") }
  }
}

/// Serves the bundled copy of the scenes to the web view.
/// The languages the menu speaks. `system` follows macOS's own order of preference.
enum Language: String, CaseIterable {
  case system
  case english = "en"
  case simplifiedChinese = "zh-Hans"
  case traditionalChinese = "zh-Hant"

  /// Each language named in itself; following the system in the language now in use.
  var name: String {
    switch self {
    case .system: Words.current.sameAsSystem
    case .english: "English"
    case .simplifiedChinese: "简体中文"
    case .traditionalChinese: "繁體中文"
    }
  }

  /// Nothing is stored until a language is chosen, so a machine whose language changes
  /// later is followed rather than overruled.
  static var chosen: Language {
    get { UserDefaults.standard.string(forKey: "language").flatMap(Language.init) ?? .system }
    set {
      if newValue == .system {
        UserDefaults.standard.removeObject(forKey: "language")
      } else {
        UserDefaults.standard.set(newValue.rawValue, forKey: "language")
      }
    }
  }

  /// The language in force: the one chosen, or the first of macOS's preferences that the
  /// menu speaks, with Traditional Chinese for Taiwan, Hong Kong and Macao.
  static var current: Language {
    if chosen != .system { return chosen }
    for tag in Locale.preferredLanguages.map({ $0.lowercased() }) {
      if ["zh-hant", "zh-tw", "zh-hk", "zh-mo"].contains(where: { tag.hasPrefix($0) }) {
        return .traditionalChinese
      }
      if tag.hasPrefix("zh") { return .simplifiedChinese }
      if tag.hasPrefix("en") { return .english }
    }
    return .english
  }
}

/// Everything the app says, in each language it speaks. The log stays in English.
struct Words {
  let world, language, sameAsSystem, feed, stir, pause, resume, quit: String
  let lowPower, pausedForReduceMotion, paused, screenOff, resting: String
  /// With %ld for the frame rate.
  let running: String
  let doubleClickFeed, doubleClickStir, loading: String
  let worlds: [World: String]

  static var current: Words {
    switch Language.current {
    case .simplifiedChinese: simplifiedChinese
    case .traditionalChinese: traditionalChinese
    case .english, .system: english
    }
  }

  static let english = Words(
    world: "World", language: "Language", sameAsSystem: "Same as macOS", feed: "Feed",
    stir: "Stir the Fire", pause: "Pause", resume: "Resume", quit: "Quit",
    lowPower: "Still, for Low Power Mode", pausedForReduceMotion: "Paused, for Reduce Motion",
    paused: "Paused", screenOff: "Still, the screen is off",
    resting: "Resting behind your windows", running: "Running at %ld frames a second",
    doubleClickFeed: "Double-Click Desktop to Feed",
    doubleClickStir: "Double-Click Desktop to Stir the Fire", loading: "Loading world…",
    worlds: [
      .riverscape: "Riverbed", .reefscape: "Coral reef", .bettascape: "Betta",
      .plasmascape: "Plasma globe", .koiscape: "Koi pond", .bonfirescape: "Bonfire",
    ])

  static let simplifiedChinese = Words(
    world: "世界", language: "语言", sameAsSystem: "跟随系统", feed: "喂食",
    stir: "拨一拨篝火", pause: "暂停", resume: "继续", quit: "退出",
    lowPower: "低电量模式已开启，画面保持静止",
    pausedForReduceMotion: "已暂停（系统开启了“减弱动态效果”）",
    paused: "已暂停", screenOff: "屏幕已关闭，画面保持静止",
    resting: "被窗口挡住了，正在休息", running: "正在以每秒 %ld 帧运行",
    doubleClickFeed: "双击桌面空白处喂食", doubleClickStir: "双击桌面空白处拨火",
    loading: "正在加载世界…",
    worlds: [
      .riverscape: "河床", .reefscape: "珊瑚礁", .bettascape: "斗鱼",
      .plasmascape: "等离子球", .koiscape: "锦鲤池", .bonfirescape: "篝火",
    ])

  static let traditionalChinese = Words(
    world: "世界", language: "語言", sameAsSystem: "跟隨系統", feed: "餵食",
    stir: "撥一撥營火", pause: "暫停", resume: "繼續", quit: "結束",
    lowPower: "低耗電模式已開啟，畫面保持靜止",
    pausedForReduceMotion: "已暫停（系統開啟了「減少動態效果」）",
    paused: "已暫停", screenOff: "螢幕已關閉，畫面保持靜止",
    resting: "被視窗擋住了，正在休息", running: "正在以每秒 %ld 幀執行",
    doubleClickFeed: "按兩下桌面空白處餵食", doubleClickStir: "按兩下桌面空白處撥火",
    loading: "正在載入世界…",
    worlds: [
      .riverscape: "河床", .reefscape: "珊瑚礁", .bettascape: "鬥魚",
      .plasmascape: "電漿球", .koiscape: "錦鯉池", .bonfirescape: "營火",
    ])
}

final class SceneHandler: NSObject, WKURLSchemeHandler {
  private let root: URL
  private let page: String
  private static let types = [
    "html": "text/html",
    "js": "text/javascript",
    "css": "text/css",
    "json": "application/json",
    "jpg": "image/jpeg",
    "png": "image/png",
  ]

  init(root: URL, page: String) {
    self.root = root.standardizedFileURL
    self.page = page
  }

  func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
    guard let url = task.request.url else { return }
    let path = url.path == "" || url.path == "/" ? page : url.path
    let file = root.appendingPathComponent(path).standardizedFileURL
    guard file.path.hasPrefix(root.path + "/"), let data = try? Data(contentsOf: file) else {
      task.didFailWithError(
        NSError(domain: NSURLErrorDomain, code: NSURLErrorFileDoesNotExist))
      return
    }
    let type = Self.types[file.pathExtension.lowercased()] ?? "application/octet-stream"
    task.didReceive(
      URLResponse(
        url: url, mimeType: type, expectedContentLength: data.count, textEncodingName: nil))
    task.didReceive(data)
    task.didFinish()
  }

  func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}

/// Puts whatever the page complains about into the agent's log.
final class Reporter: NSObject, WKScriptMessageHandler {
  static let shared = Reporter()
  func userContentController(
    _ controller: WKUserContentController, didReceive message: WKScriptMessage
  ) {
    NSLog("deskworlds page: \(message.body)")
  }
}

/// A window that keeps the exact frame it is given. AppKit insets ordinary windows from
/// the screen edges; a wallpaper has to reach them.
final class DesktopWindow: NSWindow {
  override func constrainFrameRect(_ rect: NSRect, to screen: NSScreen?) -> NSRect { rect }
  override var canBecomeKey: Bool { false }
  override var canBecomeMain: Bool { false }
}

/// One screen's worth of world.
final class Wallpaper: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
  let window: DesktopWindow
  let view: WKWebView
  private var loaded = false
  private var inside = false
  private var rate = 0
  private var battery = false

  init(screen: NSScreen, root: URL, world: World) {
    let settings = WKWebViewConfiguration()
    settings.setURLSchemeHandler(
      SceneHandler(root: root, page: world.page), forURLScheme: sceneScheme)
    settings.suppressesIncrementalRendering = true
    // The page holds no state worth keeping between runs and should never leave traces.
    settings.websiteDataStore = .nonPersistent()
    // The agent has no window to look at, so anything the page reports goes to the log.
    settings.userContentController.addUserScript(
      WKUserScript(
        source: """
          const report = (text) => webkit.messageHandlers.report.postMessage(String(text));
          for (const level of ['error', 'warn']) {
            const original = console[level];
            console[level] = (...parts) => {
              report(parts.map((part) => part && part.stack ? part.stack : part).join(' '));
              original.apply(console, parts);
            };
          }
          addEventListener('error', (event) =>
            report(`${event.message} at ${event.filename}:${event.lineno}`));
          addEventListener('unhandledrejection', (event) => report(event.reason));
          """,
        injectionTime: .atDocumentStart, forMainFrameOnly: true))
    // A pointer move the page can read, sent from the global cursor position.
    settings.userContentController.addUserScript(
      WKUserScript(
        source: """
          window.scenePointerCount = 0;
          window.scenePointer = (x, y) => {
            const canvas = document.querySelector('#scene');
            window.scenePointerCount++;
            if (canvas)
              canvas.dispatchEvent(
                new PointerEvent('pointermove', { clientX: x, clientY: y, bubbles: true }));
          };
          window.scenePointerOut = () => {
            const canvas = document.querySelector('#scene');
            if (canvas) canvas.dispatchEvent(new PointerEvent('pointerleave'));
          };
          """,
        injectionTime: .atDocumentStart, forMainFrameOnly: true))

    // The page's "Loading world…", which shows for a while, in the menu's language.
    settings.userContentController.addUserScript(
      WKUserScript(
        source: Wallpaper.loadingScript(), injectionTime: .atDocumentEnd, forMainFrameOnly: true))

    view = WKWebView(frame: screen.frame, configuration: settings)
    settings.userContentController.add(Reporter.shared, name: "report")
    // WebKit stops a page whose window it thinks is covered, and AppKit never reports a
    // background agent's window as visible, so the scene would never start. This asks
    // WebKit not to make that call; the agent works out what is covered instead.
    if view.responds(to: NSSelectorFromString("setWindowOcclusionDetectionEnabled:"))
      || view.responds(to: NSSelectorFromString("_setWindowOcclusionDetectionEnabled:"))
    {
      view.setValue(false, forKey: "windowOcclusionDetectionEnabled")
    }
    view.underPageBackgroundColor = world.background
    view.autoresizingMask = [.width, .height]

    window = DesktopWindow(
      contentRect: screen.frame, styleMask: .borderless, backing: .buffered, defer: false,
      screen: screen)
    super.init()

    view.navigationDelegate = self
    settings.userContentController.add(self, name: "ready")
    window.level = NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.desktopWindow)))
    window.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle]
    window.ignoresMouseEvents = true
    window.isOpaque = true
    window.hasShadow = false
    window.backgroundColor = world.background
    window.isReleasedWhenClosed = false
    window.contentView = view
    // Hiding the agent, or another app's "Hide Others", must not take the world away.
    window.canHide = false
    window.setFrame(screen.frame, display: true)
    window.orderFrontRegardless()

    // Native: full display resolution plugged in, the Balanced profile on battery.
    let page = "\(sceneScheme)://\(sceneHost)\(world.page)?quality=native"
    view.load(URLRequest(url: URL(string: page)!))
  }

  /// The scenes are the original project's, unchanged, so the host swaps the text in
  /// rather than editing them. JSON spells the text as a JavaScript string.
  static func loadingScript() -> String {
    let text =
      (try? JSONEncoder().encode(Words.current.loading)).flatMap { String(data: $0, encoding: .utf8) }
      ?? "''"
    return "{ const label = document.querySelector('#loading p'); if (label) label.textContent = \(text); }"
  }

  /// After a change of language, for a page that may still be loading.
  func localize() {
    view.evaluateJavaScript(Wallpaper.loadingScript())
  }

  func close() {
    NotificationCenter.default.removeObserver(self)
    view.navigationDelegate = nil
    view.configuration.userContentController.removeAllUserScripts()
    view.configuration.userContentController.removeScriptMessageHandler(forName: "report")
    view.configuration.userContentController.removeScriptMessageHandler(forName: "ready")
    view.removeFromSuperview()
    window.contentView = nil
    window.orderOut(nil)
    window.close()
  }

  /// Send only state changes. The page's ready message resends once, so there is no
  /// need to cross the WebKit process boundary every second with an unchanged rate.
  @discardableResult
  func setRate(_ wanted: Int) -> Bool {
    guard wanted != rate else { return false }
    rate = wanted
    if rate == 0 && inside {
      if loaded { view.evaluateJavaScript("scenePointerOut()") }
      inside = false
    }
    NSLog("deskworlds: \(rate) fps")
    send()
    return true
  }

  func setPower(_ onBattery: Bool) {
    guard battery != onBattery else { return }
    battery = onBattery
    send()
  }

  private func send() {
    guard loaded else { return }
    view.evaluateJavaScript(
      """
      typeof scenePower === 'function' && scenePower(\(battery ? "true" : "false"));
      typeof sceneRate === 'function' && sceneRate(\(rate));
      """)
  }

  /// A pinch of food, asked for from the menu rather than by clicking. The
  /// window never takes a mouse event, so there is no cursor position to drop it at: the
  /// page picks its own spot on the surface. Nothing is sent while the scene is stopped,
  /// where the food would only pile up unseen until it started again.
  func feed() {
    guard loaded, rate > 0 else { return }
    view.evaluateJavaScript("typeof sceneFeed === 'function' && sceneFeed()")
  }

  /// A cursor position in this screen's coordinates, or nil when the cursor left it.
  func setPointer(_ point: NSPoint?) {
    guard loaded, rate > 0 else { return }
    guard let point else {
      if inside { view.evaluateJavaScript("scenePointerOut()") }
      inside = false
      return
    }
    inside = true
    view.evaluateJavaScript(
      "scenePointer(\(String(format: "%.1f", point.x)),\(String(format: "%.1f", point.y)))")
  }

  /// The scene has installed its callbacks. WebKit's own didFinish can come before that,
  /// and a rate sent then would be lost until the next change.
  func userContentController(
    _ controller: WKUserContentController, didReceive message: WKScriptMessage
  ) {
    loaded = true
    send()
  }

  func webView(
    _ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!,
    withError error: Error
  ) {
    NSLog("deskworlds: the scene did not load: \(error.localizedDescription)")
  }

  /// What the page thinks it is doing, for the log.
  func probe() {
    view.evaluateJavaScript(
      """
      (() => {
        const canvas = document.querySelector('#scene');
        const context = canvas && canvas.getContext('webgl2');
        return JSON.stringify({
          pixels: canvas && [canvas.width, canvas.height],
          covered: !document.querySelector('#loading').hidden,
          webgl2: Boolean(context),
          gpu: context && context.getParameter(context.RENDERER),
          hidden: document.hidden,
          pointers: window.scenePointerCount,
        });
      })()
      """
    ) { value, error in
      NSLog("deskworlds page state: \(value ?? error?.localizedDescription ?? "unreadable")")
    }
  }

  /// What this screen is showing right now. The agent has no window of its own to look
  /// at, so this is how it can be checked.
  func snapshot(to file: URL, then done: @escaping () -> Void) {
    view.takeSnapshot(with: nil) { image, _ in
      defer { done() }
      guard let image, let data = image.tiffRepresentation,
        let png = NSBitmapImageRep(data: data)?.representation(using: .png, properties: [:])
      else { return }
      try? png.write(to: file)
      NSLog("deskworlds: wrote \(file.path)")
    }
  }
}

/// Whether a double-click landed on empty desktop: no window is there, the Finder's
/// desktop is, and the accessibility interface finds the desktop itself under the cursor
/// rather than an item on it. Every doubt answers no, because a missed feeding costs
/// nothing while food dropped on opening a file would look like a fault. It runs off the
/// main thread: the Finder is busy with the same click, and the accessibility interface
/// waits on it.
enum DesktopClick {
  /// `point` counts from the top-left corner of the main screen, as the window server
  /// does. The answer comes with a few words on what was found, for the log.
  static func emptyDesktop(at point: CGPoint, finder: pid_t) -> (Bool, String) {
    guard
      let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID)
        as? [[String: Any]]
    else { return (false, "no window list") }
    let iconLevel = Int(CGWindowLevelForKey(.desktopIconWindow))
    var desktop = false
    for info in list {
      guard let bounds = info[kCGWindowBounds as String] as? [String: CGFloat],
        let frame = CGRect(dictionaryRepresentation: bounds as CFDictionary),
        frame.contains(point)
      else { continue }
      let layer = info[kCGWindowLayer as String] as? Int ?? 0
      // An ordinary window there means the double-click was meant for it.
      if layer == 0, info[kCGWindowAlpha as String] as? Double ?? 0 > 0 { return (false, "a window") }
      if info[kCGWindowOwnerPID as String] as? Int32 == finder, layer == iconLevel { desktop = true }
    }
    // With the Finder's desktop hidden there is nothing to ask about, and the question
    // could reach this app's own windows instead.
    guard desktop else { return (false, "no Finder desktop there") }

    let system = AXUIElementCreateSystemWide()
    AXUIElementSetMessagingTimeout(system, 0.5)
    var hit: AXUIElement?
    guard AXUIElementCopyElementAtPosition(system, Float(point.x), Float(point.y), &hit) == .success,
      let element = hit
    else { return (false, "no accessibility answer") }
    var pid: pid_t = 0
    guard AXUIElementGetPid(element, &pid) == .success, pid == finder else {
      return (false, "something other than the Finder")
    }
    // The desktop is a plain container. An item on it is an image or text, or carries
    // the file it stands for, or at least a name.
    let role = value(element, kAXRoleAttribute) as? String ?? "an unknown element"
    guard ["AXScrollArea", "AXGroup", "AXList", "AXLayoutArea"].contains(role) else {
      return (false, role)
    }
    let title = value(element, kAXTitleAttribute) as? String ?? ""
    guard title.isEmpty, value(element, kAXURLAttribute) == nil,
      value(element, kAXFilenameAttribute) == nil
    else { return (false, "\(role) \"\(title)\"") }
    return (true, role)
  }

  private static func value(_ element: AXUIElement, _ attribute: String) -> CFTypeRef? {
    var result: CFTypeRef?
    return AXUIElementCopyAttributeValue(element, attribute as CFString, &result) == .success
      ? result : nil
  }
}

final class Controller: NSObject, NSApplicationDelegate, NSMenuDelegate {
  static var shared: Controller?
  private var screens: [Wallpaper] = []
  private var root = Bundle.main.resourceURL!.appendingPathComponent("scene")
  private var awake = true
  private var layout: [CGRect] = []
  private var lastPoint = NSPoint(x: -1e4, y: -1e4)
  private var snapshots: DispatchSourceSignal?
  private var status: NSStatusItem?
  private let state = NSMenuItem()
  private let pause = NSMenuItem()
  private let feed = NSMenuItem()
  private let doubleClick = NSMenuItem()
  private let worldMenu = NSMenuItem()
  private let languageMenu = NSMenuItem()
  private var languageItems: [NSMenuItem] = []
  private let leave = NSMenuItem()
  private var clickMonitor: Any?
  private var worldItems: [NSMenuItem] = []
  private var world = World.selected
  private var applied = 0
  private var pointerTimer: Timer?
  private var pointerRate = 0
  private var exposureTimer: Timer?
  /// The choice outlives a restart, so a paused world is still paused after logging in.
  /// Until one has been made there is nothing under the key at all, which is what lets a
  /// machine that asks for less motion start still without overruling anybody who has
  /// since decided otherwise.
  private var stopped =
    UserDefaults.standard.object(forKey: "paused") as? Bool ?? reduceMotion
  private var lowPower: Bool { ProcessInfo.processInfo.isLowPowerModeEnabled }
  /// Reduce Motion is a durable choice about the whole machine, not a passing shortage
  /// like Low Power Mode, so it decides how the wallpaper starts and never more than that:
  /// somebody who installed an animated wallpaper is allowed to want it anyway.
  private static var reduceMotion: Bool {
    NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
  }
  private var reduceMotion: Bool { Controller.reduceMotion }
  /// Wanted unless turned off in the menu. It only acts with Accessibility access, which
  /// the menu item asks for and nothing else does.
  private var doubleClickWanted: Bool {
    get { UserDefaults.standard.object(forKey: "doubleClickFeed") as? Bool ?? true }
    set { UserDefaults.standard.set(newValue, forKey: "doubleClickFeed") }
  }
  private var accessibilityGranted: Bool { AXIsProcessTrusted() }

  func applicationDidFinishLaunching(_ note: Notification) {
    Controller.shared = self
    build()
    addMenu()
    watchDoubleClicks()

    let center = NotificationCenter.default
    center.addObserver(
      self, selector: #selector(screensChanged),
      name: NSApplication.didChangeScreenParametersNotification, object: nil)

    // Drawing while the display is off, asleep or locked would only cost power.
    let workspace = NSWorkspace.shared.notificationCenter
    for (name, value) in [
      (NSWorkspace.screensDidSleepNotification, false),
      (NSWorkspace.screensDidWakeNotification, true),
      (NSWorkspace.sessionDidResignActiveNotification, false),
      (NSWorkspace.sessionDidBecomeActiveNotification, true),
    ] {
      workspace.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
        self?.awake = value
        self?.applyRate()
      }
    }
    let distributed = DistributedNotificationCenter.default()
    for (name, value) in [("com.apple.screenIsLocked", false), ("com.apple.screenIsUnlocked", true)]
    {
      distributed.addObserver(forName: .init(name), object: nil, queue: .main) { [weak self] _ in
        self?.awake = value
        self?.applyRate()
      }
    }

    // Low Power Mode holds the scene still, like any other reason not to draw.
    NotificationCenter.default.addObserver(
      forName: .NSProcessInfoPowerStateDidChange, object: nil, queue: .main
    ) { [weak self] _ in self?.applyRate() }

    // Turning Reduce Motion on mid-session stops the scene for the same reason it starts
    // stopped under it, unless it has already been asked for deliberately.
    workspace.addObserver(
      forName: NSWorkspace.accessibilityDisplayOptionsDidChangeNotification, object: nil,
      queue: .main
    ) { [weak self] _ in
      guard let self, UserDefaults.standard.object(forKey: "paused") == nil else { return }
      self.stopped = self.reduceMotion
      self.applyRate()
    }

    // Running on the battery halves the frame rate; the scene is slow enough to hold up.
    if let source = IOPSNotificationCreateRunLoopSource({ _ in
      DispatchQueue.main.async { Controller.shared?.applyRate() }
    }, nil)?.takeRetainedValue() {
      CFRunLoopAddSource(CFRunLoopGetMain(), source, .defaultMode)
    }

    // `kill -USR1` writes what the first screen is showing to /tmp/deskworlds.png.
    signal(SIGUSR1, SIG_IGN)
    snapshots = DispatchSource.makeSignalSource(signal: SIGUSR1, queue: .main)
    snapshots?.setEventHandler { [weak self] in self?.snapshot() }
    snapshots?.resume()
  }

  /// Draws for a moment even if the desktop is covered, then saves the frame.
  private func snapshot() {
    guard let first = screens.first else { return }
    for screen in screens { screen.setRate(60) }
    DispatchQueue.main.asyncAfter(deadline: .now() + 4) { [weak self] in
      first.probe()
      first.snapshot(to: URL(fileURLWithPath: "/tmp/deskworlds.png")) {
        self?.applyRate()
      }
    }
  }

  // Putting a full-screen window on a screen is itself a screen-parameter change, so the
  // arrangement is compared before anything is rebuilt.
  @objc private func screensChanged() {
    guard NSScreen.screens.map(\.frame) != layout else { return }
    build()
  }

  private func build() {
    layout = NSScreen.screens.map(\.frame)
    for screen in screens { screen.close() }
    screens = NSScreen.screens.map { Wallpaper(screen: $0, root: root, world: world) }
    applyRate()
  }

  private var onBattery: Bool {
    guard let blob = IOPSCopyPowerSourcesInfo()?.takeRetainedValue(),
      let kind = IOPSGetProvidingPowerSourceType(blob)?.takeRetainedValue() as String?
    else { return false }
    return kind == kIOPSBatteryPowerValue
  }

  /// Full speed while the wallpaper is in plain sight, a slow beat when windows leave only
  /// part of it showing, and nothing at all behind a full screen of work or a dark display.
  /// Power depends on the machine and display; it must be measured on the target Mac.
  func applyRate() {
    let battery = onBattery
    let full = battery ? 30 : 60
    let still = stopped || lowPower || !awake
    // Read the window list once for all displays, and never while deliberately still.
    let blockers = still ? [] : windowBlockers()
    applied = 0
    var changed = false
    for (index, screen) in screens.enumerated() {
      let showing = index < layout.count ? exposure(layout[index], blockers: blockers) : 1
      let rate = still || showing < 0.15 ? 0 : showing < 0.4 ? 20 : full
      screen.setPower(battery)
      if screen.setRate(rate) { changed = true }
      applied = max(applied, rate)
    }
    if changed { lastPoint = NSPoint(x: -1e4, y: -1e4) }
    updateTimers(pollExposure: !still)
  }

  private func updateTimers(pollExposure: Bool) {
    // Pointer sampling need not outrun the animation, nor wake a stopped wallpaper.
    let wanted = min(30, applied)
    if wanted != pointerRate {
      pointerTimer?.invalidate()
      pointerTimer = nil
      pointerRate = wanted
      if wanted > 0 {
        let timer = Timer.scheduledTimer(withTimeInterval: 1.0 / Double(wanted), repeats: true) { [weak self] _ in
          self?.trackPointer()
        }
        timer.tolerance = 0.003
        pointerTimer = timer
      }
    }
    if !pollExposure {
      exposureTimer?.invalidate()
      exposureTimer = nil
    } else if exposureTimer == nil {
      // Continue this low-frequency check while merely covered so uncovering resumes.
      let timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
        self?.applyRate()
      }
      timer.tolerance = 0.25
      exposureTimer = timer
    }
  }

  /// How much of a screen ordinary windows leave uncovered, from none to all of it.
  /// AppKit's own occlusion never reports this agent's windows as visible, hence the
  /// direct look at what is on screen.
  private func windowBlockers() -> [CGRect] {
    guard
      let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID)
        as? [[String: Any]]
    else { return [] }
    let me = ProcessInfo.processInfo.processIdentifier
    // Only ordinary app windows count. The menu bar, the Dock and other system layers
    // hold full-screen windows that are almost entirely transparent.
    return list.compactMap { info -> CGRect? in
      guard info[kCGWindowLayer as String] as? Int == 0,
        info[kCGWindowOwnerPID as String] as? Int32 != me,
        info[kCGWindowAlpha as String] as? Double ?? 0 > 0.95,
        let bounds = info[kCGWindowBounds as String] as? [String: CGFloat]
      else { return nil }
      return CGRect(dictionaryRepresentation: bounds as CFDictionary)
    }
  }

  private func exposure(_ frame: CGRect, blockers: [CGRect]) -> Double {
    guard !blockers.isEmpty else { return 1 }
    let flipped = CGRect(
      x: frame.minX, y: (NSScreen.screens.first?.frame.height ?? frame.maxY) - frame.maxY,
      width: frame.width, height: frame.height)
    let columns = 16, rows = 10
    var free = 0
    for column in 0..<columns {
      for row in 0..<rows {
        let point = CGPoint(
          x: flipped.minX + flipped.width * (Double(column) + 0.5) / Double(columns),
          y: flipped.minY + flipped.height * (Double(row) + 0.5) / Double(rows))
        if !blockers.contains(where: { $0.contains(point) }) { free += 1 }
      }
    }
    return Double(free) / Double(columns * rows)
  }

  // MARK: - The menu bar

  /// The agent's only visible piece: an icon in the menu bar that can stop the scene.
  private func addMenu() {
    let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
    // The logo's slab of layered ground, drawn black so AppKit can tint it for the menu bar.
    let symbol = Bundle.main.url(forResource: "menubar", withExtension: "svg").flatMap(NSImage.init)
    symbol?.size = NSSize(width: 18, height: 18)
    symbol?.isTemplate = true
    symbol?.accessibilityDescription = "Deskworlds"
    item.button?.image = symbol
    if symbol == nil { item.button?.title = "Deskworlds" }
    item.button?.toolTip = "Deskworlds · \(world.title)"

    let menu = NSMenu()
    menu.delegate = self
    // The items say for themselves when they are available; AppKit's own guess would
    // leave Pause enabled in Low Power Mode, where pressing it would do nothing.
    menu.autoenablesItems = false
    state.isEnabled = false
    menu.addItem(state)
    menu.addItem(.separator())
    let worlds = NSMenu(title: "World")
    worlds.autoenablesItems = false
    for choice in World.allCases {
      let item = NSMenuItem(title: choice.title, action: #selector(selectWorld), keyEquivalent: "")
      item.target = self
      item.representedObject = choice.rawValue
      worlds.addItem(item)
      worldItems.append(item)
    }
    worldMenu.submenu = worlds
    menu.addItem(worldMenu)
    menu.addItem(.separator())
    feed.title = world.feedTitle
    feed.target = self
    feed.action = #selector(feedEveryScreen)
    menu.addItem(feed)
    pause.target = self
    pause.action = #selector(togglePause)
    menu.addItem(pause)
    menu.addItem(.separator())
    doubleClick.target = self
    doubleClick.action = #selector(toggleDoubleClick)
    menu.addItem(doubleClick)
    menu.addItem(.separator())
    let languages = NSMenu(title: "Language")
    languages.autoenablesItems = false
    for choice in Language.allCases {
      let item = NSMenuItem(title: choice.name, action: #selector(selectLanguage), keyEquivalent: "")
      item.target = self
      item.representedObject = choice.rawValue
      languages.addItem(item)
      languageItems.append(item)
    }
    languageMenu.submenu = languages
    menu.addItem(languageMenu)
    menu.addItem(.separator())
    leave.action = #selector(quit)
    leave.keyEquivalent = "q"
    leave.target = self
    menu.addItem(leave)
    item.menu = menu
    status = item
    if item.button?.window == nil || !item.isVisible {
      NSLog("deskworlds: the menu bar item did not appear")
    }
  }

  /// Says what the wallpaper is doing, and why, whenever the menu is opened. Most of the
  /// reasons it holds still are deliberate, and unexplained stillness reads as a fault.
  func menuNeedsUpdate(_ menu: NSMenu) {
    let words = Words.current
    for item in worldItems {
      let choice = (item.representedObject as? String).flatMap(World.init)
      item.title = choice?.title ?? item.title
      item.state = choice == world ? .on : .off
    }
    worldMenu.title = words.world
    languageMenu.title = words.language
    let chosen = Language.chosen
    for item in languageItems {
      let choice = (item.representedObject as? String).flatMap(Language.init)
      item.title = choice?.name ?? item.title
      item.state = choice == chosen ? .on : .off
    }
    leave.title = words.quit
    state.title =
      lowPower
      ? words.lowPower
      : stopped
        ? reduceMotion ? words.pausedForReduceMotion : words.paused
        : !awake
          ? words.screenOff
          : applied == 0
            ? words.resting
            : String(format: words.running, applied)
    pause.title = stopped ? words.resume : words.pause
    // In Low Power Mode nothing is going to draw, so the item would be a false promise.
    // Reduce Motion is not the same case: the machine can perfectly well draw, it has
    // merely been asked not to, and Resume is how somebody says they want this one anyway.
    pause.isEnabled = !lowPower
    // Food that nothing is going to draw would sit unseen until the scene started
    // again and then all arrive at once, so Feed says so rather than promising a feeding.
    feed.isEnabled = applied > 0 && world.canFeed
    feed.title = world.feedTitle
    // The ellipsis says that choosing it asks for something first: Accessibility access.
    let granted = accessibilityGranted
    doubleClick.title =
      (world == .bonfirescape ? words.doubleClickStir : words.doubleClickFeed) + (granted ? "" : "…")
    doubleClick.state = granted && doubleClickWanted ? .on : .off
  }

  /// Every screen, because each one runs its own world rather than one
  /// scene stretched across them: feeding only the screen the menu bar happens to be on
  /// would leave the others unfed.
  @objc private func feedEveryScreen() {
    for screen in screens { screen.feed() }
  }

  /// Every screen changes together: the scenes are separate worlds, not one world with
  /// two windows, and mixing them would make the menu's checkmark a half-truth.
  @objc private func selectWorld(_ sender: NSMenuItem) {
    guard let name = sender.representedObject as? String, let chosen = World(rawValue: name),
      chosen != world
    else { return }
    world = chosen
    World.selected = chosen
    status?.button?.toolTip = "Deskworlds · \(chosen.title)"
    build()
  }

  /// The menu's titles follow at its next opening; the pages and the tooltip at once.
  @objc private func selectLanguage(_ sender: NSMenuItem) {
    guard let name = sender.representedObject as? String, let chosen = Language(rawValue: name)
    else { return }
    Language.chosen = chosen
    status?.button?.toolTip = "Deskworlds · \(world.title)"
    for screen in screens { screen.localize() }
  }

  @objc private func togglePause() {
    stopped.toggle()
    UserDefaults.standard.set(stopped, forKey: "paused")
    applyRate()
  }

  @objc private func quit() {
    NSApp.terminate(nil)
  }

  // MARK: - Double-clicking the desktop

  /// Without Accessibility access the item asks for it. macOS shows its own prompt, which
  /// leads to System Settings: access can only be requested from here, never granted.
  @objc private func toggleDoubleClick() {
    guard accessibilityGranted else {
      doubleClickWanted = true
      // kAXTrustedCheckOptionPrompt, spelled out: its Swift type differs between SDKs.
      let prompt = ["AXTrustedCheckOptionPrompt": true] as CFDictionary
      _ = AXIsProcessTrustedWithOptions(prompt)
      return
    }
    doubleClickWanted.toggle()
  }

  /// Double-clicking empty desktop does nothing in the Finder, so here it means "feed".
  /// The click itself still goes to the Finder: a global monitor only watches, and
  /// watching the mouse buttons needs no permission.
  private func watchDoubleClicks() {
    clickMonitor = NSEvent.addGlobalMonitorForEvents(matching: .leftMouseDown) { [weak self] event in
      if event.clickCount == 2 { self?.doubleClicked() }
    }
  }

  /// Feeds the world on the screen that was double-clicked, once DesktopClick has said the
  /// double-click landed on empty desktop.
  private func doubleClicked() {
    let point = NSEvent.mouseLocation
    guard doubleClickWanted, accessibilityGranted, world.canFeed, applied > 0,
      let index = NSScreen.screens.firstIndex(where: { $0.frame.contains(point) }),
      index < screens.count,
      let finder = NSRunningApplication.runningApplications(
        withBundleIdentifier: "com.apple.finder"
      ).first?.processIdentifier
    else { return }
    // AppKit counts from the bottom-left corner of the main screen, the window server and
    // the accessibility interface from its top-left.
    let top = CGPoint(x: point.x, y: (NSScreen.screens.first?.frame.maxY ?? 0) - point.y)
    let feeding = world
    DispatchQueue.global(qos: .userInitiated).async {
      let (empty, found) = DesktopClick.emptyDesktop(at: top, finder: finder)
      DispatchQueue.main.async {
        Controller.shared?.doubleClickChecked(empty, found: found, screen: index, world: feeding)
      }
    }
  }

  func doubleClickChecked(_ empty: Bool, found: String, screen index: Int, world feeding: World) {
    NSLog("deskworlds: double-click on %@%@", found, empty ? ", fed" : "")
    // The world or the screens may have changed while the Finder was being asked.
    guard empty, feeding == world, index < screens.count else { return }
    screens[index].feed()
  }

  /// The cursor belongs to the Finder, so its position is read rather than captured.
  private func trackPointer() {
    let point = NSEvent.mouseLocation
    guard abs(point.x - lastPoint.x) > 0.2 || abs(point.y - lastPoint.y) > 0.2 else { return }
    lastPoint = point
    for (index, screen) in NSScreen.screens.enumerated() where index < screens.count {
      let frame = screen.frame
      screens[index].setPointer(
        frame.contains(point)
          ? NSPoint(x: point.x - frame.minX, y: frame.maxY - point.y) : nil)
    }
  }
}

let application = NSApplication.shared
let controller = Controller()
application.setActivationPolicy(.accessory)
application.delegate = controller
application.run()
