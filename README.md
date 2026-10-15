# Deskworlds

[![Watch Riverbed](docs/images/riverscape.gif)](docs/videos/riverscape.mp4)

Deskworlds puts a small living 3D world on your Mac desktop. The creatures in each world react to your cursor, and you can feed them from the menu bar. Everything runs locally with Three.js and WebGL2, with no account, analytics or internet connection.

> **About this repository.** This is [Deskworlds](https://github.com/chaseleantj/deskworlds) by Chase Lean, published under the MIT License, with a Windows version added in [`windows/`](windows/). The worlds, the Mac app and the browser version are the original author's work, unchanged. 本仓库基于 Chase Lean 的开源项目 [Deskworlds](https://github.com/chaseleantj/deskworlds)（MIT 许可），在 `windows/` 中增加了 Windows 版；场景、Mac 版和浏览器版均为原作者的作品，未做修改。

## Worlds

| | |
| --- | --- |
| ![Riverbed](docs/images/riverscape-wide.png) **Riverbed** | ![Coral reef](docs/images/reefscape-wide.png) **Coral reef** |
| ![Betta](docs/images/bettascape-wide.png) **Betta** | ![Plasma globe](docs/images/plasmascape-wide.png) **Plasma globe** |
| ![Koi pond](docs/images/koiscape-wide.png) **Koi pond** | ![Bonfire](docs/images/bonfirescape-wide.png) **Bonfire** |

## Install on Mac

You need macOS 13 or newer and the Xcode command line tools (`xcode-select --install`). Clone the repository, then run this from the project folder:

```sh
sh wallpaper/install.sh
```

This builds the app, installs it at `~/Applications/Deskworlds.app`, and adds a login item. The first frame takes about 20 seconds to appear. Your desktop picture is not changed; the world draws on top of it.

To update, pull the latest source and run the installer again. To remove it, run `sh wallpaper/uninstall.sh`.

## Install on Windows

You need Windows 10 or 11. Download `Deskworlds-Setup-<version>.exe` from [Releases](../../releases) and run it. It installs for your account only, needs no administrator rights or internet connection, and adds a Start menu entry, an optional desktop shortcut, and start at sign-in. Each release lists the installer's SHA-256 checksum in `SHA256SUMS.txt`.

In the Windows app, Settings… in the tray menu opens a settings window where you can adjust each world's brightness, contrast, saturation and hue and, for the Riverbed and Koi pond, how many creatures it has, replace the fish, the koi or the plasma globe's centre with pictures of your own that keep all of their behaviour, or show your own picture, video or web page instead of a world. The Mac app does not have these yet.

Windows may say it protected your PC, because the installer is not code-signed; choose More info, then Run anyway. Remove it from Settings › Apps. Shortcuts, building the installer yourself, and troubleshooting are covered in [windows/README.md](windows/README.md) (in Chinese).

## Usage

Click the Deskworlds icon in the menu bar to switch worlds, feed the creatures, stir the fire, or pause. Desktop icons and clicks work as usual. The menu speaks English, Simplified Chinese and Traditional Chinese: it follows macOS unless you choose one under Language. 菜单支持简体中文和繁體中文，默认跟随系统语言，也可以在菜单的"语言"里手动切换。

You can also feed the world on a screen by double-clicking empty desktop there. Choose Double-Click Desktop to Feed… in the menu to turn this on. It needs Accessibility access, which is how it tells empty desktop from an icon so that opening a file never drops food, and macOS asks for it once. The app uses that access only to check what a double-click landed on, and notes each check in `/tmp/deskworlds.log`. Every reinstall builds a new copy of the app, which macOS treats as a different program: if double-clicking stops working after an update, remove Deskworlds from System Settings › Privacy & Security › Accessibility with the minus button, then choose the menu item again.

The wallpaper lowers its frame rate on battery or when windows cover the desktop, and stops when the desktop is hidden, the screen is locked, or Low Power Mode is on. It reads your cursor position and window sizes for this, and does not record keystrokes. Apart from the optional double-click feeding, it requests no special permissions.

## Run in a browser

All worlds also run in any browser with WebGL2. With Node.js 20 or newer:

```sh
npm start
```

Then open http://127.0.0.1:8080. Click a scene to drop food. Space pauses, F toggles fullscreen, and H hides the controls.

## Development

There are no dependencies to install. Each world lives in `scenes/<name>/`, the gallery in `ui/`, and the macOS app in `wallpaper/`.

```sh
npm run check
```

```sh
npm test
```

## License

[MIT](LICENSE). Three.js is bundled under its [MIT license](vendor/THREE-LICENSE.txt). The Windows version in `windows/` is released under the same MIT license; its installer also carries the licenses of Electron, Chromium and koffi.
