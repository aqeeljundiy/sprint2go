// The app can tell it's inside the desktop app (to hide "install" prompts and use the title bar's space).
const { contextBridge } = require('electron');
contextBridge.exposeInMainWorld('s2gDesktop', { platform: process.platform, version: process.versions.electron });
