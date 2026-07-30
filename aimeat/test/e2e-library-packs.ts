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
 * @version-history
 *   v1.0.0 — 2026-07-16 — initial (Library Acceleration Program, Phase 1).
 *   v1.1.0 — 2026-07-30 — ffmpeg-core: the loader, its classic-script twin and the fetched 32 MB
 *     wasm are served with the right content-type and an immutable cache. The wasm is checked with
 *     HEAD (no 32 MB transfer) and the failure message names `pnpm vendor:libs`, since a missing
 *     vendored asset is the one way this pack breaks.
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

// The ffmpeg core is the one pack whose binary is NOT in git — it is fetched by
// `pnpm vendor:libs` (public/lib/vendored-assets.json). A deploy that skips that step serves 404s
// here, which is indistinguishable from "the app is broken" until someone reads a CSP-free console.
// The include line carries no src="" attribute (it builds blob URLs at runtime), so the generic
// include-URL sweep below cannot see these paths — they are asserted by hand, and the wasm with
// HEAD so the suite does not pull 32 MB.
await test('ffmpeg-core: loader is served as JavaScript, immutable', async () => {
  const res = await fetch(`${BASE}/lib/ffmpeg-core@0.12.6/ffmpeg-core.js`);
  assert(res.status === 200, `ffmpeg-core.js → ${res.status} (run: pnpm vendor:libs)`);
  assert(/javascript/i.test(res.headers.get('content-type') ?? ''), `content-type ${res.headers.get('content-type')}`);
  assert((res.headers.get('cache-control') ?? '').includes('immutable'), `a fully version-pinned path should be immutable, got ${res.headers.get('cache-control')}`);
  const umd = await fetch(`${BASE}/lib/ffmpeg-core@0.12.6/ffmpeg-core.umd.js`, { method: 'HEAD' });
  assert(umd.status === 200, `the classic-script twin is missing → ${umd.status}`);
});

