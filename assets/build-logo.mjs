// Rebuilds the atoll logo from gemini-svg.svg structure with official
// framework brand paths (simple-icons, 24x24) and emits square
// light + dark SVGs, then rasterizes via @resvg/resvg-js when available.
//
//   node build-logo.mjs            → atoll-light.svg / atoll-dark.svg
//   node build-logo.mjs --png      → also renders atollJS.png / atollJS-dark.png
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const iconPath = (name) =>
  readFileSync(join(here, `icon-${name}.svg`), 'utf8').match(/d="([^"]+)"/)[1];

// Official brand colors; each icon sits on a white chip so the mark keeps
// its true fill on any ocean/island color. React's canonical cyan washes out
// on white — the react.dev ink variant keeps it legible.
const ICONS = [
  { name: 'nestjs',    at: [500, 140], d: iconPath('nestjs'),    fill: '#e0234e' },
  { name: 'nextdotjs', at: [670, 210], d: iconPath('nextdotjs'), fill: '#000000' },
  { name: 'nodedotjs', at: [730, 350], d: iconPath('nodedotjs'), fill: '#339933' },
  { name: 'vuedotjs',  at: [630, 500], d: iconPath('vuedotjs'),  fill: '#4fc08d' },
  { name: 'svelte',    at: [500, 560], d: iconPath('svelte'),    fill: '#ff3e00' },
  { name: 'solid',     at: [370, 500], d: iconPath('solid'),     fill: '#2c4f7c' },
  { name: 'react',     at: [270, 350], d: iconPath('react'),     fill: '#149eca' },
  { name: 'angular',   at: [330, 210], d: iconPath('angular'),   fill: '#dd0031' },
];

// Chip + official path, emitted at origin — the caller's translate places it.
const icon = ({ d, fill }) => {
  const s = 1.75; // 24-unit path → ~42px face on a 54px chip
  return `<circle r="27" fill="#ffffff" opacity="0.94"/>
          <g transform="translate(${(-12 * s).toFixed(1)}, ${(-12 * s).toFixed(1)}) scale(${s})">
            <path d="${d}" fill="${fill}"/>
          </g>`;
};

// ringScale pulls islands/bridges/lagoon toward the wordmark; viewBox crops
// ocean margin for the compact variant.
const svg = (theme, ringScale = 1, viewBox = '205 205 590 590', fontSize = 68) => {
  const s = (v, axis) => {
    const c = axis === 'x' ? 500 : 350;
    return c + (v - c) * ringScale;
  };
  const ringXf =
    ringScale === 1 ? '' : ` transform="translate(500 350) scale(${ringScale}) translate(-500 -350)"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">
  <defs>
    <radialGradient id="oceanBg" cx="50%" cy="50%" r="70%" fx="50%" fy="50%">
      <stop offset="0%" stop-color="${theme.ocean[0]}"/>
      <stop offset="100%" stop-color="${theme.ocean[1]}"/>
    </radialGradient>
    <linearGradient id="sandGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#fce1b6"/>
      <stop offset="100%" stop-color="#e8c28a"/>
    </linearGradient>
    <linearGradient id="grassGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#7bc96f"/>
      <stop offset="100%" stop-color="#4aa942"/>
    </linearGradient>
    <linearGradient id="bridgeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#e8c28a"/>
      <stop offset="50%" stop-color="#fce1b6"/>
      <stop offset="100%" stop-color="#e8c28a"/>
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="8" stdDeviation="6" flood-color="${theme.shadow}" flood-opacity="0.3"/>
    </filter>
    <filter id="innerShadow" x="-10%" y="-10%" width="120%" height="120%">
      <feOffset dx="0" dy="4"/>
      <feGaussianBlur stdDeviation="4" result="offset-blur"/>
      <feComposite operator="out" in="SourceGraphic" in2="offset-blur" result="inverse"/>
      <feFlood flood-color="${theme.lagoonShadow}" flood-opacity="0.5" result="color"/>
      <feComposite operator="in" in="color" in2="inverse" result="shadow"/>
      <feComposite operator="over" in="shadow" in2="SourceGraphic"/>
    </filter>
  </defs>

  <rect width="1000" height="1000" fill="url(#oceanBg)"/>

  <!-- art group: the original 1000x700 composition, re-centered vertically -->
  <g transform="translate(0, 150)">
    <g fill="none" stroke="url(#bridgeGrad)" stroke-width="28" stroke-linecap="round" opacity="0.95"${ringXf}>
      <path d="M 525 155 Q 585 155 625 185"/>
      <path d="M 660 215 Q 705 260 715 320"/>
      <path d="M 715 380 Q 705 440 665 485"/>
      <path d="M 635 515 Q 575 555 525 565"/>
      <path d="M 475 565 Q 425 555 365 515"/>
      <path d="M 335 485 Q 295 440 285 380"/>
      <path d="M 285 320 Q 295 260 340 215"/>
      <path d="M 375 185 Q 415 155 475 155"/>
    </g>

    <path d="M 350 250 C 420 220, 580 220, 650 250 C 720 280, 750 350, 750 420 C 750 490, 700 540, 630 565 C 560 590, 440 590, 370 565 C 300 540, 250 490, 250 420 C 250 350, 280 280, 350 250 Z"
          fill="${theme.lagoon}" opacity="${theme.lagoonOpacity}" filter="url(#innerShadow)"${ringXf}/>

    <g filter="url(#shadow)">
${ICONS.map((i) => `      <g transform="translate(${s(i.at[0], 'x').toFixed(1)}, ${s(i.at[1], 'y').toFixed(1)})">
        <ellipse cx="0" cy="0" rx="55" ry="44" fill="url(#sandGrad)"/>
        <ellipse cx="0" cy="2" rx="42" ry="31" fill="url(#grassGrad)"/>
        ${icon(i)}
      </g>`).join('\n')}
    </g>

    <g transform="translate(500, 358)" text-anchor="middle">
      <text x="0" y="4" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
            font-weight="800" font-size="${fontSize}" letter-spacing="1.5"
            fill="${theme.textShadow}" opacity="0.55">AtollJS</text>
      <text x="0" y="0" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
            font-weight="800" font-size="${fontSize}" letter-spacing="1.5"
            fill="${theme.text}">AtollJS</text>
    </g>
  </g>
</svg>
`;
};

