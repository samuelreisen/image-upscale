'use strict';
// Model registry, download, verify. No Electron imports, so scripts/fetch-models.js can reuse it.
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');

// Both files are pinned to an immutable Hugging Face commit and a SHA-256.
// Licence of both exports: BSD-3-Clause (Real-ESRGAN, xinntao). See README "Models".
const MODELS = {
  fast: {
    id: 'fast',
    label: 'Fast',
    detail: 'Real-ESRGAN general x4v3 (compact, 4.9 MB)',
    file: 'fast.onnx',
    bundled: true,
    size: 4866417,
    sha256: '1940a93ee08283a0a7286183186357b1688fe9fa8ede74604b424586aaddf112',
    url: 'https://huggingface.co/CoderViking/realesr-general-x4v3-onnx/resolve/c6a971706797c7502945a2b4c4274fce4900d4ab/realesr-general-x4v3.onnx',
  },
  quality: {
    id: 'quality',
    label: 'Quality',
    detail: 'Real-ESRGAN x4plus (64 MB download)',
    file: 'quality.onnx',
    bundled: false,
    size: 67051616,
    sha256: '5c586662929cbc686c1a5c38d9c060dbdb4ea5863a1f7672b8c0761e6b89c033',
    url: 'https://huggingface.co/SceneWorks/real-esrgan-onnx/resolve/09f741bac80a246b407da3ee902bf5f3291b602f/real_esrgan_x4.onnx',
  },
};

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file).on('data', (d) => h.update(d)).on('error', reject).on('end', () => resolve(h.digest('hex')));
  });
}

// GET with manual redirect following and optional Range. Resolves with the response stream.
function get(url, headers, signal, hops = 0) {
  return new Promise((resolve, reject) => {
    if (hops > 6) return reject(new Error('Too many redirects while downloading the model.'));
    const req = https.get(url, { headers }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(get(new URL(res.headers.location, url).toString(), headers, signal, hops + 1));
      }
      resolve(res);
    });
    req.on('error', reject);
    if (signal) {
      const abort = () => req.destroy(Object.assign(new Error('Download cancelled.'), { name: 'AbortError' }));
      if (signal.aborted) abort();
      else signal.addEventListener('abort', abort, { once: true });
    }
  });
}

// Downloads model.url into `${dest}.part` (resuming if a partial file exists), verifies
// size and SHA-256, then renames to dest. A bad hash deletes the partial file.
async function downloadModel(model, dest, { onProgress, signal } = {}) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const part = `${dest}.part`;
  for (let attempt = 0; attempt < 2; attempt++) {
    let have = fs.existsSync(part) ? fs.statSync(part).size : 0;
    if (have > model.size) { fs.rmSync(part); have = 0; }
    if (have < model.size) {
      const res = await get(model.url, have ? { Range: `bytes=${have}-` } : {}, signal);
      if (res.statusCode === 200 && have) { have = 0; fs.rmSync(part, { force: true }); } // server ignored Range
      else if (res.statusCode !== 200 && res.statusCode !== 206) {
        res.resume();
        throw new Error(`Model download failed (HTTP ${res.statusCode}). Check your connection and try again.`);
      }
      const out = fs.createWriteStream(part, { flags: have ? 'a' : 'w' });
      let got = have;
      res.on('data', (d) => { got += d.length; if (onProgress) onProgress(got, model.size); });
      try {
        // pipeline destroys both ends and waits for the file to close, so a later resume never races a stale writer
        await pipeline(res, out);
      } catch (e) {
        if (signal && signal.aborted) throw Object.assign(new Error('Download cancelled.'), { name: 'AbortError' });
        throw new Error('Connection dropped. Try again to resume the download.');
      }
    }
    if (fs.statSync(part).size !== model.size) {
      throw new Error('Download ended early. Try again to resume it.');
    }
    if ((await sha256File(part)) === model.sha256) {
      fs.renameSync(part, dest);
      return dest;
    }
    fs.rmSync(part, { force: true }); // corrupt: start over once
  }
  throw new Error('The downloaded model failed its integrity check twice. Try again later.');
}

async function isVerified(model, file) {
  try {
    if (fs.statSync(file).size !== model.size) return false;
    return (await sha256File(file)) === model.sha256;
  } catch { return false; }
}

module.exports = { MODELS, sha256File, downloadModel, isVerified };
