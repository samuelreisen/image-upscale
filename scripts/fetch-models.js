'use strict';
// Usage: node scripts/fetch-models.js [fast|quality|all]
// Downloads into ./models (what electron-builder bundles for "fast"). Verifies SHA-256.
const path = require('path');
const { MODELS, downloadModel, isVerified } = require('../electron/models');

(async () => {
  const which = process.argv[2] || 'fast';
  const ids = which === 'all' ? Object.keys(MODELS) : [which];
  for (const id of ids) {
    const m = MODELS[id];
    if (!m) throw new Error(`Unknown model "${id}". Use fast, quality or all.`);
    const dest = path.join(__dirname, '..', 'models', m.file);
    if (await isVerified(m, dest)) { console.log(`${m.file}: already present and verified`); continue; }
    let last = 0;
    await downloadModel(m, dest, {
      onProgress: (got, total) => {
        const pct = Math.floor((got / total) * 100);
        if (pct >= last + 10) { last = pct; console.log(`${m.file}: ${pct}%`); }
      },
    });
    console.log(`${m.file}: downloaded, SHA-256 verified`);
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
