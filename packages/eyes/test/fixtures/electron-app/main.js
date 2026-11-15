const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
if (!app.requestSingleInstanceLock()) { console.log('second instance: quitting'); app.quit(); }
app.whenReady().then(() => {
  const win = new BrowserWindow({ width: 420, height: 560, title: 'Probe', webPreferences: { preload: path.join(__dirname, 'preload.js') } });
  win.loadFile(path.join(__dirname, 'index.html'));
  // What it keeps: how many times it was opened on this data.
  const fs = require('node:fs');
  const kept = path.join(app.getPath('userData'), 'opened.json');
  let opened = 0;
  try { opened = JSON.parse(fs.readFileSync(kept, 'utf8')).opened; } catch {}
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(kept, JSON.stringify({ opened: opened + 1 }));
  ipcMain.handle('where', () => ({ userData: app.getPath('userData'), port: process.env.PROBE_PORT || null, opened: opened + 1 }));
  ipcMain.handle('mini', () => { const mini = new BrowserWindow({ width: 240, height: 160, frame: false, title: 'Mini' }); mini.loadURL('data:text/html;charset=utf-8,<title>Mini</title><button>닫기</button><p>작은 창</p>'); });
});
app.on('window-all-closed', () => app.quit());
