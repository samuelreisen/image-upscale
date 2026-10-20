'use strict';
const { app, BrowserWindow, Menu, shell, ipcMain, dialog, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const sharp = require('sharp');

// Tests and experiments point this at a scratch folder. Real data lives in the normal userData.
if (process.env.IMAGEUPSCALE_DATA_DIR) app.setPath('userData', path.resolve(process.env.IMAGEUPSCALE_DATA_DIR));

const { MODELS, downloadModel, isVerified } = require('./models');
const { Upscaler, upscaleFile, exportImage, PROVIDER_LABEL } = require('./upscaler');
const { createUpdates, explain } = require('./updates');

const isMac = process.platform === 'darwin';
const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'tif', 'tiff', 'gif', 'avif'];
const FORMATS = { png: 'PNG', jpeg: 'JPEG', webp: 'WebP' };
const EXT_FOR = { png: 'png', jpeg: 'jpg', webp: 'webp' };

let win = null;
let updates = null;
let tmpDir = null;
let nextId = 1;
const items = new Map(); // id -> { id, path, name, width, height, status, resultPath, scale }
const engines = new Map(); // model id -> Upscaler
let job = null; // { abort: AbortController }
let download = null; // { abort: AbortController }
let uiState = { count: 0, hasResult: false, busy: false, scale: 4, model: 'fast', format: 'png', qualityReady: false, selectedDone: false };

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
    handleLaunchArgs(argv);
  });
}

// ---------- paths ----------
const appRoot = () => path.join(__dirname, '..');
const bundledModelPath = () => (app.isPackaged
  ? path.join(process.resourcesPath, 'models', 'fast.onnx')
  : path.join(appRoot(), 'models', 'fast.onnx'));
const modelsDir = () => path.join(app.getPath('userData'), 'models');
const qualityPath = () => path.join(modelsDir(), MODELS.quality.file);

let qualityVerified = null; // cached after first hash, reset after a download
async function qualityReady() {
  if (qualityVerified === null) qualityVerified = await isVerified(MODELS.quality, qualityPath());
  return qualityVerified;
}

// ---------- engine ----------
async function engineFor(id) {
  if (engines.has(id)) return engines.get(id);
  let file;
  if (id === 'fast') file = bundledModelPath();
  else if (id === 'quality') {
    if (!(await qualityReady())) throw new Error('The Quality model is not downloaded yet. Choose Quality and click Download.');
    file = qualityPath();
  } else throw new Error(`Unknown model "${id}".`);
  if (!fs.existsSync(file)) throw new Error('The Fast model file is missing. Reinstall ImageUpscale.');
  const up = await new Upscaler(file).open();
  engines.set(id, up);
  return up;
}

// ---------- images ----------
function isImagePath(p) {
  return IMAGE_EXT.includes(path.extname(p).slice(1).toLowerCase());
}

async function dataUrl(file, maxEdge) {
  const buf = await sharp(file, { failOn: 'none', limitInputPixels: false }).rotate()
    .resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 90 }).toBuffer();
  return `data:image/webp;base64,${buf.toString('base64')}`;
}

async function addPaths(paths) {
  const added = [];
  const problems = [];
  for (const p of paths) {
    if (!isImagePath(p)) { problems.push(`${path.basename(p)}: not a supported image. Use PNG, JPEG, WebP, BMP, TIFF, GIF or AVIF.`); continue; }
    try {
      const meta = await sharp(p, { failOn: 'none' }).metadata();
      const rotated = meta.orientation && meta.orientation >= 5;
      const item = {
        id: nextId++, path: p, name: path.basename(p),
        width: rotated ? meta.height : meta.width, height: rotated ? meta.width : meta.height,
        status: 'ready', resultPath: null, scale: null,
        note: meta.pages > 1 ? 'first frame only' : null, // animated GIF/WebP: only frame 1 is upscaled
      };
      items.set(item.id, item);
      added.push({ ...publicItem(item), thumb: await dataUrl(p, 120) });
    } catch (e) {
      problems.push(`${path.basename(p)}: could not be read (${e.message}). Check that the file is not damaged.`);
    }
  }
  return { added, problems };
}

const publicItem = (i) => ({ id: i.id, name: i.name, width: i.width, height: i.height, status: i.status, scale: i.scale, error: i.error || null, note: i.note || null });

