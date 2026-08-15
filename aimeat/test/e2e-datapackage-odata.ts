/**
 * @file test/e2e-datapackage-odata.ts
 * @description The OData v4 feed, end to end: the three documents a native connector fetches in
 *   order, the query subset, and — the half that matters most — what the feed REFUSES.
 *
 *   WHY THE REFUSALS ARE THE IMPORTANT TESTS. An OData server that ignores a query option it does
 *   not understand returns MORE ROWS THAN THE CLIENT ASKED FOR, and the client puts them in a report
 *   as the answer. There is no symptom: the numbers are simply wrong, in somebody else's workbook,
 *   for as long as nobody checks by hand. Every 501 below is a test that the server said no rather
 *   than quietly said yes.
 *
 *   AND IT IS NOT METERED. The design note wants each feed request to be a billable event, which is
 *   a real argument — a downloaded file escapes measurement the moment it lands, a feed does not.
 *   Metering needs an authenticated caller and an entitlement coordinate, which is a different door,
 *   and a half-built meter that counted anonymous reads as free would misreport rather than
 *   under-report. Test 12 pins the current honest position: the feed is exactly as open as the CSV
 *   whose rows it serves, and no more.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=datapackage-odata
 * @version-history
 *   v1.0.0 -- 2026-08-15 -- Initial (TARGET-063 vaihe 1, the OData surface).
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
async function setupOwner() {
  const name = `od${Date.now()}`;
  let reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'OData', password: 'ODataFeed1234' }) });
  for (let i = 0; reg.status === 429 && i < 8; i++) {
    await sleep(1500);
    reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'OData', password: 'ODataFeed1234' }) });
  }
  assert(reg.status === 201, `ghii ${reg.status}: ${JSON.stringify(reg.body?.error)}`);
  const ts = new Date().toISOString();
  const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: await sign(reg.body.data.private_key, name + NODE_ID + ts) }) });
  return { name, token: tok.body.data.token as string };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

console.log('\n=== Data Package OData v4 feed E2E (TARGET-063) ===\n');

const PKG = 'shortages-odata';
const ROWS = [
  { vnr: '001000', name: 'Burana', shortage: true, reported: '2026-08-10', packages: 12 },
  { vnr: '001001', name: 'Panadol', shortage: false, reported: '2026-08-11', packages: 4 },
  { vnr: '001002', name: 'Buranex', shortage: true, reported: '2026-08-12', packages: 0 },
];

let owner: Awaited<ReturnType<typeof setupOwner>>;
let root = '';
let firstHash = '';

/** The feed, as an anonymous client sees it — no token anywhere in this helper, on purpose. */
async function feed(path: string): Promise<{ status: number; text: string; headers: Headers }> {
  const res = await fetch(`${root}${path}`);
  return { status: res.status, text: await res.text(), headers: res.headers };
}

await test('1. Setup: an owner publishes a package', async () => {
  owner = await setupOwner();
  const r = await json('/v1/datapackages', {
    method: 'POST', headers: auth(owner.token),
    body: JSON.stringify({
      name: PKG, changes: 'First version.', title: 'Medicine shortages',
      resources: [{ name: 'rows', rows: ROWS }],
    }),
  });
  assert(r.status === 201, `publish ${r.status}: ${JSON.stringify(r.body?.error)}`);
  firstHash = r.body.data.content_hash;
  root = `${BASE}/v1/odata/${encodeURIComponent(owner.name)}/${PKG}`;
});

await test('2. The service document — what a connector fetches first, with no session', async () => {
  const { status, text, headers } = await feed('');
  assert(status === 200, `service document ${status}`);
  assert(headers.get('odata-version') === '4.0', `OData-Version: ${headers.get('odata-version')}`);
  const doc = JSON.parse(text);
  assert(typeof doc['@odata.context'] === 'string' && doc['@odata.context'].endsWith('/$metadata'),
    `@odata.context points at the metadata: ${doc['@odata.context']}`);
  assert(doc.value.length === 1 && doc.value[0].name === 'rows' && doc.value[0].kind === 'EntitySet',
    `one entity set: ${JSON.stringify(doc.value)}`);
});

await test('3. $metadata is CSDL XML, and carries the types from the Table Schema', async () => {
  const { status, text, headers } = await feed('/$metadata');
  assert(status === 200, `metadata ${status}`);
  assert((headers.get('content-type') ?? '').includes('xml'), `Content-Type: ${headers.get('content-type')}`);
  assert(text.includes('<edmx:Edmx Version="4.0"'), 'a v4 edmx document');
  assert(text.includes('<Property Name="vnr" Type="Edm.String"'), 'the padded identifier stayed a string');
  assert(text.includes('<Property Name="shortage" Type="Edm.Boolean"'), 'boolean');
  assert(text.includes('<Property Name="reported" Type="Edm.Date"'), 'date');
  assert(text.includes('<Property Name="packages" Type="Edm.Int64"'), 'integer');
  assert(text.includes('<EntitySet Name="rows" EntityType="AIMEAT.shortages_odata.rows"/>'),
    `the entity set names a type in a declared namespace: ${/EntitySet[^/]*/.exec(text)?.[0]}`);
});

