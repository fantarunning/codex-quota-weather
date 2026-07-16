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
  // minimize to floating orb / restore to card
  minimize: () => ipcRenderer.send('quota:minimize'),
  restore: () => ipcRenderer.send('quota:restore'),
  onView: (cb) => ipcRenderer.on('quota:view', (_e, v) => cb(v)),
  orbDragStart: () => ipcRenderer.send('quota:orb-drag-start'),
  orbDragEnd: () => ipcRenderer.send('quota:orb-drag-end'),
  onNextWeather: (cb) => ipcRenderer.on('quota:next-weather', () => cb()),
  weatherInteracted: () => ipcRenderer.send('quota:weather-interaction'),
});
