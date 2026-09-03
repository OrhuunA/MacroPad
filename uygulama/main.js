'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const readline = require('readline');

/* ------------------------------------------------------------------ */
/* Chromium onbellek gurultusunu kes                                    */
/*                                                                      */
/* "Unable to move the cache / Gpu Cache Creation failed" uyarilari,    */
/* onbellek klasorune yazilamadiginda cikar (ikinci kopya calisiyor,    */
/* OneDrive senkronu, antivirus...). Arayuz tamamen yerel ve statik,    */
/* disk onbellegine hic ihtiyaci yok: kapatinca uyarilar da bitiyor.    */
/* ------------------------------------------------------------------ */
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
app.commandLine.appendSwitch('disable-gpu-disk-cache');
app.commandLine.appendSwitch('disable-http-cache');

/* Alt surec icin GUVENLI calisma dizini.
   Paketlenmis uygulamada __dirname "resources\app.asar" icine bakar; bu
   gercek bir klasor degildir ve spawn'a cwd olarak verilirse Windows
   ENOENT dondurur - motor bulunsa bile calismaz. */
function safeCwd() {
  try {
    if (app.isPackaged && process.resourcesPath && fs.existsSync(process.resourcesPath)) {
      return process.resourcesPath;
    }
    if (__dirname.indexOf('app.asar') === -1 && fs.existsSync(__dirname)) return __dirname;
  } catch (e) { /* yoksay */ }
  return undefined;               // undefined = ana surecin dizinini kullan
}

let win = null;
let engine = null;
let engineReady = false;
let rendererReady = false;
const REQUIRED_ENGINE = 8;   // bundan eski motorlar kabul edilmez
let lastFatal = null;
let pending = [];              // arayuz yuklenmeden gelen olaylar burada bekler

