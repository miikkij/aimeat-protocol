/**
 * @file test/e2e-memory-group-binding.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A memory record with visibility 'group' and no group opens to nobody but its owner
 *   (consent.ts answers missing_group_id), and the writer was told nothing. Each route that writes a
 *   memory record is held to one rule here: a write that names no group and finds none on the record is
 *   refused, or, on a route that restores data, stored private. A record that has a group keeps it
 *   through every rewrite that names none, and its member keeps reading.
 *
 *   A row stored by an older node cannot be made through any route now, so that case is in
 *   test/unit/memory-group-binding.test.ts, which seeds it directly.
 * @structure Setup, then one group of tests per route, then cleanup.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx \
 *   test/run-e2e-ci.ts --test=e2e-memory-group-binding
 * @version-history
 *   v1.1.0 — 2026-11-05 — 7a, 9a, 13a, 20a: a group id that names no group is refused. Red before the change.
 *   v1.0.0 — 2026-11-05 — Initial. Written before the fix, and failing.
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());
import { registerOwner } from './helpers/owner-login.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
let NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: unknown) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body: any = ct.includes('json') ? await res.json() : { _raw: await res.text() };
    return { status: res.status, body };
}
const as = (token: string) => ({ Authorization: `Bearer ${token}` });
const post = (path: string, token: string, payload: unknown) => json(path, { method: 'POST', headers: as(token), body: JSON.stringify(payload) });
const shown = (r: { status: number; body: unknown }) => `${r.status} ${JSON.stringify(r.body).slice(0, 300)}`;

interface Party { name: string; ghii: string; token: string; gaii: string; agentToken: string }

async function makeParty(name: string): Promise<Party> {
    const owner = await registerOwner(BASE, name);
    const reg = owner.registration;
    if (typeof reg.body.node === 'string' && reg.body.node) NODE_ID = reg.body.node;
    const ag = await post('/v1/agents', owner.token, { name: `${name}bot`, owner: name, capabilities: ['memory'], scopes: ['memory:read', 'memory:write'] });
    assert(ag.status === 201, `register agent for ${name}: ${shown(ag)}`);
    const gaii = ag.body.data.agent.gaii as string;
    const timestamp = new Date().toISOString();
    const signature = Buffer.from(await ed.signAsync(new TextEncoder().encode(gaii + timestamp), Buffer.from(ag.body.data.private_key, 'base64'))).toString('base64');
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ gaii, timestamp, signature }) });
    assert(tok.body.ok === true, `token for ${gaii}: ${shown(tok)}`);
    return { name, ghii: `${name}@${NODE_ID}`, token: owner.token, gaii, agentToken: tok.body.data.token };
}

const stamp = Date.now() % 1000000;
let A: Party, B: Party, C: Party;
let groupId = '';

const own = (key: string, token = A.token) => json(`/v1/memory/${encodeURIComponent(key)}`, { headers: as(token) });
/** B, a member of the group, reading A's record through the cross-owner route. */
const memberRead = (key: string) => json(`/v1/memory/${encodeURIComponent(A.ghii)}/${encodeURIComponent(key)}`, { headers: as(B.token) });
const memberReads = async (key: string) => {
    const r = await memberRead(key);
    return r.status === 200 && r.body?.data?.value !== undefined && r.body?.data?.value !== null;
};
/** Refused with the words that say what to send, and nothing stored under `key` that was not there. */
function refused(r: { status: number; body: { error?: { code?: string; message?: string } } }) {
    assert(r.status === 400 && r.body.error?.code === 'INVALID_INPUT', `expected 400 INVALID_INPUT, got ${shown(r)}`);
    assert(String(r.body.error?.message).includes('group_id'), `the refusal must say what to send: ${r.body.error?.message}`);
}
/** A record shared with the group, through the route that names one. */
async function bound(key: string) {
    const w = await post('/v1/memory', A.token, { key, value: { v: 1 }, visibility: 'group', group_id: groupId });
    assert(w.status === 201, `write bound record: ${shown(w)}`);
    assert(await memberReads(key), 'the member reads a bound record');
    return w.body.data.version as number;
}