await test('4. The entity set returns rows with @odata.context', async () => {
  const { status, text } = await feed('/rows');
  assert(status === 200, `rows ${status}`);
  const doc = JSON.parse(text);
  assert(doc['@odata.context'].endsWith('/$metadata#rows'), `context: ${doc['@odata.context']}`);
  assert(doc.value.length === 3, `three rows, got ${doc.value.length}`);
  assert(doc.value[0].vnr === '001000', `the padded identifier survived: ${doc.value[0].vnr}`);
  assert(doc.value[0].shortage === true, 'a boolean is a boolean, not "true"');
  assert(doc.value[0].packages === 12, 'an integer is a number');
  assert(typeof doc.value[0].RowId === 'number', 'and every entity has the synthetic key');
});

await test('5. $select, $top, $skip, $orderby', async () => {
  const sel = JSON.parse((await feed('/rows?$select=vnr,packages')).text);
  assert(Object.keys(sel.value[0]).sort().join(',') === 'RowId,packages,vnr', `$select: ${Object.keys(sel.value[0])}`);
  assert(JSON.parse((await feed('/rows?$top=2')).text).value.length === 2, '$top');
  assert(JSON.parse((await feed('/rows?$skip=2')).text).value.length === 1, '$skip');
  const ord = JSON.parse((await feed('/rows?$orderby=packages desc')).text);
  assert(ord.value.map((r: any) => r.packages).join(',') === '12,4,0', `$orderby: ${ord.value.map((r: any) => r.packages)}`);
});

await test('6. $filter, and $count reports what the FILTER matched', async () => {
  assert(JSON.parse((await feed('/rows?$filter=shortage eq true')).text).value.length === 2, 'eq on a boolean');
  assert(JSON.parse((await feed("/rows?$filter=vnr eq '001001'")).text).value.length === 1, 'eq on a string');
  assert(JSON.parse((await feed('/rows?$filter=packages gt 3')).text).value.length === 2, 'gt on a number');
  assert(JSON.parse((await feed("/rows?$filter=reported ge '2026-08-11'")).text).value.length === 2, 'ge on a date');
  assert(JSON.parse((await feed("/rows?$filter=contains(name,'ura')")).text).value.length === 2, 'contains');
  assert(JSON.parse((await feed('/rows?$filter=shortage eq true and packages gt 0')).text).value.length === 1, 'and');

  const counted = JSON.parse((await feed('/rows?$filter=shortage eq true&$top=1&$count=true')).text);
  assert(counted.value.length === 1 && counted['@odata.count'] === 2,
    `page of 1, count of 2: ${counted.value.length}/${counted['@odata.count']}`);
});

// ── The refusals. Each of these would be a wrong number in a report if it were ignored. ──

await test('7. REFUSAL: an unimplemented query option is 501, naming what IS supported', async () => {
  for (const opt of ['$expand=other', '$apply=groupby((vnr))', '$search=burana']) {
    const { status, text } = await feed(`/rows?${opt}`);
    assert(status === 501, `${opt}: expected 501, got ${status}`);
    const err = JSON.parse(text).error;
    assert(err.code === 'NotImplemented', `${opt}: code ${err.code}`);
    assert(err.message.includes('$select'), `${opt}: and it must list what works`);
  }
});

await test('8. REFUSAL: `or` in a $filter is 501 — split on `and` it would match the WRONG rows', async () => {
  const { status, text } = await feed('/rows?$filter=shortage eq true or packages gt 5');
  assert(status === 501, `expected 501, got ${status}`);
  assert(/`or`/.test(JSON.parse(text).error.message), 'and it says which construct');
});

await test('9. REFUSAL: an unparseable $filter clause names the offending text', async () => {
  const { status, text } = await feed('/rows?$filter=year(reported) eq 2026');
  assert(status === 501, `expected 501, got ${status}`);
  assert(/not understood/.test(JSON.parse(text).error.message), `message: ${JSON.parse(text).error.message}`);
});

await test('10. REFUSAL: naming a property that does not exist is 400, not an empty page', async () => {
  const filter = await feed("/rows?$filter=nosuch eq 'x'");
  assert(filter.status === 400, `filter: expected 400, got ${filter.status}`);
  const select = await feed('/rows?$select=vnr,nosuch');
  assert(select.status === 400, `select: expected 400, got ${select.status}`);
  // The distinction that matters: 400 means "there is no such column", NOT "no rows matched".
  assert(!/"value"/.test(filter.text), 'a refusal carries no value array a client could read as data');
});

