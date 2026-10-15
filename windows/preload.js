'use strict';
// The bridge between a scene page and this host, kept identical in behaviour to the
// scripts the macOS app injects into its web view.
const { contextBridge, ipcRenderer } = require('electron');

// The scenes say they have installed sceneRate, scenePower and sceneFeed by posting to
// WebKit's message handler, which is how the macOS host listens (scenes/shared/start.js).
// The same call reaches this host through a stand-in with the same shape.
contextBridge.exposeInMainWorld('webkit', {
  messageHandlers: {
    ready: { postMessage: () => ipcRenderer.send('deskworlds:ready') },
  },
});

// The window behind the desktop icons never receives a mouse event: the icons above it
// take them all. The host reads the cursor position instead and hands it over here as a
// pointer move, which the scenes listen for on their canvas. DOM events cross from this
// isolated world to the page's own listeners unchanged.
// A web page chosen as the wallpaper has no #scene canvas; whatever is under the cursor
// gets the move instead, so pages that react to the mouse still can.
const target = (x, y) => document.querySelector('#scene') || document.elementFromPoint(x, y);
let last = null;

ipcRenderer.on('deskworlds:pointer', (_event, x, y) => {
  last = target(x, y);
  last?.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, bubbles: true }));
  last?.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: y, bubbles: true }));
});

ipcRenderer.on('deskworlds:pointer-out', () => {
  last?.dispatchEvent(new PointerEvent('pointerleave'));
  last = null;
});

// Light and colour from the settings window, as a CSS filter over the whole page.
ipcRenderer.on('deskworlds:filter', (_event, value) => {
  if (typeof value === 'string') document.documentElement.style.filter = value;
});

// The page's "Loading world…" in the language of the app's menu. The scenes are the
// original project's, unchanged, so the host swaps the text in rather than editing them.
ipcRenderer.on('deskworlds:loading-text', (_event, value) => {
  const label = document.querySelector('#loading p');
  if (label && typeof value === 'string') label.textContent = value;
});
