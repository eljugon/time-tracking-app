const { contextBridge, ipcRenderer } = require('electron');

// Misma forma que la API `window.storage` que usaba el HTML original:
// get(key) -> { value } | null   ·   set(key, value) -> true
contextBridge.exposeInMainWorld('storage', {
  get: (key) => ipcRenderer.invoke('storage:get', String(key)),
  set: (key, value) => ipcRenderer.invoke('storage:set', String(key), String(value)),
});

contextBridge.exposeInMainWorld('rail', {
  isDesktop: true,
  // { prompt, apiKey, mcpToken } -> { ok, text } | { ok:false, error }
  sync: (payload) => ipcRenderer.invoke('rail:sync', payload),
});
