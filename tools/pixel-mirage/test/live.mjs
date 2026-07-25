/**
 * Drive the DEPLOYED extension over HTTP and report the real sandbox timings — the only number
 * that matters against the node's 5 s / 64 MB action ceiling.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const PMC = require('../src/codec.js');

const ROOT = path.join(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'out', 'live');
fs.mkdirSync(OUT, { recursive: true });
const TOKEN = fs.readFileSync(path.join(ROOT, '.token'), 'utf8').trim();
const BASE = process.env.PM_BASE || 'https://aimeat.io';

async function call(action, input) {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/v1/ext/pixel-mirage/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(input),
  });
  const wall = Date.now() - t0;
  const json = await res.json();
  return { status: res.status, wall, body: json };
}

function b64of(file) {
  const bytes = new Uint8Array(fs.readFileSync(file));
  const kind = file.endsWith('.png') ? 'png' : 'jpeg';
  return { b64: `data:image/${kind};base64,` + PMC.b64encode(bytes), bytes: bytes.length };
}

let fails = 0;
const check = (name, ok, detail = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); };

const cases = JSON.parse(process.env.PM_CASES || '[]');
for (const c of cases) {
  const img = b64of(c.file);
  const r = await call('dither', { image_base64: img.b64, ...c.recipe });
  if (r.status !== 200) {
    check(c.name, false, `HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`);
    continue;
  }
  const d = r.body.data ?? r.body;
  const t = d.timing_ms || {};
  check(c.name, !!d.image,
    `src ${(img.bytes / 1024).toFixed(0)}KB ${d.source?.width}x${d.source?.height} -> ${d.width}x${d.height} | sandbox decode=${t.decode}ms render=${t.render}ms encode=${t.encode}ms total=${t.total}ms | wall=${r.wall}ms | png ${(d.bytes / 1024).toFixed(0)}KB`);
  if (d.image) fs.writeFileSync(path.join(OUT, `${c.name.replace(/[^a-z0-9]+/gi, '-')}.png`), Buffer.from(PMC.b64decode(d.image)));
}

console.log(fails === 0 ? '\nLIVE OK' : `\n${fails} LIVE FAILURE(S)`);
process.exit(fails === 0 ? 0 : 1);
