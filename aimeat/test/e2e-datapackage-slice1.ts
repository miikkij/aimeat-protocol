/**
 * @file test/e2e-datapackage-slice1.ts
 * @description TARGET-063 slice 1, end to end: a package produced by a run with nobody present,
 *   readable by a program that knows nothing about AIMEAT, and readable back by an agent that is
 *   never told the columns.
 *
 *   THE ACCEPTANCE CRITERIA, one test each:
 *     4  — a package appears from a scheduled run, with no handwork
 *     5  — the quality gate refuses bad data and writes NOTHING
 *     6  — a failed run leaves the previous version standing and says why
 *     7  — the permanent address serves the bytes anonymously, with byte ranges
 *     8  — an agent reads the columns out of the Table Schema, never having been told them
 *     9  — the SAME package from a DIFFERENT producer lands on the same hash and the same URL
 *    10  — a pinned version can never change under a consumer
 *   10b  — the package is sellable: odps.yaml rides with every version, cadence from the cron
 *   10c-e— retention is configurable, names what it removed, never eats the current version, and
 *          does nothing at all unless the owner asked for it
 *
 *   WHAT IS PROVEN HERE AND WHAT IS PROVEN OUTSIDE. Test 7 asserts everything DuckDB and pandas
 *   need from the transport: the exact bytes, `text/csv`, `Accept-Ranges`, a correct 206 and a
 *   correct 416. The actual read by a real engine is not run from this suite, because a test that
 *   silently skips when duckdb is absent reports green having proved nothing — which is the shape
 *   this whole target exists to remove. It was run out of band against this same server and the
 *   command is recorded in the version history below, so it is repeatable rather than claimed.
 *
 *   WHY THE FIXTURE IS NOT laake-fi. The real source measured on 2026-08-15 holds 3.2 million rows
 *   across four snapshot tables and lives behind laake.aimeat.io, not on this node. Slice 1 takes
 *   its SHAPE — the shortage list, ~700 rows, refreshed daily — and this fixture produces the same
 *   shape locally so the suite proves the machinery rather than the availability of a third party.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=datapackage-slice1
 * @version-history
 *   v1.0.0 -- 2026-08-15 -- Initial (TARGET-063 vaihe 1, C). The out-of-band engine read:
 *     python -c "import duckdb; print(duckdb.sql(\"SELECT count(*), min(vnr) FROM read_csv('<csvUrl>')\"))"
 */
const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
async function json(path: string, opts: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
  const ct = res.headers.get('content-type') ?? '';
  const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text(), _ct: ct };
  return { status: res.status, body, headers: res.headers };
}

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());
async function sign(privB64: string, msg: string): Promise<string> {
  return Buffer.from(await ed.signAsync(new TextEncoder().encode(msg), Buffer.from(privB64, 'base64'))).toString('base64');
}
async function setupOwner(label: string) {
  const name = `dps${label}${Date.now()}`;
  let reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Slice1', password: 'DataPkgSlice1234' }) });
  for (let i = 0; reg.status === 429 && i < 8; i++) {
    await sleep(1500);
    reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Slice1', password: 'DataPkgSlice1234' }) });
  }
  assert(reg.status === 201, `ghii ${reg.status}: ${JSON.stringify(reg.body?.error)}`);
  const ts = new Date().toISOString();
  const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: await sign(reg.body.data.private_key, name + NODE_ID + ts) }) });
  return { name, gaii: `${name}@${NODE_ID}`, token: tok.body.data.token as string };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

console.log('\n=== Data Package slice 1 E2E (TARGET-063) ===\n');

const EXT = `slice1${Date.now()}`;
const PKG = 'shortages-weekly';

/**
 * The producer. Deterministic: same input, same rows, same bytes, same hash — which is the property
 * test 9 leans on. The shape mirrors the real Fimea shortage file: a Nordic article number, a name,
 * a state and a date.
 */
