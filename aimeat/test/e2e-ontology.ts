/**
 * @file e2e-ontology.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The semantic layer through real doors: the core ontology is served at the namespace
 *   this node's own responses cite, and an annotation naming a vocabulary nobody defined is refused
 *   rather than stored.
 *
 *   WHAT THIS PINS, and why each one was a hole. `https://aimeat.io/ns/` appeared in six catalogue
 *   responses and resolved to nothing, so a consumer expanding our JSON-LD got an empty graph from a
 *   prefix we asked it to trust. `semantic_context` on a memory schema was written unexamined, so a
 *   per-field mapping whose field name had a typo described nothing while reading as complete. A CSM
 *   could register `@type: shop:Directory` and the node copied it onto the key's schema, the CSM
 *   spec itself saying the block was "not currently validated".
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=ontology
 * @version-history
 *   v1.1.0 — 2026-09-08 — Search narrowed by what a record IS (`?type=`). The case that earns its
 *     keep is two Person records written with different spellings of the same type, found by one
 *     query: comparing the strings would have answered correctly only when both sides agreed.
 *   v1.0.0 — 2026-09-08 — Initial: /v1/ns and /v1/ns.md, the schema-context refusals and its happy
 *     path, the second owner's 403 and the unauthenticated 401 on both write doors, the CSM
 *     semantic refusal and its happy path.
 */

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    return { status: res.status, body: ct.includes('json') ? await res.json() as any : { _raw: await res.text() } };
}

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());
async function sign(p: string, m: string) {
    return Buffer.from(await ed.signAsync(new TextEncoder().encode(m), Buffer.from(p, 'base64'))).toString('base64');
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

console.log('\n=== AIMEAT Ontology E2E ===\n');

let token = '', ownerName = '';
const stamp = Date.now();

await test('Setup owner', async () => {
    ownerName = `onto${stamp}`;
    const reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: ownerName, display_name: 'Onto', password: 'Onto12345' }) });
    assert(reg.status === 200 || reg.status === 201, `register ${reg.status}: ${JSON.stringify(reg.body).slice(0, 200)}`);
    const ts = new Date().toISOString();
    const tk = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: ownerName, timestamp: ts, signature: await sign(reg.body.data.private_key, ownerName + NODE_ID + ts) }) });
    token = tk.body.data.token;
    assert(!!token, 'no token');
});

console.log('\nThe namespace resolves');

await test('1. GET /v1/ns serves the core ontology as JSON-LD', async () => {
    const res = await fetch(`${BASE}/v1/ns`);
    assert(res.status === 200, `expected 200, got ${res.status}`);
    assert((res.headers.get('content-type') ?? '').includes('application/ld+json'),
        `expected application/ld+json, got ${res.headers.get('content-type')}`);
    const doc = await res.json() as any;
    assert(doc['@id'] === 'https://aimeat.io/ns/', `@id is the namespace: ${doc['@id']}`);
    assert(doc['@context']?.aimeat === 'https://aimeat.io/ns/', 'context binds aimeat to the namespace');
    assert(Array.isArray(doc.classes) && doc.classes.length > 0, 'has classes');
    assert(Array.isArray(doc.relations) && doc.relations.length > 0, 'has relations');
});

await test('2. it is public — a peer node deciding whether it understands us has no account here', async () => {
    // No Authorization header at all, and the CORS header a browser-side consumer needs.
    const res = await fetch(`${BASE}/v1/ns`);
    assert(res.status === 200, `expected 200 unauthenticated, got ${res.status}`);
    assert(res.headers.get('access-control-allow-origin') === '*', 'missing CORS allow-origin');
});

await test('3. every class carries its definition, and the identity trio is there', async () => {
    const doc = await (await fetch(`${BASE}/v1/ns`)).json() as any;
    const silent = doc.classes.filter((c: any) => !c['rdfs:comment']);
    assert(silent.length === 0, `classes with no definition: ${silent.map((c: any) => c['@id']).join(', ')}`);
    for (const id of ['aimeat:GHII', 'aimeat:GAII', 'aimeat:GEAI']) {
        assert(doc.classes.some((c: any) => c['@id'] === id), `missing ${id}`);
    }
    const ghii = doc.classes.find((c: any) => c['@id'] === 'aimeat:GHII');
    assert(ghii['rdfs:subClassOf'] === 'schema:Person', `GHII is a kind of schema:Person, got ${ghii['rdfs:subClassOf']}`);
});

