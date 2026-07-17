// Preload: exposes a minimal, safe control surface to the renderer.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('quotaShell', {
  isElectron: true,
  close: () => ipcRenderer.send('quota:close'),
  togglePin: () => ipcRenderer.send('quota:toggle-pin'),
  getPin: () => ipcRenderer.invoke('quota:get-pin'),
  onPinState: (cb) => ipcRenderer.on('quota:pin-state', (_e, v) => cb(v)),
  getScale: () => ipcRenderer.invoke('quota:get-scale'),
  onScaleState: (cb) => ipcRenderer.on('quota:scale-state', (_e, v) => cb(v)),
  scaleBy: (delta) => ipcRenderer.send('quota:scale', delta),
  // edge/corner resize: renderer reports which edge the user grabbed; main
  // then follows the OS cursor and resizes the window (aspect-locked).
  resizeStart: (edge) => ipcRenderer.send('quota:resize-start', edge),
  resizeEnd: () => ipcRenderer.send('quota:resize-end'),
  // three-state view: card → mini → orb → card
  cycleView: () => ipcRenderer.send('quota:cycle-view'),
  setView: (mode) => ipcRenderer.send('quota:set-view', mode),
  // minimize to floating orb / restore to card (legacy, still used)
  minimize: () => ipcRenderer.send('quota:minimize'),
  restore: () => ipcRenderer.send('quota:restore'),
  onView: (cb) => ipcRenderer.on('quota:view', (_e, v) => cb(v)),
  orbDragStart: () => ipcRenderer.send('quota:orb-drag-start'),
  orbDragEnd: () => ipcRenderer.send('quota:orb-drag-end'),
  onNextWeather: (cb) => ipcRenderer.on('quota:next-weather', () => cb()),
  weatherInteracted: () => ipcRenderer.send('quota:weather-interaction'),
  getUpdateStatus: () => ipcRenderer.invoke('quota:get-update-status'),
  checkUpdate: () => ipcRenderer.invoke('quota:check-update'),
  downloadUpdate: (version) => ipcRenderer.invoke('quota:download-update', version),
  restartUpdate: () => ipcRenderer.invoke('quota:restart-update'),
  switchVersion: (version) => ipcRenderer.invoke('quota:switch-version', version),
  skipUpdate: (version) => ipcRenderer.invoke('quota:skip-update', version),
  onUpdateStatus: (cb) => ipcRenderer.on('quota:update-status', (_e, value) => cb(value)),
});
