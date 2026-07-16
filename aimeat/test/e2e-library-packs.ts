/**
 * @file aimeat/test/e2e-library-packs.ts
 * @description Library-pack registry E2E — the anti-drift contract of the Library Acceleration
 *   Program. Asserts that (a) the /v1/library-packs index + detail endpoints serve every pack
 *   with a rendered include + ai_doc, (b) every include URL actually resolves 200 on this node,
 *   (c) every demoTemplateId exists in /v1/app-templates, (d) the /v1/libs catalogue is a
 *   subset of the registry's sdk packs, (e) the build-app prompt contains every stable pack id,
 *   (f) cortex-pack versions match the bundled cortex YAML spec.version, and the failure mode
 *   (unknown pack id → 404 NOT_FOUND).
 * @usage registered in test/run-e2e-ci.ts; run via the e2e harness
 *   (cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=library-packs).
 * @version-history v1.0.0 — 2026-07-16 — initial (Library Acceleration Program, Phase 1).
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const __dirname = dirname(fileURLToPath(import.meta.url));

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (err: any) {
    failed++;
    console.error(`  ❌ ${name}: ${err.message}`);
  }
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

async function json(path: string, opts: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...opts.headers },
  });
  const ct = res.headers.get('content-type') ?? '';
  const body = ct.includes('json') ? (await res.json()) as any : { _raw: await res.text(), _ct: ct };
  return { status: res.status, body };
}

console.log('\n=== AIMEAT Library Packs E2E Test ===\n');
console.log(`Base: ${BASE}\n`);

let packs: any[] = [];

await test('GET /v1/library-packs returns the pack index', async () => {
  const { status, body } = await json('/v1/library-packs');
  assert(status === 200, `Expected 200, got ${status}`);
  assert(body.ok === true, 'Expected ok: true');
  packs = body.data?.packs ?? [];
  assert(packs.length >= 30, `Expected >= 30 packs, got ${packs.length}`);
  for (const p of packs) {
    assert(typeof p.id === 'string' && p.id.length > 0, 'pack missing id');
    assert(Array.isArray(p.include) && p.include.length > 0, `${p.id}: missing include lines`);
    assert(['sdk', 'cortex', 'vendored', 'bundle'].includes(p.kind), `${p.id}: bad kind ${p.kind}`);
    assert(['preview', 'stable', 'deprecated'].includes(p.status), `${p.id}: bad status ${p.status}`);
    assert(p.include.every((l: string) => !l.includes('{{BASE_URL}}')), `${p.id}: include not rendered`);
  }
});

await test('index filters work (?kind=vendored, ?status=stable)', async () => {
  const { body: v } = await json('/v1/library-packs?kind=vendored');
  assert(v.data.packs.length > 0 && v.data.packs.every((p: any) => p.kind === 'vendored'), 'kind filter broken');
  const { body: s } = await json('/v1/library-packs?status=stable');
  assert(s.data.packs.every((p: any) => p.status === 'stable'), 'status filter broken');
});

await test('?lang=fi localizes capability pack titles', async () => {
  const { body } = await json('/v1/library-packs?lang=fi');
  const styling = body.data.packs.find((p: any) => p.id === 'styling');
  assert(styling && /Tyylipino/.test(styling.title), `Expected Finnish title, got "${styling?.title}"`);
});

await test('GET /v1/library-packs/:id returns ai_doc + changelog (rendered)', async () => {
  const { status, body } = await json('/v1/library-packs/chartjs');
  assert(status === 200, `Expected 200, got ${status}`);
  const pack = body.data?.pack;
  assert(typeof pack?.ai_doc === 'string' && pack.ai_doc.length > 100, 'ai_doc missing/too short');
  assert(Array.isArray(pack?.changelog) && pack.changelog.length > 0, 'changelog missing');
  assert(!pack.ai_doc.includes('{{BASE_URL}}'), 'ai_doc not rendered');
  assert(pack.changelog.every((c: any) => c.version && c.date && c.summary), 'changelog entry missing fields');
});

await test('unknown pack id → 404 NOT_FOUND', async () => {
  const { status, body } = await json('/v1/library-packs/no-such-pack');
  assert(status === 404, `Expected 404, got ${status}`);
  assert(body.error?.code === 'NOT_FOUND', `Expected NOT_FOUND, got ${body.error?.code}`);
});

await test('every include URL resolves 200 on this node', async () => {
  const urls = new Set<string>();
  for (const p of packs) {
    for (const line of p.include) {
      for (const m of line.matchAll(/(?:src|href)="([^"]+)"/g)) {
        urls.add(m[1]);
      }
    }
  }
  assert(urls.size > 20, `Suspiciously few include URLs (${urls.size})`);
  // Cortex packs are seeded fire-and-forget at boot (service-init → seedBundledCortexes), so on a
  // slower backend (postgres-kysely) their /v1/cortex/... URLs can 404 for the first seconds after
  // the server reports ready. Retry misses briefly instead of racing the seeder.
  let misses: string[] = [];
  for (let attempt = 0; attempt < 15; attempt++) {
    misses = [];
    for (const url of urls) {
      const res = await fetch(url.startsWith('http') ? url : `${BASE}${url}`);
      if (res.status !== 200) misses.push(`${url} → ${res.status}`);
    }
    if (misses.length === 0) break;
    await new Promise(r => setTimeout(r, 1000));
  }
  assert(misses.length === 0, `Include URLs not served: ${misses.join(', ')}`);
});

await test('every demoTemplateId exists in /v1/app-templates', async () => {
  const { body } = await json('/v1/app-templates');
  const templateIds = new Set((body.data?.templates ?? []).map((t: any) => t.id));
  const misses = packs.filter(p => p.demoTemplateId && !templateIds.has(p.demoTemplateId));
  assert(misses.length === 0, `Missing demo templates: ${misses.map(p => `${p.id}→${p.demoTemplateId}`).join(', ')}`);
});

await test('/v1/libs catalogue names ⊆ registry sdk pack ids (no drift)', async () => {
  const res = await fetch(`${BASE}/v1/libs`);
  const body = await res.json() as any;
  const sdkIds = new Set(packs.filter(p => p.kind === 'sdk').map(p => p.id));
  const strays = (body.libraries ?? []).filter((l: any) => !sdkIds.has(l.name));
  assert((body.libraries ?? []).length > 0, '/v1/libs returned no libraries');
  assert(strays.length === 0, `Catalogue entries not in registry: ${strays.map((l: any) => l.name).join(', ')}`);
  assert(body.packs_index === '/v1/library-packs', 'packs_index pointer missing');
});

await test('build-app prompt contains every stable pack id (no drift)', async () => {
  const res = await fetch(`${BASE}/v1/prompts/build-app?format=txt`);
  assert(res.status === 200, `Expected 200 from build-app prompt, got ${res.status}`);
  const prompt = await res.text();
  const misses = packs.filter(p => p.status === 'stable' && !prompt.includes(p.id));
  assert(misses.length === 0, `Stable packs missing from the build prompt: ${misses.map(p => p.id).join(', ')}`);
  // Capability-pack plumbing present:
  assert(prompt.includes('/v1/library-packs'), 'prompt does not point AIs at the pack docs endpoint');
});

await test('llms.txt carries the generated library table (token substituted)', async () => {
  const res = await fetch(`${BASE}/llms.txt`);
  const text = await res.text();
  assert(!text.includes('{{LIBRARY_PACKS_TABLE}}'), 'LIBRARY_PACKS_TABLE token not substituted');
  assert(text.includes('| aimeat-auth |'), 'generated table missing aimeat-auth row');
  assert(text.includes('/v1/library-packs'), 'llms.txt does not mention the packs endpoint');
});

await test('bootstrap sdk_libraries derives from the registry', async () => {
  const { body } = await json('/?format=json');
  const app = body.data?.for_ai_assistants?.paths?.build_an_app?.app_building;
  assert(Array.isArray(app?.sdk_libraries) && app.sdk_libraries.length >= 25, `sdk_libraries missing/short (${app?.sdk_libraries?.length})`);
  assert(app.library_packs_endpoint?.endsWith('/v1/library-packs'), 'library_packs_endpoint missing');
});

await test('cortex pack versions match the bundled cortex YAML spec.version', async () => {
  const bundledDir = resolve(__dirname, '../public/cortex-bundled');
  const mismatches: string[] = [];
  for (const p of packs.filter(x => x.kind === 'cortex')) {
    const yaml = readFileSync(resolve(bundledDir, `${p.id}.yaml`), 'utf-8');
    const m = yaml.match(/^\s*version:\s*"([^"]+)"/m);
    if (!m) { mismatches.push(`${p.id}: no version in YAML`); continue; }
    if (m[1] !== p.version) mismatches.push(`${p.id}: yaml ${m[1]} != registry ${p.version}`);
  }
  assert(mismatches.length === 0, mismatches.join(', '));
});

console.log('\n' + '─'.repeat(40));
console.log(`Library packs E2E: ${passed} passed, ${failed} failed of ${passed + failed}`);
if (failed > 0) process.exit(1);
console.log('✅ All library-pack tests passed!\n');
