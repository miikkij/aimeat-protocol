/**
 * @file e2e-workspace-read-ambiguous.ts
 * @description E2E for a batch read of a workspace whose id two spaces hold (appdev pitfall
 *   data/workspace-read-ids-needs-space): GET /v1/organisms/:id/workspace/index?ids= without `space`
 *   answered from the first space and said nothing about the other, so an agent read the wrong
 *   record. The answer is still the first space's record, and `ambiguous` names every space that
 *   holds the id. The same function answers aimeat_workspace_read (services/workspace/tool-ops.ts).
 *   Cases: the twin id names both spaces; the space named reads the other and is not ambiguous; an id
 *   one space holds carries no `ambiguous`; an owner who is no member is refused.
 *   Seen red first: before the change the answer had no `ambiguous`.
 * @version-history
 *   v1.0.0 — 2026-11-21 — Initial.
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=workspace-read-ambiguous

import { BASE, test, assert, json, finish } from './helpers/harness.js';
import { registerOwner } from './helpers/owner-login.js';

const short = (b: any) => (b === undefined ? '' : String(JSON.stringify(b)).slice(0, 400));
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

console.log('\n=== AIMEAT Workspace Read Ambiguous Ids E2E ===\n');

const stamp = Date.now();
let alice = '';
let bob = '';
let org = '';
let ws = '';

await test('Setup: alice with an organism and a workspace of two records spaces; bob, no member', async () => {
    alice = (await registerOwner(BASE, `amb${stamp}a`)).token;
    bob = (await registerOwner(BASE, `amb${stamp}b`)).token;
    const made = await json('/v1/organisms', { method: 'POST', headers: auth(alice), body: JSON.stringify({ name: 'Twins', visibility: 'private' }) });
    assert(made.status === 201, `organism: ${made.status} ${short(made.body)}`);
    org = made.body.data?.id ?? made.body.data?.organism?.id;
    const w = await json(`/v1/organisms/${encodeURIComponent(org)}/workspaces`, {
        method: 'POST', headers: auth(alice),
        body: JSON.stringify({ name: 'Twins', manifest: { objectTypes: [
            { name: 'note', namespace: 'notes', mode: 'records' },
            { name: 'card', namespace: 'cards', mode: 'records' },
        ] } }),
    });
    assert(w.status === 201, `workspace: ${w.status} ${short(w.body)}`);
    ws = w.body.data.ws;
    const drafts: Array<[string, string, unknown]> = [['note', 'twin', { title: 'Twin note' }], ['card', 'twin', { title: 'Twin card' }], ['note', 'solo', { title: 'Only a note' }]];
    for (const [space, id, value] of drafts) {
        const d = await json(`/v1/organisms/${encodeURIComponent(org)}/workspace/drafts`, {
            method: 'POST', headers: auth(alice), body: JSON.stringify({ ws, space, id, value }),
        });
        assert(d.status === 200, `draft ${space}/${id}: ${d.status} ${short(d.body)}`);
    }
});

const read = (token: string, q: string) => json(`/v1/organisms/${encodeURIComponent(org)}/workspace/index?ws=${encodeURIComponent(ws)}&${q}`, { headers: auth(token) });

await test('An id two spaces hold, read without space, is answered from the first and names both spaces', async () => {
    const r = await read(alice, 'ids=twin');
    assert(r.status === 200, `read: ${r.status} ${short(r.body)}`);
    const d = r.body.data;
    assert(d.items?.length === 1 && d.items[0].space === 'note', `answered from the first space: ${short(d.items)}`);
    const amb = (d.ambiguous ?? []).find((a: any) => a.id === 'twin');
    assert(amb && amb.spaces.includes('note') && amb.spaces.includes('card') && amb.answered_from === 'note', `ambiguous: ${short(d.ambiguous)}`);
});

await test('The space named reads the other record, and nothing is ambiguous', async () => {
    const r = await read(alice, 'ids=twin&space=card');
    assert(r.status === 200 && r.body.data.items?.[0]?.space === 'card' && r.body.data.items[0].value?.title === 'Twin card', `space card: ${r.status} ${short(r.body)}`);
    assert(!('ambiguous' in r.body.data), `ambiguous: ${short(r.body.data.ambiguous)}`);
});

await test('An id one space holds carries no ambiguous field', async () => {
    const r = await read(alice, 'ids=solo');
    assert(r.status === 200 && r.body.data.items?.[0]?.id === 'solo', `solo: ${r.status} ${short(r.body)}`);
    assert(!('ambiguous' in r.body.data), `ambiguous: ${short(r.body.data.ambiguous)}`);
});

await test('An owner who is no member of the organism is refused, and learns nothing about the ids', async () => {
    const r = await read(bob, 'ids=twin');
    assert(r.status === 403 || r.status === 404, `bob: ${r.status} ${short(r.body)}`);
    assert(!JSON.stringify(r.body).includes('ambiguous'), `bob saw: ${short(r.body)}`);
});

finish();
