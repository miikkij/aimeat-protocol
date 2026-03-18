/**
 * @file cortex-ui-e2e.ts
 * @description E2E tests for aimeat-ui cortex library (install, activate, serve, deactivate)
 * @version-history
 *   v1.0.0 — 2026-03-16 — Initial: lifecycle tests for all 5 UI cortexes
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const CORTEX_DIR = join(__dirname, '..', 'public', 'cortex-bundled');

let passed = 0, failed = 0;
let ownerToken = '';
let ownerGaii = '';

async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}

async function json(path: string, opts?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, opts);
  const body = res.headers.get('content-type')?.includes('json') ? await res.json() : { _raw: await res.text() };
  return { status: res.status, body, headers: res.headers };
}

const UI_CORTEXES = [
  'aimeat-ui-dialogs',
  'aimeat-ui-layout',
  'aimeat-ui-viewers',
  'aimeat-ui-nav',
  'aimeat-ui-forms',
];

// ── Phase 0: Setup ──────────────────────────────────────
console.log('\n── Phase 0: Registration ──');

const OWNER_NAME = 'ui-test-owner-' + Date.now();
const OWNER_PASS = 'TestPass123!';

await test('Register owner', async () => {
  const r = await json('/v1/ghii', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: OWNER_NAME, display_name: 'UI Test Owner', password: OWNER_PASS }),
  });
  if (r.status !== 201) throw new Error(`Expected 201, got ${r.status}: ${JSON.stringify(r.body)}`);
  ownerGaii = r.body.data?.ghii?.ghii || r.body.data?.gaii;
});

await test('Login owner', async () => {
  const r = await json('/v1/ghii/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: OWNER_NAME, password: OWNER_PASS }),
  });
  if (r.status !== 200) throw new Error(`Expected 200, got ${r.status}: ${JSON.stringify(r.body)}`);
  ownerToken = r.body.data?.token;
  if (!ownerToken) throw new Error('No token in response');
});

// ── Phase 1: Install all 5 UI cortexes ──────────────────
console.log('\n── Phase 1: Install UI Cortexes ──');
for (const name of UI_CORTEXES) {
  await test(`Install ${name}`, async () => {
    const yaml = readFileSync(join(CORTEX_DIR, `${name}.yaml`), 'utf-8');
    const js = readFileSync(join(CORTEX_DIR, `${name}.js`), 'utf-8');
    const r = await json('/v1/cortex', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ownerToken}` },
      body: JSON.stringify({ manifest: yaml, libs: { [`${name}.js`]: js } }),
    });
    if (r.status !== 201 && r.status !== 409) throw new Error(`Expected 201 or 409, got ${r.status}: ${JSON.stringify(r.body)}`);
  });
}

// ── Phase 2: Activate all ────────────────────────────────
console.log('\n── Phase 2: Activate UI Cortexes ──');
for (const name of UI_CORTEXES) {
  await test(`Activate ${name}`, async () => {
    const r = await json(`/v1/cortex/${name}/activate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ownerToken}` },
    });
    if (r.status !== 200) throw new Error(`Expected 200, got ${r.status}`);
  });
}

// ── Phase 3: Verify lib serving ──────────────────────────
console.log('\n── Phase 3: Verify Lib Serving ──');
for (const name of UI_CORTEXES) {
  await test(`Serve ${name}.js`, async () => {
    const r = await fetch(`${BASE}/v1/cortex/${name}/libs/${name}.js`);
    if (r.status !== 200) throw new Error(`Expected 200, got ${r.status}`);
    const ct = r.headers.get('content-type');
    if (!ct || !ct.includes('javascript')) throw new Error(`Bad content-type: ${ct}`);
    const text = await r.text();
    if (!text.includes('AIMEAT.ui')) throw new Error('Missing AIMEAT.ui namespace in lib');
  });
}

// ── Phase 4: Verify AIMEAT.ui namespace isolation ────────
console.log('\n── Phase 4: Namespace checks ──');
await test('All UI cortexes register under AIMEAT.ui', async () => {
  for (const name of UI_CORTEXES) {
    const r = await fetch(`${BASE}/v1/cortex/${name}/libs/${name}.js`);
    const text = await r.text();
    if (!text.includes('AIMEAT.ui = AIMEAT.ui || {}')) {
      throw new Error(`${name}: Missing defensive AIMEAT.ui creation`);
    }
  }
});

// ── Phase 5: Deactivate + verify lib stops serving ───────
console.log('\n── Phase 5: Deactivate ──');
await test('Deactivated cortex lib returns 404', async () => {
  await json('/v1/cortex/aimeat-ui-dialogs/deactivate', {
    method: 'POST',
    headers: { Authorization: `Bearer ${ownerToken}` },
  });
  const r = await fetch(`${BASE}/v1/cortex/aimeat-ui-dialogs/libs/aimeat-ui-dialogs.js`);
  if (r.status !== 404) throw new Error(`Expected 404, got ${r.status}`);
});

await test('Re-activate for cleanup', async () => {
  const r = await json('/v1/cortex/aimeat-ui-dialogs/activate', {
    method: 'POST',
    headers: { Authorization: `Bearer ${ownerToken}` },
  });
  if (r.status !== 200) throw new Error(`Expected 200, got ${r.status}`);
});

// ── Cleanup: Uninstall all ───────────────────────────────
console.log('\n── Cleanup ──');
for (const name of UI_CORTEXES) {
  await json(`/v1/cortex/${name}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${ownerToken}` },
  });
}

// Delete test owner (use owner name, not GAII)
await json(`/v1/owners/${OWNER_NAME}`, {
  method: 'DELETE',
  headers: { Authorization: `Bearer ${ownerToken}` },
});

console.log(`\n═══ Results: ${passed} passed, ${failed} failed ═══`);
process.exit(failed > 0 ? 1 : 0);
