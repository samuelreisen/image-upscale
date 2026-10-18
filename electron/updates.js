'use strict';
// Local update files (.upscl). Reuses the exact packer/installer code the build uses, so the
// format can never drift. Installs go to userData/updates, never into the read-only app bundle.
const fs = require('fs');
const path = require('path');
const mp = require('../scripts/markpack');
const { installMark, listInstalled } = require('../scripts/install-mark');

function readMarkJson(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'mark.json'), 'utf8')); } catch { return null; }
}

// bundledDir: folder holding the shipped mark.json / HANDOFF.md / renderer. updatesDir: writable install target.
function createUpdates({ bundledDir, updatesDir, shellVersion }) {
  const cfg = mp.loadConfig();

  // Keep a readable HANDOFF.md in the writable area. Newer-wins, so an installed newer one is never replaced.
  function seedHandoff() {
    try {
      const bundled = fs.readFileSync(path.join(bundledDir, 'HANDOFF.md'));
      mp.syncHandoff(bundled, updatesDir, { label: 'bundled' });
    } catch { /* no bundled handoff, nothing to seed */ }
  }

  function currentMark() {
    const a = readMarkJson(bundledDir);
    const b = readMarkJson(updatesDir);
    const best = [a, b].filter(Boolean).sort((x, y) => y.mark - x.mark)[0];
    return best ? { mark: best.mark, name: mp.markName(best.mark), title: best.title } : null;
  }

  // Renderer folder to load: an installed mark's renderer only when it is newer than the bundled one.
  function rendererDir() {
    const bundled = path.join(bundledDir, 'renderer');
    const inst = readMarkJson(updatesDir);
    const base = readMarkJson(bundledDir);
    const installedIndex = path.join(updatesDir, 'renderer', 'index.html');
    if (inst && fs.existsSync(installedIndex) && (!base || inst.mark > base.mark)) return path.join(updatesDir, 'renderer');
    return bundled;
  }

  function install(file) {
    const r = installMark(fs.readFileSync(file), updatesDir, { shellVersion, config: cfg });
    return r;
  }

  function list() {
    const cur = readMarkJson(updatesDir);
    return listInstalled(updatesDir, cfg).map((i) => ({ ...i, active: !!cur && cur.mark === i.mark }));
  }

  function switchTo(markNumber) {
    const hit = listInstalled(updatesDir, cfg).find((i) => i.mark === markNumber);
    if (!hit) throw new Error('That update file is no longer stored. Install it again from the .upscl file.');
    return installMark(fs.readFileSync(hit.file), updatesDir, { shellVersion, config: cfg, store: false });
  }

  function handoffPath() {
    seedHandoff();
    return path.join(updatesDir, 'HANDOFF.md');
  }

  return { seedHandoff, currentMark, rendererDir, install, list, switchTo, handoffPath, ext: cfg.ext };
}

// Friendly text for the three refusals the installer can raise.
function explain(e) {
  if (e.code === 'NOT_A_MARK') return 'That file is not an ImageUpscale update file.';
  if (e.code === 'DAMAGED') return 'That update file is damaged or was changed after it was made. Get a fresh copy and try again.';
  if (e.code === 'TOO_NEW') return `${e.message}. Install the newest ImageUpscale first.`;
  return e.message;
}

module.exports = { createUpdates, explain };
