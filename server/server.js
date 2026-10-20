'use strict';
// Local web mode: serves the same UI as the desktop app from a Node server bound to 127.0.0.1 and
// implements the same window.native API over HTTP (see web-shim.js). Everything still runs on this
// machine; the upscaler, models and tiling code are the ones the desktop app uses.
//   node server/server.js            -> http://127.0.0.1:4317   (PORT / HOST env to change; HOST stays local by default)
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');

const root = path.join(__dirname, '..');
const { MODELS, downloadModel, isVerified } = require(path.join(root, 'electron', 'models'));
const { Upscaler, upscaleFile, exportImage, PROVIDER_LABEL } = require(path.join(root, 'electron', 'upscaler'));

const PORT = Number(process.env.PORT || 4317);
const HOST = process.env.HOST || '127.0.0.1';
const MAX_UPLOAD = 1024 * 1024 * 1024; // 1 GiB per image
const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'tif', 'tiff', 'gif', 'avif'];
const EXT_FOR = { png: 'png', jpeg: 'jpg', webp: 'webp' };
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };

const dataDir = process.env.IMAGEUPSCALE_DATA_DIR || path.join(os.homedir(), '.ImageUpscale');
const qualityPath = path.join(dataDir, 'models', MODELS.quality.file);
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ImageUpscale-web-'));
const pkg = require(path.join(root, 'package.json'));

let nextId = 1;
const items = new Map();
const engines = new Map();
let job = null;
let download = null;
let qualityVerified = null;
const clients = new Set(); // SSE listeners

const emit = (event, data) => { for (const res of clients) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };
async function qualityReady() {
  if (qualityVerified === null) qualityVerified = await isVerified(MODELS.quality, qualityPath);
  return qualityVerified;
}
async function engineFor(id) {
  if (engines.has(id)) return engines.get(id);
  let file;
  if (id === 'fast') file = path.join(root, 'models', 'fast.onnx');
  else if (id === 'quality') {
    if (!(await qualityReady())) throw new Error('The Quality model is not downloaded yet. Choose Quality and click Download.');
    file = qualityPath;
  } else throw new Error(`Unknown model "${id}".`);
  if (!fs.existsSync(file)) throw new Error('The Fast model file is missing. Run "npm run models" first.');
  const up = await new Upscaler(file).open();
  engines.set(id, up);
  return up;
}

async function dataUrl(file, maxEdge) {
  const buf = await sharp(file, { failOn: 'none', limitInputPixels: false }).rotate()
    .resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true }).webp({ quality: 90 }).toBuffer();
  return `data:image/webp;base64,${buf.toString('base64')}`;
}
const publicItem = (i) => ({ id: i.id, name: i.name, width: i.width, height: i.height, status: i.status, scale: i.scale, error: i.error || null, note: i.note || null });

// ---------- helpers ----------
const json = (res, code, obj) => { const b = JSON.stringify(obj); res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(b); };
function body(req, limit = 1e6) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', (c) => { n += c.length; if (n > limit) { reject(new Error('Request too large.')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
const jsonBody = async (req) => { const b = await body(req); return b.length ? JSON.parse(b.toString('utf8')) : {}; };

// Only this origin may talk to the API, and only with a local Host header (blocks DNS rebinding and other sites' pages).
function allowed(req) {
  const host = (req.headers.host || '').toLowerCase();
  const okHost = HOST !== '127.0.0.1' && HOST !== 'localhost' ? true : new RegExp(`^(127\\.0\\.0\\.1|localhost|\\[::1\\]):${PORT}$`).test(host);
  const origin = req.headers.origin;
  const okOrigin = !origin || new URL(origin).host.toLowerCase() === host;
  return okHost && okOrigin;
}

const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'";
function indexHtml() {
  let h = fs.readFileSync(path.join(root, 'renderer', 'index.html'), 'utf8');
  h = h.replace(/connect-src 'none'/, "connect-src 'self'");
  h = h.replace('<link rel="stylesheet" href="styles.css" />', '<link rel="icon" type="image/svg+xml" href="assets/app-icon.svg" />\n  <link rel="stylesheet" href="styles.css" />');
  h = h.replace('<script src="renderer.js"></script>', '<script src="/__web/web-shim.js"></script>\n  <script src="renderer.js"></script>');
  return h;
}

