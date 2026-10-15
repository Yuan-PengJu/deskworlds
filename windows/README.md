# Deskworlds for Windows

把 [Deskworlds](https://github.com/chaseleantj/deskworlds) 的六个会动的 3D 世界（河床、珊瑚礁、斗鱼、等离子球、锦鲤池、篝火）放到 Windows 桌面上。功能与 Mac 版对应：

- 画面在桌面图标**后面**，图标照常显示、照常点击。
- 生物会对鼠标做出反应。比如河床里的鱼会给光标让出空间，被快速靠近时会受惊逃开。
- 托盘菜单可以切换世界、喂食（篝火是"拨一拨"）、暂停；也可以用快捷键，或双击桌面空白处喂食。
- 省电行为相同：用电池时降到 30 帧；窗口挡住大半时降到 20 帧；几乎全挡住、锁屏、关屏或开启节能模式时停止渲染。
- 多块屏幕时，每块屏幕各跑一个世界。

场景代码一行都没改。这个文件夹只是 Mac 版 `wallpaper/` 在 Windows 上的对应物：Mac 用 Swift + WebKit，这里用 Electron + koffi（koffi 用来调用 Win32 接口，自带预编译文件，不需要 Visual Studio）。

## 需要什么

- Windows 10 或 Windows 11（包括 24H2）。ARM 版 Windows 11 也可以，通过系统自带的 x64 兼容层运行。
- 支持 WebGL2 的显卡（近十年的独显和核显基本都行）。

## 安装

下载 `Deskworlds-Setup-1.1.0.exe`，双击，然后点"下一步"和"完成"。

- 安装包里已经包含所有内容，安装时不联网，也不需要 Node.js。
- 只为当前用户安装，不需要管理员权限。程序装在 `%LOCALAPPDATA%\Programs\Deskworlds`，约 340 MB。
- 安装完成页上可以选择"在桌面创建快捷方式"（默认勾选）。开始菜单里也会有 Deskworlds。
- 默认开机自动启动。不需要的话，在托盘菜单里取消勾选"开机自动启动"。
- 第一帧大约 20 秒后出现。你原来的桌面壁纸不会被修改，世界是画在它上面的。

安装包请从项目的 Releases 页面下载。每个版本都附带 `SHA256SUMS.txt`，可以在 PowerShell 里核对下载的文件是否完整、未被篡改：

```powershell
Get-FileHash .\Deskworlds-Setup-1.1.0.exe -Algorithm SHA256
```

输出的哈希应与 `SHA256SUMS.txt` 里的一致。

**第一次运行安装包时，Windows 可能提示"Windows 已保护你的电脑"。** 这是因为安装包没有经过付费的代码签名，不代表有问题。点"更多信息"，再点"仍要运行"即可。

**更新**：直接运行新版安装包。它会先关掉正在运行的 Deskworlds，再原地替换，并保留你对"开机自动启动"的选择。以前用 `install.cmd` 装过的，也可以直接这样升级。

**卸载**：在"设置 › 应用 › 已安装的应用"里找到 Deskworlds，点"卸载"。你选的世界等设置保存在 `%APPDATA%\Deskworlds`，卸载后仍会保留，重装时会沿用。如果不需要，可以手动删掉这个文件夹。

## 使用

点任务栏右下角的 Deskworlds 图标（它可能收在 `^` 里面，可以拖到外面常驻），会弹出菜单。Deskworlds 已经在运行时，双击桌面快捷方式或从开始菜单打开它，同样会在鼠标位置弹出这个菜单：

- 第一行是当前状态，例如"正在以每秒 60 帧运行"或"被窗口挡住了，正在休息"。
- **世界**：切换场景。选择会被记住，下次开机还是这个世界。
- **喂食 / 拨一拨篝火**：等离子球没有可喂的东西，所以这一项是灰的。
- **暂停 / 继续**：暂停状态也会被记住。
- **退出**

### 不用打开托盘的快捷操作

| 操作 | 方法 |
| --- | --- |
| 喂食（篝火是拨火） | `Ctrl+Alt+F`，或**双击桌面空白处**（只喂双击所在的那块屏幕） |
| 暂停 / 继续 | `Ctrl+Alt+P` |
| 下一个世界 | `Ctrl+Alt+W` |

双击图标仍然是打开它，不会喂食。等离子球没有可喂的东西，双击对它不起作用。快捷键和双击都可以在托盘菜单的"快捷操作"里单独关闭。如果某个快捷键已经被别的程序占用，Deskworlds 不会去抢，菜单里会标出"被其他程序占用"。

**想换快捷键**：先从托盘退出 Deskworlds（它运行时会覆盖这个文件），再用记事本打开 `%APPDATA%\Deskworlds\settings.json`，在最外层的大括号里加一项（注意和前一项之间要有逗号）：

```json
"keys": { "feed": "Control+Alt+F", "pause": "Control+Alt+P", "world": "Control+Alt+W" }
```

如果这个文件还不存在（从没改过设置时就没有），新建一个，内容写成 `{ "keys": { ... } }` 即可。文件格式写错时，Deskworlds 会使用默认设置，并在日志里写明原因。

把某一项设为 `""` 就是不用这个快捷键。写法和 Electron 的 [Accelerator](https://www.electronjs.org/docs/latest/api/accelerator) 相同，例如 `Control+Shift+F1`。保存后重新打开 Deskworlds 即可。

隐私方面：双击检测只读取鼠标按键是否按下、光标下面是不是桌面，以及桌面上有没有选中的图标，不读取键盘。快捷键用的是系统的热键注册，同样不会记录按键。

### 其他

如果在"设置 › 辅助功能 › 视觉效果"里关闭了"动画效果"，Deskworlds 启动时会先处于暂停状态，点"继续"即可（与 Mac 版的"减弱动态效果"一致）。

## 为什么有 100 多 MB

安装包约 109 MB，装好后约 340 MB。大头是 Electron 自带的 Chromium 浏览器引擎，场景本身只有约 18 MB：

| 部分 | 装好后的大小 | 说明 |
| --- | --- | --- |
| Chromium 引擎（`Deskworlds.exe` 及其 DLL、资源文件） | 约 300 MB | 渲染 WebGL2 场景所必需 |
| Chromium 和 Electron 的开源许可文件 | 约 20 MB | 许可证要求必须随程序分发 |
| 场景和 three.js | 约 18 MB | 原项目的内容，原样打包 |
| 本程序和 koffi | 不到 2 MB | |

构建时已经做了这些精简：

- Chromium 自带的 55 种界面语言只保留英文、简体中文和繁体中文（48 MB 降到 2 MB）。本程序不显示 Chromium 自己的界面文字，其他语言的系统会自动回退到英文。
- koffi 只保留运行所需的 JavaScript 和 Windows 二进制文件，去掉它附带的 C++ 源码、头文件和文档（1.6 MB 降到 0.1 MB）。
- 安装包用 LZMA 固实压缩，字典开到 64 MB。

这个体积和其他 Electron 应用相当（VS Code、Slack、Discord 的安装包都在 100 MB 左右）。要大幅缩小，只能改用系统自带的 WebView2 引擎、不再打包 Chromium，那样安装包可以降到 20 MB 左右，但需要重写整个宿主程序。

## 开发者：从源码构建或安装

这部分需要 [Node.js](https://nodejs.org) 20 或更新版本，并且 `windows` 文件夹要放在 Deskworlds 仓库根目录里（和 `scenes` 并列）。

**构建安装包**：还需要 NSIS 3，用来生成安装程序（Windows 上从 <https://nsis.sourceforge.io> 安装；Linux 上 `apt install nsis`；macOS 上 `brew install makensis`）。然后运行：

```powershell
cd windows
npm install
npm run dist
```

结果在 `windows\dist\Deskworlds-Setup-<版本>.exe`。构建会下载 Windows 版 Electron 运行时（会校验哈希，之后走缓存）和 koffi 的 Windows 二进制文件，把场景打包进去，并给 `Deskworlds.exe` 换上自己的图标和名称。Windows、macOS、Linux 上都能构建。在国内可以先设置 `$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"`。

**发布新版本（维护者）**：安装包由 GitHub Actions 从源码构建并发布，不提交进仓库。流程定义在 `.github/workflows/windows-installer.yml`：

1. 修改 `windows/package.json` 里的 `version`（例如 `1.1.0-windows.5`）。
2. 提交后打一个 `windows-v` 开头的标签并推送：`git tag windows-v1.1.0 && git push origin windows-v1.1.0`。
3. CI 会运行 `npm ci`、`npm run check` 和 `npm run dist`，然后把安装包和 `SHA256SUMS.txt` 发布到 Releases 页面。

每个涉及 `windows/` 或场景的 Pull Request 也会自动构建一次，确保改动不会把安装包弄坏。

构建是可复现的：依赖版本由 `package-lock.json` 锁定；Electron 运行时按官方的 SHA-256 校验；koffi 的 Windows 二进制文件按 `package-lock.json` 里记录的哈希核对，不一致就停止构建。

**不打安装包，直接从源码安装**：双击 `windows\install.cmd`。如果 `windows` 文件夹不在仓库里，它会从 GitHub 下载场景；卸载用 `uninstall.cmd`。

**只看效果、不安装**：运行 `npm install`，再运行 `npm run preview`，会在一个普通窗口里运行。

## 出问题时

- **日志**在 `%APPDATA%\Deskworlds\deskworlds.log`。里面会写明挂到了哪种桌面结构上（`workerw` 是 Windows 10 / 旧版 Windows 11，`progman` 是 Windows 11 24H2 及以后），也会记录帧率变化和场景报的错。
- **截图自检**：在程序运行时执行 `"%LOCALAPPDATA%\Programs\Deskworlds\Deskworlds.exe" --snapshot`。约 4 秒后，第一块屏幕的画面会保存到 `%TEMP%\deskworlds.png`，页面状态（WebGL2、GPU 名称等）会写进日志。
- **一直显示"正在等待桌面就绪…"**：资源管理器还没准备好放置壁纸的窗口。程序会自动重试。如果一直不行，把日志发给我。
- **画面盖住了桌面图标**：说明在你的 Windows 版本上没挂到正确位置。请从托盘退出，把日志和系统版本（运行 `winver` 查看）发给我。另一种情况是画面脱离桌面、浮到别的窗口上面，这时程序会自动把它藏起来并重新挂上。
- **和 Wallpaper Engine、Lively 等动态壁纸软件同时运行**：它们会抢同一个位置，请只开一个。
- **任务栏的半透明效果透出的是原来的静态壁纸**：这是正常的，Windows 的任务栏只模糊系统壁纸，不模糊我们的窗口。
- **在任务管理器里看到的是 Electron 的图标**：正常，进程名是 Deskworlds.exe。

## 原理

1. 向桌面窗口 Progman 发送 `0x052C` 消息，让资源管理器创建图标后面的那一层 WorkerW 窗口，然后把场景窗口设为它的子窗口。Windows 11 24H2 改了这层结构，`desktop.js` 两种结构都处理了。
2. 资源管理器重启、显示器变化、桌面被重建时，程序会自动重新挂上。
3. 场景窗口收不到鼠标事件（都被图标层拿走了），所以主进程每秒读取最多 30 次光标位置，作为 `pointermove` 事件转给场景。这和 Mac 版的做法相同。
4. Chromium 会把藏在图标后面的窗口当成"被遮挡"并停止绘制，所以这个判断被关掉了，改为自己枚举窗口、计算桌面露出的比例来决定帧率。
5. 在资源管理器里，双击桌面空白处本来什么也不做，所以可以拿来喂食。画面在动的时候，程序每秒检查 60 次鼠标按键状态。只有当两次点击都落在桌面图标视图上，并且点完后没有任何图标被选中时，才算双击了空白处。点到图标会选中它，所以不会被误判。

| 文件 | 作用 |
| --- | --- |
| `main.js` | 窗口、帧率策略、鼠标转发、托盘菜单 |
| `desktop.js` | 通过 koffi 调用的 Win32 部分：挂到图标后面、窗口遮挡、电源与显示器状态 |
| `preload.js` | 场景页面与宿主之间的桥，行为与 Mac 版注入的脚本一致 |
| `build/build-installer.mjs`、`build/installer.nsi` | 构建安装包 |
| `../.github/workflows/windows-installer.yml` | 在 CI 里构建并发布安装包 |
| `install.ps1` / `uninstall.ps1` | 不打安装包、直接从源码安装与卸载（`.cmd` 是双击用的入口） |

## 许可

MIT，与原项目相同。安装包里随附了全部第三方许可：Electron 的 `LICENSE`、Chromium 的 `LICENSES.chromium.html`、three.js 的 `THREE-LICENSE.txt`、koffi 的 `LICENSE.txt`，以及 Deskworlds 本身的 `LICENSE`。挂到桌面图标后面的方法参考了 [Desktop-app-Luna](https://github.com/Titorias97/Desktop-app-Luna)（MIT）在 Windows 11 24H2 上验证过的做法。