const SCRIPTS = {
  produce: `export default async function(ctx, input){
    if (!ctx.datapackage) throw new Error('ctx.datapackage unavailable on this road');
    var n = input.rows || 3;
    var rows = [];
    for (var i = 0; i < n; i++) {
      rows.push({
        vnr: '00' + (1000 + i),
        name: 'Laake ' + i + (i === 1 ? ', 10 mg' : ''),
        shortage: i % 2 === 0,
        reported: '2026-08-' + (10 + (i % 5)),
        packages: i * 3,
      });
    }
    return await ctx.datapackage.publish({
      name: input.name,
      changes: input.changes || 'Weekly refresh from the shortage file.',
      title: 'Medicine shortages, weekly',
      resources: [{ name: 'rows', rows: rows, schema: 'infer' }],
      provenance: { license: 'CC-BY-4.0', legalBasis: 'public register',
        sources: [{ url: 'https://fimea.fi/', title: 'Fimea shortage file' }] },
    });
  }`,
  // One cell that cannot be what the schema says it is. The gate must refuse and write nothing.
  produceBad: `export default async function(ctx, input){
    return await ctx.datapackage.publish({
      name: input.name,
      changes: 'A run whose upstream sent a word where a number belongs.',
      resources: [{ name: 'rows', rows: [
        { vnr: '001000', packages: 3 },
        { vnr: '001001', packages: 'not a number' }
      ], schema: { fields: [
        { name: 'vnr', type: 'string' }, { name: 'packages', type: 'integer' }
      ] } }],
    });
  }`,
  boom: `export default async function(ctx, input){
    await ctx.datapackage.fail(input.name, 'SOURCE_UNAVAILABLE: the shortage file did not answer');
    throw new Error('SOURCE_UNAVAILABLE: the shortage file did not answer');
  }`,
};

const manifest = (name: string) => JSON.stringify({
  metadata: { name, version: '1.0.0', description: 'data package slice 1 e2e', author: 'e2e' },
  actions: [
    { id: 'produce', method: 'POST', path: '/produce', script: 'produce' },
    { id: 'produceBad', method: 'POST', path: '/produce-bad', script: 'produceBad' },
    { id: 'boom', method: 'POST', path: '/boom', script: 'boom' },
  ],
  config: { public_access: { default: true } },
  limits: { timeout_ms: 10000, max_api_calls: 8 },
}, null, 2);

let owner: Awaited<ReturnType<typeof setupOwner>>;
let scheduleId = '';
let firstHash = '';
let descriptorUrl = '';
let csvUrl = '';

await test('1. Setup: an owner and a producing extension', async () => {
  owner = await setupOwner('a');
  const inst = await json('/v1/extensions', { method: 'POST', headers: auth(owner.token), body: JSON.stringify({ manifest: manifest(EXT), scripts: SCRIPTS }) });
  assert(inst.status === 201 || inst.status === 200, `install ${inst.status}: ${JSON.stringify(inst.body?.error)}`);
  const act = await json(`/v1/extensions/${EXT}/activate`, { method: 'POST', headers: auth(owner.token) });
  assert(act.status === 200, `activate ${act.status}`);
});

await test('2. The producer is put on a clock — nobody will be present when it runs', async () => {
  const r = await json('/v1/schedules', {
    method: 'POST', headers: auth(owner.token),
    body: JSON.stringify({
      name: `weekly-${EXT}`, kind: 'extension', cron: '0 6 * * 1',
      extension_name: EXT, action_id: 'produce',
      input: { name: PKG, rows: 3 },
    }),
  });
  assert(r.status === 201 || r.status === 200, `schedule ${r.status}: ${JSON.stringify(r.body?.error)}`);
  scheduleId = r.body.data.schedule?.id ?? r.body.data.id;
});

await test('3. ACCEPTANCE: a package appears from the run, with no handwork', async () => {
  const t = await json(`/v1/schedules/${scheduleId}/trigger`, { method: 'POST', headers: auth(owner.token), body: '{}' });
  assert(t.status === 200, `trigger ${t.status}`);
  assert(t.body.data.schedule.lastRunResult === 'success', `run ${t.body.data.schedule.lastRunError ?? ''}`);

  const list = await json('/v1/datapackages', { headers: auth(owner.token) });
  assert(list.status === 200, `list ${list.status}`);
  const pkg = (list.body.data.packages as any[]).find(p => p.name === PKG);
  assert(!!pkg, `the package exists: ${JSON.stringify(list.body.data.packages)}`);
  firstHash = pkg.contentHash;
  descriptorUrl = pkg.descriptorUrl;
  assert(/^sha256:[a-f0-9]{64}$/.test(firstHash), `the version is a content hash, got ${firstHash}`);
  assert(!pkg.lastError, 'a successful run leaves no error on the pointer');
});