// ---------- window and menu ----------
function createWindow() {
  win = new BrowserWindow({
    width: 1180, height: 780, minWidth: 900, minHeight: 540, show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1c1c1e' : '#f5f5f7',
    icon: path.join(appRoot(), 'build', 'icon.png'),
    ...(isMac ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 18, y: 20 } } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
    },
  });
  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(updates.rendererDir(), 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => { openExternalSafely(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file://')) { e.preventDefault(); openExternalSafely(url); } else e.preventDefault(); });
  win.on('closed', () => { win = null; });
}

function openExternalSafely(url) {
  if (/^(https?:|mailto:)/i.test(url)) shell.openExternal(url);
}

const send = (channel, data) => { if (win && !win.isDestroyed()) win.webContents.send(channel, data); };
const menuCmd = (cmd) => () => send('menu', cmd);

function buildMenu() {
  const s = uiState;
  const radio = (label, checked, cmd, enabled = true) => ({ label, type: 'radio', checked, enabled, click: menuCmd(cmd) });
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'Open Images…', accelerator: 'CmdOrCtrl+O', enabled: !s.busy, click: menuCmd('open') },
        { label: 'Save…', accelerator: 'CmdOrCtrl+S', enabled: s.selectedDone && !s.busy, click: menuCmd('save') },
        { label: 'Save All…', accelerator: 'CmdOrCtrl+Shift+S', enabled: s.hasResult && !s.busy, click: menuCmd('saveAll') },
        { type: 'separator' },
        { label: 'Remove from Queue', accelerator: 'CmdOrCtrl+Backspace', enabled: s.count > 0 && !s.busy, click: menuCmd('remove') },
        { type: 'separator' },
        { label: 'Install Update File…', click: () => installUpdateFlow() },
        { label: 'Installed Updates…', click: menuCmd('updates') },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'Image',
      submenu: [
        { label: 'Upscale', accelerator: 'CmdOrCtrl+Return', enabled: s.count > 0 && !s.busy, click: menuCmd('upscale') },
        { label: 'Cancel', accelerator: 'Esc', enabled: s.busy, click: menuCmd('cancel') },
        { type: 'separator' },
        { label: 'Scale', enabled: !s.busy, submenu: [radio('2×', s.scale === 2, 'scale:2'), radio('4×', s.scale === 4, 'scale:4')] },
        {
          label: 'Model', enabled: !s.busy,
          submenu: [radio('Fast', s.model === 'fast', 'model:fast'), radio('Quality', s.model === 'quality', 'model:quality'),
            { type: 'separator' }, { label: 'Download Quality Model…', enabled: !s.qualityReady && !s.busy, click: menuCmd('download') }],
        },
        { label: 'Save Format', submenu: Object.entries(FORMATS).map(([k, v]) => radio(v, s.format === k, `format:${k}`)) },
        { type: 'separator' },
        { label: 'Toggle Before / After', accelerator: 'CmdOrCtrl+B', enabled: s.selectedDone, click: menuCmd('toggleCompare') },
      ],
    },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        { label: 'Open HANDOFF.md', click: () => openHandoff() },
        ...(isMac ? [] : [{ type: 'separator' }, { label: 'About ImageUpscale', click: () => showAbout() }]),
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function showAbout() {
  const mark = updates.currentMark();
  const providers = [...engines.values()].map((e) => PROVIDER_LABEL[e.provider]).join(', ') || 'not started yet';
  await dialog.showMessageBox(win, {
    type: 'info', title: 'About ImageUpscale', message: `ImageUpscale ${app.getVersion()}`,
    detail: `Update mark: ${mark ? mark.name : 'none yet (next is Mk I)'}\nRuns on: ${providers}\nElectron ${process.versions.electron}, ${process.platform}/${process.arch}\n\nEverything runs on this device. Nothing is uploaded.\nModels: Real-ESRGAN, BSD-3-Clause.`,
    buttons: ['OK'],
  });
}

async function openHandoff() {
  const p = updates.handoffPath();
  const err = await shell.openPath(p);
  if (err) dialog.showErrorBox('Could not open HANDOFF.md', `${err}\n\nIt is at: ${p}`);
}

// ---------- update files ----------
async function installUpdateFlow(filePath) {
  try {
    if (!filePath) {
      const r = await dialog.showOpenDialog(win, {
        title: 'Install Update File', properties: ['openFile'],
        filters: [{ name: 'ImageUpscale update', extensions: [updates.ext.slice(1)] }],
      });
      if (r.canceled || !r.filePaths[0]) return { cancelled: true };
      filePath = r.filePaths[0];
    }
    const r = updates.install(filePath);
    const detail = r.handoff.replaced ? `HANDOFF.md updated (${r.handoff.reason}).` : `HANDOFF.md kept (${r.handoff.reason}).`;
    const choice = await dialog.showMessageBox(win, {
      type: 'info', message: `${r.name} installed`, detail: `${detail}\nReload to use the updated interface.`, buttons: ['Reload', 'Later'], defaultId: 0,
    });
    if (choice.response === 0 && win) win.loadFile(path.join(updates.rendererDir(), 'index.html'));
    return { ok: true, name: r.name };
  } catch (e) {
    dialog.showErrorBox('Could not install the update', explain(e));
    return { ok: false, error: explain(e) };
  }
}

// Files passed on the command line / "Open With": updates install, images join the queue.
function handleLaunchArgs(argv) {
  const files = argv.slice(1).filter((a) => !a.startsWith('-') && fs.existsSync(a) && fs.statSync(a).isFile());
  const upd = files.find((a) => a.toLowerCase().endsWith(updates.ext));
  if (upd) installUpdateFlow(upd);
  const imgs = files.filter(isImagePath);
  if (imgs.length) whenLoaded(async () => send('files:added', await addPaths(imgs)));
}
function whenLoaded(fn) {
  if (!win) return;
  if (win.webContents.isLoading()) win.webContents.once('did-finish-load', fn); else fn();
}

// ---------- IPC ----------
ipcMain.handle('app:info', async () => ({
  name: app.getName(), version: app.getVersion(), platform: process.platform, arch: process.arch,
  mark: updates.currentMark(), models: Object.values(MODELS).map(({ id, label, detail }) => ({ id, label, detail })),
}));

ipcMain.handle('files:pick', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Open Images', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Images', extensions: IMAGE_EXT }] });
  return r.canceled ? { added: [], problems: [] } : addPaths(r.filePaths);
});
ipcMain.handle('files:add', (_e, paths) => addPaths((paths || []).filter((p) => typeof p === 'string' && p)));
ipcMain.handle('files:remove', (_e, id) => {
  const it = items.get(id);
  if (it && it.resultPath) fs.rmSync(it.resultPath, { force: true });
  items.delete(id);
});
ipcMain.handle('files:preview', async (_e, id) => {
  const it = items.get(id);
  if (!it) return null;
  return {
    before: await dataUrl(it.path, 3200),
    after: it.resultPath ? await dataUrl(it.resultPath, 3200) : null,
    outWidth: it.resultPath ? it.width * it.scale : null, outHeight: it.resultPath ? it.height * it.scale : null,
  };
});