await test('ffmpeg-core: the 32 MB wasm is served as application/wasm, immutable', async () => {
  const res = await fetch(`${BASE}/lib/ffmpeg-core@0.12.6/ffmpeg-core.wasm`, { method: 'HEAD' });
  assert(res.status === 200, `ffmpeg-core.wasm → ${res.status}. It is fetched, not committed: run pnpm vendor:libs`);
  // A wrong type breaks WebAssembly.instantiateStreaming in some paths, and browsers do not guess.
  assert(res.headers.get('content-type') === 'application/wasm', `content-type ${res.headers.get('content-type')}`);
  assert(res.headers.get('content-length') === '32129114', `size ${res.headers.get('content-length')} — expected the pinned 32129114 bytes`);
  assert((res.headers.get('cache-control') ?? '').includes('immutable'), `32 MB must not be refetched per visit, got ${res.headers.get('cache-control')}`);
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

// ── AI-acceleration tier + per-model proof ledger (tools/aeb/acceleration-tiers.md) ──
await test('modelTier is a valid value; frontier packs carry an apiCaveat', async () => {
  const bad = packs.filter(p => p.modelTier && !['any', 'frontier', 'needs-doc'].includes(p.modelTier));
  assert(bad.length === 0, `Bad modelTier: ${bad.map(p => `${p.id}=${p.modelTier}`).join(', ')}`);
  // A frontier pack is a version-drift trap — it MUST inline the breaking idiom or the warning is toothless.
  const frontierNoCaveat = packs.filter(p => p.modelTier === 'frontier' && !(typeof p.apiCaveat === 'string' && p.apiCaveat.length > 20));
  assert(frontierNoCaveat.length === 0, `frontier packs missing apiCaveat: ${frontierNoCaveat.map(p => p.id).join(', ')}`);
});

await test('proof ledger entries are well-formed (model, verdict, evidence path)', async () => {
  const problems: string[] = [];
  for (const p of packs) {
    if (!p.proofs) continue;
    assert(Array.isArray(p.proofs), `${p.id}: proofs not an array`);
    for (const pr of p.proofs) {
      if (!pr.model || typeof pr.model !== 'string') problems.push(`${p.id}: proof missing model`);
      if (!['pass', 'fail'].includes(pr.verdict)) problems.push(`${p.id}: bad verdict ${pr.verdict}`);
      if (typeof pr.evidence !== 'string' || !pr.evidence.startsWith('tools/aeb/results/')) problems.push(`${p.id}: evidence not a results/ path`);
      if (!pr.date) problems.push(`${p.id}: proof missing date`);
    }
  }
  assert(problems.length === 0, problems.join('; '));
});

await test('detail endpoint exposes modelTier/proofs/apiCaveat for a proven pack', async () => {
  const { body } = await json('/v1/library-packs/pixi');
  const pack = body.data?.pack;
  assert(pack?.modelTier === 'frontier', `pixi modelTier expected frontier, got ${pack?.modelTier}`);
  assert(typeof pack?.apiCaveat === 'string' && /v8/i.test(pack.apiCaveat), 'pixi apiCaveat missing/wrong');
  assert(Array.isArray(pack?.proofs) && pack.proofs.some((pr: any) => pr.model && pr.verdict), 'pixi proofs missing');
});

await test('build-app prompt inlines the apiCaveat for frontier packs', async () => {
  const res = await fetch(`${BASE}/v1/prompts/build-app?format=txt`);
  const prompt = await res.text();
  const frontier = packs.filter(p => p.modelTier === 'frontier' && p.apiCaveat);
  // The prompt only lists vendored/cortex capability packs — check the ones that appear there.
  const misses = frontier.filter(p => prompt.includes(p.id) && !prompt.includes('⚠'));
  assert(misses.length === 0, `frontier caveat not inlined in prompt for: ${misses.map(p => p.id).join(', ')}`);
  // pixi specifically: its v8 caveat fragment must be present next to the pack.
  const pixi = frontier.find(p => p.id === 'pixi');
  if (pixi && prompt.includes('pixi')) assert(/beginFill|\.rect\(.*\)\.fill\(|v8/i.test(prompt), 'pixi v8 caveat fragment absent from prompt');
  // The reliability tier is surfaced to the building AI (not left as API-only metadata).
  assert(/\[frontier\]|\[any\]|\[needs-doc\]/.test(prompt), 'no modelTier tag surfaced in the build prompt');
  assert(/reliability tag from AEB testing/i.test(prompt), 'prompt does not explain the tier tags');
});

// ── Community packs: an ACTIVE + PUBLIC user cortex with a lib component appears in the
// index (scope 'community') and serves its type:prompt content as the ai_doc. ──
await test('community pack: active+public user cortex appears with ai_doc', async () => {
  // Register + login a throwaway owner
  const uname = 'packcomm' + Date.now().toString().slice(-6);
  await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: uname, password: 'PackComm1!', display_name: 'Pack Comm' }) });
  const { body: login } = await json('/v1/ghii/login', { method: 'POST', body: JSON.stringify({ username: uname, password: 'PackComm1!' }) });
  const tok = login.data?.token || login.data?.jwt;
  assert(!!tok, 'owner login failed');
  const auth = { Authorization: `Bearer ${tok}` };

  const extName = uname + '-greeter';
  const manifest = [
    'apiVersion: cortex.aimeat.org/v1',
    'kind: Extension',
    'metadata:',
    `  name: ${extName}`,
    `  namespace: ${uname}`,
    '  description: "Tiny community greeter lib for the pack test"',
    '  author: e2e',
    '  visibility: public',
    '  tags: [ui]',
    'spec:',
    '  version: "1.0.0"',
    '  license: MIT',
    '  components:',
    '    - type: prompt',
    '      name: greeter-doc',
    '      content: |',
    '        Include: <script src="{{node_url}}/v1/cortex/' + extName + '/libs/' + extName + '.js"></' + 'script>',
    '        API: AIMEAT.greeter.hello(name) -> string greeting.',
    '    - type: lib',
    `      name: ${extName}`,
    `      filename: ${extName}.js`,
    '      exports: [hello]',
    '      api_surface: |',
    '        AIMEAT.greeter.hello(name) -> string',
  ].join('\n');
  const libJs = '(function(A){A.greeter={hello:function(n){return "hello "+n;}};})(window.AIMEAT=window.AIMEAT||{});';

  const { status: inst, body: instBody } = await json('/v1/cortex', {
    method: 'POST', headers: auth,
    body: JSON.stringify({ manifest, libs: { [extName + '.js']: libJs } }),
  });
  assert(inst === 201, `install expected 201, got ${inst}: ${JSON.stringify(instBody.error || instBody).slice(0, 150)}`);
  const { status: act, body: actBody } = await json(`/v1/cortex/${extName}/activate`, { method: 'POST', headers: auth });
  assert(act === 200 || act === 201, `activate expected 200, got ${act}: ${JSON.stringify(actBody.error || actBody).slice(0, 150)}`);

  // Appears in the index with scope community
  const { body: idx } = await json('/v1/library-packs?scope=community');
  const entry = (idx.data?.packs || []).find((p: any) => p.id === extName);
  assert(!!entry, 'community pack missing from index');
  assert(entry.scope === 'community' && entry.status === 'preview', `bad scope/status: ${entry.scope}/${entry.status}`);
  assert(entry.include[0].includes(`/v1/cortex/${extName}/libs/${extName}.js`), 'include line wrong');

  // Detail serves the type:prompt content as ai_doc, with {{node_url}} rendered
  const { status: ds, body: det } = await json(`/v1/library-packs/${extName}`);
  assert(ds === 200, `detail expected 200, got ${ds}`);
  const doc = det.data?.pack?.ai_doc || '';
  assert(doc.includes('AIMEAT.greeter.hello'), 'ai_doc missing prompt content');
  assert(!doc.includes('{{node_url}}'), 'ai_doc not rendered');
  // Node packs unaffected + carry scope node
  const { body: chart } = await json('/v1/library-packs/chartjs');
  assert(chart.data?.pack?.scope === 'node', 'static pack missing scope node');

  // Cleanup so repeated runs stay clean
  await json(`/v1/cortex/${extName}`, { method: 'DELETE', headers: auth });
});

