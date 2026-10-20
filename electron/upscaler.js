'use strict';
// Tiled Real-ESRGAN inference with onnxruntime-node. Runs in the main process.
const fs = require('fs');
const sharp = require('sharp');
const os = require('os');
const path = require('path');
const { pipeline } = require('stream/promises');
const { planTiles, StripBlender, boxDown2 } = require('./tile');

const TILE = 192;
const OVERLAP = 16;
// Rows are streamed to disk, so the limit is disk space (3 bytes per output pixel as a temp file) and
// libvips/PNG limits, not RAM. 256 MP is 16384 x 16384.
const MAX_OUTPUT_PIXELS = 256e6;

function lazyOrt() {
  return require('onnxruntime-node');
}

// Execution providers worth trying first on this OS. CPU is always the fallback.
function preferredProviders() {
  if (process.platform === 'win32') return ['dml'];
  if (process.platform === 'darwin') return ['coreml'];
  return [];
}

const PROVIDER_LABEL = { cpu: 'CPU', dml: 'DirectML (GPU)', coreml: 'CoreML' };

class Upscaler {
  constructor(modelPath) {
    this.modelPath = modelPath;
    this.session = null;
    this.provider = null; // 'cpu' | 'dml' | 'coreml'
  }

  async open(forceCpu = false) {
    const ort = lazyOrt();
    const candidates = forceCpu ? ['cpu'] : [...preferredProviders(), 'cpu'];
    let lastErr;
    for (const ep of candidates) {
      try {
        const opts = { executionProviders: [ep], graphOptimizationLevel: 'all' };
        if (ep === 'dml') { opts.enableMemPattern = false; opts.executionMode = 'sequential'; }
        this.session = await ort.InferenceSession.create(this.modelPath, opts);
        this.provider = ep;
        return this;
      } catch (e) {
        lastErr = e;
      }
    }
    throw new Error(`Could not load the model: ${lastErr && lastErr.message}`);
  }

  get providerLabel() {
    return PROVIDER_LABEL[this.provider] || this.provider;
  }

  async runTile(chw, w, h) {
    const ort = lazyOrt();
    const feeds = { [this.session.inputNames[0]]: new ort.Tensor('float32', chw, [1, 3, h, w]) };
    const out = await this.session.run(feeds);
    return out[this.session.outputNames[0]].data; // Float32Array, 3 x 4h x 4w
  }

  // rgb: interleaved Uint8 RGB, width x height. scale: 2 or 4.
  // With `sink(rows, startRow, count)` finished output rows (interleaved RGB bytes) are streamed to it in order
  // and nothing large is kept. Without a sink the whole result is returned as a Uint8ClampedArray (small images, tests).
  async upscaleRgb(rgb, width, height, { scale = 4, onProgress, signal } = {}, sink = null) {
    if (scale !== 2 && scale !== 4) throw new Error('Scale must be 2x or 4x.');
    if (width * scale * height * scale > MAX_OUTPUT_PIXELS) {
      const mp = Math.floor(MAX_OUTPUT_PIXELS / 1e6 / (scale * scale));
      throw new Error(`This image is too large for ${scale}x on this app (limit about ${mp} megapixels input). Crop or shrink it first.`);
    }
    const tiles = planTiles(width, height, TILE, OVERLAP);
    let whole = null;
    if (!sink) {
      whole = new Uint8ClampedArray(width * scale * height * scale * 3);
      sink = (rows, start) => whole.set(rows, start * width * scale * 3);
    }
    const blender = new StripBlender(width, height, scale, OVERLAP, TILE, sink);
    let done = 0;
    for (const t of tiles) {
      if (signal && signal.aborted) throw Object.assign(new Error('Cancelled.'), { name: 'AbortError' });
      const chw = new Float32Array(3 * t.w * t.h);
      for (let y = 0; y < t.h; y++) {
        for (let x = 0; x < t.w; x++) {
          const si = ((t.y + y) * width + (t.x + x)) * 3;
          const di = y * t.w + x;
          chw[di] = rgb[si] / 255;
          chw[t.w * t.h + di] = rgb[si + 1] / 255;
          chw[2 * t.w * t.h + di] = rgb[si + 2] / 255;
        }
      }
      let out;
      try {
        out = await this.runTile(chw, t.w, t.h);
      } catch (e) {
        if (this.provider === 'cpu') throw e;
        await this.open(true); // GPU path failed at run time, retry once on CPU
        out = await this.runTile(chw, t.w, t.h);
      }
      blender.add(t, scale === 4 ? out : boxDown2(out, t.w * 4, t.h * 4));
      done++;
      if (onProgress) onProgress(done, tiles.length);
    }
    blender.finish();
    return whole;
  }
}

