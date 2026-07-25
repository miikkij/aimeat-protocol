import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const PMC = require('../src/codec.js');

const FX = path.join(import.meta.dirname, '..', 'fixtures');
const OUT = path.join(import.meta.dirname, '..', 'out');
fs.mkdirSync(OUT, { recursive: true });

let fails = 0;
function check(name, ok, detail = '') {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
}

function load(f) { return new Uint8Array(fs.readFileSync(path.join(FX, f))); }

// ---- reference decode via PIL (dumped to raw rgba by a helper) -------------
function ref(name) {
  const p = path.join(FX, name + '.rawrgba');
  const meta = JSON.parse(fs.readFileSync(path.join(FX, name + '.meta.json'), 'utf8'));
  return { ...meta, rgba: new Uint8Array(fs.readFileSync(p)) };
}

function compare(name, got, want, tol, alphaTol = 0, meanTol = Infinity) {
  if (got.width !== want.width || got.height !== want.height) {
    check(name, false, `size ${got.width}x${got.height} != ${want.width}x${want.height}`);
    return;
  }
  let maxd = 0, sum = 0, n = got.rgba.length / 4;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(got.rgba[i * 4 + c] - want.rgba[i * 4 + c]);
      if (d > maxd) maxd = d;
      sum += d;
    }
    const da = Math.abs(got.rgba[i * 4 + 3] - want.rgba[i * 4 + 3]);
    if (da > alphaTol) { maxd = Math.max(maxd, 999); }
  }
  const mean = sum / (n * 3);
  check(name, maxd <= tol && mean <= meanTol, `maxdiff=${maxd} mean=${mean.toFixed(2)}`);
}

// ---- PNG decode -----------------------------------------------------------
for (const [file, key, tol] of [
  ['rgb8.png', 'rgb8', 0],
  ['gray8.png', 'gray8', 0],
  ['pal4.png', 'pal4', 0],
  ['pal8.png', 'pal8', 0],
  ['rgba8.png', 'rgba8', 0],
  ['graya8.png', 'graya8', 0],
  ['bw1.png', 'bw1', 0],
  ['pal2.png', 'pal2', 0],
  ['rgb8_nocompress.png', 'rgb8', 0],
  ['big.png', 'big', 0],
]) {
  try {
    const got = PMC.decodeImage(load(file), 0);
    compare('png ' + file, got, ref(key), tol, 0);
  } catch (e) {
    check('png ' + file, false, e.message);
  }
}

// ---- JPEG decode, full scale ---------------------------------------------
// Chroma is upsampled by replication, not by PIL's triangular "fancy upsampling", so subsampled
// files legitimately differ at sharp colour edges. Mean error is the meaningful number.
for (const [file, key, tol, meanTol] of [
  ['base_j444.jpg', 'base_j444', 6, 1],
  ['base_j422.jpg', 'base_j422', 96, 6],
  ['base_j420.jpg', 'base_j420', 96, 6],
  ['base_gray.jpg', 'base_gray', 3, 1],
  ['base_rst.jpg', 'base_rst', 96, 6],
]) {
  try {
    const got = PMC.decodeImage(load(file), 0);
    compare('jpeg ' + file, got, ref(key), tol, 255, meanTol);
  } catch (e) {
    check('jpeg ' + file, false, e.message);
  }
}

// ---- JPEG rejections ------------------------------------------------------
for (const [file, needle] of [['prog.jpg', 'progressive']]) {
  let msg = '';
  try { PMC.decodeImage(load(file), 0); } catch (e) { msg = e.message; }
  check('jpeg reject ' + file, msg.includes(needle), msg || '(no error thrown)');
}

// ---- JPEG scaled decode ---------------------------------------------------
// 1200 px source, SLACK 1.35: a scale is accepted when decoded * 1.35 still covers the target,
// so 200 stays on the 1/8 decode (150 px) and the resampler makes up the last 25 %.
for (const [target, expectW] of [[100, 150], [200, 150], [500, 600], [900, 1200]]) {
  try {
    const t0 = Date.now();
    const got = PMC.decodeImage(load('big.jpg'), target);
    check(`jpeg scaled target=${target}`, got.width === expectW,
      `-> ${got.width}x${got.height} in ${Date.now() - t0}ms`);
  } catch (e) {
    check(`jpeg scaled target=${target}`, false, e.message);
  }
}

// ---- deflate round trip ---------------------------------------------------
{
  const data = new Uint8Array(200000);
  for (let i = 0; i < data.length; i++) data[i] = (i % 97 < 40) ? (i % 5) : ((i * 7) & 15);
  const z = PMC.deflateZlib(data);
  const back = PMC.inflateRaw(z, 2);
  let same = back.length === data.length;
  if (same) for (let i = 0; i < data.length; i++) if (back[i] !== data[i]) { same = false; break; }
  check('deflate roundtrip', same, `${data.length} -> ${z.length} bytes (${(100 * z.length / data.length).toFixed(1)}%)`);
}

// ---- indexed PNG encode (verified by PIL in the shell step) ---------------
for (const [n, name] of [[2, 'enc2'], [4, 'enc4'], [16, 'enc16'], [64, 'enc64']]) {
  const w = 137, h = 91;
  const idx = new Uint8Array(w * h);
  const pal = [];
  for (let i = 0; i < n; i++) pal.push([(i * 37) % 256, (i * 91) % 256, (i * 143) % 256]);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) idx[y * w + x] = (x * 3 + y * 5) % n;
  const png = PMC.encodeIndexedPng(idx, w, h, pal);
  fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(png));
  // self-check: decode it back with our own decoder
  const back = PMC.decodePng(png);
  let ok = back.width === w && back.height === h;
  if (ok) {
    for (let i = 0; i < w * h && ok; i++) {
      const p = pal[idx[i]];
      if (back.rgba[i * 4] !== p[0] || back.rgba[i * 4 + 1] !== p[1] || back.rgba[i * 4 + 2] !== p[2]) ok = false;
    }
  }
  check(`encodeIndexedPng n=${n}`, ok, `${png.length} bytes`);
}

console.log(fails === 0 ? '\nALL CODEC TESTS PASSED' : `\n${fails} FAILURE(S)`);
process.exit(fails === 0 ? 0 : 1);
