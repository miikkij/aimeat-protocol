/**
 * @file test/e2e-knowledge-entry-rest.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A knowledge package entry over REST, and a manifest written as plain memory.
 *
 *   WHY. Adding an entry (aimeat_knowledge_contribute) was reachable only over the node MCP, so the
 *   connector and the shell refused it, and a fleet could fill a package only in the call that made
 *   it. POST /v1/knowledge/:id/entries now calls the same service. And a knowledge package manifest
 *   written with POST /v1/memory, the bulk write or a PATCH was stored whatever it held, and the
 *   knowledge list showed it as a package; it is now checked against the import's schema
 *   (services/knowledge/manifest-write.ts).
 *
 *   1. Happy path: an agent creates a package, adds an entry over REST; the manifest indexes it and
 *      the package read shows it.
 *   2. FAILURE: no memory:write is 403, an unknown package 404, a missing content 400, the reserved
 *      appdev-pitfalls package 400 RESERVED_PACKAGE; nothing is written.
 *   3. FAILURE: another owner's agent cannot add to the package (404), and nothing lands in it.
 *   4. FAILURE: POST /v1/memory of a knowledge manifest with no entries is 422
 *      SCHEMA_VALIDATION_FAILED and nothing is stored; a valid one is stored.
 *   5. FAILURE: PATCH that empties a valid manifest's entries is 422, and the manifest is unchanged.
 *   6. FAILURE: a bulk write of an invalid manifest fails that entry and stores the others.
 *   7. A data package's catalogue manifest shape under the same key, without the knowledge tag or
 *      type, is not checked.
 * @version-history
 *   v1.0.0 — 2026-11-25 — Initial (wish-tietopaketin-manifesti-tarkistetaan-muistin-kirjoituksessa-j).
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-knowledge-entry-rest

import { BASE, assert, finish, json, test } from './helpers/harness.js';
import { registerOwner, type RegisteredOwner } from './helpers/owner-login.js';
import { makeAgent, type McpAgent } from './helpers/mcp-session.js';

const stamp = Date.now().toString(36);
let alice: RegisteredOwner;
let writer: McpAgent;
let reader: McpAgent;
let bobAgent: McpAgent;
let packageId = '';

const as = (token: string, method: string, body?: unknown): RequestInit => ({
    method, headers: { Authorization: `Bearer ${token}` }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const manifestOf = async (token: string, id: string) =>
    (await json(`/v1/memory/${encodeURIComponent(`packages/${id}/manifest`)}`, as(token, 'GET')));

/** A manifest the import accepts, for the memory writes below. */
const validManifest = (name: string) => ({
    type: 'knowledge-package', name, version: '1.0.0', author: 'alice', content_type: 'research', tags: ['e2e'],
    entries: [{ key: `packages/m-${stamp}/summary`, title: 'Summary', visibility: 'owner' }],
    sharing: { catalog_listed: false, allow_clone: false, toll_morsels: 0 },
    synthesis: { level: 'ai-generated', description: 'Written by a test.' },
});

await test('setup: an owner with a writing and a reading agent, and another owner\'s agent', async () => {
    alice = await registerOwner(BASE, `kentry${stamp}`);
    const bob = await registerOwner(BASE, `kentryb${stamp}`);
    writer = await makeAgent(BASE, alice, ['memory:read', 'memory:write']);
    reader = await makeAgent(BASE, alice, ['memory:read']);
    bobAgent = await makeAgent(BASE, bob, ['memory:read', 'memory:write']);
    const made = await json('/v1/knowledge/import', as(writer.token, 'POST', {
        package: {
            name: `Field notes ${stamp}`, content_type: 'research', tags: ['e2e'],
            entries: [{ key: 'summary', title: 'Summary', value: { text: 'Three findings.' } }],
        },
    }));
    assert(made.status === 201, `import: ${made.status} ${JSON.stringify(made.body).slice(0, 300)}`);
    packageId = made.body.data.package_id;
});

await test('1. an agent adds an entry over REST, and the manifest indexes it', async () => {
    const r = await json(`/v1/knowledge/${packageId}/entries`, as(writer.token, 'POST', { entry_key: 'method', content: 'Interviews with six users.' }));
    assert(r.status === 201, `add entry: ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`);
    assert(r.body.data.entry_key === `packages/${packageId}/method`, `entry_key: ${r.body.data.entry_key}`);
    assert(r.body.data.manifest_updated === true, `manifest_updated: ${JSON.stringify(r.body.data)}`);
    const m = await manifestOf(writer.token, packageId);
    const keys = (m.body.data.value.entries as Array<{ key: string }>).map(e => e.key).sort();
    assert(JSON.stringify(keys) === JSON.stringify([`packages/${packageId}/method`, `packages/${packageId}/summary`]), `manifest entries: ${JSON.stringify(keys)}`);
    const entry = await json(`/v1/memory/${encodeURIComponent(`packages/${packageId}/method`)}`, as(writer.token, 'GET'));
    assert(entry.status === 200 && entry.body.data.value === 'Interviews with six users.', `entry: ${entry.status} ${JSON.stringify(entry.body).slice(0, 200)}`);
});

