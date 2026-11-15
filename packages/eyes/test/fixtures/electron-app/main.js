const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
if (!app.requestSingleInstanceLock()) { console.log('second instance: quitting'); app.quit(); }
app.whenReady().then(() => {
  const win = new BrowserWindow({ width: 420, height: 560, title: 'Probe', webPreferences: { preload: path.join(__dirname, 'preload.js') } });
  win.loadFile(path.join(__dirname, 'index.html'));
  ipcMain.handle('where', () => ({ userData: app.getPath('userData'), port: process.env.PROBE_PORT || null }));
  ipcMain.handle('mini', () => { const mini = new BrowserWindow({ width: 240, height: 160, frame: false, title: 'Mini' }); mini.loadURL('data:text/html;charset=utf-8,<title>Mini</title><button>닫기</button><p>작은 창</p>'); });
});
app.on('window-all-closed', () => app.quit());
