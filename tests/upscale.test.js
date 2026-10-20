'use strict';
// End-to-end: real model, real tiles. Skipped when models/fast.onnx has not been fetched.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { Upscaler, upscaleFile } = require('../electron/upscaler');

const model = path.join(__dirname, '..', 'models', 'fast.onnx');
const fixture = path.join(__dirname, 'fixtures', 'scene.png');
const skip = fs.existsSync(model) ? false : 'run `npm run models` first';

function psnr(a, b) {
  let se = 0;
  for (let i = 0; i < a.length; i++) se += (a[i] - b[i]) ** 2;
  return 10 * Math.log10((255 * 255) / (se / a.length));
}

for (const scale of [4, 2]) {
  test(`fast model ${scale}x gives right size and a sane picture`, { skip }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upscl-test-'));
    const out = path.join(dir, `out${scale}.png`);
    const up = await new Upscaler(model).open(true);
    let ticks = 0;
    const r = await upscaleFile(up, fixture, out, { scale, onProgress: () => ticks++ });
    assert.equal(r.width, 320 * scale);
    assert.equal(r.height, 240 * scale);
    assert.ok(ticks >= 4, 'multiple tiles were processed');
    const meta = await sharp(out).metadata();
    assert.equal(meta.width, 320 * scale);
    // Compared with a plain Lanczos upscale the result should be close (same picture) but not identical.
    const mine = await sharp(out).removeAlpha().raw().toBuffer();
    const ref = await sharp(fixture).resize(320 * scale, 240 * scale, { kernel: 'lanczos3' }).removeAlpha().raw().toBuffer();
    const p = psnr(mine, ref);
    console.log(`    ${scale}x: ${r.width}x${r.height}, ${r.ms} ms, ${ticks} tiles, PSNR vs Lanczos ${p.toFixed(1)} dB`);
    assert.ok(p > 22 && p < 60, `PSNR ${p}`);
    fs.copyFileSync(out, path.join(process.env.UPSCL_TEST_KEEP || dir, `kept-${scale}x.png`));
  });
}

test('cancel stops between tiles', { skip }, async () => {
  const up = await new Upscaler(model).open(true);
  const ac = new AbortController();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upscl-test-'));
  await assert.rejects(
    upscaleFile(up, fixture, path.join(dir, 'x.png'), { scale: 4, signal: ac.signal, onProgress: () => ac.abort() }),
    { name: 'AbortError' },
  );
});

test('refuses images that would exhaust memory', { skip }, async () => {
  const up = await new Upscaler(model).open(true);
  await assert.rejects(up.upscaleRgb(Buffer.alloc(3), 9000, 9000, { scale: 4 }), /too large/);
});

test('animated GIF: detected as multi-frame, only the first frame is upscaled', { skip }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upscl-gif-'));
  const gif = path.join(dir, 'anim.gif');
  const w = 40, h = 30;
  const frames = Buffer.concat([Buffer.alloc(w * h * 3, 40), Buffer.alloc(w * h * 3, 200)]);
  await sharp(frames, { raw: { width: w, height: h * 2, channels: 3, pageHeight: h } }).gif({ loop: 0, delay: [100, 100] }).toFile(gif);
  const meta = await sharp(gif).metadata();
  assert.equal(meta.pages, 2, 'fixture really is animated');
  const up = await new Upscaler(model).open(true);
  const out = path.join(dir, 'out.png');
  const r = await upscaleFile(up, gif, out, { scale: 2 });
  assert.equal(r.width, w * 2);
  assert.equal(r.height, h * 2, 'height is one frame, not the stacked frames');
});
