'use strict';
// electron-builder afterPack hook: drop native binaries for every OS/arch except the one being packed.
// Without this each installer carries ~290 MB of onnxruntime files for platforms it can never run on.
const fs = require('fs');
const path = require('path');

const ARCH = { 1: 'x64', 3: 'arm64' }; // builder-util Arch enum

function rm(p) { if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true }); }

exports.default = async function afterPack(ctx) {
  const platform = ctx.electronPlatformName; // win32 | darwin | linux
  const arch = ARCH[ctx.arch];
  if (!arch) throw new Error(`afterPack: unexpected arch ${ctx.arch}`);
  const resources = platform === 'darwin'
    ? path.join(ctx.appOutDir, `${ctx.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
    : path.join(ctx.appOutDir, 'resources');
  const nm = path.join(resources, 'app.asar.unpacked', 'node_modules');

  // onnxruntime-node/bin/napi-v6/<platform>/<arch>
  const ort = path.join(nm, 'onnxruntime-node', 'bin', 'napi-v6');
  if (fs.existsSync(ort)) {
    for (const p of fs.readdirSync(ort)) {
      if (p !== platform) { rm(path.join(ort, p)); continue; }
      for (const a of fs.readdirSync(path.join(ort, p))) if (a !== arch) rm(path.join(ort, p, a));
    }
  }
  // @img/sharp-<os>-<arch> and @img/sharp-libvips-<os>-<arch>
  const img = path.join(nm, '@img');
  if (fs.existsSync(img)) {
    const keep = (n) => !/^sharp(-libvips)?-(darwin|linux|linuxmusl|win32)-/.test(n) || n.endsWith(`-${platform}-${arch}`);
    for (const n of fs.readdirSync(img)) if (!keep(n)) rm(path.join(img, n));
  }
  console.log(`  • afterPack  pruned native binaries to ${platform}/${arch}`);
};
