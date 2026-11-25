/**
 * @file test/e2e-knowledge-create-mcp.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An agent creates a knowledge package over the node MCP endpoint with
 *   aimeat_knowledge_create, and the tool refuses what POST /v1/knowledge/import refuses.
 *
 *   WHY. Over MCP an agent could add an entry to a knowledge package (aimeat_knowledge_contribute)
 *   but could not create one, so an agent with research to keep wrote it to an organism workspace
 *   instead. The create tool calls the same service the import route calls
 *   (services/knowledge/package-import.ts), so the checks are the route's.
 *
 *   WHAT IS ASKED.
 *   1. The tool is offered to an agent that holds memory:write, and its description says which of
 *      the three packages it concerns and where the other two are.
 *   2. Happy path: the agent creates a package with one entry, reads it back with
 *      aimeat_knowledge_get, adds an entry with aimeat_knowledge_contribute, and the owner sees the
 *      package in their own memory.
 *   3. A manifest the schema refuses (a content type outside the list) is refused, and no package is
 *      written.
 *   4. An agent without memory:write is refused, and no package is written.
 *   5. Another owner's agent does not read the package.
 * @version-history
 *   v1.0.0 — 2026-11-25 — Initial (wish-knowledge-package-luonti-mcp-hen-ja-sana-package-yksiselitte).
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-knowledge-create-mcp

import { BASE, assert, finish, json, test } from './helpers/harness.js';
import { registerOwner, type RegisteredOwner } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool, mcpRpc, type McpAgent, type McpSession } from './helpers/mcp-session.js';

const stamp = Date.now().toString(36);
let alice: RegisteredOwner;
let bob: RegisteredOwner;
let writer: McpAgent;
let writerSession: McpSession;
let readerSession: McpSession;
let bobSession: McpSession;
let packageId = '';

/** The knowledge package manifests the owner holds across their own identity and their agents. */
async function ownerManifests(owner: RegisteredOwner): Promise<Array<{ key: string; value: any }>> {
    const r = await json('/v1/memory?prefix=packages/&tags=knowledge-package&owner_scope=true&limit=200', {
        headers: { Authorization: `Bearer ${owner.token}` },
    });
    assert(r.status === 200, `owner memory list: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
    const rows = r.body?.data?.items as Array<{ key: string; value: any }> | undefined;
    assert(Array.isArray(rows), `owner memory list has no items: ${JSON.stringify(r.body).slice(0, 200)}`);
    return rows.filter(e => typeof e?.key === 'string' && e.key.endsWith('/manifest'));
}

await test('setup: two owners, a writing agent, a reading agent, and a session each', async () => {
    alice = await registerOwner(BASE, `kcreate${stamp}`);
    bob = await registerOwner(BASE, `kcreateb${stamp}`);
    writer = await makeAgent(BASE, alice, ['memory:read', 'memory:write']);
    const reader = await makeAgent(BASE, alice, ['memory:read']);
    const bobAgent = await makeAgent(BASE, bob, ['memory:read', 'memory:write']);
    writerSession = await openSession(BASE, writer.token, 'e2e-knowledge-create');
    readerSession = await openSession(BASE, reader.token, 'e2e-knowledge-create-reader');
    bobSession = await openSession(BASE, bobAgent.token, 'e2e-knowledge-create-bob');
});

await test('1. the tool is offered with memory:write, and says which package it concerns', async () => {
    const body = await mcpRpc(writerSession, 'tools/list', {});
    const tools = (body?.result?.tools ?? []) as Array<{ name: string; description: string }>;
    const create = tools.find(t => t.name === 'aimeat_knowledge_create');
    assert(create, `aimeat_knowledge_create is not offered: ${tools.map(t => t.name).filter(n => n.includes('knowledge')).join(', ')}`);
    assert(/knowledge package/i.test(create.description), `description does not say knowledge package: ${create.description}`);
    assert(create.description.includes('aimeat_package_') && create.description.includes('aimeat_datapackage_'),
        `description does not name where the component and data packages are: ${create.description}`);
});

await test('2. an agent creates a package, reads it, adds an entry, and the owner sees it', async () => {
    const before = await ownerManifests(alice);
    const r = await callTool(writerSession, 'aimeat_knowledge_create', {
        package: {
            name: `Field notes ${stamp}`,
            content_type: 'research',
            tags: ['e2e', 'field-notes'],
            entries: [{ key: 'summary', title: 'Summary', value: { text: 'Three findings from the pilot.' } }],
        },
    });
    assert(!r.isError, `create refused: ${r.text}`);
    packageId = r.data?.package_id;
    assert(typeof packageId === 'string' && packageId.length > 10, `no package_id: ${r.text}`);
    assert(r.data.entries_created === 1, `entries_created is ${r.data.entries_created}`);
    assert(r.data.audience === 'owner', `a package without an audience is the owner's own, got ${r.data.audience}`);

    const got = await callTool(writerSession, 'aimeat_knowledge_get', { package_id: packageId });
    assert(!got.isError, `get refused: ${got.text}`);
    assert(got.data.manifest?.name === `Field notes ${stamp}`, `manifest name: ${JSON.stringify(got.data.manifest)}`);
    assert(got.data.manifest?.content_type === 'research', `content_type: ${got.data.manifest?.content_type}`);
    const summary = (got.data.entries ?? []).find((e: any) => e.key === `packages/${packageId}/summary`);
    assert(summary?.value?.text === 'Three findings from the pilot.', `entry value: ${JSON.stringify(got.data.entries)}`);

    const added = await callTool(writerSession, 'aimeat_knowledge_contribute', {
        package_id: packageId, entry_key: 'method', content: 'Interviews with six users.',
    });
    assert(!added.isError, `contribute to the created package refused: ${added.text}`);
    const again = await callTool(writerSession, 'aimeat_knowledge_get', { package_id: packageId });
    const keys = (again.data.entries ?? []).map((e: any) => e.key).sort();
    assert(JSON.stringify(keys) === JSON.stringify([`packages/${packageId}/method`, `packages/${packageId}/summary`]),
        `entries after contribute: ${JSON.stringify(keys)}`);

    const after = await ownerManifests(alice);
    assert(after.length === before.length + 1, `owner manifests ${before.length} → ${after.length}`);
    assert(after.some(m => m.key === `packages/${packageId}/manifest`), 'the owner does not see the new manifest');
});

