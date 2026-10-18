'use strict';
// Usage: node scripts/bench.js   (CPU only; prints seconds per megapixel of input, 4x)
const path = require('path');
const os = require('os');
const { Upscaler, decodeImage } = require('../electron/upscaler');

(async () => {
  const img = await decodeImage(path.join(__dirname, '..', 'tests', 'fixtures', 'scene.png'));
  const mp = (img.width * img.height) / 1e6;
  console.log(`${os.cpus()[0].model}, ${os.cpus().length} threads, input ${img.width}x${img.height} (${mp.toFixed(3)} MP)`);
  for (const id of ['fast', 'quality']) {
    const up = await new Upscaler(path.join(__dirname, '..', 'models', `${id}.onnx`)).open(true);
    await up.upscaleRgb(img.rgb, img.width, img.height, { scale: 4 }); // warm up
    const t = Date.now();
    await up.upscaleRgb(img.rgb, img.width, img.height, { scale: 4 });
    const s = (Date.now() - t) / 1000;
    console.log(`${id.padEnd(8)} ${s.toFixed(1)} s  =>  ${(s / mp).toFixed(1)} s per input megapixel`);
  }
})();