ipcMain.handle('engine:prepare', async (_e, model) => {
  try {
    const up = await engineFor(model);
    return { ok: true, provider: PROVIDER_LABEL[up.provider] };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('model:status', async () => ({
  quality: { ready: await qualityReady(), size: MODELS.quality.size },
}));

ipcMain.handle('model:download', async () => {
  if (download) return { ok: false, error: 'A download is already running.' };
  download = { abort: new AbortController() };
  try {
    await downloadModel(MODELS.quality, qualityPath(), {
      signal: download.abort.signal,
      onProgress: (got, total) => send('model:progress', { got, total }),
    });
    qualityVerified = true;
    engines.delete('quality');
    return { ok: true };
  } catch (e) {
    return { ok: false, cancelled: e.name === 'AbortError', error: e.name === 'AbortError' ? 'Download paused. Click Download again to resume.' : e.message };
  } finally { download = null; }
});
ipcMain.handle('model:cancel', () => { if (download) download.abort.abort(); });

ipcMain.handle('upscale:start', async (_e, { ids, scale, model }) => {
  if (job) return { ok: false, error: 'Already upscaling.' };
  if (scale !== 2 && scale !== 4) return { ok: false, error: 'Scale must be 2× or 4×.' };
  job = { abort: new AbortController() };
  const results = [];
  try {
    const up = await engineFor(model);
    const todo = ids.map((id) => items.get(id)).filter(Boolean);
    for (let n = 0; n < todo.length; n++) {
      const it = todo[n];
      if (job.abort.signal.aborted) break;
      it.status = 'working'; it.error = null;
      send('upscale:progress', { id: it.id, done: 0, total: 1, index: n, count: todo.length, status: 'working' });
      try {
        if (it.resultPath) fs.rmSync(it.resultPath, { force: true });
        const out = path.join(tmpDir, `${it.id}-${scale}x.png`);
        const r = await upscaleFile(up, it.path, out, {
          scale, signal: job.abort.signal,
          onProgress: (done, total) => send('upscale:progress', { id: it.id, done, total, index: n, count: todo.length, status: 'working' }),
        });
        it.status = 'done'; it.resultPath = out; it.scale = scale;
        results.push({ id: it.id, ms: r.ms, width: r.width, height: r.height });
        send('upscale:progress', { id: it.id, done: 1, total: 1, index: n, count: todo.length, status: 'done', ms: r.ms, provider: PROVIDER_LABEL[up.provider] });
      } catch (e) {
        it.status = e.name === 'AbortError' ? 'ready' : 'error';
        it.error = e.name === 'AbortError' ? null : e.message;
        send('upscale:progress', { id: it.id, done: 0, total: 1, index: n, count: todo.length, status: it.status, error: it.error });
        if (e.name === 'AbortError') break;
      }
    }
    return { ok: true, results, cancelled: job.abort.signal.aborted, provider: PROVIDER_LABEL[up.provider] };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally { job = null; }
});
ipcMain.handle('upscale:cancel', () => { if (job) job.abort.abort(); });

const stem = (it) => path.basename(it.name, path.extname(it.name));

ipcMain.handle('save:one', async (_e, id, format) => {
  const it = items.get(id);
  if (!it || !it.resultPath) return { ok: false, error: 'Upscale this image first, then save it.' };
  const r = await dialog.showSaveDialog(win, {
    title: 'Save Upscaled Image', defaultPath: `${stem(it)}-${it.scale}x.${EXT_FOR[format]}`,
    filters: [{ name: FORMATS[format], extensions: [EXT_FOR[format]] }],
  });
  if (r.canceled || !r.filePath) return { cancelled: true };
  try { await exportImage(it.resultPath, r.filePath, format); return { ok: true, path: r.filePath }; }
  catch (e) { return { ok: false, error: `Could not save: ${e.message}. Pick a folder you can write to.` }; }
});

ipcMain.handle('save:all', async (_e, format) => {
  const done = [...items.values()].filter((i) => i.resultPath);
  if (!done.length) return { ok: false, error: 'Nothing to save yet. Upscale at least one image.' };
  const r = await dialog.showOpenDialog(win, { title: 'Choose a Folder for the Upscaled Images', properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled || !r.filePaths[0]) return { cancelled: true };
  const saved = []; const failed = [];
  for (const it of done) {
    let out = path.join(r.filePaths[0], `${stem(it)}-${it.scale}x.${EXT_FOR[format]}`);
    for (let k = 2; fs.existsSync(out); k++) out = path.join(r.filePaths[0], `${stem(it)}-${it.scale}x-${k}.${EXT_FOR[format]}`); // never overwrite
    try { await exportImage(it.resultPath, out, format); saved.push(out); } catch (e) { failed.push(`${it.name}: ${e.message}`); }
  }
  return { ok: failed.length === 0, saved, failed, folder: r.filePaths[0] };
});

ipcMain.on('state:set', (_e, s) => { uiState = { ...uiState, ...s }; buildMenu(); });
ipcMain.handle('update:install', () => installUpdateFlow());
ipcMain.handle('update:list', () => updates.list().map(({ mark, name, title, active }) => ({ mark, name, title, active })));
ipcMain.handle('update:switch', async (_e, mark) => {
  try {
    const r = updates.switchTo(mark);
    if (win) win.loadFile(path.join(updates.rendererDir(), 'index.html'));
    return { ok: true, name: r.name };
  } catch (e) { return { ok: false, error: explain(e) }; }
});
ipcMain.handle('handoff:open', () => openHandoff());

// ---------- lifecycle ----------
app.on('open-file', (e, file) => { // macOS: double-clicked .upscl or an image
  e.preventDefault();
  const go = () => handleLaunchArgs(['', file]);
  if (app.isReady() && updates) go(); else app.once('ready', go);
});

app.whenReady().then(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ImageUpscale-'));
  updates = createUpdates({ bundledDir: appRoot(), updatesDir: path.join(app.getPath('userData'), 'updates'), shellVersion: app.getVersion() });
  updates.seedHandoff();
  buildMenu();
  createWindow();
  handleLaunchArgs(process.argv);
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('before-quit', () => {
  if (job) job.abort.abort();
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});
app.on('window-all-closed', () => { if (!isMac) app.quit(); });
