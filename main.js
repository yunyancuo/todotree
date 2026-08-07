const { app, BrowserWindow, ipcMain, dialog, Menu, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

let currentFilePath = path.join(os.homedir(), 'Desktop', 'TODOTREE.md');
let configPath = path.join(app.getPath('userData'), 'config.json');
let mainWindow;
let isPinned = true;
let windowBounds = { x: undefined, y: undefined, width: 520, height: 740 };

function loadConfig() {
  try {
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      currentFilePath = config.filePath || currentFilePath;
      if (config.bounds) windowBounds = { ...windowBounds, ...config.bounds };
    }
  } catch (_) {}
}
function saveConfig() {
  try {
    fs.writeFileSync(configPath, JSON.stringify({ filePath: currentFilePath, bounds: windowBounds }, null, 2), 'utf-8');
  } catch (_) {}
}
loadConfig();

function readTodoFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return '# TodoTree\n\n## 待完成\n\n- [ ] 示例任务\n\n## 已完成\n\n## 目标\n\n## 放弃\n';
  }
  return fs.readFileSync(filePath, 'utf-8');
}
function writeTodoFile(filePath, content) {
  fs.writeFileSync(filePath, content, 'utf-8');
}

function applyPinState(sendEvent = true) {
  if (!mainWindow) return;
  if (isPinned) {
    mainWindow.setAlwaysOnTop(false);
    mainWindow.setFocusable(false);
    mainWindow.setSkipTaskbar(true);
    mainWindow.setResizable(false);
    mainWindow.setMovable(false);
  } else {
    mainWindow.setAlwaysOnTop(false);
    mainWindow.setFocusable(true);
    mainWindow.setSkipTaskbar(true);
    mainWindow.setResizable(true);
    mainWindow.setMovable(true);
  }
  if (sendEvent) mainWindow.webContents.send('pin-state-changed', isPinned);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    x: windowBounds.x,
    y: windowBounds.y,
    width: windowBounds.width,
    height: windowBounds.height,
    minWidth: 420,
    minHeight: 500,
    resizable: true,
    frame: false,
    transparent: true,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  Menu.setApplicationMenu(null);
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.setMenu(null);
  mainWindow.on('ready-to-show', () => {
    mainWindow.show();
    applyPinState(false);
  });

  let saveBoundsTimer = null;
  const onBoundsChange = () => {
    if (saveBoundsTimer) clearTimeout(saveBoundsTimer);
    saveBoundsTimer = setTimeout(() => {
      const b = mainWindow.getBounds();
      windowBounds = { x: b.x, y: b.y, width: b.width, height: b.height };
      saveConfig();
    }, 500);
  };
  mainWindow.on('resize', onBoundsChange);
  mainWindow.on('move', onBoundsChange);
}

ipcMain.handle('load-todo', () => {
  try {
    const content = readTodoFile(currentFilePath);
    return { content, filePath: currentFilePath };
  } catch (e) {
    return { content: '# TodoTree\n\n## 待完成\n\n- [ ] 新建任务\n\n## 已完成\n\n\n## 目标\n\n\n## 放弃\n', filePath: currentFilePath };
  }
});

ipcMain.handle('save-todo', async (_event, content) => {
  try { writeTodoFile(currentFilePath, content); return { success: true }; }
  catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('change-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择 TODOTREE 文件',
    filters: [{ name: 'Markdown', extensions: ['md', 'txt'] }, { name: 'All Files', extensions: ['*'] }],
    properties: ['openFile'],
  });
  if (!result.canceled && result.filePaths.length > 0) {
    currentFilePath = result.filePaths[0];
    saveConfig();
    return { content: readTodoFile(currentFilePath), filePath: currentFilePath };
  }
  return null;
});

ipcMain.handle('get-file-path', () => currentFilePath);
ipcMain.handle('toggle-pin', () => { isPinned = !isPinned; applyPinState(); return isPinned; });
ipcMain.handle('close-app', () => app.quit());
ipcMain.handle('get-work-area', () => screen.getDisplayMatching(mainWindow.getBounds()).workArea);

ipcMain.handle('get-auto-start', () => {
  return app.getLoginItemSettings().openAtLogin;
});

ipcMain.handle('toggle-auto-start', () => {
  const current = app.getLoginItemSettings().openAtLogin;
  app.setLoginItemSettings({ openAtLogin: !current });
  return !current;
});

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