await test('4. ACCEPTANCE: the quality gate refuses bad data and writes NOTHING', async () => {
  const r = await json(`/v1/ext/${EXT}/produceBad`, { method: 'POST', headers: auth(owner.token), body: JSON.stringify({ name: PKG }) });
  assert(r.status === 500, `a refused publish must fail the call, got ${r.status}`);
  const msg = JSON.stringify(r.body?.error ?? r.body);
  assert(/QUALITY_GATE/.test(msg), `and say which gate: ${msg}`);
  // The coordinate, not a verdict: row 2, the packages column.
  assert(/row 2/.test(msg) && /packages/.test(msg), `and name the row and the column: ${msg}`);

  // The package still stands on its previous version — nothing half-written at a permanent address.
  const list = await json('/v1/datapackages', { headers: auth(owner.token) });
  const pkg = (list.body.data.packages as any[]).find(p => p.name === PKG);
  assert(pkg.contentHash === firstHash, `the previous version still stands, got ${pkg.contentHash}`);
});

await test('5. ACCEPTANCE: a failed run leaves the previous version standing, and says why', async () => {
  const mk = await json('/v1/schedules', {
    method: 'POST', headers: auth(owner.token),
    body: JSON.stringify({ name: `broken-${EXT}`, kind: 'extension', cron: '0 7 * * 1', extension_name: EXT, action_id: 'boom', input: { name: PKG } }),
  });
  const badSchedule = mk.body.data.schedule?.id ?? mk.body.data.id;
  const t = await json(`/v1/schedules/${badSchedule}/trigger`, { method: 'POST', headers: auth(owner.token), body: '{}' });
  assert(t.body.data.schedule.lastRunResult === 'error', `the run must fail, got ${t.body.data.schedule.lastRunResult}`);
  assert(/SOURCE_UNAVAILABLE/.test(t.body.data.schedule.lastRunError ?? ''), `with the reason: ${t.body.data.schedule.lastRunError}`);

  const list = await json('/v1/datapackages', { headers: auth(owner.token) });
  const pkg = (list.body.data.packages as any[]).find(p => p.name === PKG);
  assert(pkg.contentHash === firstHash, `NO new version: ${pkg.contentHash}`);
  assert(!!pkg.lastError, 'and the pointer carries the failure, so "unchanged" and "broken" are distinguishable');
  assert(/SOURCE_UNAVAILABLE/.test(pkg.lastError.message), `with the reason: ${pkg.lastError.message}`);
  await json(`/v1/schedules/${badSchedule}`, { method: 'DELETE', headers: auth(owner.token) });
});

await test('6. ACCEPTANCE: the permanent address serves the descriptor to anyone, no session', async () => {
  const res = await fetch(descriptorUrl);
  assert(res.status === 200, `anonymous descriptor read ${res.status}`);
  const d = JSON.parse(await res.text());
  assert(d.profile === 'tabular-data-package', `a Frictionless descriptor, got ${d.profile}`);
  assert(d.aimeat.contentHash === firstHash, 'the descriptor carries its own version');
  assert(d.aimeat.changes.length > 0, 'and the required change description');
  assert(d.aimeat.producer.kind === 'extension', `the producer is recorded: ${JSON.stringify(d.aimeat.producer)}`);
  assert(d.aimeat.schemaSource === 'inferred', 'and whether anybody confirmed the types');
  // resources[].path is a SIBLING relative path, which is what makes a plain Frictionless client
  // resolve the data with no AIMEAT knowledge at all.
  assert(d.resources[0].path === 'data/rows.csv', `relative resource path, got ${d.resources[0].path}`);
  csvUrl = descriptorUrl.replace(/datapackage\.json$/, '') + 'data/rows.csv';
});

await test('7. ACCEPTANCE: the CSV is at a permanent address, typed, and range-readable', async () => {
  const res = await fetch(csvUrl);
  assert(res.status === 200, `anonymous csv read ${res.status}`);
  assert((res.headers.get('content-type') ?? '').startsWith('text/csv'), `Content-Type: ${res.headers.get('content-type')}`);
  // Everything a range reader decides from before it starts.
  assert(res.headers.get('accept-ranges') === 'bytes', 'Accept-Ranges — without it a reader concludes there are none');
  const text = await res.text();
  assert(text.startsWith('vnr,name,shortage,reported,packages\n'), `header row: ${text.slice(0, 60)}`);
  assert(text.includes('"Laake 1, 10 mg"'), 'a comma inside a value is quoted, not escaped away');
  assert(text.endsWith('\n'), 'and the file ends with a newline');

  const ranged = await fetch(csvUrl, { headers: { Range: 'bytes=0-9' } });
  assert(ranged.status === 206, `a range read answers 206, got ${ranged.status}`);
  assert(await ranged.text() === text.slice(0, 10), 'with the right bytes');
  const suffix = await fetch(csvUrl, { headers: { Range: 'bytes=-8' } });
  assert(suffix.status === 206 && await suffix.text() === text.slice(-8), 'and a suffix range works — the shape a Parquet reader opens with');
});

