'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

// Small, explicit API. ipcRenderer itself is never exposed.
const on = (channel, cb) => {
  const fn = (_e, data) => cb(data);
  ipcRenderer.on(channel, fn);
  return () => ipcRenderer.removeListener(channel, fn);
};

contextBridge.exposeInMainWorld('native', {
  info: () => ipcRenderer.invoke('app:info'),
  pathForFile: (file) => webUtils.getPathForFile(file),
  pickImages: () => ipcRenderer.invoke('files:pick'),
  addPaths: (paths) => ipcRenderer.invoke('files:add', paths),
  remove: (id) => ipcRenderer.invoke('files:remove', id),
  preview: (id) => ipcRenderer.invoke('files:preview', id),
  upscale: (opts) => ipcRenderer.invoke('upscale:start', opts),
  cancel: () => ipcRenderer.invoke('upscale:cancel'),
  prepare: (model) => ipcRenderer.invoke('engine:prepare', model),
  modelStatus: () => ipcRenderer.invoke('model:status'),
  downloadQuality: () => ipcRenderer.invoke('model:download'),
  cancelDownload: () => ipcRenderer.invoke('model:cancel'),
  save: (id, format) => ipcRenderer.invoke('save:one', id, format),
  saveAll: (format) => ipcRenderer.invoke('save:all', format),
  setState: (state) => ipcRenderer.send('state:set', state),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  listUpdates: () => ipcRenderer.invoke('update:list'),
  switchUpdate: (mark) => ipcRenderer.invoke('update:switch', mark),
  openHandoff: () => ipcRenderer.invoke('handoff:open'),
  onProgress: (cb) => on('upscale:progress', cb),
  onDownload: (cb) => on('model:progress', cb),
  onMenu: (cb) => on('menu', cb),
  onAdded: (cb) => on('files:added', cb),
});
