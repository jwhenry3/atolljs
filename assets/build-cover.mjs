// Builds the Atoll blog cover (1000×420): brand lockup on the left, an
// orbital ring of framework icons on the right — the atoll motif read as
// "workers around a main thread". Dark theme only.
//
//   node build-cover.mjs  → atoll-cover.svg; rasterize via headless Edge:
//     msedge --headless --screenshot=atoll-cover.png --window-size=1000,420 atoll-cover.svg
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

// ── refined geometry (same spec as build-logo.mjs) ──────────────────────────
const A_PATH =
  'M 250 140 L 170 310 H 205 L 222 272 H 278 L 295 310 H 330 Z ' +
  'M 235 242 L 250 205 L 265 242 Z';
const NODES = [
  [250, 95], [363, 160], [363, 290], [250, 355], [137, 290], [137, 160],
];
const INK = '#cfe9f7';

const mark = (ink) => `
  <path d="${A_PATH}" fill="${ink}"/>
  <circle cx="250" cy="225" r="130" fill="none" stroke="${ink}" stroke-width="8"/>
${NODES.map(([x, y]) => `  <circle cx="${x}" cy="${y}" r="16" fill="${ink}"/>`).join('\n')}`;

// ── framework icons (24×24 single-path glyphs in assets/icon-*.svg) ─────────
const ICONS = [
  'react', 'vuedotjs', 'angular', 'svelte',
  'solid', 'nextdotjs', 'nodedotjs', 'nestjs',
];
const glyph = (name) =>
  readFileSync(join(here, `icon-${name}.svg`), 'utf8').match(/\bd="([^"]+)"/)[1];

// icon nodes on the orbit ring (r=130 about 845,210), one per 45° from top.
const orbit = () => {
  const [cx, cy, r] = [845, 210, 130];
  return ICONS.map((name, i) => {
    const a = (i * 45 * Math.PI) / 180;
    const x = (cx + r * Math.sin(a)).toFixed(1);
    const y = (cy - r * Math.cos(a)).toFixed(1);
    return `
  <g>
    <circle cx="${x}" cy="${y}" r="24" fill="#10314a" stroke="${INK}" stroke-opacity="0.55" stroke-width="1.5"/>
    <path d="${glyph(name)}" fill="${INK}" transform="translate(${x - 13} ${y - 13}) scale(1.0833)"/>
  </g>`;
  }).join('\n');
};

// sparse distant workers — fixed coordinates in the empty zones
const dust = [
  [62, 52, 2.2, 0.5], [168, 34, 1.6, 0.35], [318, 58, 2.6, 0.45],
  [452, 38, 1.8, 0.3], [560, 330, 2.2, 0.4], [624, 356, 1.6, 0.3],
  [470, 372, 2.6, 0.45], [330, 384, 1.8, 0.35], [80, 376, 2.4, 0.5],
  [640, 96, 2, 0.35], [700, 330, 1.7, 0.3],
]
  .map(([x, y, r, o]) => `  <circle cx="${x}" cy="${y}" r="${r}" fill="${INK}" opacity="${o}"/>`)
  .join('\n');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 420" width="1000" height="420">
  <defs><radialGradient id="bg" cx="32%" cy="50%" r="90%">
    <stop offset="0%" stop-color="#143049"/><stop offset="100%" stop-color="#081420"/>
  </radialGradient></defs>
  <rect width="1000" height="420" fill="url(#bg)"/>
${dust}
  <!-- right orbital motif: framework islands on a worker ring -->
  <circle cx="845" cy="210" r="168" fill="none" stroke="${INK}" stroke-opacity="0.16"
          stroke-width="2" stroke-linecap="round" stroke-dasharray="0.1 11"/>
  <circle cx="845" cy="210" r="130" fill="none" stroke="${INK}" stroke-opacity="0.6" stroke-width="3"/>
${orbit()}
  <!-- left brand lockup -->
  <g transform="translate(-7 66.5) scale(0.62)">
${mark(INK)}
  </g>
  <text x="266" y="212" font-family="system-ui, -apple-system, sans-serif"
        font-weight="800" font-size="80" fill="${INK}" letter-spacing="2">ATOLL<tspan dy="-0.72em" font-size="0.42em">JS</tspan></text>
  <text x="270" y="254" font-family="system-ui, -apple-system, sans-serif"
        font-weight="600" font-size="20" fill="${INK}" letter-spacing="2.4">ISLANDS BASED MULTITHREADING</text></svg>
`;

writeFileSync(join(here, 'atoll-cover.svg'), svg);
console.log('wrote atoll-cover.svg (1000×420)');
