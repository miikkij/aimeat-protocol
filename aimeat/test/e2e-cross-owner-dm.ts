/**
 * @file e2e-cross-owner-dm.ts
 * @description E2E for the first-contact gate and organism co-members (services/contact/
 *   shared-organism.ts, services/message/send.ts). A first message from a co-member of an organism
 *   nobody joins on their own (invite_only or approval_required, not archived) lands in the inbox; an
 *   agent of that co-member does too when the organism admits it. What must not change: a stranger's
 *   message, a co-member of an OPEN organism only, an agent the organism keeps out (agent_access
 *   "listed"), a co-member of an archived organism, and a blocked co-member all stay requests or
 *   refused, and the rule reaches nobody outside the organism.
 * @version-history
 *   v1.0.0 — 2026-11-19 — Initial.
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=cross-owner-dm

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
import { ownerSignIn } from './helpers/owner-login.js';
import { BASE, test, assert, json, expectRefusal, finish } from './helpers/harness.js';

const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());
async function sign(privB64: string, msg: string): Promise<string> {
    return Buffer.from(await ed.signAsync(new TextEncoder().encode(msg), Buffer.from(privB64, 'base64'))).toString('base64');
}

async function setupOwner(label: string) {
    const name = `xodm${label}${Date.now()}`;
    const body = JSON.stringify({ username: name, display_name: `Member ${label.toUpperCase()}`, password: 'XoDm12345' });
    let reg = await json('/v1/ghii', { method: 'POST', body });
    for (let i = 0; reg.status === 429 && i < 8; i++) {
        await new Promise(r => setTimeout(r, 1500));
        reg = await json('/v1/ghii', { method: 'POST', body });
    }
    assert(reg.status === 201, `ghii ${label} ${reg.status}`);
    const tok = await ownerSignIn(BASE, name, 'XoDm12345');
    return { name, ghii: `${name}@${NODE_ID}`, token: tok.body.data.token as string };
}
type Owner = Awaited<ReturnType<typeof setupOwner>>;

async function agentOf(owner: Owner, name: string, scopes: string[]) {
    const made = await json('/v1/agents', {
        method: 'POST', headers: auth(owner.token),
        body: JSON.stringify({ name, owner: owner.name, capabilities: ['messages'], model: 'gpt-4o', scopes }),
    });
    assert(made.status === 201, `agent ${name} ${made.status}: ${JSON.stringify(made.body.error)}`);
    const gaii = made.body.data.agent.gaii as string;
    const key = made.body.data.private_key as string;
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ gaii, timestamp: ts, signature: await sign(key, gaii + ts) }) });
    assert(tok.body.ok === true, `agent token ${name}: ${JSON.stringify(tok.body.error)}`);
    return { gaii, token: tok.body.data.token as string };
}

async function organism(owner: Owner, name: string, joinPolicy: string, extra: Record<string, unknown> = {}) {
    const r = await json('/v1/organisms', {
        method: 'POST', headers: auth(owner.token),
        body: JSON.stringify({ name, type: 'project', join_policy: joinPolicy, visibility: 'private', ...extra }),
    });
    assert(r.status === 201, `organism ${name} ${r.status}: ${JSON.stringify(r.body.error)}`);
    return r.body.data.organism.id as string;
}
async function addMember(owner: Owner, orgId: string, who: Owner) {
    const r = await json(`/v1/organisms/${orgId}/members`, { method: 'POST', headers: auth(owner.token), body: JSON.stringify({ ghii: who.name }) });
    assert(r.status === 201, `member add ${who.name} ${r.status}: ${JSON.stringify(r.body.error)}`);
}

const send = (token: string, to: string, body: string) =>
    json('/v1/messages', { method: 'POST', headers: auth(token), body: JSON.stringify({ to, body }) });
const stateIn = async (owner: Owner, contact: string, qs = '') => {
    const r = await json(`/v1/contacts${qs}`, { headers: auth(owner.token) });
    assert(r.status === 200, `contacts ${r.status}`);
    return (r.body.data.contacts as any[]).find(c => c.contact_id === contact)?.state ?? null;
};
async function expectRequest(token: string, to: Owner, from: string, label: string) {
    const r = await send(token, to.ghii, `hello, ${label}`);
    assert(r.status === 201, `send ${label} ${r.status}: ${JSON.stringify(r.body.error)}`);
    assert(r.body.data?.awaiting_approval === true, `${label} waits for approval: ${JSON.stringify(r.body.data).slice(0, 200)}`);
    assert(await stateIn(to, from) === 'pending', `${to.name} holds ${from} as pending`);
}
async function expectDelivered(token: string, to: Owner, from: string, label: string) {
    const r = await send(token, to.ghii, `hello, ${label}`);
    assert(r.status === 201, `send ${label} ${r.status}: ${JSON.stringify(r.body.error)}`);
    assert(r.body.data?.awaiting_approval !== true, `${label} is delivered, not a request: ${JSON.stringify(r.body.data).slice(0, 200)}`);
    assert(await stateIn(to, from) === 'accepted', `${to.name} holds ${from} as accepted`);
}

console.log('\n=== AIMEAT co-members of a closed organism: the first-contact gate E2E ===\n');

let A: Owner, B: Owner, C: Owner, D: Owner, E: Owner, F: Owner, G: Owner;
let closedOrg = '', listedOrg = '';

await test('Setup: people who are strangers to each other', async () => {
    // The first owner of a fresh node is the operator; its welcome gives everyone a row with it.
    await setupOwner('op');
    A = await setupOwner('a'); B = await setupOwner('b'); C = await setupOwner('c'); D = await setupOwner('d');
    E = await setupOwner('e'); F = await setupOwner('f'); G = await setupOwner('g');
});

await test('1. Before any organism, B\'s first message to A is a request (the gate holds)', async () => {
    await expectRequest(B.token, A, B.ghii, 'stranger B');
});

await test('2. A co-member of an invite_only organism: a pending request from B is accepted by B\'s next message', async () => {
    closedOrg = await organism(A, `Closed ${Date.now()}`, 'invite_only');
    await addMember(A, closedOrg, B);
    await expectDelivered(B.token, A, B.ghii, 'co-member B');
});

await test('3. A co-member of an approval_required organism: C\'s first message to D lands in the inbox', async () => {
    const org = await organism(D, `Approval ${Date.now()}`, 'approval_required');
    await addMember(D, org, C);
    await expectDelivered(C.token, D, C.ghii, 'co-member C');
});

await test('4. A co-member of an OPEN organism only: E\'s first message to F stays a request', async () => {
    const org = await organism(F, `Open ${Date.now()}`, 'open');
    const join = await json(`/v1/organisms/${org}/join`, { method: 'POST', headers: auth(E.token), body: '{}' });
    assert(join.status === 201, `E joins the open organism: ${join.status} ${JSON.stringify(join.body.error)}`);
    await expectRequest(E.token, F, E.ghii, 'open co-member E');
});

await test('5. An agent of a co-member that the organism admits: its first message lands in the inbox', async () => {
    const bot = await agentOf(B, 'xodmbot', ['messages:send']);
    await expectDelivered(bot.token, A, bot.gaii, 'B\'s agent in the closed organism');
});

await test('6. An agent the organism keeps out (agent_access listed, not on the list) stays a request', async () => {
    listedOrg = await organism(G, `Listed ${Date.now()}`, 'invite_only');
    // The create route takes no agent_access; the update sets it.
    const put = await json(`/v1/organisms/${listedOrg}`, { method: 'PUT', headers: auth(G.token), body: JSON.stringify({ agent_access: 'listed' }) });
    assert(put.status === 200 && put.body.data?.organism?.agentAccess === 'listed', `agent_access listed: ${put.status} ${JSON.stringify(put.body.error ?? put.body.data?.organism?.agentAccess)}`);
    await addMember(G, listedOrg, C);
    const outsider = await agentOf(C, 'xodmoutside', ['messages:send']);
    await expectRequest(outsider.token, G, outsider.gaii, 'C\'s agent not admitted');
});

await test('7. The same agent once listed is let in, and so is its person', async () => {
    const listed = await agentOf(C, 'xodmlisted', ['messages:send']);
    const attach = await json(`/v1/organisms/${listedOrg}/agents`, { method: 'POST', headers: auth(G.token), body: JSON.stringify({ agent_gaii: listed.gaii }) });
    assert(attach.status === 201, `attach ${attach.status}: ${JSON.stringify(attach.body.error)}`);
    await expectDelivered(listed.token, G, listed.gaii, 'C\'s listed agent');
    await expectDelivered(C.token, G, C.ghii, 'co-member C in the listed organism');
});

await test('8. A block still wins: A blocks B, and B\'s next message is not let in', async () => {
    const block = await json(`/v1/messages/contacts/${encodeURIComponent(B.ghii)}/block`, { method: 'POST', headers: auth(A.token), body: '{}' });
    assert(block.status === 200, `block ${block.status}: ${JSON.stringify(block.body.error)}`);
    await send(B.token, A.ghii, 'after the block');
    // A blocked row leaves the address book; it is listed with ?state=blocked.
    assert(await stateIn(A, B.ghii) === null, 'B is back in A\'s book after the block');
    assert(await stateIn(A, B.ghii, '?state=blocked') === 'blocked', 'A still holds B as blocked');
});

await test('9. An archived organism no longer introduces: E and A share only an archived closed organism', async () => {
    const org = await organism(A, `Archived ${Date.now()}`, 'invite_only');
    await addMember(A, org, E);
    const arch = await json(`/v1/organisms/${org}/archive`, { method: 'POST', headers: auth(A.token), body: JSON.stringify({ level: 'organism' }) });
    assert(arch.status === 200, `archive ${arch.status}: ${JSON.stringify(arch.body.error)}`);
    await expectRequest(E.token, A, E.ghii, 'co-member of an archived organism');
});

await test('10. A co-member\'s agent without messages:send is refused (403), organism or not', async () => {
    const reader = await agentOf(B, 'xodmreader', ['contacts:read']);
    const refused = await send(reader.token, D.ghii, 'no permission to send');
    expectRefusal(refused, 403);
});

finish();
