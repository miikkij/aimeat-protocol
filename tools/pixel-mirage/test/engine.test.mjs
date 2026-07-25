import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const PMC = require('../src/codec.js');
const PM = require('../src/engine.js');

const FX = path.join(import.meta.dirname, '..', 'fixtures');
const OUT = path.join(import.meta.dirname, '..', 'out');
fs.mkdirSync(OUT, { recursive: true });

let fails = 0;
function check(name, ok, detail = '') {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
}

const photoPath = process.argv[2] || path.join(FX, 'big.jpg');
const src = PMC.decodeImage(new Uint8Array(fs.readFileSync(photoPath)), 512);
console.log(`source ${photoPath} -> ${src.width}x${src.height}\n`);

function distinct(indices, n) {
  const seen = new Set();
  for (let i = 0; i < indices.length; i++) seen.add(indices[i]);
  for (const v of seen) if (v >= n) return -1;
  return seen.size;
}

// ---- every algorithm renders, uses the palette, and is not flat -----------
let slowest = 0, slowestName = '';
for (const algo of PM.ALGORITHMS) {
  const r = PM.normalizeRecipe({ algorithm: algo.id, palette: 'thermal', size: 512, scale: 2 });
  const t0 = Date.now();
  const out = PM.render(src.rgba, src.width, src.height, r);
  const ms = Date.now() - t0;
  if (ms > slowest) { slowest = ms; slowestName = algo.id; }
  const used = distinct(out.indices, out.palette.length);
  check(`algo ${algo.id}`, used >= 2 && out.width === 512, `${out.width}x${out.height} colours-used=${used}/${out.palette.length} ${ms}ms`);
  const png = PMC.encodeIndexedPng(out.indices, out.width, out.height, out.palette);
  fs.writeFileSync(path.join(OUT, `algo-${algo.id}.png`), Buffer.from(png));
}
console.log(`  slowest algorithm: ${slowestName} ${slowest}ms\n`);

// ---- every palette renders and only emits in-range indices ---------------
// Swept over a full-range gradient: a palette whose gamut is all-light legitimately collapses
// to one ink on a dark photo, so the coverage claim only means anything on full-range input.
const sweep = PMC.decodeImage(new Uint8Array(fs.readFileSync(path.join(FX, 'rgb8.png'))), 0);
for (const p of PM.PALETTES) {
  const r = PM.normalizeRecipe({ palette: p.id, algorithm: 'floyd-steinberg', size: 320 });
  const out = PM.render(sweep.rgba, sweep.width, sweep.height, r);
  const used = distinct(out.indices, out.palette.length);
  check(`palette ${p.id}`, used >= 2 && out.palette.length === p.colors.length,
    `${used}/${p.colors.length} used`);
  const png = PMC.encodeIndexedPng(out.indices, out.width, out.height, out.palette);
  fs.writeFileSync(path.join(OUT, `pal-${p.id}.png`), Buffer.from(png));
}

// ---- auto palette ---------------------------------------------------------
{
  const r = PM.normalizeRecipe({ palette: 'auto', colorCount: 8, algorithm: 'atkinson', size: 400 });
  const out = PM.render(src.rgba, src.width, src.height, r);
  check('palette auto', out.palette.length === 8, `extracted ${out.colors.join(' ')}`);
  fs.writeFileSync(path.join(OUT, 'pal-auto.png'), Buffer.from(PMC.encodeIndexedPng(out.indices, out.width, out.height, out.palette)));
}

// ---- custom colours override the preset ----------------------------------
{
  const r = PM.normalizeRecipe({ colors: ['#000000', '#ff0000', '#ffffff'], algorithm: 'bayer8' });
  const out = PM.render(src.rgba, src.width, src.height, r);
  check('custom colours', out.colors.length === 3 && out.colors[1] === '#ff0000', out.colors.join(' '));
}

// ---- geometry -------------------------------------------------------------
for (const [name, g] of [
  ['rotate45', { rotate: 45 }],
  ['zoom200', { zoom: 200 }],
  ['pan', { offsetX: 40, offsetY: -30 }],
  ['contain', { fit: 'contain' }],
]) {
  const r = PM.normalizeRecipe({ ...g, palette: 'gameboy', algorithm: 'bayer4', size: 320 });
  const out = PM.render(src.rgba, src.width, src.height, r);
  check(`geometry ${name}`, distinct(out.indices, out.palette.length) >= 2);
  fs.writeFileSync(path.join(OUT, `geo-${name}.png`), Buffer.from(PMC.encodeIndexedPng(out.indices, out.width, out.height, out.palette)));
}

// ---- adjustments change the picture --------------------------------------
{
  const baseR = PM.normalizeRecipe({ palette: 'ash-grey', algorithm: 'bayer8', size: 256 });
  const base = PM.render(src.rgba, src.width, src.height, baseR);
  for (const [name, adj] of [
    ['invert', { invert: true }],
    ['gamma220', { gamma: 220 }],
    ['sat-100', { saturation: -100 }],
    ['hue90', { hue: 90 }],
    ['sharpen80', { sharpen: 80 }],
    ['posterize3', { posterize: 3 }],
    ['pixelate', { pixelate: true, scale: 6 }],
  ]) {
    const r = PM.normalizeRecipe({ palette: 'ash-grey', algorithm: 'bayer8', size: 256, ...adj });
    const out = PM.render(src.rgba, src.width, src.height, r);
    let diff = 0;
    for (let i = 0; i < out.indices.length; i++) if (out.indices[i] !== base.indices[i]) diff++;
    check(`adjust ${name}`, diff > out.indices.length * 0.01, `${(100 * diff / out.indices.length).toFixed(1)}% pixels changed`);
    fs.writeFileSync(path.join(OUT, `adj-${name}.png`), Buffer.from(PMC.encodeIndexedPng(out.indices, out.width, out.height, out.palette)));
  }
}

// ---- determinism ----------------------------------------------------------
{
  const r = PM.normalizeRecipe({ palette: 'pico8', algorithm: 'void-cluster', size: 300 });
  const a = PM.render(src.rgba, src.width, src.height, r);
  const b = PM.render(src.rgba, src.width, src.height, r);
  let same = true;
  for (let i = 0; i < a.indices.length; i++) if (a.indices[i] !== b.indices[i]) { same = false; break; }
  check('deterministic', same);
}

// ---- clamping -------------------------------------------------------------
{
  const r = PM.normalizeRecipe({ size: 99999, scale: -4, strength: 900, algorithm: 'nope', palette: 'nope' });
  check('recipe clamping', r.size === 1024 && r.scale === 1 && r.strength === 200 && r.algorithm === 'bayer4' && r.palette === 'ink-cyan',
    JSON.stringify({ size: r.size, scale: r.scale, strength: r.strength, algorithm: r.algorithm, palette: r.palette }));
}

// ---- payload size at the sandbox ceiling ---------------------------------
for (const size of [512, 768, 1024]) {
  const r = PM.normalizeRecipe({ palette: 'pico8', algorithm: 'floyd-steinberg', size });
  const t0 = Date.now();
  const out = PM.render(src.rgba, src.width, src.height, r);
  const png = PMC.encodeIndexedPng(out.indices, out.width, out.height, out.palette);
  const b64 = PMC.b64encode(png);
  console.log(`  size=${size}: render+encode ${Date.now() - t0}ms, png ${(png.length / 1024).toFixed(0)}KB, base64 ${(b64.length / 1024).toFixed(0)}KB`);
}

console.log(fails === 0 ? '\nALL ENGINE TESTS PASSED' : `\n${fails} FAILURE(S)`);
process.exit(fails === 0 ? 0 : 1);