/* ------------------------------------------------------------------ */
/* Pencere                                                             */
/* ------------------------------------------------------------------ */
function createWindow() {
  win = new BrowserWindow({
    width: 1060,
    height: 780,
    minWidth: 900,
    minHeight: 660,
    backgroundColor: '#12151f',
    show: false,
    autoHideMenuBar: true,
    title: 'MacroPad',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  rendererReady = false;
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => { win = null; });

  // dis linkleri varsayilan tarayicida ac
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

/* ------------------------------------------------------------------ */
/* Python motoru                                                       */
/* ------------------------------------------------------------------ */
function engineCandidates() {
  const list = [];
  const script = path.join(__dirname, 'engine', 'engine.py');
  const exeName = process.platform === 'win32' ? 'macropad-engine.exe' : 'macropad-engine';

  // 1) paketlenmis motor (PyInstaller ciktisi)
  const packed = path.join(process.resourcesPath || '', 'engine', exeName);
  if (process.resourcesPath && fs.existsSync(packed)) list.push({ cmd: packed, args: [] });

  // 2) gelistirme klasorundeki motor exe
  const localExe = path.join(__dirname, 'engine', 'dist', exeName);
  if (fs.existsSync(localExe)) list.push({ cmd: localExe, args: [] });

  if (!fs.existsSync(script)) return list;   // engine.py yoksa python adaylari anlamsiz

  // 3) kurulum betiginin buldugu yorumlayici
  //    MACROPAD_PYEXE: tam yol (bosluk icerebilir) + MACROPAD_PYARGS: ek arguman
  //    MACROPAD_PYTHON: eski bicim, tek satirda ("py -3")
  if (process.env.MACROPAD_PYEXE) {
    const extra = (process.env.MACROPAD_PYARGS || '').trim();
    const pre = extra ? extra.split(/\s+/) : [];
    list.push({ cmd: process.env.MACROPAD_PYEXE, args: pre.concat([script]) });
  } else if (process.env.MACROPAD_PYTHON) {
    const parts = process.env.MACROPAD_PYTHON.trim().split(/\s+/);
    list.push({ cmd: parts[0], args: parts.slice(1).concat([script]) });
  }

  // 4) sistemdeki yorumlayicilar. Windows'ta once "py -3": "python" cogu
  //    makinede Microsoft Store kisayoluna gidip hicbir sey calistirmiyor.
  const tries = process.platform === 'win32'
    ? [['py', ['-3']], ['python', []], ['python3', []]]
    : [['python3', []], ['python', []]];
  for (const [cmd, pre] of tries) list.push({ cmd, args: pre.concat([script]) });

  // 5) son care: kabuk uzerinden (PATH cozumu konsoldakiyle birebir ayni olur)
  if (process.platform === 'win32') {
    for (const pre of ['py -3', 'python']) {
      list.push({ cmd: pre + ' "' + script + '"', args: [], shell: true });
    }
  }

  return list;
}

function toRenderer(channel, payload) {
  if (!rendererReady) { pending.push([channel, payload]); return; }
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function startEngine(index = 0) {
  const cands = engineCandidates();

  const script = path.join(__dirname, 'engine', 'engine.py');
  if (!fs.existsSync(script) && cands.length === 0) {
    toRenderer('engine:event', {
      ev: 'fatal',
      message: 'Motor dosyası bulunamadı: ' + script +
               '  —  zip\'i açarken klasör yapısı bozulmuş olabilir.'
    });
    return;
  }

  if (index >= cands.length) {
    const packagedMsg =
      'Gömülü motor başlatılamadı. Antivirüs engellemiş olabilir — ' +
      'MacroPad dosyasını dışlanan öğeler listesine ekleyip tekrar dene.';
    toRenderer('engine:event', lastFatal || {
      ev: 'fatal',
      message: app.isPackaged ? packagedMsg
             : 'Python motoru başlatılamadı. Aşağıdaki günlükte her denemenin ' +
               'sonucu yazıyor — asıl hata orada.'
    });
    return;
  }

  const { cmd, args, shell } = cands[index];
  const label = shell ? cmd : [cmd].concat(args).join(' ');
  toRenderer('engine:event', { ev: 'log', text: '→ deneniyor: ' + label });
  if (index === 0) {
    toRenderer('engine:event', {
      ev: 'log',
      text: '   çalışma dizini: ' + (safeCwd() || '(varsayılan)')
    });
  }

  let advanced = false;
  const next = (why) => {
    if (advanced) return;
    advanced = true;
    if (why) toRenderer('engine:event', { ev: 'log', text: '   ' + why });
    startEngine(index + 1);
  };

  let child;
  try {
    child = spawn(cmd, args, {
      cwd: safeCwd(),
      shell: !!shell,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: Object.assign({}, process.env,
        { PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' })
    });
  } catch (err) {
    return next('başlatılamadı: ' + err.message);
  }

  child.on('error', (err) => next('başlatılamadı: ' + (err.code || err.message)));

  const rl = readline.createInterface({ input: child.stdout });
  rl.on('line', (line) => {
    line = line.trim();
    if (!line) return;
    let msg;
    try { msg = JSON.parse(line); }
    catch (e) { toRenderer('engine:event', { ev: 'log', text: line }); return; }

    if (msg.ev === 'fatal' && !engineReady) {
      lastFatal = msg;                       // bu yorumlayicida olmadi, digerini dene
      toRenderer('engine:event', { ev: 'log', text: '   ' + msg.message });
      return;
    }
    if (msg.ev === 'ready') {
      const v = msg.version || 1;
      if (v < REQUIRED_ENGINE) {
        // Klasorde kalmis eski bir motor: kullanma, sonraki adaya gec.
        toRenderer('engine:event', {
          ev: 'log',
          text: '   ESKİ MOTOR (sürüm ' + v + ', gereken ' + REQUIRED_ENGINE +
                ') — atlanıyor. Eskimiş engine/dist klasörünü silebilirsin.'
        });
        try { child.kill(); } catch (err) { /* yoksay */ }
        return next('sürümü eski');
      }
      engineReady = true;
      lastFatal = null;
      toRenderer('engine:event', {
        ev: 'log', text: '   motor bu komutla çalıştı ✓ (sürüm ' + v + ')'
      });
    }
    toRenderer('engine:event', msg);
  });

  // stderr HER ZAMAN gunluge dusmeli: asil hata mesaji burada oluyor
  child.stderr.on('data', (d) => {
    const t = String(d).trim();
    if (t) toRenderer('engine:event', { ev: 'log', text: t });
  });

  /* DIKKAT: 'exit' ile karar VERME.
     PyInstaller'in tek-dosya exe'si once bir acici surec calistirir; o
     surec cikinca 'exit' hemen tetiklenir ama asil motor arkada calismaya
     devam eder ve bir saniye sonra "ready" yollar. 'close' ise ancak
     stdout'u tutan herkes birakinca tetiklenir - dogru sinyal budur.
     Ustune kucuk bir gecikme koyup bekleyen satirlarin islenmesini de
     garantiliyoruz. */
  let exitCode = null;
  child.on('exit', (code) => { exitCode = code; });

  child.on('close', () => {
    setTimeout(() => {
      if (advanced) return;
      if (!engineReady) return next('çıkış kodu ' + exitCode + ' — çalışmadı');
      engineReady = false;
      engine = null;
      toRenderer('engine:event', { ev: 'log', text: 'Motor kapandı (kod ' + exitCode + ').' });
      if (!app.isQuiting) {
        toRenderer('engine:event', {
          ev: 'status', kind: 'err',
          text: 'Motor beklenmedik şekilde kapandı. "yeniden dene" düğmesine bas.'
        });
      }
    }, 250);
  });

  engine = child;
}

function sendToEngine(msg) {
  if (!engine || !engine.stdin.writable) return false;
  engine.stdin.write(JSON.stringify(msg) + '\n');
  return true;
}

/* ------------------------------------------------------------------ */
/* IPC                                                                 */
/* ------------------------------------------------------------------ */
// arayuz hazir olduğunu bildirir; bekleyen olaylar buradan akar
ipcMain.handle('renderer:hello', () => {
  rendererReady = true;
  const queued = pending;
  pending = [];
  for (const [c, p] of queued) {
    if (win && !win.isDestroyed()) win.webContents.send(c, p);
  }
  return { engineReady: engineReady };
});

ipcMain.handle('engine:restart', () => {
  if (engine) { try { engine.kill(); } catch (err) { /* yoksay */ } }
  engine = null;
  engineReady = false;
  lastFatal = null;
  startEngine(0);
  return true;
});

ipcMain.handle('engine:send', (e, msg) => {
  if (sendToEngine(msg)) return true;
  /* Boru kopmus. Kullaniciyi cikmaza sokmak yerine motoru sessizce
     yeniden kur; komutu da kisa bir gecikmeyle tekrar dene. */
  toRenderer('engine:event', { ev: 'log', text: 'Motora ulaşılamadı, yeniden kuruluyor…' });
  engineReady = false;
  engine = null;
  startEngine(0);
  setTimeout(() => { if (engineReady) sendToEngine(msg); }, 1200);
  return false;
});

ipcMain.handle('macro:save', async (e, data) => {
  const res = await dialog.showSaveDialog(win, {
    title: 'Makroyu kaydet',
    defaultPath: 'makro.json',
    filters: [{ name: 'MacroPad makrosu', extensions: ['json'] }]
  });
  if (res.canceled || !res.filePath) return { ok: false };
  fs.writeFileSync(res.filePath, JSON.stringify(data, null, 2), 'utf-8');
  return { ok: true, path: res.filePath };
});

ipcMain.handle('macro:open', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'Makro ac',
    properties: ['openFile'],
    filters: [{ name: 'MacroPad makrosu', extensions: ['json'] }]
  });
  if (res.canceled || !res.filePaths.length) return { ok: false };
  try {
    const raw = fs.readFileSync(res.filePaths[0], 'utf-8');
    return { ok: true, data: JSON.parse(raw), path: res.filePaths[0] };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

/* ------------------------------------------------------------------ */
/* Uygulama yasam dongusu                                              */
/* ------------------------------------------------------------------ */
// Ayni anda iki MacroPad calisirsa ikisi de ayni onbellek klasorunu
// kullanmaya calisir; ikincisini acmak yerine mevcut pencereyi one getir.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
}

app.whenReady().then(() => {
  createWindow();
  startEngine();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  app.isQuiting = true;
  if (engine) {
    try { sendToEngine({ cmd: 'quit' }); } catch (e) { /* yoksay */ }
    setTimeout(() => { try { engine.kill(); } catch (e) { /* yoksay */ } }, 200);
  }
});

app.on('window-all-closed', () => { app.quit(); });