// ---------- API ----------
const routes = {
  'GET /api/info': async () => ({ name: 'ImageUpscale', version: pkg.version, platform: process.platform, arch: process.arch, mark: null, mode: 'web',
    models: Object.values(MODELS).map(({ id, label, detail }) => ({ id, label, detail })) }),
  'GET /api/model/status': async () => ({ quality: { ready: await qualityReady(), size: MODELS.quality.size } }),
  'POST /api/prepare': async (req) => {
    const { model } = await jsonBody(req);
    try { const up = await engineFor(model); return { ok: true, provider: PROVIDER_LABEL[up.provider] }; } catch (e) { return { ok: false, error: e.message }; }
  },
  'POST /api/model/download': async () => {
    if (download) return { ok: false, error: 'A download is already running.' };
    download = { abort: new AbortController() };
    try {
      await downloadModel(MODELS.quality, qualityPath, { signal: download.abort.signal, onProgress: (got, total) => emit('model', { got, total }) });
      qualityVerified = true; engines.delete('quality');
      return { ok: true };
    } catch (e) {
      return { ok: false, cancelled: e.name === 'AbortError', error: e.name === 'AbortError' ? 'Download paused. Click Download again to resume.' : e.message };
    } finally { download = null; }
  },
  'POST /api/model/cancel': async () => { if (download) download.abort.abort(); return {}; },
  'POST /api/upload': async (req) => {
    const name = path.basename(decodeURIComponent(req.headers['x-filename'] || 'image'));
    if (!IMAGE_EXT.includes(path.extname(name).slice(1).toLowerCase())) {
      return { added: [], problems: [`${name}: not a supported image. Use PNG, JPEG, WebP, BMP, TIFF, GIF or AVIF.`] };
    }
    const id = nextId++;
    const dest = path.join(tmpDir, `${id}-in${path.extname(name).toLowerCase()}`);
    let n = 0;
    await new Promise((resolve, reject) => {
      const out = fs.createWriteStream(dest);
      req.on('data', (c) => { n += c.length; if (n > MAX_UPLOAD) { req.destroy(); out.destroy(); reject(new Error('That file is larger than 1 GB.')); } });
      req.pipe(out); out.on('finish', resolve); out.on('error', reject); req.on('error', reject);
    });
    try {
      const meta = await sharp(dest, { failOn: 'none', limitInputPixels: false }).metadata();
      const rotated = meta.orientation && meta.orientation >= 5;
      const it = { id, path: dest, name, width: rotated ? meta.height : meta.width, height: rotated ? meta.width : meta.height,
        status: 'ready', resultPath: null, scale: null, note: meta.pages > 1 ? 'first frame only' : null };
      items.set(id, it);
      return { added: [{ ...publicItem(it), thumb: await dataUrl(dest, 120) }], problems: [] };
    } catch (e) {
      fs.rmSync(dest, { force: true });
      return { added: [], problems: [`${name}: could not be read (${e.message}). Check that the file is not damaged.`] };
    }
  },
  'POST /api/remove': async (req) => {
    const { id } = await jsonBody(req); const it = items.get(id);
    if (it) { fs.rmSync(it.path, { force: true }); if (it.resultPath) fs.rmSync(it.resultPath, { force: true }); items.delete(id); }
    return {};
  },
  'POST /api/preview': async (req) => {
    const { id } = await jsonBody(req); const it = items.get(id);
    if (!it) return null;
    return { before: await dataUrl(it.path, 3200), after: it.resultPath ? await dataUrl(it.resultPath, 3200) : null,
      outWidth: it.resultPath ? it.width * it.scale : null, outHeight: it.resultPath ? it.height * it.scale : null };
  },
  'POST /api/upscale': async (req) => {
    const { ids, scale, model } = await jsonBody(req);
    if (job) return { ok: false, error: 'Already upscaling.' };
    if (scale !== 2 && scale !== 4) return { ok: false, error: 'Scale must be 2× or 4×.' };
    job = { abort: new AbortController() };
    const results = [];
    try {
      const up = await engineFor(model);
      const todo = (ids || []).map((id) => items.get(id)).filter(Boolean);
      for (let n = 0; n < todo.length; n++) {
        const it = todo[n];
        if (job.abort.signal.aborted) break;
        it.status = 'working'; it.error = null;
        emit('progress', { id: it.id, done: 0, total: 1, index: n, count: todo.length, status: 'working' });
        try {
          if (it.resultPath) fs.rmSync(it.resultPath, { force: true });
          const out = path.join(tmpDir, `${it.id}-${scale}x.png`);
          const r = await upscaleFile(up, it.path, out, { scale, signal: job.abort.signal,
            onProgress: (done, total) => emit('progress', { id: it.id, done, total, index: n, count: todo.length, status: 'working' }) });
          it.status = 'done'; it.resultPath = out; it.scale = scale;
          results.push({ id: it.id, ms: r.ms, width: r.width, height: r.height });
          emit('progress', { id: it.id, done: 1, total: 1, index: n, count: todo.length, status: 'done', ms: r.ms, provider: PROVIDER_LABEL[up.provider] });
        } catch (e) {
          it.status = e.name === 'AbortError' ? 'ready' : 'error'; it.error = e.name === 'AbortError' ? null : e.message;
          emit('progress', { id: it.id, done: 0, total: 1, index: n, count: todo.length, status: it.status, error: it.error });
          if (e.name === 'AbortError') break;
        }
      }
      return { ok: true, results, cancelled: job.abort.signal.aborted, provider: PROVIDER_LABEL[up.provider] };
    } catch (e) { return { ok: false, error: e.message }; } finally { job = null; }
  },
  'GET /api/done': async () => [...items.values()].filter((i) => i.resultPath).map((i) => i.id),
  'POST /api/cancel': async () => { if (job) job.abort.abort(); return {}; },
};