async function main() {
    console.log('\n=== A group record names its group, on every memory write route ===\n');

    await test('setup: three owners, an agent each, a group with the second owner in it', async () => {
        A = await makeParty(`mgba${stamp}`);
        B = await makeParty(`mgbb${stamp}`);
        C = await makeParty(`mgbc${stamp}`);
        const g = await post('/v1/groups', A.token, {
            name: `binding-${stamp}`, members: [{ identifier: B.ghii, identifier_type: 'ghii' }], default_permissions: { read: true, write: false },
        });
        assert(g.status === 201, `create group: ${shown(g)}`);
        groupId = g.body.data.group.id;
    });

    console.log('\nPOST /v1/memory');
    await test('1. An owner naming no group is refused, and the record does not exist', async () => {
        const key = `mgb.post.owner.${stamp}`;
        refused(await post('/v1/memory', A.token, { key, value: 1, visibility: 'group' }));
        assert((await own(key)).status === 404, 'the refused record exists');
    });
    await test('2. An agent naming no group is refused the same', async () => {
        const key = `mgb.post.agent.${stamp}`;
        refused(await post('/v1/memory', A.agentToken, { key, value: 1, visibility: 'group' }));
        assert((await own(key, A.agentToken)).status === 404, 'the refused record exists');
    });
    await test('3. A blank group id names no group', async () => {
        refused(await post('/v1/memory', A.token, { key: `mgb.post.blank.${stamp}`, value: 1, visibility: 'group', group_id: '   ' }));
    });
    await test('4. A group that is named still shares: the member reads the record', async () => {
        await bound(`mgb.post.named.${stamp}`);
    });
    await test('5. A rewrite naming no group keeps the group the record has, and the member keeps reading', async () => {
        const key = `mgb.post.rewrite.${stamp}`;
        await bound(key);
        const w = await post('/v1/memory', A.token, { key, value: { v: 2 }, visibility: 'group' });
        assert(w.status === 200, `rewrite: ${shown(w)}`);
        const r = await memberRead(key);
        assert(r.status === 200 && r.body.data.value.v === 2, `the member reads the new value: ${shown(r)}`);
    });
    await test('6. A blank group id on a rewrite does not replace the group the record has', async () => {
        const key = `mgb.post.rewrite-blank.${stamp}`;
        await bound(key);
        const w = await post('/v1/memory', A.token, { key, value: { v: 2 }, visibility: 'group', group_id: '   ' });
        assert(w.status === 200, `rewrite: ${shown(w)}`);
        assert(await memberReads(key), 'the blank id took the group away');
    });
    await test('7. A record turned private has lost its group, so asking for group again names none and is refused', async () => {
        const key = `mgb.post.dropped.${stamp}`;
        await bound(key);
        assert((await post('/v1/memory', A.token, { key, value: 1, visibility: 'private' })).status === 200, 'turn private');
        refused(await post('/v1/memory', A.token, { key, value: 1, visibility: 'group' }));
        assert((await own(key)).body.data.visibility === 'private', 'the refused write changed the record');
    });

    await test('7a. A group id that names no group is refused, and nothing is stored', async () => {
        const key = `mgb.post.unknown.${stamp}`;
        refused(await post('/v1/memory', A.token, { key, value: 1, visibility: 'group', group_id: `no-such-group-${stamp}` }));
        assert((await own(key)).status === 404, 'the refused record exists');
    });
    await test('7b. The rule opens nothing: an owner outside the group is refused a bound record, and through a rewrite that names no group', async () => {
        const key = `mgb.post.outsider.${stamp}`;
        const outside = () => json(`/v1/memory/${encodeURIComponent(A.ghii)}/${encodeURIComponent(key)}`, { headers: as(C.token) });
        await bound(key);
        const before = await outside();
        assert(before.status === 403, `an outsider read a bound record: ${shown(before)}`);
        assert((await post('/v1/memory', A.token, { key, value: { v: 2 }, visibility: 'group' })).status === 200, 'rewrite');
        const after = await outside();
        assert(after.status === 403, `an outsider read the rewritten record: ${shown(after)}`);
    });

    console.log('\nPUT /v1/memory/{key}');
    await test('8. A private record is not turned into a group record with no group', async () => {
        const key = `mgb.put.${stamp}`;
        const w = await post('/v1/memory', A.token, { key, value: 1, visibility: 'private' });
        refused(await json(`/v1/memory/${encodeURIComponent(key)}`, { method: 'PUT', headers: as(A.token), body: JSON.stringify({ visibility: 'group', version: w.body.data.version }) }));
        const after = await own(key);
        assert(after.body.data.visibility === 'private' && after.body.data.version === w.body.data.version, `the refused write changed the record: ${shown(after)}`);
    });
    await test('9. PUT naming the group shares the record, and an edit of its value keeps the group', async () => {
        const key = `mgb.put.named.${stamp}`;
        const w = await post('/v1/memory', A.token, { key, value: 1, visibility: 'private' });
        const put = (body: object) => json(`/v1/memory/${encodeURIComponent(key)}`, { method: 'PUT', headers: as(A.token), body: JSON.stringify(body) });
        const shared = await put({ visibility: 'group', group_id: groupId, version: w.body.data.version });
        assert(shared.status === 200, `share: ${shown(shared)}`);
        assert(await memberReads(key), 'the member reads after the PUT');
        const edited = await put({ value: 2, version: shared.body.data.version });
        assert(edited.status === 200, `edit: ${shown(edited)}`);
        const r = await memberRead(key);
        assert(r.status === 200 && r.body.data.value === 2, `the member reads the edit: ${shown(r)}`);
    });

    await test('9a. PUT naming a group that does not exist is refused, and the record keeps its group', async () => {
        const key = `mgb.put.unknown.${stamp}`;
        const version = await bound(key);
        refused(await json(`/v1/memory/${encodeURIComponent(key)}`, { method: 'PUT', headers: as(A.token), body: JSON.stringify({ visibility: 'group', group_id: `no-such-group-${stamp}`, version }) }));
        assert(await memberReads(key), 'the refused write took the group away');
    });

    console.log('\nPATCH /v1/memory/{key}');
    await test('10. A PATCH creating a group record is refused, and nothing is created', async () => {
        const key = `mgb.patch.new.${stamp}`;
        refused(await json(`/v1/memory/${encodeURIComponent(key)}`, { method: 'PATCH', headers: as(A.token), body: JSON.stringify({ patch: { a: 1 }, visibility: 'group' }) }));
        assert((await own(key)).status === 404, 'the refused record exists');
    });
    await test('11. A PATCH turning a private record into a group record is refused, and the value stays', async () => {
        const key = `mgb.patch.private.${stamp}`;
        await post('/v1/memory', A.token, { key, value: { a: 1 }, visibility: 'private' });
        refused(await json(`/v1/memory/${encodeURIComponent(key)}`, { method: 'PATCH', headers: as(A.token), body: JSON.stringify({ patch: { a: 2 }, visibility: 'group' }) }));
        const after = await own(key);
        assert(after.body.data.visibility === 'private' && after.body.data.value.a === 1, `the refused patch changed the record: ${shown(after)}`);
    });
    await test('12. A PATCH on a bound record keeps the group, named or left out', async () => {
        const key = `mgb.patch.bound.${stamp}`;
        await bound(key);
        for (const body of [{ patch: { v: 2 } }, { patch: { v: 3 }, visibility: 'group' }]) {
            const p = await json(`/v1/memory/${encodeURIComponent(key)}`, { method: 'PATCH', headers: as(A.token), body: JSON.stringify(body) });
            assert(p.status === 200, `patch ${JSON.stringify(body)}: ${shown(p)}`);
        }
        const r = await memberRead(key);
        assert(r.status === 200 && r.body.data.value.v === 3, `the member reads the patch: ${shown(r)}`);
    });

    console.log('\nPOST /v1/memory/bulk');
    await test('13. The entry naming no group fails by name, and the rest of the batch lands', async () => {
        const bad = `mgb.bulk.bad.${stamp}`, good = `mgb.bulk.good.${stamp}`, named = `mgb.bulk.named.${stamp}`;
        const r = await post('/v1/memory/bulk', A.token, { entries: [
            { key: bad, value: 1, visibility: 'group' },
            { key: good, value: 1 },
            { key: named, value: 1, visibility: 'group', group_id: groupId },
        ] });
        assert(r.status === 200, `bulk: ${shown(r)}`);
        const failedRow = JSON.stringify(r.body.data);
        assert(failedRow.includes(bad) && failedRow.includes('group_id'), `the answer names the refused key and what to send: ${failedRow.slice(0, 400)}`);
        assert((await own(bad)).status === 404, 'the refused entry exists');
        assert((await own(good)).status === 200, 'the plain entry did not land');
        assert(await memberReads(named), 'the named entry does not share');
    });
    await test('13a. The entry naming a group that does not exist fails by name, and the rest lands', async () => {
        const bad = `mgb.bulk.unknown.${stamp}`, good = `mgb.bulk.unknown-good.${stamp}`;
        const r = await post('/v1/memory/bulk', A.token, { entries: [
            { key: bad, value: 1, visibility: 'group', group_id: `no-such-group-${stamp}` }, { key: good, value: 1 },
        ] });
        assert(r.status === 200, `bulk: ${shown(r)}`);
        const answer = JSON.stringify(r.body.data);
        assert(answer.includes(bad) && answer.includes('group_id'), `the answer names the refused key: ${answer.slice(0, 400)}`);
        assert((await own(bad)).status === 404, 'the refused entry exists');
        assert((await own(good)).status === 200, 'the plain entry did not land');
    });
    await test('14. A bulk rewrite of a bound record naming no group keeps the group', async () => {
        const key = `mgb.bulk.bound.${stamp}`;
        await bound(key);
        const r = await post('/v1/memory/bulk', A.token, { entries: [{ key, value: { v: 2 }, visibility: 'group' }] });
        assert(r.status === 200, `bulk: ${shown(r)}`);
        const read = await memberRead(key);
        assert(read.status === 200 && read.body.data.value.v === 2, `the member reads the rewrite: ${shown(read)}`);
    });

    console.log('\nPOST /v1/memory/import');
    await test('15. An imported entry at group keeps its data and is stored private, since an import names no group', async () => {
        const key = `mgb.import.new.${stamp}`;
        const r = await post('/v1/memory/import', A.token, { entries: [{ key, value: { v: 1 }, visibility: 'group' }] });
        assert(r.status === 200 && r.body.data.created === 1, `import: ${shown(r)}`);
        const after = await own(key);
        assert(after.body.data.visibility === 'private' && after.body.data.value.v === 1, `stored: ${shown(after)}`);
        const stranger = await memberRead(key);
        assert(stranger.status === 403, `the group's member read an entry that is private: ${shown(stranger)}`);
    });
    await test('16. Importing over a bound record keeps the group, and the member keeps reading', async () => {
        const key = `mgb.import.bound.${stamp}`;
        await bound(key);
        const r = await post('/v1/memory/import', A.token, { mode: 'overwrite', entries: [{ key, value: { v: 2 }, visibility: 'group' }] });
        assert(r.status === 200, `import: ${shown(r)}`);
        const read = await memberRead(key);
        assert(read.status === 200 && read.body.data.value.v === 2, `the member reads the import: ${shown(read)}`);
    });

    console.log('\nPOST /v1/memory/copy');
    await test('17. A copy asked at group is refused, since a copy names no group', async () => {
        const key = `mgb.copy.${stamp}`;
        assert((await post('/v1/memory', B.token, { key, value: 1, visibility: 'public' })).status === 201, 'public source');
        refused(await post('/v1/memory/copy', A.agentToken, { source_gaii: B.ghii, key, visibility: 'group' }));
        assert((await own(key, A.agentToken)).status === 404, 'the refused copy exists');
        const control = await post('/v1/memory/copy', A.agentToken, { source_gaii: B.ghii, key });
        assert(control.status === 200 || control.status === 201, `the copy itself works: ${shown(control)}`);
    });

    console.log('\nPOST /v1/agents/import');
    await test('18. A bundle record at group is stored private on the new agent, and it lands', async () => {
        const name = `mgbimp${stamp}`;
        const exp = await post(`/v1/agents/${encodeURIComponent(A.gaii)}/export`, A.token, {});
        assert(exp.status === 200, `export: ${shown(exp)}`);
        const key = `mgb.agentimport.${stamp}`;
        const bundle = exp.body.data;
        const r = await post('/v1/agents/import', A.token, {
            ...bundle, agent: { ...bundle.agent, name }, memory: [{ key, value: 1, visibility: 'group' }],
        });
        assert(r.status === 201, `import: ${shown(r)}`);
        assert(r.body.data.imported.memories === 1, `imported: ${JSON.stringify(r.body.data.imported)}`);
        const read = await json(`/v1/memory/${encodeURIComponent(key)}?agent=${encodeURIComponent(r.body.data.agent.gaii)}`, { headers: as(A.token) });
        assert(read.body?.data?.visibility === 'private', `stored: ${shown(read)}`);
    });

    console.log('\nKnowledge packages');
    let packageId = '';
    await test('19. A package imported with an entry at group stores the entry and its manifest line private', async () => {
        const r = await post('/v1/knowledge/import', A.token, {
            package: {
                type: 'knowledge-package', name: `Binding ${stamp}`, version: '1.0.0', author: A.name, content_type: 'research',
                tags: ['binding'], language: 'en', maturity: 'published', synthesis: { level: 'original', description: 'Test' }, references: [],
                entries: [{ key: 'notes', title: 'Notes', visibility: 'group' }, { key: 'open', title: 'Open', visibility: 'public' }],
                links: [], sharing: { catalog_listed: true, allow_clone: true, morsel_price: 0 },
            },
            entry_data: { notes: { title: 'Notes', body: 'text' }, open: { title: 'Open', body: 'text' } },
        });
        assert(r.status === 201, `import: ${shown(r)}`);
        packageId = r.body.data.package_id;
        const record = await own(`packages/${packageId}/notes`);
        assert(record.body.data.visibility === 'private', `the entry record: ${shown(record)}`);
        const manifest = await own(`packages/${packageId}/manifest`);
        const line = manifest.body.data.value.entries.find((e: { key: string }) => e.key.endsWith('/notes'));
        assert(line.visibility === 'private', `the manifest line: ${JSON.stringify(line)}`);
    });
    const entryVisibility = (body: object) => json(`/v1/knowledge/${packageId}/entries/notes/visibility`, { method: 'PATCH', headers: as(A.token), body: JSON.stringify(body) });
    await test('20. An entry is not turned to group with no group', async () => {
        refused(await entryVisibility({ visibility: 'group' }));
        assert((await own(`packages/${packageId}/notes`)).body.data.visibility === 'private', 'the refused change moved the record');
    });
    await test('20a. An entry naming a group that does not exist is refused', async () => {
        refused(await entryVisibility({ visibility: 'group', group_id: `no-such-group-${stamp}` }));
        assert((await own(`packages/${packageId}/notes`)).body.data.visibility === 'private', 'the refused change moved the record');
    });
    await test('21. An entry naming its group shares it, and the member reads it', async () => {
        const r = await entryVisibility({ visibility: 'group', group_id: groupId });
        assert(r.status === 200, `change: ${shown(r)}`);
        assert(await memberReads(`packages/${packageId}/notes`), 'the member does not read the entry');
    });

    console.log('\nAn ai schedule\'s answer');
    const base = { kind: 'ai', cron: '0 9 * * *', prompt: 'Summarise the input.', input_keys: ['news.raw'] };
    await test('22. A schedule whose answer would land at group with no group is refused at save', async () => {
        refused(await post('/v1/schedules', A.token, { ...base, display_name: 'No group', output_key: `mgb.sched.new.${stamp}`, output_visibility: 'group' }));
    });
    await test('23. A schedule writing to a record that has a group is saved, and an ordinary level still is', async () => {
        const key = `mgb.sched.bound.${stamp}`;
        await bound(key);
        const kept = await post('/v1/schedules', A.token, { ...base, display_name: 'Bound', output_key: key, output_visibility: 'group' });
        assert(kept.status === 201, `bound: ${shown(kept)}`);
        const plain = await post('/v1/schedules', A.token, { ...base, display_name: 'Plain', output_key: `mgb.sched.plain.${stamp}`, output_visibility: 'owner' });
        assert(plain.status === 201, `plain: ${shown(plain)}`);
    });
    await test('24. An edit moving a schedule\'s answer to group with no group is refused', async () => {
        const made = await post('/v1/schedules', A.token, { ...base, display_name: 'Edit', output_key: `mgb.sched.edit.${stamp}`, output_visibility: 'owner' });
        assert(made.status === 201, `create: ${shown(made)}`);
        const id = made.body.data.schedule.id;
        const edited = await json(`/v1/schedules/${id}`, {
            method: 'PATCH', headers: as(A.token),
            body: JSON.stringify({ input: { ...made.body.data.schedule.input, outputVisibility: 'group' } }),
        });
        refused(edited);
    });

    console.log('\nCleanup');
    for (const p of [A, B, C]) {
        await test(`cascade-delete ${p?.name}`, async () => {
            const d = await json(`/v1/owners/${p.name}`, { method: 'DELETE', headers: as(p.token) });
            assert(d.status === 200 || d.status === 204, `delete ${p.name}: ${d.status}`);
        });
    }

    console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
    process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => { console.error('FATAL', err); process.exit(1); });
