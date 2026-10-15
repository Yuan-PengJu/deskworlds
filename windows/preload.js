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
const scene = () => document.querySelector('#scene');

ipcRenderer.on('deskworlds:pointer', (_event, x, y) => {
  scene()?.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, bubbles: true }));
});

ipcRenderer.on('deskworlds:pointer-out', () => {
  scene()?.dispatchEvent(new PointerEvent('pointerleave'));
});
