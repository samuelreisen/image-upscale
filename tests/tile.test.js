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