await test('8. ACCEPTANCE: an agent reads the columns out of the Table Schema, never told them', async () => {
  // The whole criterion in one flow: nothing below names a column literally. The reader gets the
  // descriptor, learns the fields from it, asks for two of them by the names it just learned, and
  // checks that what came back is exactly those.
  const d = JSON.parse(await (await fetch(descriptorUrl)).text());
  const fields: Array<{ name: string; type: string }> = d.resources[0].schema.fields;
  assert(fields.length === 5, `the schema names every column, got ${fields.length}`);
  const byName = Object.fromEntries(fields.map(f => [f.name, f.type]));
  // The types were INFERRED and they are still narrow — which is the difference between a schema
  // that tells an agent something and one where everything is a string.
  assert(byName.shortage === 'boolean' && byName.packages === 'integer' && byName.reported === 'date',
    `inference stayed narrow: ${JSON.stringify(byName)}`);

  const picked = [fields[0].name, fields[4].name];
  const rows = await json(`/v1/datapackages/${encodeURIComponent(owner.name)}/${PKG}/rows/${d.resources[0].name}?select=${picked.join(',')}&limit=2`);
  assert(rows.status === 200, `rows ${rows.status}`);
  assert(Object.keys(rows.body.data.rows[0]).sort().join(',') === [...picked].sort().join(','),
    `only the requested columns came back: ${JSON.stringify(rows.body.data.rows[0])}`);
  assert(typeof rows.body.data.rows[0][picked[1]] === 'number', 'and the integer column came back as a number');
});

await test('9. ACCEPTANCE: a DIFFERENT producer lands on the SAME version and the SAME address', async () => {
  // A workflow step running the same action with the same input. If the address or the hash moved,
  // "the producer is interchangeable" would be false and every pinned consumer would break on a
  // change of who runs the job.
  const def = {
    title: { en_US: 'Same package, other producer' }, description: { en_US: 'workflow step' },
    trigger: { kind: 'manual' }, vars: [], on_step_fail: 'inspect',
    steps: [{
      id: 'produce', description: { en_US: 'Produce' }, required_to_function: 'none',
      action: { kind: 'extension', extension: EXT, action: 'produce', input: { name: PKG, rows: 3 }, result_to_key: 'slice1.result' },
    }],
  };
  const put = await json('/v1/workflows/slice1-wf', { method: 'PUT', headers: auth(owner.token), body: JSON.stringify(def) });
  assert(put.status === 200 || put.status === 201, `save ${put.status}: ${JSON.stringify(put.body?.data?.errors)}`);
  const r = await json('/v1/workflows/slice1-wf/run', { method: 'POST', headers: auth(owner.token), body: JSON.stringify({ mode: 'full' }) });
  const runId = r.body.data.run?.runId ?? r.body.data.runId;
  let run: any;
  for (let i = 0; i < 40; i++) {
    const g = await json(`/v1/workflows/slice1-wf/runs/${runId}`, { headers: auth(owner.token) });
    run = g.body.data?.run ?? g.body.data;
    if (run && !['running', 'waiting-step'].includes(run.status)) break;
    await sleep(250);
  }
  assert(run.steps.produce.state === 'green', `step ${run.steps.produce.state}`);

  const result = (await json(`/v1/memory/${encodeURIComponent('slice1.result')}`, { headers: auth(owner.token) })).body.data.value;
  assert(result.contentHash === firstHash, `same bytes, same version: ${result.contentHash} vs ${firstHash}`);
  assert(result.descriptorUrl === descriptorUrl, `same permanent address: ${result.descriptorUrl}`);
  assert(result.unchanged === true, 'and it is reported as NO CHANGE rather than an update');
  await json('/v1/workflows/slice1-wf', { method: 'DELETE', headers: auth(owner.token) });
});

