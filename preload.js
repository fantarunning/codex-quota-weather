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
  // The title cycles card -> portrait -> dock -> card. Dragging a card to a
  // display edge also docks it; pulling the dock inward restores the prior card.
  cycleView: () => ipcRenderer.send('quota:cycle-view'),
  setView: (mode) => ipcRenderer.send('quota:set-view', mode),
  // Minimize hides the panel completely; the tray icon remains available.
  minimize: () => ipcRenderer.send('quota:minimize'),
  restore: () => ipcRenderer.send('quota:restore'),
  onView: (cb) => ipcRenderer.on('quota:view', (_e, v, meta) => cb(v, meta)),
  compactDragStart: () => ipcRenderer.send('quota:compact-drag-start'),
  compactDragEnd: () => ipcRenderer.send('quota:compact-drag-end'),
  dockDragStart: (point) => ipcRenderer.send('quota:dock-drag-start', point),
  dockDragMove: (point) => ipcRenderer.send('quota:dock-drag-move', point),
  dockDragEnd: (result) => ipcRenderer.send('quota:dock-drag-end', result),
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
