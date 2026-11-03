// Bluefish docs capture harness (runs under Electron, does not modify the repo).
// - serves repo files itself, injecting a load-time CSS override so the overlay paints transparent
// - records animation frames exactly as the app renders them, plus the fake cursor position
// - captures the size stills / menu / console screenshots
//
// Usage from the repo root:
//   node node_modules/electron/cli.js tools/docs/capture.cjs
//   node node_modules/electron/cli.js tools/docs/capture.cjs --only=hero|moods|sizes|menu|console
//   CAP_DPR=1.5 node node_modules/electron/cli.js tools/docs/capture.cjs --only=console
// Output: tools/docs/.work/shots (override with BLUEFISH_CAPTURE_DIR)
// Note: unset ELECTRON_RUN_AS_NODE if your shell sets it, or electron.exe runs as plain node.
const {app, BrowserWindow, screen} = require('electron');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');

const REPO = path.resolve(__dirname, '..', '..');
const OUT = path.resolve(process.env.BLUEFISH_CAPTURE_DIR || path.join(__dirname, '.work'));
const FRAMES = path.join(OUT, 'frames');
const STILLS = path.join(OUT, 'stills');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const ONLY = (process.argv.find(a => a.startsWith('--only=')) || '').split('=')[1] || '';
const DPR = process.env.CAP_DPR || '2';
const want = name => !ONLY || ONLY === name;

app.commandLine.appendSwitch('force-device-scale-factor', DPR);
app.on('window-all-closed', () => {}); // keep the process alive between shots

const CAPTURE_CSS = 'html,body{background:transparent!important}html.preview body{background:transparent!important}'
  + '#taskbar{display:none!important}*{animation:none!important;transition:none!important}';
const MIME = {'.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.gif': 'image/gif'};
const ALLOW = /^\/(index\.html|overlay\.html|menu\.html|style\.css|tokens\.css|overlay\.css|menu\.css|src\/[a-z-]+\.mjs|assets\/(rig\.json|master\.png|reconstructed\.png|master-source\.png|layers\/[a-z_]+\.png)|examples\/[a-z-]+\.json)$/;

function startServer() {
  return new Promise(resolve => {
    const server = http.createServer(async (req, res) => {
      try {
        if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); return res.end(); }
        const url = new URL(req.url, 'http://127.0.0.1');
        let name = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
        if (name === '/capture.css') { res.writeHead(200, {'Content-Type': MIME['.css']}); return res.end(req.method === 'HEAD' ? undefined : CAPTURE_CSS); }
        if (!ALLOW.test(name)) { res.writeHead(404); return res.end(); }
        let body = await fs.promises.readFile(path.join(REPO, name));
        if (name.endsWith('.html')) {
          body = body.toString('utf8').replace('</head>', '<link rel="stylesheet" href="capture.css"></head>');
        }
        res.writeHead(200, {'Content-Type': MIME[path.extname(name)] || 'application/octet-stream', 'Cache-Control': 'no-store'});
        res.end(req.method === 'HEAD' ? undefined : body);
      } catch { res.writeHead(404); res.end('Not found'); }
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

const STUB_PRELOAD = path.join(OUT, 'petcontrol-stub.cjs');
fs.mkdirSync(path.dirname(STUB_PRELOAD), {recursive: true});
fs.writeFileSync(STUB_PRELOAD, `const {contextBridge} = require('electron');
const state = {size: 240, docked: true, follow: true, idle: true, reduced: false, pose: {yaw: 0, pitch: 0, roll: 0}};
contextBridge.exposeInMainWorld('petControl', {
  getState: async () => ({...state}), onState: () => {}, set: () => {},
  action: () => {}, command: () => {}, fit: () => {}
});
`);

let base;

function makeWin(opts) {
  const win = new BrowserWindow({
    width: opts.width, height: opts.height, useContentSize: true, show: false,
    frame: false, transparent: opts.transparent !== false,
    backgroundColor: opts.transparent === false ? (opts.backgroundColor || '#f2f2f2') : '#00000000',
    hasShadow: false, skipTaskbar: true, focusable: false,
    webPreferences: {backgroundThrottling: false, preload: opts.preload}
  });
  if (opts.offscreen) {
    // off the visible desktop but still composed by the browser, so screenshots get live frames
    win.setPosition(-3200, -2400);
    win.showInactive();
  }
  return win;
}

async function waitFor(wc, expr, timeout = 20000, interval = 100) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try { if (await wc.executeJavaScript(expr)) return true; } catch {}
    await sleep(interval);
  }
  return false;
}

async function loadOverlay(win, size) {
  await win.loadURL(base + '/overlay.html?size=' + size);
  const ok = await waitFor(win.webContents, '!!(window.bluefish && window.bluefish.renderer)');
  if (!ok) throw Error('overlay not ready at size ' + size);
  return win.webContents;
}

// Capture one animation frame exactly as the page renders it (device px -> 1x css px).
async function shot(wc, file) {
  const img = await wc.capturePage();
  const small = img.resize({width: 800, height: 392, quality: 'best'});
  fs.writeFileSync(path.join(file), small.toPNG());
  return img.getSize();
}

const DOCK_W = 800, DOCK_H = 392, DOCK_LEDGE = 380, HEAD_FRACTION = (1 + (0.73 - 0.5) * 1.76) / 2;
const CENTER = {x: DOCK_W / 2, y: (DOCK_LEDGE - 240 * HEAD_FRACTION) + 120};

async function setPointer(wc, p) {
  if (!p) return wc.executeJavaScript('window.bluefish.setPointer(null)');
  const gx = clamp((p[0] - CENTER.x) / (240 * 0.7), -1, 1);
  const gy = clamp((p[1] - CENTER.y) / (240 * 0.7), -1, 1);
  return wc.executeJavaScript('window.bluefish.setPointer({x:' + p[0] + ',y:' + p[1] + ',gx:' + gx + ',gy:' + gy + '})');
}

const HERO_T = 9.0;
function smoothStep(u) { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); }
function mix(a, b, u) { return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]; }