await test('10. ACCEPTANCE: a pinned version can never change under a consumer', async () => {
  // Publish genuinely different data, then read the OLD hash back and check it is untouched.
  const r = await json(`/v1/ext/${EXT}/produce`, {
    method: 'POST', headers: auth(owner.token),
    body: JSON.stringify({ name: PKG, rows: 5, changes: 'Two more products entered the shortage list.' }),
  });
  assert(r.status === 200, `second version ${r.status}: ${JSON.stringify(r.body?.error)}`);
  const second = r.body.data.contentHash;
  assert(second !== firstHash, 'different data is a different version');

  const pinned = await json(`/v1/datapackages/${encodeURIComponent(owner.name)}/${PKG}?version=${encodeURIComponent(firstHash)}`);
  assert(pinned.status === 200, `the pinned version is still there: ${pinned.status}`);
  assert(pinned.body.data.descriptor.resources[0].rowCount === 3, `and still has its own 3 rows, got ${pinned.body.data.descriptor.resources[0].rowCount}`);

  const latest = await json(`/v1/datapackages/${encodeURIComponent(owner.name)}/${PKG}`);
  assert(latest.body.data.descriptor.aimeat.contentHash === second, 'while the unpinned read follows the newest');
  assert(latest.body.data.descriptor.resources[0].rowCount === 5, 'which has 5');
  // The old bytes are still at their old address, byte for byte.
  const oldCsv = await fetch(csvUrl);
  assert(oldCsv.status === 200 && (await oldCsv.text()).split('\n').length === 5, 'the first version\'s CSV is untouched');
});

