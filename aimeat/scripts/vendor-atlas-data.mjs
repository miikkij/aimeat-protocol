/**
 * @file scripts/vendor-atlas-data.mjs
 * @description Builds the atlas component's geometry file: downloads world-atlas 110m
 *   (TopoJSON of Natural Earth country polygons — data public domain, packaging ISC), decodes
 *   the TopoJSON inline (no dependency), projects equirectangular, and writes ONE compact JSON
 *   of ready SVG path strings to public/lib/aimeat-atlas@1.json. The atlas component fetches
 *   that file lazily and never needs a projection library — the projection happened here, once.
 *
 *   Run on demand when upgrading the geometry; the output is committed, so a node never
 *   downloads anything. A future geometry change ships as aimeat-atlas@2.json (VENDORED.md
 *   major rule); this file never changes shape.
 * @usage  node scripts/vendor-atlas-data.mjs
 * @version-history
 *   v1.0.0 — 2026-08-29 — Initial (TARGET-074 next level: the offline data map).
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SRC = 'https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json';
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'lib', 'aimeat-atlas@1.json');
const W = 1000;
const H = 500;

const res = await fetch(SRC);
if (!res.ok) { console.error(`download failed: ${res.status}`); process.exit(1); }
const topo = await res.json();

// ── TopoJSON decode (the arc/transform format, nothing more) ─────────────────────────────────
const { scale, translate } = topo.transform;
const arcs = topo.arcs.map((arc) => {
  let x = 0;
  let y = 0;
  return arc.map(([dx, dy]) => {
    x += dx;
    y += dy;
    return [x * scale[0] + translate[0], y * scale[1] + translate[1]];
  });
});

function ringCoords(arcIndexes) {
  const coords = [];
  for (const index of arcIndexes) {
    const arc = index >= 0 ? arcs[index] : arcs[-index - 1].slice().reverse();
    // Adjacent arcs share their join point — drop the duplicate.
    for (const pt of coords.length ? arc.slice(1) : arc) coords.push(pt);
  }
  return coords;
}

function project([lon, lat]) {
  return [((lon + 180) / 360) * W, ((90 - lat) / 180) * H];
}

function ringPath(ring) {
  const pts = ring.map(project);
  let d = '';
  let prev = null;
  for (const [x, y] of pts) {
    const px = Math.round(x * 10) / 10;
    const py = Math.round(y * 10) / 10;
    if (prev && prev[0] === px && prev[1] === py) continue; // rounding collapsed the step
    d += (d ? 'L' : 'M') + px + ' ' + py;
    prev = [px, py];
  }
  return d + 'Z';
}

const countries = [];
for (const geom of topo.objects.countries.geometries) {
  const name = (geom.properties && geom.properties.name) || '';
  if (!name) continue;
  const polys = geom.type === 'Polygon' ? [geom.arcs] : geom.type === 'MultiPolygon' ? geom.arcs : [];
  let d = '';
  // The bbox is the MAINLAND's (the largest polygon), not the whole multipolygon: framing
  // "Norway" must mean Norway, not the Arctic emptiness up to Svalbard — same for France and
  // French Guiana. The path still draws every part.
  let main = null;
  let mainArea = -1;
  for (const poly of polys) {
    const partBox = [Infinity, Infinity, -Infinity, -Infinity];
    for (const ring of poly) {
      const coords = ringCoords(ring);
      d += ringPath(coords);
      for (const pt of coords) {
        const [x, y] = project(pt);
        if (x < partBox[0]) partBox[0] = x;
        if (y < partBox[1]) partBox[1] = y;
        if (x > partBox[2]) partBox[2] = x;
        if (y > partBox[3]) partBox[3] = y;
      }
    }
    const area = (partBox[2] - partBox[0]) * (partBox[3] - partBox[1]);
    if (area > mainArea) { mainArea = area; main = partBox; }
  }
  if (!d || !main) continue;
  countries.push({ id: String(geom.id ?? ''), name, d, bbox: main.map((v) => Math.round(v * 10) / 10) });
}

const out = {
  format: 'aimeat-atlas/1',
  attribution: 'Natural Earth (public domain) via world-atlas (ISC), equirectangular',
  w: W,
  h: H,
  countries,
};
writeFileSync(OUT, JSON.stringify(out));
console.log(`✓ ${countries.length} countries → ${OUT} (${Math.round(JSON.stringify(out).length / 1024)} kB)`);
