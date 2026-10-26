/**
 * @file e2e-colleagues.ts
 * @description E2E for the company-node setting "everyone on this server sees each other"
 *   (registration.members_see_each_other, AIMEAT_MEMBERS_SEE_EACH_OTHER, services/colleagues.ts).
 *   Off by default: the address book holds only saved and messaged people, the member directory only
 *   the people who opted in, and a stranger's first message is a request. On: every other active person
 *   of the node is in the book as a colleague (REST for the owner and for an agent on contacts:read),
 *   the directory lists everyone, and a colleague's first message and an earlier pending request are
 *   accepted. What must not change: a block still hides and still holds the gate, an agent still asks
 *   first, a disabled account is not shown, a person is not their own colleague, only an operator turns
 *   the setting on, and turning it off takes the colleagues out again.
 * @version-history
 *   v1.0.0 — 2026-10-26 — Initial.
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=colleagues

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
import { ownerSignIn } from './helpers/owner-login.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const SETTING = 'registration.members_see_each_other';

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());
async function sign(privB64: string, msg: string): Promise<string> {
    return Buffer.from(await ed.signAsync(new TextEncoder().encode(msg), Buffer.from(privB64, 'base64'))).toString('base64');
}

async function setupOwner(label: string) {
    const name = `colg${label}${Date.now()}`;
    const body = JSON.stringify({ username: name, display_name: `Colleague ${label.toUpperCase()}`, password: 'ColG12345' });
    let reg = await json('/v1/ghii', { method: 'POST', body });
    for (let i = 0; reg.status === 429 && i < 8; i++) {
        await new Promise(r => setTimeout(r, 1500));
        reg = await json('/v1/ghii', { method: 'POST', body });
    }
    assert(reg.status === 201, `ghii ${label} ${reg.status}`);
    const tok = await ownerSignIn(BASE, name, 'ColG12345');
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

const contactsOf = async (token: string, qs = '') => {
    const r = await json(`/v1/contacts${qs}`, { headers: auth(token) });
    assert(r.status === 200, `contacts ${r.status}: ${JSON.stringify(r.body.error)}`);
    return r.body.data.contacts as any[];
};
const directoryOf = async (token: string) => {
    const r = await json('/v1/ghii/list', { headers: auth(token) });
    assert(r.status === 200, `directory ${r.status}: ${JSON.stringify(r.body.error)}`);
    return (r.body.data.humans as any[]).map(h => h.ghii as string);
};
const send = (token: string, to: string, body: string) =>
    json('/v1/messages', { method: 'POST', headers: auth(token), body: JSON.stringify({ to, body }) });
const setSetting = (token: string, value: boolean) =>
    json('/v1/admin/config', { method: 'PUT', headers: auth(token), body: JSON.stringify({ changes: [{ path: SETTING, value }] }) });

console.log('\n=== AIMEAT Colleagues (everyone on this server sees each other) E2E ===\n');

let OP: Owner, A: Owner, B: Owner, C: Owner, D: Owner, E: Owner, F: Owner;

await test('Setup: the operator, and six people who are strangers to each other', async () => {
    // The first owner of a fresh node is the operator, and the operator's welcome gives everyone a
    // row with the operator, so the operator is never one of the strangers asserted on below.
    OP = await setupOwner('op');
    A = await setupOwner('a'); B = await setupOwner('b'); C = await setupOwner('c');
    D = await setupOwner('d'); E = await setupOwner('e'); F = await setupOwner('f');
});

// ── Off (the default) ──

await test('1. Off: A\'s address book holds none of the strangers, and the directory shows none of them', async () => {
    const book = (await contactsOf(A.token)).map(r => r.contact_id);
    for (const p of [B, C, D, E, F]) assert(!book.includes(p.ghii), `${p.name} is in A's book while the setting is off`);
    const dir = await directoryOf(A.token);
    for (const p of [B, C, D]) assert(!dir.includes(p.ghii), `${p.name} is in the directory without opting in`);
});

await test('2. Off: a stranger\'s first message is a request (E to A)', async () => {
    const r = await send(E.token, A.ghii, 'hello from E, setting off');
    assert(r.status === 200 || r.status === 201, `send ${r.status}: ${JSON.stringify(r.body.error)}`);
    assert(r.body.data?.awaiting_approval === true, `the first message waits for approval: ${JSON.stringify(r.body.data).slice(0, 300)}`);
    const row = (await contactsOf(A.token)).find(c => c.contact_id === E.ghii);
    assert(row?.state === 'pending', `A holds E as pending: ${JSON.stringify(row)}`);
});

await test('3. Only an operator turns the setting on (A is refused)', async () => {
    const r = await setSetting(A.token, true);
    assert(r.status === 403 || r.status === 401, `a person who is not an operator: ${r.status}`);
    assert(!(await contactsOf(B.token)).some(c => c.contact_id === C.ghii), 'the setting did not change');
});

// ── On ──

await test('4. The operator turns it on', async () => {
    const r = await setSetting(OP.token, true);
    assert(r.status === 200, `set ${r.status}: ${JSON.stringify(r.body.error ?? r.body).slice(0, 300)}`);
});

await test('5. On: every other person is in A\'s book as a colleague, with the name from their profile; A is not', async () => {
    const book = await contactsOf(A.token);
    for (const p of [B, C, D, F]) {
        const row = book.find(r => r.contact_id === p.ghii);
        assert(!!row, `${p.name} missing from A's book: ${JSON.stringify(book.map(r => r.contact_id))}`);
        assert(row.kind === 'ghii' && row.origin === 'colleague' && row.state === null, `row shape: ${JSON.stringify(row)}`);
        assert(row.display_name === `Colleague ${p.name.slice(4, 5).toUpperCase()}`, `display name: ${row.display_name}`);
    }
    assert(!book.some(r => r.contact_id === A.ghii), 'A is not their own colleague');
    // E has a pending request row, so E shows as that row, not a second one.
    assert(book.filter(r => r.contact_id === E.ghii).length === 1, 'E appears once');
});

await test('6. On: an agent of A reading the book on contacts:read gets the colleagues too', async () => {
    const bot = await agentOf(A, 'colgreader', ['contacts:read']);
    const book = await contactsOf(bot.token);
    assert(book.some(r => r.contact_id === B.ghii && r.origin === 'colleague'), `the agent sees the colleague B: ${JSON.stringify(book.map(r => r.contact_id))}`);
});

await test('7. On: the member directory lists everyone without the opt-in', async () => {
    const dir = await directoryOf(A.token);
    for (const p of [B, C, D, F]) assert(dir.includes(p.ghii), `${p.name} missing from the directory`);
});

await test('8. On: a colleague\'s first message arrives, not as a request (B to A)', async () => {
    const r = await send(B.token, A.ghii, 'hello from B, colleague');
    assert(r.status === 200 || r.status === 201, `send ${r.status}: ${JSON.stringify(r.body.error)}`);
    assert(r.body.data?.awaiting_approval !== true, `a colleague is not a request: ${JSON.stringify(r.body.data).slice(0, 300)}`);
    const row = (await contactsOf(A.token)).find(c => c.contact_id === B.ghii);
    assert(row?.state === 'accepted', `A holds B as accepted: ${JSON.stringify(row)}`);
});

await test('9. On: a request sent while it was off is accepted with the colleague\'s next message (E to A)', async () => {
    const r = await send(E.token, A.ghii, 'hello again from E');
    assert(r.status === 200 || r.status === 201, `send ${r.status}: ${JSON.stringify(r.body.error)}`);
    assert(r.body.data?.awaiting_approval !== true, `no longer a request: ${JSON.stringify(r.body.data).slice(0, 300)}`);
    const row = (await contactsOf(A.token)).find(c => c.contact_id === E.ghii);
    assert(row?.state === 'accepted', `A holds E as accepted: ${JSON.stringify(row)}`);
});

await test('10. On: a block still wins. C, blocked by A, leaves A\'s book and C\'s message is not let in', async () => {
    assert((await contactsOf(A.token)).some(r => r.contact_id === C.ghii && r.origin === 'colleague'), 'C is a colleague in A\'s book before the block');
    const block = await json(`/v1/messages/contacts/${encodeURIComponent(C.ghii)}/block`, { method: 'POST', headers: auth(A.token), body: '{}' });
    assert(block.status === 200, `block ${block.status}: ${JSON.stringify(block.body.error)}`);
    assert(!(await contactsOf(A.token)).some(r => r.contact_id === C.ghii), 'a blocked colleague is back in the book');
    await send(C.token, A.ghii, 'hello from blocked C');
    const blocked = await contactsOf(A.token, '?state=blocked');
    assert(blocked.some(r => r.contact_id === C.ghii && r.state === 'blocked'), `C stays blocked: ${JSON.stringify(blocked)}`);
});

await test('11. On: an agent still asks first. B\'s agent writing to D is a request', async () => {
    const bot = await agentOf(B, 'colgwriter', ['messages:send']);
    const r = await send(bot.token, D.ghii, 'hello from B\'s agent');
    assert(r.status === 200 || r.status === 201, `send ${r.status}: ${JSON.stringify(r.body.error)}`);
    assert(r.body.data?.awaiting_approval === true, `an agent is not a colleague: ${JSON.stringify(r.body.data).slice(0, 300)}`);
});

await test('12. On: an account the operator disabled is not shown, in the book or the directory', async () => {
    assert((await contactsOf(A.token)).some(r => r.contact_id === F.ghii), 'F is in A\'s book before the account is disabled');
    assert((await directoryOf(A.token)).includes(F.ghii), 'F is in the directory before the account is disabled');
    const off = await json(`/v1/admin/owners/${encodeURIComponent(F.name)}/disable`, { method: 'POST', headers: auth(OP.token), body: '{}' });
    assert(off.status === 200, `disable ${off.status}: ${JSON.stringify(off.body.error)}`);
    assert(!(await contactsOf(A.token)).some(r => r.contact_id === F.ghii), 'a disabled account is in the book');
    assert(!(await directoryOf(A.token)).includes(F.ghii), 'a disabled account is in the directory');
});

// ── Off again ──

await test('13. Off again: the colleagues nobody saved or messaged leave the book; the directory is opt-in again', async () => {
    const r = await setSetting(OP.token, false);
    assert(r.status === 200, `unset ${r.status}`);
    const book = (await contactsOf(A.token)).map(c => c.contact_id);
    assert(!book.includes(D.ghii), `D, never saved or messaged, is still in A's book`);
    assert(book.includes(B.ghii), 'B stays: B and A exchanged a message');
    assert(!(await directoryOf(A.token)).includes(D.ghii), 'the directory lists D without the opt-in');
});

console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) process.exit(1);