await test('4. relations come in inverse pairs, which is what makes the graph walkable both ways', async () => {
    const doc = await (await fetch(`${BASE}/v1/ns`)).json() as any;
    const byId = new Map(doc.relations.map((r: any) => [r['@id'], r]));
    let pairs = 0;
    for (const r of doc.relations) {
        const inv = r['owl:inverseOf'];
        if (!inv) continue;
        const other = byId.get(inv) as any;
        assert(!!other, `${r['@id']} names ${inv}, which is not published`);
        assert(other['owl:inverseOf'] === r['@id'], `${inv} does not name ${r['@id']} back`);
        pairs++;
    }
    assert(pairs >= 6, `expected at least three inverse pairs, saw ${pairs} halves`);
});

await test('5. GET /v1/ns.md is the same thing for a reader, with the prefix table', async () => {
    const res = await fetch(`${BASE}/v1/ns.md`);
    assert(res.status === 200, `expected 200, got ${res.status}`);
    const md = await res.text();
    assert(md.includes('https://aimeat.io/ns/'), 'names the namespace');
    assert(md.includes('http://www.w3.org/2004/02/skos/core#'), 'the prefix table lists skos');
    assert(md.includes('`aimeat:GHII`'), 'documents the classes');
    assert(md.includes('`aimeat:canPerform`'), 'documents the relations');
});

console.log('\nA schema\'s semantic context is checked before it is stored');

const KEY = `onto-${stamp}`;
const SCHEMA = { type: 'object', properties: { temperature: { type: 'number' }, takenAt: { type: 'string' } } };

await test('6. an undeclared prefix is refused', async () => {
    const r = await json(`/v1/memory/${encodeURIComponent(KEY)}/schema`, {
        method: 'PUT', headers: auth(token),
        body: JSON.stringify({
            schema: SCHEMA, apply_to: 'exact', schema_mode: 'open',
            semantic_context: { '@type': 'weather:Reading' },
        }),
    });
    assert(r.status === 400, `expected 400, got ${r.status}`);
    assert(r.body.error?.code === 'INVALID_SEMANTIC_CONTEXT', `expected INVALID_SEMANTIC_CONTEXT, got ${r.body.error?.code}`);
    assert(String(r.body.error?.message).includes('weather:'), `the message names the prefix: ${r.body.error?.message}`);
});

await test('7. refused BEFORE the write — nothing was stored', async () => {
    // Refuse before you write. The route evicts the old validator from the cache and calls
    // setSchema in the same block, so a check placed after either of those would have left a
    // half-applied lock behind on the way to a 400.
    const r = await json(`/v1/memory/${encodeURIComponent(KEY)}/schema`);
    assert(r.status === 200, `schema read ${r.status}`);
    assert(r.body.data?.has_schema === false, `expected no schema at ${KEY}, got ${JSON.stringify(r.body.data).slice(0, 200)}`);
});

await test('8. a per-field mapping naming a field the schema does not have is refused, and says so', async () => {
    const r = await json(`/v1/memory/${encodeURIComponent(KEY)}/schema`, {
        method: 'PUT', headers: auth(token),
        body: JSON.stringify({
            schema: SCHEMA, apply_to: 'exact', schema_mode: 'open',
            semantic_context: {
                '@type': 'schema:PropertyValue',
                properties: { temperatur: { '@type': 'qudt:QuantityValue' } },  // one letter short
            },
        }),
    });
    assert(r.status === 400, `expected 400, got ${r.status}`);
    assert(r.body.error?.code === 'INVALID_SEMANTIC_CONTEXT', `expected INVALID_SEMANTIC_CONTEXT, got ${r.body.error?.code}`);
    const msg = String(r.body.error?.message);
    assert(msg.includes('temperatur'), `names the offending field: ${msg}`);
    assert(msg.includes('temperature'), `names the fields the schema does have: ${msg}`);
});

