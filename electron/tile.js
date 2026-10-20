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


// Same maths as Blender, but memory stays at one tile row. Tiles must be added in planTiles() order
// (row by row). Once a tile row is done, every output row above the next tile row's start can no longer
// change, so those rows are converted and handed to `sink(rows, startRow, count)` (interleaved RGB bytes,
// ascending) and dropped. This lifts the output size limit from RAM to disk.
class StripBlender {
  constructor(width, height, scale, overlap, tileSize, sink) {
    this.W = width * scale;
    this.H = height * scale;
    this.scale = scale;
    this.ramp = overlap * scale;
    this.srcW = width;
    this.srcH = height;
    this.sink = sink;
    this.cap = tileSize * scale; // output rows one tile row can span
    this.acc = new Float32Array(3 * this.W * this.cap);
    this.wsum = new Float32Array(this.W * this.cap);
    this.base = 0; // first output row still held in the buffer
    this.rowY = null; // source y of the tile row being filled
  }

  add(tile, data) {
    if (this.rowY !== null && tile.y !== this.rowY) this._endRow(tile.y);
    this.rowY = tile.y;
    const s = this.scale;
    const tw = tile.w * s;
    const th = tile.h * s;
    const ox = tile.x * s;
    const oy = tile.y * s - this.base;
    if (oy < 0 || oy + th > this.cap) throw new Error('tiles added out of order');
    const atL = tile.x === 0;
    const atR = tile.x + tile.w >= this.srcW;
    const atT = tile.y === 0;
    const atB = tile.y + tile.h >= this.srcH;
    const plane = this.W * this.cap;
    for (let y = 0; y < th; y++) {
      const wy = edgeWeight(y, th, this.ramp, atT, atB);
      for (let x = 0; x < tw; x++) {
        const w = wy * edgeWeight(x, tw, this.ramp, atL, atR);
        const di = (oy + y) * this.W + (ox + x);
        this.wsum[di] += w;
        for (let c = 0; c < 3; c++) this.acc[c * plane + di] += data[c * tw * th + y * tw + x] * w;
      }
    }
    this.lastEnd = tile.y * s + th; // output row just past the last tile of this row
  }

  // Rows below `limit` (absolute output row) are final: emit them and slide the rest to the top.
  _flush(limit) {
    const count = limit - this.base;
    if (count <= 0) return;
    const plane = this.W * this.cap;
    const out = new Uint8ClampedArray(count * this.W * 3);
    for (let r = 0; r < count; r++) {
      for (let x = 0; x < this.W; x++) {
        const i = r * this.W + x;
        const w = this.wsum[i] || 1;
        const o = i * 3;
        for (let c = 0; c < 3; c++) out[o + c] = Math.round((this.acc[c * plane + i] / w) * 255);
      }
    }
    this.sink(out, this.base, count);
    const keep = this.lastEnd - limit; // rows still needed by the next tile row
    for (let c = 0; c < 3; c++) {
      this.acc.copyWithin(c * plane, c * plane + count * this.W, c * plane + (count + keep) * this.W);
      this.acc.fill(0, c * plane + keep * this.W, (c + 1) * plane);
    }
    this.wsum.copyWithin(0, count * this.W, (count + keep) * this.W);
    this.wsum.fill(0, keep * this.W);
    this.base = limit;
  }

  _endRow(nextY) { this._flush(nextY * this.scale); }

  finish() { this._flush(this.H); }
}

// Halves a planar CHW float image (3 x h x w, w and h even) by averaging 2x2 blocks.
function boxDown2(data, w, h) {
  const ow = w >> 1;
  const oh = h >> 1;
  const out = new Float32Array(3 * ow * oh);
  for (let c = 0; c < 3; c++) {
    const plane = c * w * h;
    const oplane = c * ow * oh;
    for (let y = 0; y < oh; y++) {
      for (let x = 0; x < ow; x++) {
        const i = plane + 2 * y * w + 2 * x;
        out[oplane + y * ow + x] = (data[i] + data[i + 1] + data[i + w] + data[i + w + 1]) / 4;
      }
    }
  }
  return out;
}

module.exports = { planTiles, edgeWeight, Blender, StripBlender, boxDown2 };
