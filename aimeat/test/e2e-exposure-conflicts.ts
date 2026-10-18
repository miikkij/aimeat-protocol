/**
 * @file test/e2e-exposure-conflicts.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description E2E for the conflicts in "what others can see" (plan doc-mvdipuyqraas, L4.1): where
 *   classification is on, every exposed item carries its EFFECTIVE classification and the label's
 *   audience cap, and an item readable wider than its cap is a conflict, listed first. Asserted over
 *   REST and the node MCP:
 *     - content already wider than its cap when the cap is set is reported, not changed (decision
 *       10.3): a public record and a public board under the owner's cap on Internal, and a shared
 *       workspace page whose ORGANISM's label (Confidential, capped at signed-in) makes it a conflict;
 *     - each conflict names its effective label, where the label came from, the cap and `lower_to`;
 *     - a record the owner's 'audience' exception covers is `excepted`, not a conflict;
 *     - a record labelled Public (no cap) carries its classification and is no conflict;
 *     - the report counts conflicts, and the operator's node-wide report counts them too;
 *     - lowering a record and the share through the routes that change them takes them out of the
 *       conflicts;
 *     - the refusals: another owner gets 403 on the node-wide report and on setting the owner's board
 *       label, and their own report lists nothing of the first owner's.
 *   The operator (the suite's first account) clears every cap on the node's labels, turns
 *   classification on for every owner, and turns it off and restores the policy at the end.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=exposure-conflicts
 * @version-history
 *   v1.0.0 — 2026-10-18 — Initial (plan doc-mvdipuyqraas, L4.1).
 */
import { registerOwner, type RegisteredOwner } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool, type McpAgent, type McpSession } from './helpers/mcp-session.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40437';
const stamp = Date.now();

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }

// Runtime assertions below check the HTTP contract at this untyped JSON boundary.
type Body = Record<string, any>;
/** One request. `method` is always written out by the caller, so a refusal test names what it refuses. */
async function call(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, token?: string, body?: unknown): Promise<{ status: number; body: Body }> {
    const res = await fetch(BASE + path, {
        method,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(60_000),
    });
    const text = await res.text();
    return { status: res.status, body: (res.headers.get('content-type') ?? '').includes('json') ? JSON.parse(text) as Body : { _raw: text } };
}
const q = (o: Record<string, string>) => new URLSearchParams(o).toString();
const INTERNAL = 'sisainen';
const PUBLIC = 'julkinen';
const CONF = 'luottamuksellinen';

console.log('\n=== Conflicts first in what others can see (plan doc-mvdipuyqraas, L4.1) ===\n');

let op!: RegisteredOwner, alice!: RegisteredOwner, bob!: RegisteredOwner;
let bot!: McpAgent, botMcp!: McpSession;
let nodePolicyBefore: Body | null = null;
let orgId = '', ws = '', docId = '', boardId = '';
const conflictKey = `exc.conflict.${stamp}`;
const exceptKey = `exc.excepted.${stamp}`;
const fineKey = `exc.public.${stamp}`;
const setSwitch = (mode: string) => call('PUT', '/v1/admin/config', op.token, { changes: [{ path: 'classification.mode', value: mode }] });
const write = (key: string) => call('POST', '/v1/memory', alice.token, { key, value: { text: key }, visibility: 'public' });
const report = async (token: string): Promise<Body> => {
    const r = await call('GET', '/v1/exposure/mine', token);
    assert(r.status === 200, `report: ${r.status} ${JSON.stringify(r.body?.error)}`);
    return r.body.data as Body;
};
const itemOf = (rep: Body, kind: string, id: string): Body | undefined => (rep.items as Body[]).find(i => i.kind === kind && i.id === id);
const shareId = () => `${orgId}/${ws}/pages/${docId}`;