await test('community pack: PRIVATE user cortex does NOT leak into the public index', async () => {
  const uname = 'packpriv' + Date.now().toString().slice(-6);
  await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: uname, password: 'PackPriv1!', display_name: 'Pack Priv' }) });
  const { body: login } = await json('/v1/ghii/login', { method: 'POST', body: JSON.stringify({ username: uname, password: 'PackPriv1!' }) });
  const tok = login.data?.token || login.data?.jwt;
  const auth = { Authorization: `Bearer ${tok}` };
  const extName = uname + '-secret';
  const manifest = [
    'apiVersion: cortex.aimeat.org/v1', 'kind: Extension', 'metadata:', `  name: ${extName}`,
    `  namespace: ${uname}`, '  description: "private lib"', '  author: e2e', '  visibility: private',
    'spec:', '  version: "1.0.0"', '  license: MIT', '  components:',
    '    - type: lib', `      name: ${extName}`, `      filename: ${extName}.js`,
    '      exports: [x]', '      api_surface: |', '        x()',
  ].join('\n');
  const { status: inst } = await json('/v1/cortex', {
    method: 'POST', headers: auth,
    body: JSON.stringify({ manifest, libs: { [extName + '.js']: '(function(){})();' } }),
  });
  assert(inst === 201, `install expected 201, got ${inst}`);
  await json(`/v1/cortex/${extName}/activate`, { method: 'POST', headers: auth });
  const { body: idx } = await json('/v1/library-packs');
  assert(!(idx.data?.packs || []).some((p: any) => p.id === extName), 'PRIVATE cortex leaked into the public pack index');
  const { status: ds } = await json(`/v1/library-packs/${extName}`);
  assert(ds === 404, `private cortex detail should 404, got ${ds}`);
  await json(`/v1/cortex/${extName}`, { method: 'DELETE', headers: auth });
});

console.log('\n' + '─'.repeat(40));
console.log(`Library packs E2E: ${passed} passed, ${failed} failed of ${passed + failed}`);
if (failed > 0) process.exit(1);
console.log('✅ All library-pack tests passed!\n');
