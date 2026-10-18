'use strict';
// Usage: node scripts/make-icons.js [path/to/your-1024-logo.png]
// With an argument, that PNG becomes build/icon.png. Without one, a PLACEHOLDER is drawn
// (two nested squares, small one sharpened into a grid) if build/icon.png is missing.
// Always outputs build/icon.png (1024), build/icon.icns (Mac), build/icon.ico (Windows).
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const png2icons = require('png2icons');

const buildDir = path.join(__dirname, '..', 'build');
const pngPath = path.join(buildDir, 'icon.png');

(async () => {
  fs.mkdirSync(buildDir, { recursive: true });
  const supplied = process.argv[2];
  if (supplied) {
    await sharp(supplied).resize(1024, 1024, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toFile(pngPath);
  } else if (!fs.existsSync(pngPath)) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3a8dff"/><stop offset="1" stop-color="#5e5ce6"/></linearGradient></defs>
      <rect x="64" y="64" width="896" height="896" rx="200" fill="url(#g)"/>
      <rect x="236" y="560" width="228" height="228" rx="36" fill="#fff" fill-opacity="0.55"/>
      <rect x="312" y="236" width="476" height="476" rx="56" fill="#fff"/>
      <path d="M560 612V412M560 412l-72 72M560 412l72 72" fill="none" stroke="#3a8dff" stroke-width="44" stroke-linecap="round" stroke-linejoin="round" transform="rotate(45 560 512)"/>
    </svg>`;
    await sharp(Buffer.from(svg)).png().toFile(pngPath);
    console.log('No icon supplied: drew a PLACEHOLDER. Replace build/icon.png (or pass a logo) and re-run.');
  }
  const input = fs.readFileSync(pngPath);
  const icns = png2icons.createICNS(input, png2icons.BILINEAR, 0);
  const ico = png2icons.createICO(input, png2icons.BILINEAR, 0, false, true);
  if (!icns || !ico) throw new Error('Icon conversion failed. Is build/icon.png a square PNG of at least 512px?');
  fs.writeFileSync(path.join(buildDir, 'icon.icns'), icns);
  fs.writeFileSync(path.join(buildDir, 'icon.ico'), ico);
  console.log('Wrote build/icon.png, build/icon.icns, build/icon.ico');
})().catch((e) => { console.error(e); process.exit(1); });
