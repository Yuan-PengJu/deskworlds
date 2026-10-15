'use strict';
// The settings page's bridge to the app. Every call goes to a handler in main.js that
// first checks it came from the settings window.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('deskworlds', {
  state: () => ipcRenderer.invoke('settings:state'),
  chooseWorld: (id) => ipcRenderer.invoke('settings:world', id),
  tweak: (key, value) => ipcRenderer.invoke('settings:tweak', key, value),
  resetTweaks: () => ipcRenderer.invoke('settings:reset'),
  pick: (kind) => ipcRenderer.invoke('settings:pick', kind),
  showPage: (address) => ipcRenderer.invoke('settings:page', address),
  showMedia: () => ipcRenderer.invoke('settings:show-media'),
  addSkins: () => ipcRenderer.invoke('settings:skin-add'),
  removeSkin: (file) => ipcRenderer.invoke('settings:skin-remove', file),
  resetSkins: () => ipcRenderer.invoke('settings:skin-reset'),
  onChange: (callback) => ipcRenderer.on('settings:changed', () => callback()),
});