await test('Setup: the operator clears the caps and turns classification on; alice holds public content and a shared page', async () => {
    op = await registerOwner(BASE, `excop${stamp}`);
    alice = await registerOwner(BASE, `excalice${stamp}`);
    bob = await registerOwner(BASE, `excbob${stamp}`);
    const now = await call('GET', `/v1/classification/policy?${q({ level: 'node' })}`, op.token);
    assert(now.status === 200, `node policy: ${now.status} ${JSON.stringify(now.body?.error)}`);
    nodePolicyBefore = now.body.data.effective;
    // No cap on the node: what a cap does here is the owner's and the organism's, set below. Every
    // label may leave the organism, so a shared page of a classified organism is served to the link
    // at all (a label that may not leave keeps the page off the share, and nothing is exposed).
    const labels = (nodePolicyBefore!.labels as Body[]).map(l => ({ ...l, maxAudience: null, mayLeaveOrganism: true }));
    const put = await call('PUT', '/v1/classification/policy', op.token, { level: 'node', policy: { ...nodePolicyBefore, labels } });
    assert(put.status === 200, `node policy without caps: ${put.status} ${JSON.stringify(put.body?.error ?? put.body?.data)}`);
    const on = await setSwitch('all');
    assert(on.status === 200, `switch all: ${on.status} ${JSON.stringify(on.body?.error)}`);

    for (const key of [conflictKey, exceptKey, fineKey]) {
        const w = await write(key);
        assert(w.status === 201, `write ${key}: ${w.status} ${JSON.stringify(w.body?.error)}`);
    }
    const pub = await call('PUT', '/v1/classification/label', alice.token, { kind: 'memory', key: fineKey, label: PUBLIC });
    assert(pub.status === 200 && pub.body.data.applied === true, `label Public: ${pub.status} ${JSON.stringify(pub.body?.error ?? pub.body?.data)}`);

    const b = await call('POST', '/v1/boards', alice.token, { name: `Conflict board ${stamp}`, visibility: 'public' });
    assert(b.status === 201, `board: ${b.status} ${JSON.stringify(b.body?.error)}`);
    boardId = b.body.data.id as string;

    const o = await call('POST', '/v1/organisms', alice.token, { name: `Conflict org ${stamp}`, description: 'x', type: 'project', join_policy: 'invite_only', visibility: 'private' });
    assert(o.status === 201, `organism: ${o.status} ${JSON.stringify(o.body?.error)}`);
    orgId = o.body.data.organism.id;
    const w = await call('POST', `/v1/organisms/${orgId}/workspaces`, alice.token, {
        name: 'Julkaisut',
        manifest: { manifestVersion: '1', name: 'Julkaisut', kind: 'project', objectTypes: [
            { name: 'pages', namespace: 'shared.pages', schemaRef: 'schema:page@1', mode: 'document', backing: 'memory', writeRole: 'member' },
        ] },
    });
    assert(w.status === 201, `workspace: ${w.status} ${JSON.stringify(w.body?.error)}`);
    ws = w.body.data.ws;
    const d = await call('POST', `/v1/organisms/${orgId}/workspace/drafts`, alice.token, { ws, space: 'pages', value: { title: `Shared page ${stamp}`, markdown: '# Shared\n\nAnyone with the link reads this.' } });
    assert(d.status === 200, `draft: ${d.status} ${JSON.stringify(d.body?.error)}`);
    docId = d.body.data.id;
    const p = await call('POST', `/v1/organisms/${orgId}/publish`, alice.token, { ws, namespace: 'shared.pages', id: docId });
    assert(p.status === 200, `publish: ${p.status} ${JSON.stringify(p.body?.error)}`);
    const s = await call('PUT', `/v1/organisms/${orgId}/workspace/share?${q({ ws })}`, alice.token, { docs: { [`pages/${docId}`]: true } });
    assert(s.status === 200, `share: ${s.status} ${JSON.stringify(s.body?.error)}`);

    bot = await makeAgent(BASE, alice, ['memory:read'], `excbot${stamp % 100000}`);
    botMcp = await openSession(BASE, bot.token, 'exposure conflicts');
});

