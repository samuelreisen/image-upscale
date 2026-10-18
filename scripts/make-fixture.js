'use strict';
// Regenerates tests/fixtures/scene.png: a 320x240 synthetic scene (gradient sky, shapes, text, fine lines).
const sharp = require('sharp');
const path = require('path');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240">
  <defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2b6cb0"/><stop offset="1" stop-color="#f6ad55"/></linearGradient></defs>
  <rect width="320" height="240" fill="url(#sky)"/>
  <circle cx="240" cy="70" r="34" fill="#fff5c2"/>
  <polygon points="0,240 90,120 170,200 230,140 320,240" fill="#2f4f3a"/>
  <rect x="40" y="150" width="70" height="60" fill="#8b3a3a"/><polygon points="34,150 75,115 116,150" fill="#4a2020"/>
  <rect x="64" y="178" width="22" height="32" fill="#f2e2b0"/>
  <g stroke="#111" stroke-width="1">${Array.from({ length: 16 }, (_, i) => `<line x1="${150 + i * 5}" y1="170" x2="${150 + i * 5}" y2="225"/>`).join('')}</g>
  <text x="14" y="34" font-family="DejaVu Sans, Arial, sans-serif" font-size="22" font-weight="700" fill="#fff">Upscale test</text>
  <text x="14" y="56" font-family="DejaVu Sans, Arial, sans-serif" font-size="11" fill="#fff">fine detail 0123456789</text>
</svg>`;
sharp(Buffer.from(svg)).png().toFile(path.join(__dirname, '..', 'tests', 'fixtures', 'scene.png'))
  .then((i) => console.log('wrote tests/fixtures/scene.png', i.width + 'x' + i.height));