// Decode any sharp-readable file (EXIF-rotated). Keeps alpha apart so it can be resized separately.
async function decodeImage(file) {
  const base = sharp(file, { failOn: 'none' }).rotate();
  const meta = await base.metadata();
  const hasAlpha = !!meta.hasAlpha;
  const { data, info } = await base.clone().removeAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true });
  let alpha = null;
  if (hasAlpha) alpha = await base.clone().extractChannel('alpha').raw().toBuffer();
  return { rgb: data, alpha, width: info.width, height: info.height };
}

// Full pipeline: file in, PNG file out. Output rows go to a temp raw file as they finish, then sharp
// encodes the PNG from that stream, so memory does not grow with the output size.
// Returns { outPath, width, height, provider, ms }.
async function upscaleFile(upscaler, inPath, outPath, { scale = 4, onProgress, signal } = {}) {
  const t0 = Date.now();
  const img = await decodeImage(inPath);
  const W = img.width * scale;
  const H = img.height * scale;
  const rawPath = path.join(os.tmpdir(), `upscl-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.raw`);
  const fd = fs.openSync(rawPath, 'w');
  try {
    await upscaler.upscaleRgb(img.rgb, img.width, img.height, { scale, onProgress, signal },
      (rows) => { fs.writeSync(fd, rows); });
    fs.closeSync(fd);
    let enc = sharp({ raw: { width: W, height: H, channels: 3 }, limitInputPixels: false });
    if (img.alpha) {
      const a = await sharp(img.alpha, { raw: { width: img.width, height: img.height, channels: 1 } })
        .resize(W, H, { kernel: 'lanczos3' }).raw().toBuffer();
      enc = enc.joinChannel(a, { raw: { width: W, height: H, channels: 1 } });
    }
    await pipeline(fs.createReadStream(rawPath), enc.png({ compressionLevel: 3 }), fs.createWriteStream(outPath));
  } catch (e) {
    try { fs.closeSync(fd); } catch { /* already closed */ }
    fs.rmSync(outPath, { force: true });
    throw e;
  } finally {
    fs.rmSync(rawPath, { force: true });
  }
  return { outPath, width: W, height: H, provider: upscaler.provider, ms: Date.now() - t0 };
}

// Re-encode a finished PNG into the chosen format.
async function exportImage(pngPath, outPath, format, quality = 92) {
  const img = sharp(pngPath, { limitInputPixels: false });
  const { width, height } = await img.metadata();
  if (format === 'webp' && Math.max(width, height) > 16383) {
    throw new Error(`WebP cannot hold ${width} × ${height} px (limit is 16383 on each side). Save as PNG or JPEG instead.`);
  }
  if (format === 'jpeg' && Math.max(width, height) > 65535) {
    throw new Error(`JPEG cannot hold ${width} × ${height} px. Save as PNG instead.`);
  }
  if (format === 'png') await img.png({ compressionLevel: 6 }).toFile(outPath);
  else if (format === 'jpeg') await img.flatten({ background: '#ffffff' }).jpeg({ quality, mozjpeg: true }).toFile(outPath);
  else if (format === 'webp') await img.webp({ quality }).toFile(outPath);
  else throw new Error(`Unknown format "${format}".`);
  return outPath;
}

module.exports = { Upscaler, upscaleFile, exportImage, decodeImage, TILE, OVERLAP, MAX_OUTPUT_PIXELS, PROVIDER_LABEL };
