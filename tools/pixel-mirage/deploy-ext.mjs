/** Upsert the built extension straight over the REST API (the presigned path cannot update). */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = import.meta.dirname;
const TOKEN = fs.readFileSync(path.join(ROOT, '.token'), 'utf8').trim();
const BASE = process.env.PM_BASE || 'https://aimeat.io';

const manifest = fs.readFileSync(path.join(ROOT, 'dist', 'manifest.yaml'), 'utf8');
const scripts = {};
for (const f of ['dither.js', 'variants.js', 'styles.js']) {
  scripts[f] = fs.readFileSync(path.join(ROOT, 'dist', f), 'utf8');
}

const res = await fetch(`${BASE}/v1/extensions/pixel-mirage`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
  body: JSON.stringify({ manifest, scripts }),
});
const body = await res.json();
console.log(res.status, JSON.stringify(body).slice(0, 400));

if (res.ok) {
  const act = await fetch(`${BASE}/v1/extensions/pixel-mirage/activate`, {
    method: 'POST', headers: { Authorization: `Bearer ${TOKEN}` },
  });
  console.log('activate', act.status, JSON.stringify(await act.json()).slice(0, 200));
}