async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (!allowed(req)) { res.writeHead(403); return res.end('Forbidden'); }

  if (url.pathname === '/api/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
    res.write(': ok\n\n'); clients.add(res); req.on('close', () => clients.delete(res)); return;
  }
  const m = url.pathname.match(/^\/api\/download\/(\d+)$/);
  if (m && req.method === 'GET') {
    const it = items.get(Number(m[1])); const format = url.searchParams.get('format') || 'png';
    if (!it || !it.resultPath || !EXT_FOR[format]) { res.writeHead(404); return res.end('Upscale this image first.'); }
    const out = path.join(tmpDir, `${it.id}-export.${EXT_FOR[format]}`);
    try { await exportImage(it.resultPath, out, format); } catch (e) { res.writeHead(400, { 'content-type': 'text/plain' }); return res.end(e.message); }
    const stem = path.basename(it.name, path.extname(it.name));
    res.writeHead(200, { 'content-type': { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' }[format],
      'content-length': fs.statSync(out).size, 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`${stem}-${it.scale}x.${EXT_FOR[format]}`)}` });
    return fs.createReadStream(out).pipe(res).on('close', () => fs.rmSync(out, { force: true }));
  }
  const key = `${req.method} ${url.pathname}`;
  if (routes[key]) {
    try { return json(res, 200, await routes[key](req)); } catch (e) { return json(res, 500, { ok: false, error: e.message }); }
  }
  // static: UI files only, never anything outside renderer/ (plus the shim)
  if (req.method !== 'GET') { res.writeHead(405); return res.end(); }
  if (url.pathname === '/favicon.ico') { res.writeHead(204); return res.end(); }
  const headers = { 'content-security-policy': CSP, 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'cache-control': 'no-store' };
  if (url.pathname === '/' || url.pathname === '/index.html') { res.writeHead(200, { ...headers, 'content-type': MIME['.html'] }); return res.end(indexHtml()); }
  const file = url.pathname === '/__web/web-shim.js' ? path.join(__dirname, 'web-shim.js') : path.join(root, 'renderer', decodeURIComponent(url.pathname));
  const base = url.pathname === '/__web/web-shim.js' ? __dirname : path.join(root, 'renderer');
  if (!path.resolve(file).startsWith(path.resolve(base) + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end('Not found'); }
  res.writeHead(200, { ...headers, 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer((req, res) => { handle(req, res).catch((e) => { if (!res.headersSent) res.writeHead(500); res.end(String(e.message)); }); });
server.on('error', (e) => {
  console.error(e.code === 'EADDRINUSE' ? `Port ${PORT} is already in use. Close the other ImageUpscale window or set PORT=another number.` : e.message);
  process.exit(1);
});
server.listen(PORT, HOST, () => {
  const url = `http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}/`;
  console.log(`ImageUpscale is running at ${url}\nEverything stays on this computer. Press Ctrl+C to stop.`);
  engineFor('fast').then((u) => console.log(`Engine ready: ${PROVIDER_LABEL[u.provider]}`)).catch((e) => console.error(e.message));
  if (process.argv.includes('--open')) {
    const { exec } = require('child_process');
    exec(process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`);
  }
});
const cleanup = () => { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ } process.exit(0); };
process.on('SIGINT', cleanup); process.on('SIGTERM', cleanup);
