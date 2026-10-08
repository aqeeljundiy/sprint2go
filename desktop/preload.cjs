// What the web app may ask of the desktop window (src/push.ts, DesktopBridge): it can tell it's inside the desktop app
// (to hide "install" prompts and use the title bar's space), bring the window forward when a notification is clicked,
// show the unread count on the dock, and offer a restart when a new version has downloaded.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('s2gDesktop', {
  platform: process.platform,
  version: process.versions.electron,
  focus: () => ipcRenderer.send('s2g:focus'),
  setBadge: (n) => ipcRenderer.send('s2g:badge', Number(n) || 0),
  /** Calls back once a new version is ready (also when it was ready before the page loaded). Returns a way to stop. */
  onUpdateReady: (cb) => {
    const on = (_e, info) => cb(info || {});
    ipcRenderer.on('s2g:update', on);
    ipcRenderer.invoke('s2g:update-state').then((info) => info && cb(info), () => {});
    return () => ipcRenderer.removeListener('s2g:update', on);
  },
  restartToUpdate: () => ipcRenderer.send('s2g:restart'),
});
