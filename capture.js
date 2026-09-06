const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP_DIR = process.env.APP_DIR;
const OUT = process.env.OUT;
const PORT = 9223;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function getTarget() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await res.json();
      const page = list.find(t => t.type === 'page');
      if (page) return page;
    } catch (e) { /* not up yet */ }
    await sleep(500);
  }
  throw new Error('CDP target not found in 20s');
}

function capture(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const timer = setTimeout(() => reject(new Error('ws timeout')), 15000);
    ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: 'Page.captureScreenshot', params: { format: 'png', captureBeyondViewport: false } }));
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id === 1) { clearTimeout(timer); resolve(msg.result.data); }
    };
    ws.onerror = (e) => { clearTimeout(timer); reject(new Error('ws error')); };
  });
}

(async () => {
  const child = spawn(process.env.ELECTRON_EXE, ['.', `--remote-debugging-port=${PORT}`], { cwd: APP_DIR, stdio: 'ignore' });
  try {
    const target = await getTarget();
    await sleep(2500); // let renderer paint data
    const data = await capture(target.webSocketDebuggerUrl);
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, Buffer.from(data, 'base64'));
    console.log('SAVED', OUT, fs.statSync(OUT).size, 'bytes');
  } finally {
    child.kill();
    process.exit(0);
  }
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
