// sprint2go for Mac and Windows: the web app in its own window, with the system's notifications and dock badge.
// It loads the hosted app (S2G_URL), so updates arrive without reinstalling. Not from the App Store: installed
// from the download on the site.
const { app, BrowserWindow, shell, Menu, nativeTheme } = require('electron');
const path = require('node:path');

const URL = process.env.S2G_URL || 'https://app.sprint2go.com';

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 760,
    minHeight: 520,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0e1013' : '#f4f5f7',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true },
  });
  win.loadURL(URL);
  // Links to other sites open in the browser; the app stays on sprint2go.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(URL)) return { action: 'allow' };
    shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(URL) && !url.startsWith('http://localhost')) (e.preventDefault(), shell.openExternal(url));
  });
  return win;
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ]));
  createWindow();
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});
app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit());