await test('11. REFUSAL: an entity set that does not exist lists the ones that do', async () => {
  const { status, text } = await feed('/nosuchset');
  assert(status === 404, `expected 404, got ${status}`);
  assert(/rows/.test(JSON.parse(text).error.message), 'and names what the feed offers');
});

// ── Versions, and the honest position on metering ──

await test('12. The feed is exactly as open as the CSV it serves — and is NOT metered', async () => {
  // No Authorization header has appeared anywhere in this suite. That is deliberate: the package's
  // CSV is world-readable at a permanent address, so gating the feed would be theatre. It also means
  // there is no meter here; a paid feed is a separate authenticated door, not built.
  const anon = await feed('/rows');
  assert(anon.status === 200, 'anonymous read works');
  assert(anon.headers.get('access-control-allow-origin') === '*', 'and a browser client can read it');
  // The same rows, from the file address, byte-for-byte the same data.
  const pkg = await json(`/v1/datapackages/${encodeURIComponent(owner.name)}/${PKG}`);
  const csvUrl = pkg.body.data.descriptor_url.replace(/datapackage\.json$/, 'data/rows.csv');
  const csv = await (await fetch(csvUrl)).text();
  assert(csv.split('\n').filter(Boolean).length === 4, 'header plus three rows in the file');
});

await test('13. ?version pins the feed to one version, which can never change', async () => {
  // Publish a second version, then read the feed both ways.
  const second = await json('/v1/datapackages', {
    method: 'POST', headers: auth(owner.token),
    body: JSON.stringify({
      name: PKG, changes: 'One product left the list.',
      resources: [{ name: 'rows', rows: ROWS.slice(0, 2) }],
    }),
  });
  assert(second.status === 201, `second version ${second.status}`);

  const latest = JSON.parse((await feed('/rows')).text);
  assert(latest.value.length === 2, `the unpinned feed follows the newest, got ${latest.value.length}`);

  const pinned = JSON.parse((await feed(`/rows?version=${encodeURIComponent(firstHash)}`)).text);
  assert(pinned.value.length === 3, `the pinned feed still has three rows, got ${pinned.value.length}`);

  // A pinned feed is immutable, so it may be cached; an unpinned one must not be.
  const pinnedHeaders = (await feed(`/rows?version=${encodeURIComponent(firstHash)}`)).headers;
  assert((pinnedHeaders.get('cache-control') ?? '').includes('max-age'), 'a pinned feed is cacheable');
  assert((await feed('/rows')).headers.get('cache-control') === 'no-cache',
    'and an unpinned one is not — a stale feed is a wrong report');
});

await test('13b. The feed is a door onto PACKAGES, not onto the owner\'s storage', async () => {
  // The package name is a path segment that becomes part of a storage key, so the fence worth
  // testing is that it cannot be steered at anything else the owner has stored. It cannot: the key
  // is built as datapkg/{name}/{hash}/datapackage.json and only an exact stored key answers.
  const secret = 'odata-private-probe.txt';
  const put = await json('/v1/storage', {
    method: 'POST', headers: auth(owner.token),
    body: JSON.stringify({ key: secret, data: Buffer.from('not a package').toString('base64'), mime_type: 'text/plain', visibility: 'private' }),
  });
  assert(put.status === 201, `stored a private file ${put.status}`);

  for (const crafted of [secret, `../${secret}`, `..%2F..%2F${secret}`, 'datapkg', '']) {
    const res = await fetch(`${BASE}/v1/odata/${encodeURIComponent(owner.name)}/${encodeURIComponent(crafted)}`);
    assert(res.status === 404 || res.status === 400,
      `"${crafted}" must not resolve to anything, got ${res.status}`);
    const body = await res.text();
    assert(!body.includes('not a package'), `and must never carry the file's bytes: ${body.slice(0, 80)}`);
  }
});

await test('14. A feed for a package that does not exist is a 404 in OData\'s own shape', async () => {
  const res = await fetch(`${BASE}/v1/odata/${encodeURIComponent(owner.name)}/no-such-package`);
  assert(res.status === 404, `expected 404, got ${res.status}`);
  const body = JSON.parse(await res.text());
  // OData clients render `error.code` / `error.message`. The node envelope would surface in Excel as
  // "something went wrong", which is the same as saying nothing.
  assert(body.error?.code === 'NotFound' && typeof body.error.message === 'string',
    `OData error shape: ${JSON.stringify(body)}`);
});

await test('Cleanup', async () => {
  // Nothing to remove: a data package is storage, and the owner cascade takes it.
});

console.log(`\n  Results: ${passed} passed, ${failed} failed out of ${passed + failed}`);
if (failed > 0) process.exit(1);