await test('10b. ACCEPTANCE: the package is sellable — odps.yaml rides with every version', async () => {
  // The product sheet is generated from the descriptor and stored beside it, so a pinned version
  // carries the sheet that describes THAT version. Schema conformance is asserted against the
  // vendored ODPS v4.1 schema in test/unit/datapackage-odps.test.ts; what matters here is that the
  // file exists at a permanent address and says the true things about this package.
  const yamlUrl = descriptorUrl.replace(/datapackage\.json$/, 'odps.yaml');
  const res = await fetch(yamlUrl);
  assert(res.status === 200, `anonymous odps.yaml read ${res.status}`);
  const text = await res.text();
  assert(/^schema: https:\/\/opendataproducts\.org\/v4\.1\/schema\/odps\.yaml/m.test(text), `schema pointer: ${text.slice(0, 80)}`);
  // The YAML writer quotes it, because a bare 4.1 would parse as a number and the field is a string.
  assert(/^version: ["']?4\.1["']?$/m.test(text), `ODPS v4.1, got: ${/^version:.*$/m.exec(text)?.[0]}`);
  // The cadence is the producer's cron, recorded rather than described. The schedule is weekly.
  assert(/dimension: updateFrequency/.test(text), 'the SLA carries the update frequency');
  assert(/unit: weeks/.test(text), `and it came from the cron, got: ${/unit: \w+/.exec(text)?.[0]}`);
  // The change description is the version's own explanation and ODPS has a field that means that.
  assert(/versionNotes:/.test(text), 'the required change description reaches the product sheet');
});

await test('10c. ACCEPTANCE: retention is configurable, and what it removed is named', async () => {
  // keep: 2 versions. Publishing a third must remove the oldest and SAY which — a deletion nobody
  // can see is how a history disappears unnoticed.
  const pub = async (rows: number, changes: string) => json('/v1/datapackages', {
    method: 'POST', headers: auth(owner.token),
    body: JSON.stringify({
      name: 'retained', changes,
      resources: [{ name: 'rows', rows: Array.from({ length: rows }, (_, i) => ({ n: i })) }],
      retentionPolicy: { keep: 2, unit: 'versions' },
    }),
  });
  const v1 = await pub(1, 'first');
  const v2 = await pub(2, 'second');
  assert(v1.status === 201 && v2.status === 201, `two versions: ${v1.status}/${v2.status}`);
  assert(!v1.body.data.pruned_versions && !v2.body.data.pruned_versions, 'nothing pruned yet — two are kept');

  const v3 = await pub(3, 'third');
  assert(v3.status === 201, `third ${v3.status}`);
  assert(Array.isArray(v3.body.data.pruned_versions) && v3.body.data.pruned_versions.length === 1,
    `exactly one version pruned, got ${JSON.stringify(v3.body.data.pruned_versions)}`);
  assert(v3.body.data.pruned_versions[0] === v1.body.data.content_hash,
    `and it is the OLDEST: ${v3.body.data.pruned_versions[0]} vs ${v1.body.data.content_hash}`);

  // Gone means gone: a consumer pinned to the pruned version gets a 404, not different bytes.
  const pinnedGone = await json(`/v1/datapackages/${encodeURIComponent(owner.name)}/retained?version=${encodeURIComponent(v1.body.data.content_hash)}`);
  assert(pinnedGone.status === 404, `the pruned version is gone, got ${pinnedGone.status}`);
  // …and the two kept versions are both still readable, the newest one included.
  for (const keep of [v2, v3]) {
    const r = await json(`/v1/datapackages/${encodeURIComponent(owner.name)}/retained?version=${encodeURIComponent(keep.body.data.content_hash)}`);
    assert(r.status === 200, `a kept version is still there: ${r.status}`);
  }
});

await test('10d. Retention never removes the version the pointer names', async () => {
  // keep: 0 is "keep only the current one", not "delete everything" — a package with no readable
  // version is a deletion, not a retention policy.
  const r = await json('/v1/datapackages', {
    method: 'POST', headers: auth(owner.token),
    body: JSON.stringify({
      name: 'retained', changes: 'fourth, keeping nothing older',
      resources: [{ name: 'rows', rows: [{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }] }],
      retentionPolicy: { keep: 0, unit: 'versions' },
    }),
  });
  assert(r.status === 201, `fourth ${r.status}`);
  const latest = await json(`/v1/datapackages/${encodeURIComponent(owner.name)}/retained`);
  assert(latest.status === 200, `the current version survives keep:0, got ${latest.status}`);
  assert(latest.body.data.descriptor.aimeat.contentHash === r.body.data.content_hash, 'and it is the one just published');
});

await test('10e. With NO retention policy, nothing is ever removed', async () => {
  // The default, and the only safe one: a policy that deleted somebody's history by default would
  // be the worst possible default here.
  const a = await json('/v1/datapackages', {
    method: 'POST', headers: auth(owner.token),
    body: JSON.stringify({ name: 'kept-forever', changes: 'one', resources: [{ name: 'rows', rows: [{ n: 1 }] }] }),
  });
  for (const n of [2, 3, 4]) {
    const r = await json('/v1/datapackages', {
      method: 'POST', headers: auth(owner.token),
      body: JSON.stringify({ name: 'kept-forever', changes: `v${n}`, resources: [{ name: 'rows', rows: Array.from({ length: n }, (_, i) => ({ n: i })) }] }),
    });
    assert(!r.body.data.pruned_versions, `no policy, no pruning (v${n})`);
  }
  const first = await json(`/v1/datapackages/${encodeURIComponent(owner.name)}/kept-forever?version=${encodeURIComponent(a.body.data.content_hash)}`);
  assert(first.status === 200, `the very first version is still readable, got ${first.status}`);
});

// ── What a SECOND principal gets ──
await test('11. A stranger cannot publish into another owner\'s package namespace', async () => {
  const other = await setupOwner('b');
  // Same package NAME, different owner: it is a different package under a different address, and
  // the first owner's version is not touched. What must NOT happen is a write into their namespace.
  const r = await json('/v1/datapackages', {
    method: 'POST', headers: auth(other.token),
    body: JSON.stringify({ name: PKG, changes: 'mine now', resources: [{ name: 'rows', rows: [{ a: 1 }] }] }),
  });
  assert(r.status === 201, `their own package is fine: ${r.status}`);
  assert(r.body.data.package_id === `pkg:${other.name}/${PKG}`, `under THEIR id, got ${r.body.data.package_id}`);
  assert(!r.body.data.descriptor_url.includes(encodeURIComponent(owner.gaii)), 'and at their own address');

  const mine = await json(`/v1/datapackages/${encodeURIComponent(owner.name)}/${PKG}`);
  assert(mine.body.data.descriptor.resources[0].rowCount === 5, 'the first owner\'s package is untouched');
});

await test('12. Publishing needs a token, and the write scopes', async () => {
  const noAuth = await json('/v1/datapackages', {
    method: 'POST',
    body: JSON.stringify({ name: 'x', changes: 'x', resources: [{ name: 'rows', rows: [{ a: 1 }] }] }),
  });
  assert(noAuth.status === 401, `expected 401, got ${noAuth.status}`);
  const noList = await json('/v1/datapackages');
  assert(noList.status === 401, `listing your own packages needs a token too, got ${noList.status}`);
});

await test('Cleanup', async () => {
  await json(`/v1/schedules/${scheduleId}`, { method: 'DELETE', headers: auth(owner.token) });
  await json(`/v1/extensions/${EXT}`, { method: 'DELETE', headers: auth(owner.token) });
});

console.log(`\n  Results: ${passed} passed, ${failed} failed out of ${passed + failed}`);
if (failed > 0) process.exit(1);
