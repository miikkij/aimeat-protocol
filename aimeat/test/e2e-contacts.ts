/**
 * @file e2e-contacts.ts
 * @description E2E for the CONTACTS (address book) API: merged list (saved rows ∪ DM peers with
 *   display names), proactive save (origin 'saved'), gate-safe delete (removing a messaged
 *   contact never resets the DM first-contact gate), blocked-row handling, the q filter,
 *   cross-owner isolation, and exact-match email resolve (found / not-found / invalid / unauth).
 * @version-history
 *   v1.0.0 — 2026-07-16 — Initial.
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=contacts

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
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body };
}

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());
async function sign(privB64: string, msg: string): Promise<string> {
    return Buffer.from(await ed.signAsync(new TextEncoder().encode(msg), Buffer.from(privB64, 'base64'))).toString('base64');
}

async function setupOwner(label: string) {
    const name = `contx${label}${Date.now()}`;
    let reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: `Contact ${label.toUpperCase()}`, password: 'ContX1234' }) });
    for (let i = 0; reg.status === 429 && i < 8; i++) {
        await new Promise(r => setTimeout(r, 1500));
        reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: `Contact ${label.toUpperCase()}`, password: 'ContX1234' }) });
    }
    assert(reg.status === 201, `ghii ${reg.status}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: await sign(reg.body.data.private_key, name + NODE_ID + ts) }) });
    return { name, ghii: `${name}@${NODE_ID}`, token: tok.body.data.token as string };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const contactsOf = async (token: string, qs = '') => {
    const r = await json(`/v1/contacts${qs}`, { headers: auth(token) });
    assert(r.status === 200, `contacts ${r.status}: ${JSON.stringify(r.body.error)}`);
    return r.body.data.contacts as any[];
};

console.log('\n=== AIMEAT Contacts (Address Book) E2E ===\n');

let A: Awaited<ReturnType<typeof setupOwner>>;   // saves B, resolves emails
let B: Awaited<ReturnType<typeof setupOwner>>;   // saved by A; messages C
let C: Awaited<ReturnType<typeof setupOwner>>;   // receives B's DM (gate row), blocks later

await test('Setup owners A + B + C', async () => {
    // The first owner on a fresh node becomes the OPERATOR, and the operator welcomes every new
    // account by message — which gives them a contact row with everyone. A used to be that first
    // owner, so "A's address book" started out holding B and C for reasons this suite is not
    // about. A throwaway owner takes the role, leaving A, B and C as ordinary strangers.
    await setupOwner('op');
    A = await setupOwner('a'); B = await setupOwner('b'); C = await setupOwner('c');
});

// ── Proactive save ──

await test('1. A saves B by bare name → origin saved, state accepted, display name resolved', async () => {
    const r = await json('/v1/contacts', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ contact_id: B.name }) });
    assert(r.status === 201, `save ${r.status}: ${JSON.stringify(r.body.error)}`);
    assert(r.body.data.contact.origin === 'saved' && r.body.data.contact.state === 'accepted', `row: ${JSON.stringify(r.body.data.contact)}`);
    const list = await contactsOf(A.token);
    const row = list.find(c => c.contact_id === B.ghii);
    assert(!!row, `B in A's list: ${JSON.stringify(list.map(c => c.contact_id))}`);
    assert(row.kind === 'ghii' && row.origin === 'saved' && row.has_messages === false, `row shape: ${JSON.stringify(row)}`);
    assert(row.display_name === 'Contact B', `display name resolved at read time, got ${row.display_name}`);
});

await test('2. Saving yourself → 400; saving an unknown local owner → 404', async () => {
    const self = await json('/v1/contacts', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ contact_id: A.name }) });
    assert(self.status === 400, `self expected 400, got ${self.status}`);
    const nope = await json('/v1/contacts', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ contact_id: `no-such-${Date.now()}` }) });
    assert(nope.status === 404 && nope.body.error?.code === 'OWNER_NOT_FOUND', `expected 404 OWNER_NOT_FOUND, got ${nope.status} ${nope.body.error?.code}`);
});

// ── Messaged peers appear (both directions) ──

await test('3. B DMs C → C lists B (gate row, origin message); B lists C (conversation peer)', async () => {
    const dm = await json('/v1/messages', { method: 'POST', headers: auth(B.token), body: JSON.stringify({ to: C.ghii, body: 'hello from B' }) });
    assert(dm.status === 200 || dm.status === 201, `dm ${dm.status}: ${JSON.stringify(dm.body.error)}`);
    const cList = await contactsOf(C.token);
    const bRow = cList.find(c => c.contact_id === B.ghii);
    assert(!!bRow && bRow.origin === 'message' && bRow.has_messages === true, `C sees B via the gate: ${JSON.stringify(bRow)}`);
    const bList = await contactsOf(B.token);
    const cRow = bList.find(c => c.contact_id === C.ghii);
    assert(!!cRow && cRow.has_messages === true, `B sees C via conversations: ${JSON.stringify(cRow)}`);
});

await test('4. Cross-owner isolation: A\'s list never contains C', async () => {
    const list = await contactsOf(A.token);
    assert(!list.some(c => c.contact_id === C.ghii), `A must not see C: ${JSON.stringify(list.map(c => c.contact_id))}`);
});

await test('5. The q filter narrows by name/id', async () => {
    const hit = await contactsOf(A.token, `?q=${encodeURIComponent(B.name.slice(0, 8))}`);
    assert(hit.some(c => c.contact_id === B.ghii), 'prefix q finds B');
    const miss = await contactsOf(A.token, '?q=zzz-no-such-contact');
    assert(miss.length === 0, `nonsense q finds nothing, got ${JSON.stringify(miss)}`);
});

// ── Gate-safe delete ──

await test('6. Deleting a pure saved contact (no messages) removes the row', async () => {
    const r = await json(`/v1/contacts/${encodeURIComponent(B.ghii)}`, { method: 'DELETE', headers: auth(A.token) });
    assert(r.status === 200, `delete ${r.status}: ${JSON.stringify(r.body.error)}`);
    const list = await contactsOf(A.token);
    assert(!list.some(c => c.contact_id === B.ghii), 'B gone from A\'s list');
    const again = await json(`/v1/contacts/${encodeURIComponent(B.ghii)}`, { method: 'DELETE', headers: auth(A.token) });
    assert(again.status === 404, `second delete expected 404, got ${again.status}`);
});

await test('7. Deleting a messaged contact keeps the DM gate (origin flips back to message)', async () => {
    // C saves B (upgrades the gate row to origin 'saved') …
    const save = await json('/v1/contacts', { method: 'POST', headers: auth(C.token), body: JSON.stringify({ contact_id: B.ghii }) });
    assert(save.status === 201 && save.body.data.contact.origin === 'saved', `save ${save.status}`);
    // … then removes it from the address book — the gate row must SURVIVE as origin 'message'.
    const del = await json(`/v1/contacts/${encodeURIComponent(B.ghii)}`, { method: 'DELETE', headers: auth(C.token) });
    assert(del.status === 200, `delete ${del.status}: ${JSON.stringify(del.body.error)}`);
    const list = await contactsOf(C.token);
    const row = list.find(c => c.contact_id === B.ghii);
    assert(!!row && row.origin === 'message' && row.has_messages === true, `gate row survives: ${JSON.stringify(row)}`);
    // The messaging-gate view still knows the pair (state preserved, whatever it was).
    const gate = await json('/v1/messages/contacts', { headers: auth(C.token) });
    assert((gate.body.data.contacts || []).some((c: any) => c.contactId === B.ghii), 'messaging gate row still present');
});

// ── Blocked rows ──

await test('8. A blocked contact is hidden by default, visible via ?state=blocked, and locked (409)', async () => {
    const block = await json(`/v1/messages/contacts/${encodeURIComponent(B.ghii)}/block`, { method: 'POST', headers: auth(C.token), body: '{}' });
    assert(block.status === 200, `block ${block.status}`);
    const def = await contactsOf(C.token);
    assert(!def.some(c => c.contact_id === B.ghii && c.state === 'blocked'), 'blocked row hidden from the default list');
    const blocked = await contactsOf(C.token, '?state=blocked');
    assert(blocked.some(c => c.contact_id === B.ghii), 'visible via ?state=blocked');
    const del = await json(`/v1/contacts/${encodeURIComponent(B.ghii)}`, { method: 'DELETE', headers: auth(C.token) });
    assert(del.status === 409 && del.body.error?.code === 'BLOCKED', `delete expected 409 BLOCKED, got ${del.status}`);
    const save = await json('/v1/contacts', { method: 'POST', headers: auth(C.token), body: JSON.stringify({ contact_id: B.ghii }) });
    assert(save.status === 409 && save.body.error?.code === 'BLOCKED', `save expected 409 BLOCKED, got ${save.status}`);
});

// ── Email resolve ──

await test('9. Resolve: unknown email → found:false; invalid → 400; unauthenticated → 401', async () => {
    const miss = await json('/v1/contacts/resolve', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ email: `nobody-${Date.now()}@example.com` }) });
    assert(miss.status === 200 && miss.body.data.found === false, `miss ${miss.status}: ${JSON.stringify(miss.body.data)}`);
    const bad = await json('/v1/contacts/resolve', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ email: 'not-an-email' }) });
    assert(bad.status === 400, `invalid expected 400, got ${bad.status}`);
    const anon = await json('/v1/contacts/resolve', { method: 'POST', body: JSON.stringify({ email: 'x@example.com' }) });
    assert(anon.status === 401, `unauthenticated expected 401, got ${anon.status}`);
});

await test('10. Resolve finds an owner with a verified email (code-invite provisioned)', async () => {
    // Provision an account WITH a verified email via the code-invite flow (the only e2e-safe way
    // to attach an email — the interactive verification flows need real mail delivery).
    const org = await json('/v1/organisms', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ name: 'Resolve Org', type: 'project', join_policy: 'invite_only', visibility: 'public' }) });
    assert(org.status === 201, `org ${org.status}`);
    const email = `resolveme-${Date.now()}@example.com`;
    const uname = `contxr${Date.now()}`;
    const mint = await json(`/v1/organisms/${org.body.data.organism.id}/invitations/code`, {
        method: 'POST', headers: auth(A.token),
        body: JSON.stringify({ email, username: uname, code: 'SuperSecret99', display_name: 'Resolve Target' }),
    });
    assert(mint.status === 201, `code mint ${mint.status}: ${JSON.stringify(mint.body.error)}`);
    const hit = await json('/v1/contacts/resolve', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ email: email.toUpperCase() }) });
    assert(hit.status === 200 && hit.body.data.found === true, `hit ${hit.status}: ${JSON.stringify(hit.body.data)}`);
    assert(hit.body.data.owner === uname, `resolved owner ${hit.body.data.owner} !== ${uname}`);
    // Resolved owner can be saved straight to contacts.
    const save = await json('/v1/contacts', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ contact_id: hit.body.data.ghii }) });
    assert(save.status === 201, `save resolved ${save.status}: ${JSON.stringify(save.body.error)}`);
});

console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) process.exit(1);
