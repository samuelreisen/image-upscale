'use strict';
// Usage: node scripts/make-logo.js
// Writes branding/variants/*.svg, branding/showcase.html and a PNG contact sheet.
// The chosen mark is branding/logo.svg (flat mark) and branding/app-icon.svg (gradient tile used for build/icon.png).
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const out = path.join(__dirname, '..', 'branding');
const rect = (x, y, w, h, r, extra = '') => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" ${extra}/>`;

// All marks: viewBox 0 0 100 100, drawn in currentColor.
const variants = [
  {
    id: 'quad-zoom', name: 'Quad Zoom',
    why: 'One pixel becomes four: the exact thing a 2x upscale does. Three quiet quadrants at source resolution, one crisp subdivided quadrant as the single focal point. Asymmetric, mostly negative space.',
    svg: `<g fill="currentColor">${rect(18, 18, 29, 29, 7, 'opacity=".32"')}${rect(18, 53, 29, 29, 7, 'opacity=".32"')}${rect(53, 53, 29, 29, 7, 'opacity=".32"')}${rect(53, 18, 12.5, 12.5, 3.5)}${rect(69.5, 18, 12.5, 12.5, 3.5)}${rect(53, 34.5, 12.5, 12.5, 3.5)}${rect(69.5, 34.5, 12.5, 12.5, 3.5)}</g>`,
  },
  {
    id: 'stair-to-curve', name: 'Stair to Curve',
    why: 'A jagged pixel staircase on the left resolves into one smooth curve on the right: low resolution turning into detail. A single stroke, nothing else.',
    svg: `<path d="M16 72 H28 V60 H40 V48 H52 C62 48 66 40 70 34 C74 28 80 26 86 26" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="86" cy="26" r="5" fill="currentColor"/>`,
  },
  {
    id: 'resolution-ramp', name: 'Resolution Ramp',
    why: 'A diagonal run of squares that shrink and multiply toward the top right: pixel density rising. Reads as motion and as a halftone at once.',
    svg: `<g fill="currentColor">${rect(14, 58, 28, 28, 7)}${rect(50, 58, 12, 12, 3)}${rect(50, 74, 12, 12, 3)}${rect(66, 74, 12, 12, 3)}${rect(66, 58, 12, 12, 3)}${rect(50, 28, 6, 6, 1.5)}${rect(60, 28, 6, 6, 1.5)}${rect(70, 28, 6, 6, 1.5)}${rect(80, 28, 6, 6, 1.5)}${rect(50, 38, 6, 6, 1.5)}${rect(60, 38, 6, 6, 1.5)}${rect(70, 38, 6, 6, 1.5)}${rect(80, 38, 6, 6, 1.5)}</g>`,
  },
  {
    id: 'frame-grow', name: 'Frame Grow',
    why: 'A small solid square inside a larger open frame whose corner is cut away toward the top right: the picture growing out of its own frame.',
    svg: `<g fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"><path d="M64 18 H30 a12 12 0 0 0 -12 12 V70 a12 12 0 0 0 12 12 H70 a12 12 0 0 0 12 -12 V36"/></g><rect x="36" y="46" width="24" height="24" rx="6" fill="currentColor"/><path d="M62 38 L82 18 M68 18 H82 V32" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
  {
    id: 'aperture-sharpen', name: 'Aperture',
    why: 'A lens ring with a single sharp pixel at its centre. Focus and clarity; the centre square is the only hard edge in a round form.',
    svg: `<circle cx="50" cy="50" r="30" fill="none" stroke="currentColor" stroke-width="5"/><path d="M50 14 A36 36 0 0 1 86 50" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" opacity=".35"/><rect x="40" y="40" width="20" height="20" rx="5" fill="currentColor"/>`,
  },
  {
    id: 'nested-up', name: 'Nested Up',
    why: 'Two rounded squares offset along the diagonal, the larger one carrying the smaller: 2x as a nesting. Solid over ghost for hierarchy.',
    svg: `${rect(16, 40, 44, 44, 10, 'fill="currentColor" opacity=".3"')}${rect(36, 16, 48, 48, 11, 'fill="currentColor"')}<path d="M52 48 L68 32 M56 32 H68 V44" fill="none" stroke="#fff" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round" class="knock"/>`,
  },
  {
    id: 'dot-matrix', name: 'Dot Matrix',
    why: 'A 3x3 dot grid where each dot is slightly larger toward the bottom left and the top right dot is ringed: a sampling grid being refined.',
    svg: `<g fill="currentColor">${[0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => `<circle cx="${28 + c * 22}" cy="${28 + r * 22}" r="${[4, 5, 6][2 - r] * (c === 2 && r === 0 ? 0 : 1)}"/>`)).join('')}</g><circle cx="72" cy="28" r="9" fill="none" stroke="currentColor" stroke-width="4"/><circle cx="72" cy="28" r="3.5" fill="currentColor"/>`,
  },
  {
    id: 'split-diagonal', name: 'Split Diagonal',
    why: 'A square cut on the diagonal: the lower left half is a coarse 3x3 pixel block, the upper right half is solid and smooth. Before and after in one shape.',
    svg: `<path d="M82 18 V82 H18 Z" fill="currentColor"/><g fill="currentColor">${rect(18, 18, 14, 14, 3)}${rect(35, 18, 14, 14, 3, 'opacity=".55"')}${rect(18, 35, 14, 14, 3, 'opacity=".55"')}${rect(35, 35, 14, 14, 3, 'opacity=".3"')}${rect(52, 18, 14, 14, 3, 'opacity=".3"')}${rect(18, 52, 14, 14, 3, 'opacity=".3"')}</g>`,
  },
];