await test('Setup: the organism is labelled Confidential, the owner excepts one record, and only then the caps are set', async () => {
    const l = await call('PUT', '/v1/classification/label', alice.token, { kind: 'organism', organism_id: orgId, label: CONF });
    assert(l.status === 200 && l.body.data.applied === true, `organism label: ${l.status} ${JSON.stringify(l.body?.error ?? l.body?.data)}`);
    const e = await call('POST', '/v1/classification/exceptions', alice.token, { kind: 'memory', key: exceptKey, action: 'audience', reason: 'This note is meant for everyone.' });
    assert(e.status === 201 || e.status === 200, `exception: ${e.status} ${JSON.stringify(e.body?.error)}`);
    const mine = await call('PUT', '/v1/classification/policy', alice.token, { level: 'owner', policy: { enabled: true, labels: [{ id: INTERNAL, maxAudience: 'organism' }] } });
    assert(mine.status === 200 && mine.body.data.applied === true, `owner cap: ${mine.status} ${JSON.stringify(mine.body?.error ?? mine.body?.data)}`);
    const org = await call('PUT', '/v1/classification/policy', alice.token, { level: 'organism', organism_id: orgId, policy: { labels: [{ id: CONF, maxAudience: 'signed-in' }] } });
    assert(org.status === 200 && org.body.data.applied === true, `organism cap: ${org.status} ${JSON.stringify(org.body?.error ?? org.body?.data)}`);
    // Decision 10.3: a cap set on a policy changes no content.
    const read = await call('GET', `/v1/memory/${encodeURIComponent(alice.ghii)}/${encodeURIComponent(conflictKey)}`, alice.token);
    assert(read.status === 200 && read.body.data.visibility === 'public', `the record was changed by the cap: ${JSON.stringify(read.body?.data?.visibility ?? read.body?.error)}`);
});

// ─── 1. The report ───
console.log('\nThe report: each item\'s classification, the conflicts first');

await test('CONFLICTS FIRST: the record, the board and the shared page come before every other item, and the report counts them', async () => {
    const rep = await report(alice.token);
    assert(rep.classification && rep.classification.conflicts === 3 && rep.classification.excepted === 1,
        `classification counts: ${JSON.stringify(rep.classification)}`);
    const items = rep.items as Body[];
    const firstFine = items.findIndex(i => !i.classification?.conflict);
    const lastConflict = items.map(i => !!i.classification?.conflict).lastIndexOf(true);
    assert(lastConflict === 2 && firstFine === 3, `order: ${items.map(i => `${i.kind}:${i.classification?.conflict ? 'C' : '-'}`).join(' ')}`);
});

