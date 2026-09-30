// Builds the Atoll asset family from the refined streamlined mark
// (refined.svg): thin ring, six island nodes on hexagonal positions,
// geometric A, ATOLLJS wordmark + tagline.
//
//   node build-logo.mjs  → all SVGs; rasterize PNGs via headless Edge:
//     msedge --headless --screenshot=out.png --window-size=N,N file.svg
//     (add --default-background-color=00000000 for transparency)
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

// ── refined geometry (viewBox 500×550, mark centered at 250,225) ────────────
const A_PATH =
  'M 250 140 L 170 310 H 205 L 222 272 H 278 L 295 310 H 330 Z ' +
  'M 235 242 L 250 205 L 265 242 Z';
// Six nodes on the ring (r=130): top, then hexagonal positions.
const NODES = [
  [250, 95], [363, 160], [363, 290], [250, 355], [137, 290], [137, 160],
];

// weight: stroke/node sizes — `sm` thickens for favicon-size rasters.
function mark(ink, weight = 1) {
  const w = 8 * weight;
  const r = 16 * weight;
  return `
  <path d="${A_PATH}" fill="${ink}"/>
  <circle cx="250" cy="225" r="130" fill="none" stroke="${ink}" stroke-width="${w}"/>
${NODES.map(([x, y]) => `  <circle cx="${x}" cy="${y}" r="${r}" fill="${ink}"/>`).join('\n')}`;
}

const TEXT = (ink) => `
  <text x="250" y="440" font-family="system-ui, -apple-system, sans-serif"
        font-weight="800" font-size="38" fill="${ink}" text-anchor="middle"
        letter-spacing="2">ATOLL<tspan dy="-0.72em" font-size="0.42em">JS</tspan></text>
  <text x="250" y="475" font-family="system-ui, -apple-system, sans-serif"
        font-weight="600" font-size="14" fill="${ink}" text-anchor="middle"
        letter-spacing="3">ISLANDS BASED MULTITHREADING</text>`;

// ── variants ────────────────────────────────────────────────────────────────
const svg = (ink, viewBox, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${body}</svg>\n`;

const themed = (bg0, bg1, ink, viewBox = '0 0 500 550') =>
  svg(
    ink,
    viewBox,
    `
  <defs><radialGradient id="bg" cx="50%" cy="45%" r="75%">
    <stop offset="0%" stop-color="${bg0}"/><stop offset="100%" stop-color="${bg1}"/>
  </radialGradient></defs>
  <rect width="500" height="550" fill="url(#bg)"/>${mark(ink)}${TEXT(ink)}`
  );

// full logo — light ocean / dark navy wash, brand ink
writeFileSync(join(here, 'atoll-light.svg'), themed('#bfe9f5', '#8fd4ec', '#14455e'));
writeFileSync(join(here, 'atoll-dark.svg'), themed('#143049', '#081420', '#cfe9f7'));

// transparent full logo — mark + wordmark, no ocean panel (for themed pages)
writeFileSync(
  join(here, 'atoll-light-t.svg'),
  svg('#14455e', '0 0 500 550', mark('#14455e') + TEXT('#14455e'))
);
writeFileSync(
  join(here, 'atoll-dark-t.svg'),
  svg('#cfe9f7', '0 0 500 550', mark('#cfe9f7') + TEXT('#cfe9f7'))
);

// compact — artwork region only, square-ish crop
writeFileSync(
  join(here, 'atoll-compact-light.svg'),
  themed('#bfe9f5', '#8fd4ec', '#14455e', '60 65 380 380')
);
writeFileSync(
  join(here, 'atoll-compact-dark.svg'),
  themed('#143049', '#081420', '#cfe9f7', '60 65 380 380')
);

// favicon — mark only, no text. Transparent background. `light`/`dark` pick
// ink suited to each browser chrome; `sm` thickens strokes for ≤32px rasters.
const ICON_INK = { light: '#1b4965', dark: '#cfe9f7' };
const iconSvg = (theme, sm = false) => {
  const w = sm ? 1.6 : 1;
  const bleed = Math.ceil(16 * w + 8 * w); // node radius + ring stroke
  const size = 292 + 2 * bleed; // mark extent 250±146, square crop on center
  const x = (250 - size / 2).toFixed(0);
  const y = (225 - size / 2).toFixed(0);
  return svg(ICON_INK[theme], `${x} ${y} ${size} ${size}`, mark(ICON_INK[theme], w));
};
for (const t of ['light', 'dark']) {
  writeFileSync(join(here, `atoll-icon-${t}.svg`), iconSvg(t));
  writeFileSync(join(here, `atoll-icon-${t}-sm.svg`), iconSvg(t, true));
}

// horizontal lockup — mark left, wordmark + tagline right. Transparent bg;
// ink per theme (light ink for dark surfaces, navy for light).
const horizontal = (ink) =>
  svg(
    ink,
    '0 0 660 200',
    `
  <g transform="translate(${118 - 250 * 0.62} ${110 - 225 * 0.62}) scale(0.62)">
${mark(ink)}
  </g>
  <text x="235" y="115" font-family="system-ui, -apple-system, sans-serif"
        font-weight="800" font-size="58" fill="${ink}" letter-spacing="2">ATOLL<tspan dy="-0.72em" font-size="0.42em">JS</tspan></text>
  <text x="238" y="152" font-family="system-ui, -apple-system, sans-serif"
        font-weight="600" font-size="17" fill="${ink}" letter-spacing="2.6">ISLANDS BASED MULTITHREADING</text>`
  );
writeFileSync(join(here, 'atoll-horizontal-light.svg'), horizontal('#14455e'));
writeFileSync(join(here, 'atoll-horizontal-dark.svg'), horizontal('#cfe9f7'));

// brand lockup — mark + wordmark sized so the text fills the icon's height
// (cap top ≈ mark top, baseline ≈ mark bottom). For tight headers/sidebars;
// no tagline.
const brand = (ink) => {
  const s = 236 / 292; // mark height → 236px
  const cx = 131 * s + 24; // mark's left edge at x≈24
  const cy = 130;
  return svg(
    ink,
    '0 12 1052 238',
    `
  <g transform="translate(${(cx - 250 * s).toFixed(1)} ${(cy - 225 * s).toFixed(1)}) scale(${s.toFixed(3)})">
${mark(ink)}
  </g>
  <text x="264" y="185" font-family="system-ui, -apple-system, sans-serif"
        font-weight="800" font-size="140" fill="${ink}" letter-spacing="2">ATOLL<tspan dy="-0.72em" font-size="0.42em">JS</tspan></text>
  <text x="268" y="233" font-family="system-ui, -apple-system, sans-serif"
        font-weight="600" font-size="42" fill="${ink}" letter-spacing="2.4">ISLANDS BASED MULTITHREADING</text>`
  );
};
writeFileSync(join(here, 'atoll-brand-light.svg'), brand('#14455e'));
writeFileSync(join(here, 'atoll-brand-dark.svg'), brand('#cfe9f7'));

// monochrome mark — single-color glyph for badges/inline use
writeFileSync(
  join(here, 'atoll-mark.svg'),
  svg('currentColor', '75 60 350 350', mark('currentColor'))
);

console.log('wrote atoll-{light,dark}.svg, atoll-compact-{light,dark}.svg, atoll-icon{,-sm}.svg, atoll-mark.svg');
