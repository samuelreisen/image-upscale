'use strict';
// Usage: node scripts/pack-server.js [win32|linux|darwin] [x64|arm64] [--no-node] [--no-zip]
// Builds a self-contained "local server" bundle: the web UI + server + models + production node_modules for the
// target OS + (Windows) a portable node.exe, so the person unzips it and double-clicks a .bat. No installer, no Wine.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const flags = new Set(process.argv.slice(2).filter((a) => a.startsWith('--')));
const [plat = 'win32', cpu = 'x64'] = args;
const NODE_VERSION = process.env.NODE_VERSION || 'v22.23.3';
const pkg = require(path.join(root, 'package.json'));
const name = `ImageUpscale-Server-${plat === 'win32' ? 'Windows' : plat}-${cpu}`;
const outDir = path.join(root, 'release', 'server-stage', name);
const app = path.join(outDir, 'app');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const rm = (p) => fs.rmSync(p, { recursive: true, force: true });
const cp = (from, to) => fs.cpSync(path.join(root, from), path.join(app, to || from), { recursive: true });

function get(url) {
  return new Promise((resolve, reject) => https.get(url, (r) => {
    if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) { r.resume(); return resolve(get(new URL(r.headers.location, url).toString())); }
    if (r.statusCode !== 200) { r.resume(); return reject(new Error(`${url}: HTTP ${r.statusCode}`)); }
    const chunks = []; r.on('data', (c) => chunks.push(c)); r.on('end', () => resolve(Buffer.concat(chunks))); r.on('error', reject);
  }).on('error', reject));
}

(async () => {
  rm(outDir); fs.mkdirSync(app, { recursive: true });
  // 1. only what server mode loads
  cp('server'); cp('renderer');
  for (const f of ['tile.js', 'upscaler.js', 'models.js']) cp(`electron/${f}`);
  if (!fs.existsSync(path.join(root, 'models', 'fast.onnx'))) throw new Error('models/fast.onnx is missing. Run: npm run models');
  cp('models/fast.onnx');
  fs.writeFileSync(path.join(app, 'package.json'), JSON.stringify({
    name: pkg.name, productName: pkg.productName, version: pkg.version, private: true, license: pkg.license,
    scripts: { start: 'node server/server.js --open' }, dependencies: pkg.dependencies,
  }, null, 2));
  fs.copyFileSync(path.join(root, 'package-lock.json'), path.join(app, 'package-lock.json'));

  // 2. production dependencies for the TARGET platform (npm picks the matching native sharp packages)
  console.log(`installing production dependencies for ${plat}/${cpu}…`);
  execFileSync(npm, ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', `--os=${plat}`, `--cpu=${cpu}`], { cwd: app, stdio: 'inherit', shell: process.platform === 'win32' });

  // 3. prune what the target can never use (and install-script-only packages that carry advisories, see HANDOFF §7)
  const nm = path.join(app, 'node_modules');
  const ort = path.join(nm, 'onnxruntime-node', 'bin', 'napi-v6');
  for (const p of fs.readdirSync(ort)) {
    if (p !== plat) { rm(path.join(ort, p)); continue; }
    for (const a of fs.readdirSync(path.join(ort, p))) if (a !== cpu) rm(path.join(ort, p, a));
  }
  const img = path.join(nm, '@img');
  for (const n of fs.existsSync(img) ? fs.readdirSync(img) : []) {
    if (/^sharp(-libvips)?-(darwin|linux|linuxmusl|win32)-/.test(n) && !n.endsWith(`-${plat}-${cpu}`)) rm(path.join(img, n));
    if (n === 'sharp-wasm32') rm(path.join(img, n));
  }
  for (const d of ['adm-zip', 'global-agent', 'roarr', 'sprintf-js']) rm(path.join(nm, d));
  rm(path.join(nm, 'onnxruntime-node', 'script'));

  // 4. launchers + portable Node (Windows)
  if (plat === 'win32') {
    fs.writeFileSync(path.join(outDir, 'Start ImageUpscale.bat'), [
      '@echo off', 'title ImageUpscale', 'cd /d "%~dp0app"', 'echo Starting ImageUpscale. A browser tab will open.', 'echo Keep this window open while you use it. Close it to stop.', 'echo.',
      '"%~dp0node\\node.exe" server\\server.js --open', 'echo.', 'echo ImageUpscale stopped. If this was not on purpose, read the message above.', 'pause', ''].join('\r\n'));
    if (!flags.has('--no-node')) {
      const base = `https://nodejs.org/dist/${NODE_VERSION}`;
      const file = `node-${NODE_VERSION}-win-${cpu}.zip`;
      console.log(`downloading ${file}…`);
      const sums = (await get(`${base}/SHASUMS256.txt`)).toString('utf8');
      const want = (sums.split('\n').find((l) => l.trim().endsWith(file)) || '').split(/\s+/)[0];
      if (!want) throw new Error(`no checksum listed for ${file}`);
      const zip = await get(`${base}/${file}`);
      const have = crypto.createHash('sha256').update(zip).digest('hex');
      if (have !== want) throw new Error(`Node download failed its SHA-256 check (${have} vs ${want})`);
      const tmp = path.join(os.tmpdir(), `${file}`); fs.writeFileSync(tmp, zip);
      fs.mkdirSync(path.join(outDir, 'node'), { recursive: true });
      execFileSync('python3', ['-c', `import zipfile,sys;z=zipfile.ZipFile(sys.argv[1]);[open(sys.argv[2]+'/'+n.split('/')[-1],'wb').write(z.read(n)) for n in z.namelist() if n.split('/')[-1] in ('node.exe','LICENSE')]`, tmp, path.join(outDir, 'node')]);
      fs.rmSync(tmp);
      console.log(`Node ${NODE_VERSION} verified (sha256 ${have.slice(0, 12)}…) and added`);
    }
  } else {
    fs.writeFileSync(path.join(outDir, 'start.sh'), '#!/usr/bin/env bash\ncd "$(dirname "$0")/app" && node server/server.js --open\n', { mode: 0o755 });
  }
  fs.writeFileSync(path.join(outDir, 'README.txt'), [
    'ImageUpscale (local server edition)', '', plat === 'win32' ? 'Double-click "Start ImageUpscale.bat". Your browser opens to the app.' : 'Run ./start.sh (needs Node 22 or newer). Your browser opens to the app.',
    '', 'Everything runs on this computer. The server only accepts connections from this computer (127.0.0.1).',
    'Nothing is uploaded. The only download is the optional Quality model (64 MB) from huggingface.co.',
    'If a firewall asks about "Node.js" or "node.exe", it is safe to choose Cancel / Block: it only needs to talk to your own browser.',
    'To stop: close the black window (or press Ctrl+C).', 'Not code-signed, so Windows SmartScreen may warn about the .bat the first time: More info, Run anyway.',
    'Port 4317 busy? Open a Command Prompt here and run: set PORT=4400 && "Start ImageUpscale.bat"', ''].join(plat === 'win32' ? '\r\n' : '\n'));

  // 5. zip
  if (!flags.has('--no-zip')) {
    const zipPath = path.join(root, 'release', `${name}.zip`); rm(zipPath);
    execFileSync('python3', ['-c', `
import zipfile, os, sys
src, out = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as z:
    for d, _, fs_ in os.walk(src):
        for f in fs_:
            p = os.path.join(d, f); z.write(p, os.path.join(os.path.basename(src), os.path.relpath(p, src)))
`, outDir, zipPath]);
    console.log(`wrote ${zipPath} (${(fs.statSync(zipPath).size / 1048576).toFixed(0)} MB)`);
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