await test('A RECORD over the owner\'s cap: Internal, its own label, capped at organism, lowered to private', async () => {
    const it = itemOf(await report(alice.token), 'memory', conflictKey);
    const c = it?.classification;
    assert(c && c.conflict === true && c.label === INTERNAL && c.from === 'own' && c.max_audience === 'organism',
        `record: ${JSON.stringify(it)}`);
    assert(c.lower_to?.level === 'private', `lower_to: ${JSON.stringify(c.lower_to)}`);
    assert(c.name?.en === 'Internal' && /^#[0-9a-fA-F]{6}$/.test(c.color), `name and colour: ${JSON.stringify(c)}`);
});

await test('A CONTAINER\'s label makes a conflict: the shared page is Confidential from its organism, capped at signed-in', async () => {
    const it = itemOf(await report(alice.token), 'workspace_share', shareId());
    const c = it?.classification;
    assert(it?.level === 'link' && c && c.conflict === true && c.label === CONF && c.from === 'organism' && c.max_audience === 'signed-in',
        `shared page: ${JSON.stringify(it)}`);
    assert(c.lower_to?.level === 'signed-in', `lower_to: ${JSON.stringify(c.lower_to)}`);
});

await test('EXCEPTED is not a conflict: the record the owner excepted carries excepted, and a Public record no cap', async () => {
    const rep = await report(alice.token);
    const ex = itemOf(rep, 'memory', exceptKey)?.classification;
    assert(ex && ex.conflict === false && ex.excepted === true && ex.max_audience === 'organism', `excepted: ${JSON.stringify(ex)}`);
    const fine = itemOf(rep, 'memory', fineKey)?.classification;
    assert(fine && fine.conflict === false && !fine.excepted && fine.label === PUBLIC && fine.max_audience === null, `Public: ${JSON.stringify(fine)}`);
    const board = itemOf(rep, 'board', boardId)?.classification;
    assert(board && board.conflict === true && board.lower_to?.level === 'private', `board: ${JSON.stringify(board)}`);
});

await test('MCP: aimeat_exposure_report hands the agent the same conflicts', async () => {
    const r = await callTool(botMcp, 'aimeat_exposure_report', {});
    assert(!r.isError, `MCP: ${r.text.slice(0, 300)}`);
    const rep = JSON.parse(r.text) as Body;
    assert(rep.classification?.conflicts === 3, `MCP counts: ${JSON.stringify(rep.classification)}`);
    assert((rep.items as Body[])[0]?.classification?.conflict === true, `MCP first item: ${JSON.stringify((rep.items as Body[])[0])}`);
});

await test('NODE-WIDE: the operator\'s report counts the conflicts, numbers only', async () => {
    const r = await call('GET', '/v1/admin/exposure', op.token);
    assert(r.status === 200, `node-wide: ${r.status} ${JSON.stringify(r.body?.error)}`);
    const c = r.body.data.classification;
    assert(c && c.conflicts >= 3 && c.excepted >= 1, `node-wide classification: ${JSON.stringify(c)}`);
    assert(!('items' in r.body.data), 'the node-wide report handed out items');
});

// ─── 2. Lowering ───
console.log('\nLowering: the route that changes the item takes it out of the conflicts');

await test('LOWER: the record made private and the share opened to signed-in accounts leave the conflicts', async () => {
    const m = await call('PATCH', `/v1/memory/${encodeURIComponent(conflictKey)}`, alice.token, { patch: {}, visibility: 'private' });
    assert(m.status === 200, `record private: ${m.status} ${JSON.stringify(m.body?.error)}`);
    const s = await call('PUT', `/v1/organisms/${orgId}/workspace/share?${q({ ws })}`, alice.token, { access: 'account' });
    assert(s.status === 200, `share to signed-in: ${s.status} ${JSON.stringify(s.body?.error)}`);
    const rep = await report(alice.token);
    assert(rep.classification.conflicts === 1, `after: ${JSON.stringify(rep.classification)}`);
    assert(!itemOf(rep, 'memory', conflictKey), 'the private record is still listed');
    const share = itemOf(rep, 'workspace_share', shareId());
    assert(share?.level === 'signed-in' && share.classification?.conflict === false, `share after: ${JSON.stringify(share)}`);
});

// ─── 3. The refusals ───
console.log('\nThe refusals: another owner reads and sets nothing of alice\'s');

await test('REFUSED: bob gets 403 on the node-wide report, and his own report lists nothing of alice\'s', async () => {
    const r = await call('GET', '/v1/admin/exposure', bob.token);
    assert(r.status === 403, `bob read the node-wide report: ${r.status}`);
    const rep = await report(bob.token);
    assert(!(rep.items as Body[]).some(i => i.id === boardId || i.id === exceptKey || i.id === shareId()), `bob's report lists alice's items: ${JSON.stringify(rep.items)}`);
    assert(rep.classification?.conflicts === 0, `bob's conflicts: ${JSON.stringify(rep.classification)}`);
});

await test('REFUSED: bob cannot set the classification of alice\'s public board (403), and it stays as it was', async () => {
    const r = await call('PUT', '/v1/classification/label', bob.token, { kind: 'board', board_id: boardId, label: PUBLIC });
    assert(r.status === 403, `bob set alice's board label: ${r.status} ${JSON.stringify(r.body?.error)}`);
    const it = itemOf(await report(alice.token), 'board', boardId);
    assert(it?.classification?.label === INTERNAL && it.classification.conflict === true, `alice's board after: ${JSON.stringify(it)}`);
});

await test('Cleanup: the operator turns classification off and restores the node policy', async () => {
    const off = await setSwitch('off');
    assert(off.status === 200, `switch off: ${off.status} ${JSON.stringify(off.body?.error)}`);
    if (nodePolicyBefore) {
        const back = await call('PUT', '/v1/classification/policy', op.token, { level: 'node', policy: nodePolicyBefore });
        assert(back.status === 200, `restore: ${back.status} ${JSON.stringify(back.body?.error)}`);
    }
    const rep = await report(alice.token);
    assert(!rep.classification && !(rep.items as Body[]).some(i => i.classification), 'classification off still reports a classification');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
