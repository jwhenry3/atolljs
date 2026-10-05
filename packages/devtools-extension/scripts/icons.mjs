// Rasterize the atoll mark (docs-consumer/public/atoll-icon-dark.svg) into
// the PNG icons Chrome requires (manifest icons and DevTools panel icons
// can't be SVG). Dependency-free: a tiny SVG subset parser (absolute
// M/L/H/V/Z paths, circles with fill or stroke), 4x4 supersampling, and a
// zlib-backed PNG encoder.
import { deflateSync } from 'node:zlib';

const num = (s) => Number.parseFloat(s);
const attr = (tag, name) => {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(tag);
  return m ? m[1] : null;
};

/** Parse the subset of SVG the atoll mark uses. Throws on anything else. */
export function parseMark(svg) {
  const vb = attr(/<svg\b[^>]*>/.exec(svg)?.[0] ?? '', 'viewBox')?.trim().split(/[\s,]+/).map(num);
  if (!vb || vb.length !== 4) throw new Error('icon svg: missing viewBox');
  const shapes = [];
  for (const [tag] of svg.matchAll(/<path\b[^>]*>/g)) {
    const d = attr(tag, 'd') ?? '';
    const tokens = d.match(/[MLHVZmlhvz]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? [];
    const rings = [];
    let ring = null, x = 0, y = 0, cmd = '';
    for (let i = 0; i < tokens.length;) {
      const t = tokens[i];
      if (/[A-Za-z]/.test(t)) {
        if (t !== t.toUpperCase()) throw new Error(`icon svg: relative path command ${t} unsupported`);
        cmd = t; i++;
        if (cmd === 'Z') { if (ring) rings.push(ring); ring = null; }
        continue;
      }
      if (cmd === 'M') { x = num(tokens[i]); y = num(tokens[i + 1]); i += 2; if (ring) rings.push(ring); ring = [[x, y]]; cmd = 'L'; }
      else if (cmd === 'L') { x = num(tokens[i]); y = num(tokens[i + 1]); i += 2; ring.push([x, y]); }
      else if (cmd === 'H') { x = num(tokens[i]); i += 1; ring.push([x, y]); }
      else if (cmd === 'V') { y = num(tokens[i]); i += 1; ring.push([x, y]); }
      else throw new Error(`icon svg: unexpected token ${t}`);
    }
    if (ring) rings.push(ring);
    shapes.push({ kind: 'poly', rings, fill: attr(tag, 'fill') });
  }
  for (const [tag] of svg.matchAll(/<circle\b[^>]*>/g)) {
    const fill = attr(tag, 'fill');
    shapes.push({
      kind: 'circle',
      cx: num(attr(tag, 'cx')), cy: num(attr(tag, 'cy')), r: num(attr(tag, 'r')),
      fill: fill && fill !== 'none' ? fill : null,
      stroke: attr(tag, 'stroke'),
      strokeWidth: num(attr(tag, 'stroke-width') ?? '1'),
    });
  }
  return { viewBox: vb, shapes };
}

const inRings = (rings, px, py) => {
  let inside = false; // even-odd
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
};

const hex = (c) => {
  const m = /^#([0-9a-f]{6})$/i.exec(c ?? '');
  if (!m) throw new Error(`icon svg: color ${c} unsupported`);
  const n = Number.parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/**
 * RGBA pixels for the mark on a rounded dark tile. Thin strokes and dots
 * are thickened at small sizes so the 16px icon still reads.
 */
export function renderMark(mark, size, { background = '#0d1117', radius = 0.22, pad = 0.08 } = {}) {
  const [vx, vy, vw, vh] = mark.viewBox;
  const inner = size * (1 - 2 * pad);
  const scale = inner / Math.max(vw, vh);
  const minPx = 1.25 / scale; // svg units per ~1.25 output px
  const bg = hex(background);
  const fg = hex(mark.shapes.find((s) => s.fill)?.fill ?? mark.shapes.find((s) => s.stroke)?.stroke);
  const r = radius * size;
  const out = Buffer.alloc(size * size * 4);
  const S = 4;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let tile = 0, ink = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const ox = px + (sx + 0.5) / S, oy = py + (sy + 0.5) / S;
          // rounded-square tile
          const cx = Math.min(Math.max(ox, r), size - r), cy = Math.min(Math.max(oy, r), size - r);
          if ((ox - cx) ** 2 + (oy - cy) ** 2 > r * r) continue;
          tile++;
          const x = vx + (ox - size * pad) / scale - (inner / scale - vw) / 2;
          const y = vy + (oy - size * pad) / scale - (inner / scale - vh) / 2;
          for (const s of mark.shapes) {
            let hit = false;
            if (s.kind === 'poly') hit = inRings(s.rings, x, y);
            else {
              const d = Math.hypot(x - s.cx, y - s.cy);
              if (s.fill) hit = d <= Math.max(s.r, minPx * 1.6);
              else hit = Math.abs(d - s.r) <= Math.max(s.strokeWidth, minPx) / 2;
            }
            if (hit) { ink++; break; }
          }
        }
      }
      const a = tile / (S * S);
      const k = tile ? ink / tile : 0;
      const o = (py * size + px) * 4;
      for (let c = 0; c < 3; c++) out[o + c] = Math.round(bg[c] + (fg[c] - bg[c]) * k);
      out[o + 3] = Math.round(a * 255);
    }
  }
  return out;
}

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};

/** Encode RGBA pixels as a PNG (8-bit, color type 6, no filtering). */
export function encodePng(rgba, w, h) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export function markPng(svg, size) {
  return encodePng(renderMark(parseMark(svg), size), size, size);
}
