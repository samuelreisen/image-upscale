'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { planTiles, Blender } = require('../electron/tile');

test('tiles cover every pixel and stay in bounds', () => {
  for (const [w, h] of [[100, 80], [192, 192], [193, 500], [1000, 37]]) {
    const seen = new Uint8Array(w * h);
    for (const t of planTiles(w, h, 192, 16)) {
      assert.ok(t.x >= 0 && t.y >= 0 && t.x + t.w <= w && t.y + t.h <= h, `bounds ${w}x${h}`);
      for (let y = t.y; y < t.y + t.h; y++) for (let x = t.x; x < t.x + t.w; x++) seen[y * w + x] = 1;
    }
    assert.equal(seen.reduce((a, b) => a + b, 0), w * h, `coverage ${w}x${h}`);
  }
});

test('small image is a single tile', () => {
  assert.deepEqual(planTiles(50, 40), [{ x: 0, y: 0, w: 50, h: 40 }]);
});

test('rejects overlap that swallows the tile', () => {
  assert.throws(() => planTiles(500, 500, 32, 16));
});

test('blending identical tiles of a gradient leaves no seams', () => {
  const W = 300, H = 200, S = 2;
  const b = new Blender(W, H, S, 16);
  const val = (X, Y, c) => ((X / (W * S)) * 0.5 + (Y / (H * S)) * 0.3 + c * 0.05);
  for (const t of planTiles(W, H, 192, 16)) {
    const tw = t.w * S, th = t.h * S, d = new Float32Array(3 * tw * th);
    for (let c = 0; c < 3; c++)
      for (let y = 0; y < th; y++)
        for (let x = 0; x < tw; x++) d[c * tw * th + y * tw + x] = val(t.x * S + x, t.y * S + y, c);
    b.add(t, d);
  }
  const out = b.finish();
  let maxErr = 0;
  for (let Y = 0; Y < H * S; Y++)
    for (let X = 0; X < W * S; X++)
      for (let c = 0; c < 3; c++)
        maxErr = Math.max(maxErr, Math.abs(out[(Y * W * S + X) * 3 + c] - Math.round(val(X, Y, c) * 255)));
  assert.ok(maxErr <= 1, `max error ${maxErr}`);
});

test('boxDown2 averages 2x2 blocks per channel', () => {
  const { boxDown2 } = require('../electron/tile');
  const w = 4, h = 2, d = new Float32Array(3 * w * h);
  for (let c = 0; c < 3; c++) for (let i = 0; i < w * h; i++) d[c * w * h + i] = c + (i % 2);
  const o = boxDown2(d, w, h);
  assert.equal(o.length, 3 * 2 * 1);
  assert.deepEqual(Array.from(o), [0.5, 0.5, 1.5, 1.5, 2.5, 2.5]);
});

test('model verification accepts the exact file and rejects a changed byte', async () => {
  const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
  const { isVerified } = require('../electron/models');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'upscl-m-'));
  const data = Buffer.from('pretend model bytes');
  const model = { size: data.length, sha256: crypto.createHash('sha256').update(data).digest('hex') };
  const f = path.join(dir, 'm.onnx');
  fs.writeFileSync(f, data);
  assert.equal(await isVerified(model, f), true);
  data[3] ^= 1; fs.writeFileSync(f, data);
  assert.equal(await isVerified(model, f), false);
  assert.equal(await isVerified(model, path.join(dir, 'missing.onnx')), false);
});

test('StripBlender output is byte-identical to Blender while holding one tile row', () => {
  const { StripBlender } = require('../electron/tile');
  for (const [W, H, S] of [[300, 200, 2], [193, 500, 4], [100, 80, 2], [420, 450, 2]]) {
    const ref = new Blender(W, H, S, 16);
    const got = new Uint8ClampedArray(W * S * H * S * 3);
    let nextRow = 0;
    const strip = new StripBlender(W, H, S, 16, 192, (rows, start, count) => {
      assert.equal(start, nextRow, 'rows arrive in order with no gaps');
      got.set(rows, start * W * S * 3);
      nextRow += count;
    });
    let seed = 7;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (const t of planTiles(W, H, 192, 16)) {
      const tw = t.w * S, th = t.h * S, d = new Float32Array(3 * tw * th);
      for (let i = 0; i < d.length; i++) d[i] = rnd(); // noisy on purpose: any mis-weighted overlap shows
      ref.add(t, d);
      strip.add(t, d);
    }
    strip.finish();
    assert.equal(nextRow, H * S, `all rows emitted for ${W}x${H}`);
    assert.deepEqual(Buffer.from(got), Buffer.from(ref.finish()), `identical for ${W}x${H} x${S}`);
  }
});
