'use strict';
// Tiled Real-ESRGAN inference with onnxruntime-node. Runs in the main process.
const fs = require('fs');
const sharp = require('sharp');
const { planTiles, Blender, boxDown2 } = require('./tile');

const TILE = 192;
const OVERLAP = 16;
// Blender holds 3 float planes + a weight plane: 16 bytes per output pixel.
const MAX_OUTPUT_PIXELS = 64e6;

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
  // Returns interleaved Uint8ClampedArray RGB of (width*scale) x (height*scale).
  async upscaleRgb(rgb, width, height, { scale = 4, onProgress, signal } = {}) {
    if (scale !== 2 && scale !== 4) throw new Error('Scale must be 2x or 4x.');
    if (width * scale * height * scale > MAX_OUTPUT_PIXELS) {
      const mp = Math.floor(MAX_OUTPUT_PIXELS / 1e6 / (scale * scale));
      throw new Error(`This image is too large for ${scale}x on this app (limit about ${mp} megapixels input). Crop or shrink it first.`);
    }
    const tiles = planTiles(width, height, TILE, OVERLAP);
    const blender = new Blender(width, height, scale, OVERLAP);
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
    return blender.finish();
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

// Full pipeline: file in, PNG file out. Returns { outPath, width, height, provider, ms }.
async function upscaleFile(upscaler, inPath, outPath, { scale = 4, onProgress, signal } = {}) {
  const t0 = Date.now();
  const img = await decodeImage(inPath);
  const rgb = await upscaler.upscaleRgb(img.rgb, img.width, img.height, { scale, onProgress, signal });
  const W = img.width * scale;
  const H = img.height * scale;
  let pipeline = sharp(Buffer.from(rgb.buffer, rgb.byteOffset, rgb.byteLength), { raw: { width: W, height: H, channels: 3 } });
  if (img.alpha) {
    const a = await sharp(img.alpha, { raw: { width: img.width, height: img.height, channels: 1 } })
      .resize(W, H, { kernel: 'lanczos3' }).raw().toBuffer();
    pipeline = pipeline.joinChannel(a, { raw: { width: W, height: H, channels: 1 } });
  }
  await pipeline.png({ compressionLevel: 3 }).toFile(outPath);
  return { outPath, width: W, height: H, provider: upscaler.provider, ms: Date.now() - t0 };
}

// Re-encode a finished PNG into the chosen format.
async function exportImage(pngPath, outPath, format, quality = 92) {
  const img = sharp(pngPath);
  if (format === 'png') await img.png({ compressionLevel: 6 }).toFile(outPath);
  else if (format === 'jpeg') await img.flatten({ background: '#ffffff' }).jpeg({ quality, mozjpeg: true }).toFile(outPath);
  else if (format === 'webp') await img.webp({ quality }).toFile(outPath);
  else throw new Error(`Unknown format "${format}".`);
  return outPath;
}

module.exports = { Upscaler, upscaleFile, exportImage, decodeImage, TILE, OVERLAP, MAX_OUTPUT_PIXELS, PROVIDER_LABEL };
