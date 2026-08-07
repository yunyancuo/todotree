const { app, BrowserWindow, ipcMain, dialog, Menu, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

let currentFilePath = path.join(os.homedir(), 'Desktop', 'TODOTREE.md');
let configPath = path.join(app.getPath('userData'), 'config.json');
let mainWindow;
let isPinned = true;

function loadConfig() {
  try {
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      currentFilePath = config.filePath || currentFilePath;
    }
  } catch (_) {}
}
function saveConfig() {
  try { fs.writeFileSync(configPath, JSON.stringify({ filePath: currentFilePath }, null, 2), 'utf-8'); } catch (_) {}
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
    mainWindow.setAlwaysOnTop(true, 'screen-saver');
    mainWindow.setSkipTaskbar(true);
    mainWindow.setResizable(false);
  } else {
    mainWindow.setAlwaysOnTop(false);
    mainWindow.setSkipTaskbar(true);
    mainWindow.setResizable(true);
  }
  if (sendEvent) mainWindow.webContents.send('pin-state-changed', isPinned);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 520,
    height: 720,
    minWidth: 400,
    minHeight: 400,
    resizable: true,
    frame: false,
    transparent: true,
    skipTaskbar: true,
    alwaysOnTop: true,
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
    mainWindow.setResizable(false);
  });
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

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
