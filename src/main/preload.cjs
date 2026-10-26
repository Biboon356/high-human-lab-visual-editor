// Sandboxed preload: exposes a narrow, typed API to the renderer. No Node access leaks through.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const invoke = (ch, ...a) => ipcRenderer.invoke(ch, ...a);
contextBridge.exposeInMainWorld('hh', {
  platform: process.platform,
  pickMedia: () => invoke('media:pick'),
  probePaths: (paths) => invoke('media:probe', paths),
  pathForFile: (file) => webUtils.getPathForFile(file),
  mediaThumbs: (o) => invoke('media:thumbs', o),
  mediaPeaks: (p) => invoke('media:peaks', p),
  makeProxy: (p) => invoke('media:proxy', p),
  openProject: () => invoke('project:open'),
  saveProject: (project, filePath, saveAs) => invoke('project:save', { project, filePath, saveAs }),
  analyzeAudio: (project) => invoke('audio:analyze', project),
  pickExportPath: (defaultName, format) => invoke('export:pickPath', { defaultName, format }),
  exportStart: (project, settings) => invoke('export:start', { project, settings }),
  exportOpenDecoder: (o) => invoke('export:openDecoder', o),
  exportNextFrame: (id) => invoke('export:nextFrame', id),
  exportFrame: (buf) => invoke('export:frame', buf),
  exportFinish: () => invoke('export:finish'),
  exportCancel: () => invoke('export:cancel'),
  onExportProgress: (cb) => ipcRenderer.on('export:progress', (_e, v) => cb(v)),
  setDirty: (d, title) => ipcRenderer.send('app:dirty', d, title),
  revealFile: (p) => invoke('app:reveal', p),
  onMenu: (cb) => ipcRenderer.on('menu:action', (_e, a) => cb(a)),
  mediaUrl: (p) => `hhlab://local/media/${encodeURIComponent(p)}`,
});