await test('3. FAILURE: a manifest the schema refuses is refused, and nothing is written', async () => {
    const before = await ownerManifests(alice);
    const r = await callTool(writerSession, 'aimeat_knowledge_create', {
        package: { name: `Bad ${stamp}`, content_type: 'not-a-content-type', entries: [{ key: 'x', value: 'y' }] },
    });
    assert(r.isError, `a content type outside the list was accepted: ${r.text}`);
    const none = await callTool(writerSession, 'aimeat_knowledge_create', {
        package: { name: `Empty ${stamp}`, content_type: 'research', entries: [] },
    });
    assert(none.isError && /SCHEMA_VALIDATION/.test(none.text), `a package with no entries was not refused by the schema: ${none.text}`);
    const after = await ownerManifests(alice);
    assert(after.length === before.length, `a refused create wrote a manifest: ${before.length} → ${after.length}`);
});

await test('4. FAILURE: an agent without memory:write is refused, and nothing is written', async () => {
    const before = await ownerManifests(alice);
    const r = await callTool(readerSession, 'aimeat_knowledge_create', {
        package: { name: `Reader ${stamp}`, content_type: 'idea', entries: [{ key: 'x', value: 'y' }] },
    });
    assert(r.isError, `an agent without memory:write created a package: ${r.text}`);
    assert(/SCOPE_DENIED/.test(r.text) && r.text.includes('memory:write'), `the refusal does not name the missing word: ${r.text}`);
    const after = await ownerManifests(alice);
    assert(after.length === before.length, `a refused create wrote a manifest: ${before.length} → ${after.length}`);
});

await test('5. FAILURE: another owner\'s agent does not read the created package', async () => {
    assert(packageId, 'no package from test 2');
    const r = await callTool(bobSession, 'aimeat_knowledge_get', { package_id: packageId });
    assert(r.isError && /not found/i.test(r.text), `another owner's agent read the package: ${r.text.slice(0, 200)}`);
    const bobs = await ownerManifests(bob);
    assert(!bobs.some(m => m.key === `packages/${packageId}/manifest`), 'the package shows in another owner\'s memory');
});

finish();
