// 桌面层锚定（WorkerW / Progman）：把窗口挂进资源管理器的桌面窗口树，
// 位于桌面图标之上、所有普通窗口之下。通过 koffi 直接调用 user32，免编译原生模块。
const koffi = require('koffi');

const user32 = koffi.load('user32.dll');
const FindWindowW = user32.func('void * __stdcall FindWindowW(str16 cls, str16 win)');
const FindWindowExW = user32.func('void * __stdcall FindWindowExW(void *parent, void *after, str16 cls, str16 win)');
const SendMessageTimeoutW = user32.func('uintptr __stdcall SendMessageTimeoutW(void *hwnd, uint32 msg, uintptr wp, intptr lp, uint32 flags, uint32 timeout, void *result)');
const SetParent = user32.func('void * __stdcall SetParent(void *child, void *parent)');
const SetWindowPos = user32.func('int __stdcall SetWindowPos(void *hwnd, void *after, int32 x, int32 y, int32 cx, int32 cy, uint32 flags)');
const GetWindowLongW = user32.func('int32 __stdcall GetWindowLongW(void *hwnd, int32 index)');
const SetWindowLongW = user32.func('int32 __stdcall SetWindowLongW(void *hwnd, int32 index, int32 value)');
const IsWindow = user32.func('int __stdcall IsWindow(void *hwnd)');
const RECT = koffi.struct('RECT', { left: 'long', top: 'long', right: 'long', bottom: 'long' });
const GetWindowRect = user32.func('int __stdcall GetWindowRect(void *hwnd, _Out_ RECT *rect)');

const GWL_STYLE = -16;
const WS_CHILD = 0x40000000;
const WS_POPUP = 0x80000000;
const HWND_TOP = 0;
const HWND_NOTOPMOST = -2;
const SWP_NOSIZE = 0x0001;
const SWP_NOMOVE = 0x0002;
const SWP_NOACTIVATE = 0x0010;
const SMTO_ABORTIFHUNG = 0x0008;
const WM_SPAWN_WORKERW = 0x052C;

// 当前锚定状态：{ hwnd, parent, defview, screen }
let attached = null;
let lastAttachError = 0;

function hwndOf(win) {
  return win.getNativeWindowHandle().readUInt32LE(0);
}

function containerRect(handle) {
  const rc = { left: 0, top: 0, right: 0, bottom: 0 };
  GetWindowRect(handle, rc);
  return rc;
}

// 找承载桌面图标的容器：多数 Win10/11 会派生 WorkerW(内含 SHELLDLL_DefView)，
// 否则图标层直接在 Progman 下，就用 Progman 本身
function findDesktopContainer() {
  const progman = FindWindowW('Progman', null);
  if (!progman) return null;
  let defview = FindWindowExW(progman, null, 'SHELLDLL_DefView', null);
  if (!defview) {
    try { SendMessageTimeoutW(progman, WM_SPAWN_WORKERW, 0, 0, SMTO_ABORTIFHUNG, 1000, null); } catch (_) {}
    defview = FindWindowExW(progman, null, 'SHELLDLL_DefView', null);
  }
  let container = progman;
  let w = null;
  for (;;) {
    w = FindWindowExW(null, w, 'WorkerW', null);
    if (!w) break;
    const dv = FindWindowExW(w, null, 'SHELLDLL_DefView', null);
    if (dv) { container = w; defview = dv; break; }
  }
  if (!defview) return null;
  return { container, defview };
}

function setChildStyle(hwnd, child) {
  const style = GetWindowLongW(hwnd, GWL_STYLE) >>> 0;
  const next = child ? (style | WS_CHILD) & ~WS_POPUP : (style | WS_POPUP) & ~WS_CHILD;
  SetWindowLongW(hwnd, GWL_STYLE, next | 0);
}

// 挂入桌面层。抛错表示环境不支持（调用方自行回退为普通窗口）。
function attach(win) {
  if (!win || win.isDestroyed()) return false;
  if (attached) return true;
  const target = findDesktopContainer();
  if (!target) throw new Error('找不到桌面容器 (Progman/WorkerW)');
  const hwnd = hwndOf(win);
  const screen = win.getBounds();
  const rc = containerRect(target.container);
  setChildStyle(hwnd, true);
  SetParent(hwnd, target.container);
  SetWindowPos(hwnd, HWND_TOP, screen.x - rc.left, screen.y - rc.top, screen.width, screen.height, SWP_NOACTIVATE);
  // 把图标层压到自己下方：既贴住桌面，又不被图标挡住、还能点
  SetWindowPos(target.defview, hwnd, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
  attached = { hwnd, parent: target.container, defview: target.defview, screen };
  console.log(`[desktop-layer] attached, parent=0x${Number(target.container).toString(16)}`);
  return true;
}

// 从桌面层摘回普通窗口（坐标按容器偏移换算回屏幕坐标）
function detach(win) {
  if (!attached) return false;
  const state = attached;
  attached = null;
  if (!win || win.isDestroyed() || !IsWindow(state.hwnd)) return false;
  const rc = IsWindow(state.parent) ? containerRect(state.parent) : { left: 0, top: 0, right: 0, bottom: 0 };
  const bounds = win.getBounds();
  const screenX = bounds.x + rc.left;
  const screenY = bounds.y + rc.top;
  setChildStyle(state.hwnd, false);
  SetParent(state.hwnd, null);
  SetWindowPos(state.hwnd, HWND_NOTOPMOST, screenX, screenY, bounds.width, bounds.height, SWP_NOACTIVATE);
  win.setBounds({ x: screenX, y: screenY, width: bounds.width, height: bounds.height });
  console.log('[desktop-layer] detached');
  return true;
}

// 看门狗：explorer 重启会连带销毁挂在桌面树里的窗口，需要检测并交还上层处理
function ensureAttached(win) {
  if (!attached) {
    // 上次 attach 失败后每 60 秒静默重试一次（例如 explorer 尚未就绪）
    if (Date.now() - lastAttachError > 60000) {
      try { attach(win); lastAttachError = 0; } catch (e) { lastAttachError = Date.now(); }
    }
    return 'idle';
  }
  const hwndAlive = IsWindow(attached.hwnd);
  const parentAlive = IsWindow(attached.parent);
  if (hwndAlive && !parentAlive) {
    // 容器没了但窗口还在：先摘回屏幕，等容器恢复后由下轮重挂
    attached = null;
    restore(win);
    lastAttachError = 0;
    return 'container-lost';
  }
  if (!hwndAlive) {
    // 窗口被连带销毁：main 进程会收到 closed 并自动重建
    attached = null;
    return 'window-destroyed';
  }
  return 'ok';
}

function restore(win) {
  const state = attached;
  if (!state) return false;
  attached = null;
  if (!win || win.isDestroyed() || !IsWindow(state.hwnd)) return false;
  const rc = IsWindow(state.parent) ? containerRect(state.parent) : { left: 0, top: 0, right: 0, bottom: 0 };
  const bounds = win.getBounds();
  const screenX = bounds.x + rc.left;
  const screenY = bounds.y + rc.top;
  setChildStyle(state.hwnd, false);
  SetParent(state.hwnd, null);
  SetWindowPos(state.hwnd, HWND_NOTOPMOST, screenX, screenY, bounds.width, bounds.height, SWP_NOACTIVATE);
  if (!win.isDestroyed()) win.setBounds({ x: screenX, y: screenY, width: bounds.width, height: bounds.height });
  return true;
}

function isAttached() {
  return !!attached;
}

module.exports = { attach, detach, ensureAttached, isAttached };
