/**
 * Run the BUILT action bundles from dist/ the way the sandbox does: rewrite `export default` into a
 * const, evaluate in a bare context with no Node globals, and call it with a stub ctx.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const PMC = require('../src/codec.js');

const ROOT = path.join(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'out');
fs.mkdirSync(OUT, { recursive: true });

let fails = 0;
function check(name, ok, detail = '') {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
}

function loadAction(file) {
  const src = fs.readFileSync(path.join(ROOT, 'dist', file), 'utf8');
  const transformed = src.replace(/export\s+default\s+/, 'const __userFn = ').trim();
  const context = vm.createContext({
    // Deliberately bare: no require, no process, no Buffer — the sandbox has none of them.
    Math, JSON, Date, Error, Array, Object, String, Number, Boolean, isFinite, parseInt, parseFloat,
    Uint8Array, Int8Array, Int16Array, Int32Array, Float32Array, Float64Array, ArrayBuffer, Set, Map,
    Promise,
  });
  vm.runInContext(`${transformed};\nglobalThis.__run = (ctx, input) => __userFn(ctx, input);`, context, { filename: file });
  return context.__run;
}

const memoryStore = new Map();
const ctx = {
  memory: {
    getPublic: async (gaii, key) => {
      const v = memoryStore.get(`${gaii}/${key}`);
      if (!v) return null;
      return { value: v };
    },
  },
  caller: { gaii: 'tester#happydude500001@aimeat-finland-001-genesis' },
  log: Object.assign(() => {}, { info: () => {}, warn: () => {}, error: () => {} }),
};

const photo = process.argv[2] || path.join(ROOT, 'fixtures', 'big.jpg');
const photoB64 = 'data:image/jpeg;base64,' + PMC.b64encode(new Uint8Array(fs.readFileSync(photo)));
const pngB64 = PMC.b64encode(new Uint8Array(fs.readFileSync(path.join(ROOT, 'fixtures', 'live', 'p1024.png'))));
const pngTooBig = PMC.b64encode(new Uint8Array(fs.readFileSync(path.join(ROOT, 'fixtures', 'live', 'p1600.png'))));

const dither = loadAction('dither.js');
const variants = loadAction('variants.js');
const styles = loadAction('styles.js');

// ---- styles ---------------------------------------------------------------
{
  const r = await styles(ctx, {});
  check('styles catalogue', r.palettes.length > 20 && r.algorithms.length === 18,
    `${r.palettes.length} palettes, ${r.algorithms.length} algorithms, max ${r.limits.max_output_px}px`);
}

// ---- dither, base64 jpeg --------------------------------------------------
{
  const r = await dither(ctx, { image_base64: photoB64, palette: 'riso-trio', algorithm: 'halftone-dot', size: 640, scale: 3, angle: 30 });
  check('dither jpeg', r.image.startsWith('data:image/png;base64,') && r.width === 640,
    `${r.width}x${r.height} ${(r.bytes / 1024).toFixed(0)}KB timings=${JSON.stringify(r.timing_ms)}`);
  fs.writeFileSync(path.join(OUT, 'act-dither-jpeg.png'), Buffer.from(PMC.b64decode(r.image)));
}

// ---- dither, bare base64 png, auto palette -------------------------------
{
  const r = await dither(ctx, { image_base64: pngB64, palette: 'auto', colorCount: 6, algorithm: 'atkinson', size: 512, return: 'png' });
  check('dither png auto-palette', !r.image.startsWith('data:') && r.palette.count === 6, r.palette.colors.join(' '));
  fs.writeFileSync(path.join(OUT, 'act-dither-auto.png'), Buffer.from(PMC.b64decode(r.image)));
}

// ---- dither via image_ref -------------------------------------------------
{
  memoryStore.set('happydude500001@aimeat-finland-001-genesis/pixel-mirage.upload.x', { b64: pngB64 });
  const r = await dither(ctx, { image_ref: 'happydude500001@aimeat-finland-001-genesis/pixel-mirage.upload.x', palette: 'gameboy', size: 256 });
  check('dither via image_ref', r.width === 256 && r.palette.count === 4);
}

// ---- recipe echo replays identically -------------------------------------
{
  const a = await dither(ctx, { image_base64: pngB64, palette: 'thermal', algorithm: 'void-cluster', size: 300, scale: 2 });
  const b = await dither(ctx, { image_base64: pngB64, recipe: a.recipe });
  check('recipe round-trip', a.image === b.image, 'echoed recipe reproduces the identical PNG');
}

// ---- variants -------------------------------------------------------------
{
  const r = await variants(ctx, {
    image_base64: photoB64,
    recipe: { size: 320, contrast: 25 },
    variants: [
      { label: 'gameboy', palette: 'gameboy', algorithm: 'bayer8' },
      { label: 'riso', palette: 'riso-trio', algorithm: 'halftone-dot', scale: 3 },
      { label: 'noir', palette: 'neon-noir', algorithm: 'floyd-steinberg' },
      { label: 'print', palette: 'newsprint', algorithm: 'halftone-line', scale: 4, angle: 45 },
    ],
  });
  check('variants', r.count === 4 && r.variants.every((v) => v.image.startsWith('data:image/png')),
    `total ${r.timing_ms.total}ms, labels=${r.variants.map((v) => v.label).join(',')}`);
  r.variants.forEach((v, i) => fs.writeFileSync(path.join(OUT, `act-var-${i}-${v.label}.png`), Buffer.from(PMC.b64decode(v.image))));
}

// ---- failure modes --------------------------------------------------------
const failures = [
  ['no image', {}, 'No image supplied'],
  ['bad format', { image_base64: PMC.b64encode(new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4, 87, 69, 66, 80, 0, 0, 0, 0, 0])) }, 'Unsupported image format'],
  ['oversize', { image_base64: 'A'.repeat(5 * 1024 * 1024) }, 'too large'],
  ['missing ref', { image_ref: 'nobody@nowhere/nothing' }, 'No public memory record'],
  ['png over decode budget', { image_base64: pngTooBig }, 'over the 0.9 MP decode budget'],
];
for (const [name, input, needle] of failures) {
  let msg = '';
  try { await dither(ctx, input); } catch (e) { msg = e.message; }
  check(`error: ${name}`, msg.includes(needle), msg || '(no error thrown)');
}
{
  let msg = '';
  try { await variants(ctx, { image_base64: pngB64, variants: [] }); } catch (e) { msg = e.message; }
  check('error: empty variants', msg.includes('non-empty array'), msg);
  msg = '';
  try { await variants(ctx, { image_base64: pngB64, variants: new Array(9).fill({}) }); } catch (e) { msg = e.message; }
  check('error: too many variants', msg.includes('Too many variants'), msg);
}

// ---- the render budget guard names a workable alternative ---------------
{
  let msg = '', hint = '';
  try {
    await dither(ctx, { image_base64: photoB64, palette: 'thermal', algorithm: 'jarvis', size: 768, sharpen: 60, rotate: 20 });
  } catch (e) { msg = e.message; hint = e.hint || ''; }
  check('budget guard', msg.includes('render time') && /Set size to \d+/.test(hint), `${msg} | ${hint}`);
}

// ---- the payload an agent actually receives ------------------------------
for (const size of [512, 640, 768]) {
  const r = await dither(ctx, { image_base64: photoB64, palette: 'pico8', algorithm: 'floyd-steinberg', size });
  console.log(`  size=${size}: ${r.width}x${r.height}, response image field ${(r.image.length / 1024).toFixed(0)}KB, ${r.timing_ms.total}ms (node)`);
}

console.log(fails === 0 ? '\nALL ACTION TESTS PASSED' : `\n${fails} FAILURE(S)`);
process.exit(fails === 0 ? 0 : 1);