const wrap = (inner, color = '#111', size = 100) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${size}" height="${size}" style="color:${color}">${inner}</svg>`;

(async () => {
  fs.mkdirSync(path.join(out, 'variants'), { recursive: true });
  for (const v of variants) fs.writeFileSync(path.join(out, 'variants', `${v.id}.svg`), wrap(v.svg).replace(' style="color:#111"', '').replace(/currentColor/g, '#111'));

  // contact sheet PNG: 4 columns x 2 rows
  const cell = 300; const cols = 4;
  const cells = variants.map((v, i) => ({
    input: Buffer.from(wrap(v.svg, '#111', 220).replace(/currentColor/g, '#111').replace(' style="color:#111"', '')),
    left: (i % cols) * cell + 40, top: Math.floor(i / cols) * cell + 20,
  }));
  await sharp({ create: { width: cell * cols, height: cell * 2, channels: 3, background: '#f5f5f7' } }).composite(cells).png().toFile(path.join(out, 'contact-sheet.png'));

  const card = (v) => `<article><div class="mark">${wrap(v.svg, 'currentColor', 160)}</div><h2>${v.name}</h2><p>${v.why}</p><a href="variants/${v.id}.svg" download>SVG</a></article>`;
  fs.writeFileSync(path.join(out, 'showcase.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ImageUpscale logo exploration</title>
<style>:root{color-scheme:light dark;--bg:#f5f5f7;--fg:#111;--card:#fff;--mut:#6e6e73}@media(prefers-color-scheme:dark){:root{--bg:#000;--fg:#f5f5f7;--card:#1c1c1e;--mut:#98989d}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;padding:48px 24px}
h1{font-size:34px;margin:0 0 6px}header p{color:var(--mut);max-width:60ch;margin:0 0 32px}
main{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px}
article{background:var(--card);border-radius:24px;padding:24px;display:grid;gap:8px}
.mark{display:grid;place-items:center;height:200px;color:var(--fg)}h2{margin:0;font-size:17px}article p{margin:0;color:var(--mut);font-size:13px}a{color:#0a84ff;font-weight:600;text-decoration:none}
.pick{outline:3px solid #0a84ff}</style></head><body><header><h1>ImageUpscale</h1><p>Eight directions for one idea: a low-resolution pixel becoming a higher-resolution one. Chosen: <strong>Quad Zoom</strong>.</p></header><main>
${variants.map((v, i) => card(v).replace('<article>', i === 0 ? '<article class="pick">' : '<article>')).join('\n')}</main></body></html>`);

  // chosen mark: flat logo + app icon tile
  const chosen = variants[0];
  fs.writeFileSync(path.join(out, 'logo.svg'), wrap(chosen.svg).replace(' style="color:#111"', '').replace(/currentColor/g, '#111'));
  const iconMark = chosen.svg.replace(/currentColor/g, '#fff').replace(/opacity=".32"/g, 'opacity=".5"'); // stronger ghosts so the icon holds up at 32 px and below
  fs.writeFileSync(path.join(out, 'app-icon.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3a8dff"/><stop offset="1" stop-color="#5e5ce6"/></linearGradient></defs><rect x="64" y="64" width="896" height="896" rx="200" fill="url(#g)"/><g transform="translate(62 62) scale(9)">${iconMark}</g></svg>`);
  console.log('wrote branding/: variants, showcase.html, contact-sheet.png, logo.svg, app-icon.svg');
})().catch((e) => { console.error(e); process.exit(1); });