async function captureHero(wc) {
  await wc.executeJavaScript('window.bluefish.peek.cfg.gazeHold=0.5;window.bluefish.peek.cfg.cooldown=0.65;');
  const dir = path.join(FRAMES, 'hero');
  fs.mkdirSync(dir, {recursive: true});
  const frames = [];
  const t0 = Date.now();
  let phase = 'approach', phaseT = 0, restT = null;
  while (true) {
    const t = (Date.now() - t0) / 1000;
    if (t > HERO_T) break;
    const st = await wc.executeJavaScript('({off:window.bluefish.peek.offset,mode:window.bluefish.peek.mode})');
    let p;
    if (phase === 'rest') {
      p = [400, 300];
      if (restT !== null && t - restT > 0.7) break;
    } else if (phase === 'approach') {
      p = mix([700, 168], [640, 226], smoothStep(t / 0.9));
      if (t >= 0.9) { phase = 'right'; phaseT = t; }
    } else if (phase === 'right') {
      p = [640, 228];
      if (st.off >= 0.115) { phase = 'sweep'; phaseT = t; }
      else if (t - phaseT > 3.2) { phase = 'sweep'; phaseT = t; }
    } else if (phase === 'sweep') {
      p = mix([640, 228], [170, 244], smoothStep((t - phaseT) / 0.65));
      if (t - phaseT >= 0.65) { phase = 'left'; phaseT = t; }
    } else if (phase === 'left') {
      p = [168, 246];
      if (st.off <= 0.005) { phase = 'rest'; restT = t; }
      else if (t - phaseT > 3.6) { phase = 'rest'; restT = t; }
    }
    await setPointer(wc, p);
    const ts = Date.now();
    const file = 'f' + String(frames.length).padStart(3, '0') + '.png';
    await shot(wc, path.join(dir, file));
    frames.push({t, ts, file, x: p[0], y: p[1], off: st.off, mode: st.mode});
    const spent = Date.now() - ts;
    if (spent < 64) await sleep(64 - spent);
  }
  fs.writeFileSync(path.join(FRAMES, 'hero.json'), JSON.stringify({size: 240, frames}, null, 1));
  return frames.length;
}

const MOODS_T = 4.8;
function moodsCursor(t) {
  if (t < 1.45) return null;
  if (t < 2.15) {
    const u = (t - 1.45) / 0.7, s = u * u * (3 - 2 * u);
    return [700 + (425 - 700) * s, 150 + (290 - 150) * s];
  }
  return [425 + Math.sin((t - 2.15) * 2.2) * 6, 290 + Math.cos((t - 2.15) * 1.7) * 3];
}

async function captureMoods(wc) {
  const dir = path.join(FRAMES, 'moods');
  fs.mkdirSync(dir, {recursive: true});
  const frames = [];
  const t0 = Date.now();
  let poked = false;
  while (true) {
    const t = (Date.now() - t0) / 1000;
    if (t > MOODS_T) break;
    const p = moodsCursor(t);
    await setPointer(wc, p);
    if (p && !poked && t > 2.05) {
      const hit = await wc.executeJavaScript(`(() => {
        let hit = null;
        for (let yy = 220; yy < 376 && !hit; yy += 6)
          for (let xx = 320; xx < 500 && !hit; xx += 6)
            if (window.bluefish.hitTest(xx, yy)) hit = {x: xx, y: yy};
        if (!hit) return null;
        document.getElementById('avatar').dispatchEvent(new PointerEvent('pointerdown', {bubbles: true, clientX: hit.x, clientY: hit.y, button: 0, pointerId: 1}));
        return hit;
      })()`);
      if (hit) { poked = true; console.log('poke at ' + JSON.stringify(hit)); }
    }
    const ts = Date.now();
    const file = 'f' + String(frames.length).padStart(3, '0') + '.png';
    await shot(wc, path.join(dir, file));
    frames.push({t, ts, file, x: p ? p[0] : null, y: p ? p[1] : null});
    const spent = Date.now() - ts;
    if (spent < 64) await sleep(64 - spent);
  }
  await wc.executeJavaScript('dispatchEvent(new PointerEvent("pointerup",{bubbles:true,button:0,pointerId:1}))').catch(() => {});
  fs.writeFileSync(path.join(FRAMES, 'moods.json'), JSON.stringify({size: 240, frames}, null, 1));
  return frames.length;
}

