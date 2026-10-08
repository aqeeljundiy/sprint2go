// sprint2go for Mac and Windows: the web app in its own window, with the system's notifications and dock badge.
// It loads the hosted app (S2G_URL), so the app itself updates without reinstalling. The window around it updates
// itself too: new versions come from the GitHub releases (electron-updater), download in the background, and install
// on the next restart. Not from the App Store: installed from the download on the site.
const { app, BrowserWindow, shell, Menu, nativeTheme, ipcMain } = require('electron');
const path = require('node:path');

const URL = process.env.S2G_URL || 'https://app.sprint2go.com';
let win = null;

function createWindow() {
  win = new BrowserWindow({
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
  win.on('closed', () => (win = null));
  return win;
}

/* ---------- the app talks to the window (preload.cjs) ---------- */

// A notification was clicked: bring the window forward.
ipcMain.on('s2g:focus', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
});
// Unread notices on the dock icon (Mac); Windows has no count on the taskbar icon this way, so it's left alone there.
ipcMain.on('s2g:badge', (_e, n) => {
  if (process.platform === 'darwin') app.setBadgeCount(Math.max(0, Number(n) || 0));
});

/* ---------- updates ---------- */

let ready = null; // the version that downloaded and waits for a restart
ipcMain.handle('s2g:update-state', () => ready);
ipcMain.on('s2g:restart', () => ready && require('electron-updater').autoUpdater.quitAndInstall());

/**
 * Checks GitHub for a new version at start and every four hours, downloads it in the background, then tells the app
 * (a quiet "restart to update", and a menu item); it also installs when the app quits. When updates can't apply
 * here (an unsigned Mac build, the portable Windows build, a development run), it stops checking: no errors, no nagging.
 */
/** Mac updates need a Developer ID signature (macOS checks the new version is from the same developer). */
function macCanUpdate() {
  if (process.platform !== 'darwin') return true;
  try {
    const bundle = path.resolve(process.execPath, '../../..');
    const r = require('node:child_process').spawnSync('codesign', ['-dv', '--verbose=2', bundle], { encoding: 'utf8', timeout: 5000 });
    return /Authority=Developer ID Application/.test(`${r.stdout}${r.stderr}`);
  } catch {
    return false;
  }
}

function startUpdates() {
  if (!app.isPackaged || process.env.PORTABLE_EXECUTABLE_DIR || process.env.S2G_NO_UPDATES || !macCanUpdate()) return;
  let autoUpdater;
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch {
    return;
  }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = null;
  let timer = null;
  const stop = () => (timer && clearInterval(timer), (timer = null));
  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  autoUpdater.on('error', (e) => {
    const msg = String((e && e.message) || e);
    // A Mac build without a Developer ID signature can't install updates (macOS checks the signature): stop asking.
    if (/code signature|signature|not signed|SecCodeCheckValidity|ShipIt/i.test(msg)) stop();
    console.warn('[updates]', msg.slice(0, 200));
  });
  autoUpdater.on('update-downloaded', (info) => {
    stop();
    ready = { version: info && info.version };
    if (win) win.webContents.send('s2g:update', ready);
    buildMenu();
  });
  setTimeout(check, 10_000);
  timer = setInterval(check, 4 * 3600_000);
}

function buildMenu() {
  const restart = ready ? [{ label: `Restart to update${ready.version ? ` (${ready.version})` : ''}`, click: () => require('electron-updater').autoUpdater.quitAndInstall() }, { type: 'separator' }] : [];
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(process.platform === 'darwin' ? [{ label: app.name, submenu: [{ role: 'about' }, { type: 'separator' }, ...restart, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] }] : []),
      { role: 'fileMenu', ...(process.platform === 'darwin' || !ready ? {} : { submenu: [...restart, { role: 'quit' }] }) },
      { role: 'editMenu' },
      { role: 'viewMenu' },
      { role: 'windowMenu' },
    ]),
  );
}

app.whenReady().then(() => {
  buildMenu();
  createWindow();
  startUpdates();
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});
app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit());