await test('2. FAILURE: no memory:write, an unknown package, no content and the reserved package are refused', async () => {
    const before = (await manifestOf(writer.token, packageId)).body.data.value.entries.length;
    const noScope = await json(`/v1/knowledge/${packageId}/entries`, as(reader.token, 'POST', { entry_key: 'x', content: 'y' }));
    assert(noScope.status === 403, `an agent without memory:write: ${noScope.status} ${JSON.stringify(noScope.body).slice(0, 200)}`);
    const unknown = await json(`/v1/knowledge/no-such-${stamp}/entries`, as(writer.token, 'POST', { entry_key: 'x', content: 'y' }));
    assert(unknown.status === 404, `an unknown package: ${unknown.status} ${JSON.stringify(unknown.body).slice(0, 200)}`);
    const noContent = await json(`/v1/knowledge/${packageId}/entries`, as(writer.token, 'POST', { entry_key: 'x' }));
    // The contract's request check answers first (openapi.yaml marks content required).
    assert(noContent.status === 400 && noContent.body.error.code === 'VALIDATION_ERROR', `no content: ${noContent.status} ${JSON.stringify(noContent.body).slice(0, 200)}`);
    const reserved = await json('/v1/knowledge/appdev-pitfalls/entries', as(writer.token, 'POST', { entry_key: 'x', content: 'y' }));
    assert(reserved.status === 400 && reserved.body.error.code === 'RESERVED_PACKAGE', `reserved: ${reserved.status} ${JSON.stringify(reserved.body).slice(0, 200)}`);
    const after = (await manifestOf(writer.token, packageId)).body.data.value.entries.length;
    assert(after === before, `a refused add changed the manifest: ${before} → ${after}`);
    const stray = await json(`/v1/memory/${encodeURIComponent(`packages/${packageId}/x`)}`, as(writer.token, 'GET'));
    assert(stray.status === 404, `a refused add stored an entry: ${stray.status}`);
});

await test('3. FAILURE: another owner\'s agent cannot add to the package', async () => {
    const r = await json(`/v1/knowledge/${packageId}/entries`, as(bobAgent.token, 'POST', { entry_key: 'intrusion', content: 'z' }));
    assert(r.status === 404, `another owner's agent: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
    const keys = (await manifestOf(writer.token, packageId)).body.data.value.entries.map((e: { key: string }) => e.key);
    assert(!keys.some((k: string) => k.endsWith('/intrusion')), `the manifest gained another owner's entry: ${JSON.stringify(keys)}`);
});

await test('4. FAILURE: POST /v1/memory of a knowledge manifest the schema refuses stores nothing', async () => {
    const key = `packages/bad-${stamp}/manifest`;
    const bad = await json('/v1/memory', as(writer.token, 'POST', { key, value: { ...validManifest('Bad'), entries: [] }, tags: ['knowledge-package'] }));
    assert(bad.status === 422 && bad.body.error.code === 'SCHEMA_VALIDATION_FAILED', `invalid manifest: ${bad.status} ${JSON.stringify(bad.body).slice(0, 300)}`);
    assert(String(bad.body.error.message).includes('/entries'), `the refusal does not name the part: ${bad.body.error.message}`);
    assert((await manifestOf(writer.token, `bad-${stamp}`)).status === 404, 'the refused manifest was stored');
    const good = await json('/v1/memory', as(writer.token, 'POST', { key: `packages/m-${stamp}/manifest`, value: validManifest('Good'), tags: ['knowledge-package'] }));
    assert(good.status === 200 || good.status === 201, `valid manifest: ${good.status} ${JSON.stringify(good.body).slice(0, 300)}`);
});

await test('5. FAILURE: a PATCH that empties a valid manifest\'s entries is refused, and the manifest stays', async () => {
    const key = `packages/m-${stamp}/manifest`;
    const r = await json(`/v1/memory/${encodeURIComponent(key)}`, as(writer.token, 'PATCH', { patch: { entries: [] } }));
    assert(r.status === 422 && r.body.error.code === 'SCHEMA_VALIDATION_FAILED', `patch: ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`);
    const m = await manifestOf(writer.token, `m-${stamp}`);
    assert(m.body.data.value.entries.length === 1, `the manifest changed: ${JSON.stringify(m.body.data.value.entries)}`);
});

await test('6. FAILURE: a bulk write fails the invalid manifest and stores the rest', async () => {
    const r = await json('/v1/memory/bulk', as(writer.token, 'POST', { entries: [
        { key: `packages/bulkbad-${stamp}/manifest`, value: { type: 'knowledge-package', name: 'Bulk bad' } },
        { key: `notes.bulk-${stamp}`, value: { text: 'kept' } },
    ] }));
    assert(r.status === 200 || r.status === 207, `bulk: ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`);
    const results = JSON.stringify(r.body.data);
    assert(results.includes('SCHEMA_VALIDATION_FAILED'), `the bulk answer does not name the refusal: ${results.slice(0, 400)}`);
    assert((await manifestOf(writer.token, `bulkbad-${stamp}`)).status === 404, 'the invalid manifest was stored by the bulk write');
    const kept = await json(`/v1/memory/${encodeURIComponent(`notes.bulk-${stamp}`)}`, as(writer.token, 'GET'));
    assert(kept.status === 200, `the valid entry of the batch was not stored: ${kept.status}`);
});

await test('7. a manifest that is not a knowledge package\'s is not checked', async () => {
    const r = await json('/v1/memory', as(writer.token, 'POST', { key: `packages/data-${stamp}/manifest`, value: { name: 'Rows', resources: [] }, tags: ['dataset'] }));
    assert(r.status === 200 || r.status === 201, `a data package shaped manifest: ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`);
});

finish();