await test('9. the same context, spelled right, is accepted and read back', async () => {
    const r = await json(`/v1/memory/${encodeURIComponent(KEY)}/schema`, {
        method: 'PUT', headers: auth(token),
        body: JSON.stringify({
            schema: SCHEMA, apply_to: 'exact', schema_mode: 'open',
            semantic_context: {
                '@type': 'schema:PropertyValue',
                properties: {
                    temperature: { '@type': 'qudt:QuantityValue', 'qudt:unit': 'qudt:DEG_C' },
                    takenAt: { '@type': 'schema:DateTime' },
                },
            },
        }),
    });
    assert(r.status === 200, `expected 200, got ${r.status}: ${JSON.stringify(r.body).slice(0, 300)}`);

    const got = await json(`/v1/memory/${encodeURIComponent(KEY)}/schema`);
    assert(got.status === 200, `read back ${got.status}`);
    const ctx = got.body.data?.semantic_context;
    assert(ctx?.['@type'] === 'schema:PropertyValue', `semantic context survived the round trip: ${JSON.stringify(ctx)}`);
    assert(ctx?.properties?.temperature?.['qudt:unit'] === 'qudt:DEG_C', 'the per-field mapping survived');
});

console.log('\nSearch narrowed by what a record IS');

await test('9b. three records, two of them people, one written as a full IRI', async () => {
    const write = (key: string, value: unknown) => json('/v1/memory', {
        method: 'POST', headers: auth(token),
        body: JSON.stringify({ key, value, visibility: 'private' }),
    });
    const a = await write(`onto-p1-${stamp}`, { '@type': 'schema:Person', name: 'Anna', city: 'Helsinki' });
    const b = await write(`onto-p2-${stamp}`, { '@type': 'https://schema.org/Person', name: 'Bertta', city: 'Helsinki' });
    const c = await write(`onto-e1-${stamp}`, { '@type': 'schema:Event', name: 'Concert', city: 'Helsinki' });
    for (const r of [a, b, c]) assert(r.status === 200 || r.status === 201, `write ${r.status}`);
});

await test('10. ?type= narrows a text search, and matches BOTH spellings of the same type', async () => {
    // The one behaviour that makes this worth having: the caller writes schema:Person and finds the
    // record written as https://schema.org/Person too. Comparing the strings would answer correctly
    // only when both sides happened to agree.
    const r = await json(`/v1/memory/search?q=Helsinki&type=${encodeURIComponent('schema:Person')}&include=meta`, { headers: auth(token) });
    assert(r.status === 200, `search ${r.status}`);
    const keys = (r.body.data?.results ?? []).map((x: any) => x.key);
    assert(keys.includes(`onto-p1-${stamp}`), `the prefixed one is there: ${keys.join(', ')}`);
    assert(keys.includes(`onto-p2-${stamp}`), `the full-IRI one is there too: ${keys.join(', ')}`);
    assert(!keys.includes(`onto-e1-${stamp}`), `the Event is not: ${keys.join(', ')}`);
});

await test('11. a single type with no q lists that type', async () => {
    const r = await json(`/v1/memory/search?type=${encodeURIComponent('schema:Event')}&include=meta`, { headers: auth(token) });
    assert(r.status === 200, `search ${r.status}: ${JSON.stringify(r.body.error)}`);
    const keys = (r.body.data?.results ?? []).map((x: any) => x.key);
    assert(keys.includes(`onto-e1-${stamp}`), `the Event is listed: ${keys.join(', ')}`);
    assert(!keys.includes(`onto-p1-${stamp}`), `a Person is not: ${keys.join(', ')}`);
});

await test('12. neither q nor type is still a refusal, and it says which', async () => {
    const r = await json('/v1/memory/search?include=meta', { headers: auth(token) });
    assert(r.status === 400, `expected 400, got ${r.status}`);
    assert(r.body.error?.code === 'INVALID_INPUT', `got ${r.body.error?.code}`);
});

console.log('\nThe fence: a second owner cannot rewrite what this one means');

let otherToken = '';

await test('13. Setup a second owner', async () => {
    const other = `onto2${stamp}`;
    const reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: other, display_name: 'Onto2', password: 'Onto12345' }) });
    assert(reg.status === 200 || reg.status === 201, `register ${reg.status}`);
    const ts = new Date().toISOString();
    const tk = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: other, timestamp: ts, signature: await sign(reg.body.data.private_key, other + NODE_ID + ts) }) });
    otherToken = tk.body.data.token;
    assert(!!otherToken, 'no token for the second owner');
});

