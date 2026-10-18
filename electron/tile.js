'use strict';
// Pure tiling and blending math. No Electron, no ONNX, so it is unit testable.

// Split a width x height image into tiles of at most `size` px that overlap by `overlap` px.
// Returns [{ x, y, w, h }] in source pixels, covering every pixel at least once.
function planTiles(width, height, size = 192, overlap = 16) {
  if (size <= overlap * 2) throw new Error('tile size must be larger than twice the overlap');
  const step = size - overlap;
  const axis = (len) => {
    if (len <= size) return [{ start: 0, len }];
    const out = [];
    for (let s = 0; ; s += step) {
      if (s + size >= len) {
        out.push({ start: len - size, len: size });
        break;
      }
      out.push({ start: s, len: size });
    }
    return out;
  };
  const xs = axis(width);
  const ys = axis(height);
  const tiles = [];
  for (const y of ys) for (const x of xs) tiles.push({ x: x.start, y: y.start, w: x.len, h: y.len });
  return tiles;
}

// Feather weight for position i of n pixels along one axis. Ramps over `ramp` px at each
// side that touches a neighbour; image borders stay at full weight.
function edgeWeight(i, n, ramp, atStart, atEnd) {
  let w = 1;
  if (!atStart && i < ramp) w = Math.min(w, (i + 0.5) / ramp);
  if (!atEnd && n - 1 - i < ramp) w = Math.min(w, (n - 1 - i + 0.5) / ramp);
  return w;
}

// Accumulates upscaled tiles (CHW float arrays, 0..1) into one output image with feathered seams.
class Blender {
  constructor(width, height, scale, overlap) {
    this.W = width * scale;
    this.H = height * scale;
    this.scale = scale;
    this.ramp = overlap * scale;
    this.acc = new Float32Array(3 * this.W * this.H);
    this.wsum = new Float32Array(this.W * this.H);
    this.srcW = width;
    this.srcH = height;
  }

  // tile: source rect {x,y,w,h}; data: Float32Array of 3 * (h*scale) * (w*scale), planar RGB.
  add(tile, data) {
    const s = this.scale;
    const tw = tile.w * s;
    const th = tile.h * s;
    const ox = tile.x * s;
    const oy = tile.y * s;
    const atL = tile.x === 0;
    const atR = tile.x + tile.w >= this.srcW;
    const atT = tile.y === 0;
    const atB = tile.y + tile.h >= this.srcH;
    for (let y = 0; y < th; y++) {
      const wy = edgeWeight(y, th, this.ramp, atT, atB);
      for (let x = 0; x < tw; x++) {
        const w = wy * edgeWeight(x, tw, this.ramp, atL, atR);
        const di = (oy + y) * this.W + (ox + x);
        this.wsum[di] += w;
        for (let c = 0; c < 3; c++) {
          this.acc[c * this.W * this.H + di] += data[c * tw * th + y * tw + x] * w;
        }
      }
    }
  }

  // Returns interleaved RGB Uint8ClampedArray, ready for sharp / canvas.
  finish() {
    const n = this.W * this.H;
    const out = new Uint8ClampedArray(n * 3);
    for (let i = 0; i < n; i++) {
      const w = this.wsum[i] || 1;
      for (let c = 0; c < 3; c++) out[i * 3 + c] = Math.round((this.acc[c * n + i] / w) * 255);
    }
    return out;
  }
}

module.exports = { planTiles, edgeWeight, Blender };