(async () => {
  await app.whenReady();
  fs.mkdirSync(FRAMES, {recursive: true});
  fs.mkdirSync(STILLS, {recursive: true});
  const server = await startServer();
  base = 'http://127.0.0.1:' + server.address().port;
  console.log('base=' + base);
  const disp = screen.getPrimaryDisplay();
  console.log('display=' + JSON.stringify({size: disp.size, workArea: disp.workArea, scale: disp.scaleFactor, dpr: DPR}));

  if (want('hero')) {
    const win = makeWin({width: DOCK_W, height: DOCK_H, transparent: true});
    const wc = await loadOverlay(win, 240);
    await sleep(650);
    const n = await captureHero(wc);
    console.log('hero_frames=' + n);
    win.destroy();
  }

  if (want('moods')) {
    const win = makeWin({width: DOCK_W, height: DOCK_H, transparent: true});
    const wc = await loadOverlay(win, 240);
    await sleep(500);
    await wc.executeJavaScript('window.bluefish.forceSulk();window.bluefish.setPointer(null);');
    await sleep(250);
    const n = await captureMoods(wc);
    console.log('moods_frames=' + n);
    win.destroy();
  }

  if (want('sizes')) {
    for (const s of [150, 240, 460]) {
      const width = Math.round(s * 1.3), grip = Math.round(s * 0.05), height = Math.round(s * 0.70) + grip;
      const win = makeWin({width, height, transparent: true});
      const wc = await loadOverlay(win, s);
      await sleep(600);
      const frames = [];
      for (let i = 0; i < 4; i++) {
        const img = await wc.capturePage();
        const name = 'size' + s + '_' + i + '.png';
        fs.writeFileSync(path.join(STILLS, name), img.toPNG());
        frames.push({name, device: img.getSize()});
        await sleep(240);
      }
      console.log('size' + s + ' ' + JSON.stringify({width, height, grip, ledge: height - grip, frames}));
      win.destroy();
    }
  }

  if (want('menu')) {
    // a clean 240px pet still, eyes toward the menu side
    {
      const win = makeWin({width: 312, height: 180, transparent: true});
      const wc = await loadOverlay(win, 240);
      await wc.executeJavaScript('window.bluefish.setPointer({x:286,y:126,gx:1,gy:-0.2})');
      await sleep(800);
      const img = await wc.capturePage();
      fs.writeFileSync(path.join(STILLS, 'pet240_look.png'), img.toPNG());
      console.log('pet240_look ' + JSON.stringify(img.getSize()));
      win.destroy();
    }
    const win = makeWin({width: 280, height: 420, transparent: true, preload: STUB_PRELOAD});
    await win.loadURL(base + '/menu.html');
    await sleep(900);
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(STILLS, 'menu.png'), img.toPNG());
    console.log('menu ' + JSON.stringify(img.getSize()));
    win.destroy();
  }

  if (want('console')) {
    const win = makeWin({width: 980, height: 660, transparent: false, backgroundColor: '#f2f2f2', preload: STUB_PRELOAD});
    await win.loadURL(base + '/');
    const ok = await waitFor(win.webContents, '!!(window.bluefish && window.bluefish.renderer)');
    // A hidden window can hold a stale WebGL frame; mirror the avatar into a 2D canvas that
    // repaints every frame, which the compositor does pick up.
    const mirrored = await win.webContents.executeJavaScript(`(() => {
      const src = document.getElementById('avatar');
      if (!src) return 'no-canvas';
      const r = src.getBoundingClientRect();
      const c = document.createElement('canvas');
      c.width = src.width; c.height = src.height;
      c.style.cssText = 'position:fixed;left:' + r.left + 'px;top:' + r.top + 'px;width:' + r.width + 'px;height:' + r.height + 'px;pointer-events:none;z-index:5;';
      document.body.appendChild(c);
      const g = c.getContext('2d');
      (function tick() {
        try { g.clearRect(0, 0, c.width, c.height); g.drawImage(src, 0, 0, c.width, c.height); } catch (e) {}
        requestAnimationFrame(tick);
      })();
      return {w: c.width, h: c.height, left: r.left, top: r.top, cssW: r.width};
    })()`);
    console.log('mirror=' + JSON.stringify(mirrored));
    await sleep(900);
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(STILLS, 'console.png'), img.toPNG());
    console.log('console ready=' + ok + ' ' + JSON.stringify(img.getSize()));
    win.destroy();
  }

  server.close();
  app.quit();
})().catch(e => { console.error('FAIL ' + (e && e.stack || e)); app.quit(); });