const LIGHT = {
  ocean: ['#73d0f4', '#4ab1e2'],
  lagoon: '#5ec4ee',
  lagoonOpacity: '0.4',
  lagoonShadow: '#2c89b2',
  shadow: '#1d6688',
  text: '#1b4965',
  textShadow: '#ffffff',
};
const DARK = {
  ocean: ['#1d3a52', '#0a1622'],
  lagoon: '#14304a',
  lagoonOpacity: '0.55',
  lagoonShadow: '#050d18',
  shadow: '#020a12',
  text: '#d9f2ff',
  textShadow: '#041018',
};

// Favicon mark: ring of bare islets + lagoon + "A" monogram. Transparent
// background so the same file works on light and dark browser chrome.
const islets = Array.from({ length: 8 }, (_, k) => {
  const a = (-90 + k * 45) * (Math.PI / 180);
  return [500 + 350 * Math.cos(a), 500 + 350 * Math.sin(a)];
});
// Small favicon sizes need a heavier, darker contour — the standard outline
// is sub-pixel at 32px. `sm` strengthens it for the -32 render.
// Small favicon sizes need a different treatment than a heavier contour:
// flood the ring's interior with the light lagoon and ink the A navy —
// a disc reads better than a dark outline at 32px.
const atollShapes = `    <circle cx="500" cy="500" r="350" fill="none" stroke="#04101e" stroke-opacity="0.25" stroke-width="66"/>
    <circle cx="500" cy="500" r="350" fill="none" stroke="#ecc48c" stroke-width="56"/>
${islets.map(([x, y]) => `    <ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="94" ry="72" fill="#55b157"/>`).join('\n')}`;

const iconSvg = (sm = false) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000">
  <defs>
    <filter id="silhouette" x="-15%" y="-15%" width="130%" height="130%">
      <feMorphology in="SourceAlpha" operator="dilate" radius="${sm ? 14 : 9}" result="d"/>
      <feFlood flood-color="${sm ? '#03101c' : '#0f3550'}" flood-opacity="${sm ? 1 : 0.7}"/>
      <feComposite in2="d" operator="in"/>
    </filter>
    <!-- outer-only contour: interior of the ring (r<331) is masked out so the
         outline hugs the exterior silhouette, not the ring's inner rim or the
         concavities between islets -->
    <mask id="outerOnly">
      <rect width="1000" height="1000" fill="#fff"/>
      <circle cx="500" cy="500" r="331" fill="#000"/>
    </mask>
  </defs>
  ${sm ? '<circle cx="500" cy="500" r="318" fill="#5ec4ee"/>' : ''}
  <g mask="url(#outerOnly)"><g filter="url(#silhouette)">
${atollShapes}
  </g></g>
  <g>
${atollShapes}
  </g>
  <text x="500" y="680" text-anchor="middle"
        font-family="system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
        font-weight="800" font-size="560" fill="${sm ? '#16405a' : '#2f8fc0'}"
        stroke="#0f3550" stroke-opacity="0.7"
        stroke-width="${sm ? 0 : 14}" paint-order="stroke" stroke-linejoin="round">A</text>
</svg>
`;

writeFileSync(join(here, 'atoll-light.svg'), svg(LIGHT));
writeFileSync(join(here, 'atoll-dark.svg'), svg(DARK));
// Compact: ring pulled in ~22%, wordmark sized to keep the side islands clear,
// viewBox cropped to the artwork.
writeFileSync(join(here, 'atoll-compact-light.svg'), svg(LIGHT, 0.78, '250 245 500 500', 52));
writeFileSync(join(here, 'atoll-compact-dark.svg'), svg(DARK, 0.78, '250 245 500 500', 52));
writeFileSync(join(here, 'atoll-icon.svg'), iconSvg());
writeFileSync(join(here, 'atoll-icon-sm.svg'), iconSvg(true));
console.log('wrote atoll-{light,dark}.svg / atoll-compact-{light,dark}.svg / atoll-icon.svg');

if (process.argv.includes('--png')) {
  const { Resvg } = await import('@resvg/resvg-js');
  for (const [src, out] of [
    ['atoll-light.svg', 'atollJS.png'],
    ['atoll-dark.svg', 'atollJS-dark.png'],
  ]) {
    const resvg = new Resvg(readFileSync(join(here, src), 'utf8'), {
      fitTo: { mode: 'width', value: 1408 },
    });
    writeFileSync(join(here, out), resvg.render().asPng());
    console.log('rendered', out);
  }
}