await test('14. a different owner is refused, and the refusal is about the LOCK, not the annotation', async () => {
    // A valid semantic context from the wrong principal must still be refused. If this ever came
    // back 400 INVALID_SEMANTIC_CONTEXT instead of 403, the new check would have moved in FRONT of
    // the ownership gate — which is the order this suite is here to pin.
    const r = await json(`/v1/memory/${encodeURIComponent(KEY)}/schema`, {
        method: 'PUT', headers: auth(otherToken),
        body: JSON.stringify({
            schema: SCHEMA, apply_to: 'exact', schema_mode: 'open',
            semantic_context: { '@type': 'schema:Thing' },
        }),
    });
    assert(r.status === 403, `expected 403, got ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`);
    assert(r.body.error?.code === 'SCHEMA_LOCKED_BY_OTHER', `expected SCHEMA_LOCKED_BY_OTHER, got ${r.body.error?.code}`);
});

await test('15. and what the first owner said is still what the key means', async () => {
    const got = await json(`/v1/memory/${encodeURIComponent(KEY)}/schema`);
    assert(got.body.data?.semantic_context?.['@type'] === 'schema:PropertyValue',
        `unchanged after the refusal: ${JSON.stringify(got.body.data?.semantic_context)}`);
});

await test('16. with no credential at all, the door does not open', async () => {
    const r = await json(`/v1/memory/${encodeURIComponent(KEY)}/schema`, {
        method: 'PUT',
        body: JSON.stringify({ schema: SCHEMA, apply_to: 'exact', schema_mode: 'open' }),
    });
    assert(r.status === 401, `expected 401, got ${r.status}`);
});

await test('17. registering a CSM needs a credential too', async () => {
    const res = await fetch(`${BASE}/v1/csm`, {
        method: 'POST', headers: { 'Content-Type': 'text/yaml' },
        body: csmYaml(`onto-anon-${stamp}`, ''),
    });
    assert(res.status === 401, `expected 401, got ${res.status}`);
});

console.log('\nA CSM manifest\'s semantic block is checked too');

function csmYaml(name: string, semantic: string): string {
    return `csm: "1.0"
service:
  name: ${name}
  type: directory
  description: An E2E fixture for the ontology suite
  version: "1.0"
${semantic}
schema_mode: open
data_schema:
  required:
    title:
      type: string
  optional: {}
consent_requirements:
  visibility_default: public
  requires_consent: false
  consent_purpose: testing
  data_retention: 30d
moderation:
  flags_enabled: false
  auto_hide_threshold: 5
  appeals_enabled: false
ui_hints:
  list_view: [title]
  detail_view: [title]
  search_fields: [title]
`;
}

const postCsm = (yaml: string) => fetch(`${BASE}/v1/csm`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/yaml', ...auth(token) },
    body: yaml,
}).then(async (res) => ({ status: res.status, body: await res.json() as any }));

await test('18. a manifest naming a vocabulary nobody defined is refused', async () => {
    const r = await postCsm(csmYaml(`onto-bad-${stamp}`, `  semantic:
    "@type": "shop:Directory"`));
    assert(r.status === 400, `expected 400, got ${r.status}: ${JSON.stringify(r.body).slice(0, 300)}`);
    assert(String(r.body.error?.message).includes('shop:'), `the message names the prefix: ${r.body.error?.message}`);
    assert(String(r.body.error?.message).includes('service.semantic'), `the message says where: ${r.body.error?.message}`);
});

await test('19. the same manifest with the prefix declared registers', async () => {
    const r = await postCsm(csmYaml(`onto-ok-${stamp}`, `  semantic:
    "@context":
      shop: "https://example.org/shop#"
      schema: "https://schema.org/"
    "@type": "shop:Directory"
    "schema:about": "groceries"`));
    assert(r.status === 200 || r.status === 201, `expected 200/201, got ${r.status}: ${JSON.stringify(r.body).slice(0, 300)}`);
});

await test('20. a manifest using a default prefix needs no @context of its own', async () => {
    const r = await postCsm(csmYaml(`onto-def-${stamp}`, `  semantic:
    "@type": "schema:DataCatalog"`));
    assert(r.status === 200 || r.status === 201, `expected 200/201, got ${r.status}: ${JSON.stringify(r.body).slice(0, 300)}`);
});

await test('21. a manifest with no semantic block at all is untouched', async () => {
    const r = await postCsm(csmYaml(`onto-none-${stamp}`, ''));
    assert(r.status === 200 || r.status === 201, `expected 200/201, got ${r.status}: ${JSON.stringify(r.body).slice(0, 300)}`);
});

console.log(`\n=== Ontology E2E Results: ${passed} passed, ${failed} failed out of ${passed + failed} ===\n`);
process.exit(failed > 0 ? 1 : 0);
