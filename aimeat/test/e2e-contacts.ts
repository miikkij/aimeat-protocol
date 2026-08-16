/**
 * @file e2e-contacts.ts
 * @description E2E for the CONTACTS (address book) API: merged list (saved rows ∪ DM peers with
 *   display names), proactive save (origin 'saved'), gate-safe delete (removing a messaged
 *   contact never resets the DM first-contact gate), blocked-row handling, the q filter,
 *   cross-owner isolation, and exact-match email resolve (found / not-found / invalid / unauth).
 * @version-history
 *   v1.1.0 — 2026-08-17 — TARGET-063: saved PEOPLE (name + email, no account here), the
 *     shape and existence checks that close "any string with an @ is a contact", promotion on
 *     a verified email, card edits, and the cross-owner refusals for both new verbs.
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


// -- Saved people: someone with no account on this node (TARGET-063) --

await test('11. A saves a PERSON by name + email -> kind mail, own row, card readable', async () => {
    const email = `person-${Date.now()}@example.com`;
    const r = await json('/v1/contacts', {
        method: 'POST', headers: auth(A.token),
        body: JSON.stringify({
            name: 'Outside Olivia', email, note: 'met at a conference',
            tags: ['lead'], relation: 'to invite',
            links: [{ label: 'LinkedIn', url: 'https://example.com/in/olivia' }],
        }),
    });
    assert(r.status === 201, `save person ${r.status}: ${JSON.stringify(r.body.error)}`);
    assert(r.body.data.kind === 'mail', `kind should be mail, got ${r.body.data.kind}`);
    assert(String(r.body.data.contact_id).startsWith('mail:'), `id should be mail-prefixed: ${r.body.data.contact_id}`);
    const row = (await contactsOf(A.token)).find(c => c.contact_id === r.body.data.contact_id);
    assert(!!row, 'person appears in the address book');
    assert(row.display_name === 'Outside Olivia' && row.saved_name === 'Outside Olivia', `names: ${JSON.stringify(row)}`);
    assert(row.email === email, `email carried: ${row.email}`);
    assert(row.note === 'met at a conference' && row.relation === 'to invite', `card: ${JSON.stringify(row)}`);
    assert(row.tags.includes('lead') && row.links.length === 1, `tags/links: ${JSON.stringify(row)}`);
    assert(row.state === null && row.has_messages === false, `a person has no consent state: ${JSON.stringify(row)}`);
});

await test('12. Person save needs BOTH name and email; neither shape -> 400', async () => {
    const noName = await json('/v1/contacts', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ email: `x-${Date.now()}@example.com` }) });
    assert(noName.status === 400, `email without name expected 400, got ${noName.status}`);
    const nothing = await json('/v1/contacts', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ note: 'nope' }) });
    assert(nothing.status === 400, `neither shape expected 400, got ${nothing.status}`);
    const badEmail = await json('/v1/contacts', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ name: 'X', email: 'not-an-email' }) });
    assert(badEmail.status === 400, `bad email expected 400, got ${badEmail.status}`);
});

await test('13. An email address is REFUSED as an identity id, and says what to do instead', async () => {
    // The defect the research proved against production: contactKind read anything with an '@' as
    // a GHII and a mail host passed as a node name, so the row went in meaning nothing.
    const r = await json('/v1/contacts', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ contact_id: 'someone@example.com' }) });
    assert(r.status === 400 && r.body.error?.code === 'INVALID_INPUT', `expected 400 INVALID_INPUT, got ${r.status} ${r.body.error?.code}`);
    assert(/name and an email/i.test(r.body.error?.message ?? ''), `message should point at the person path: ${r.body.error?.message}`);
    assert(!(await contactsOf(A.token)).some(c => c.contact_id === 'someone@example.com'), 'nothing was stored');
});

await test('14. A nonexistent local agent and a nonexistent local app are both refused', async () => {
    const agent = await json('/v1/contacts', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ contact_id: `nosuch#${A.name}@${NODE_ID}` }) });
    assert(agent.status === 404 && agent.body.error?.code === 'CONTACT_NOT_FOUND', `agent expected 404 CONTACT_NOT_FOUND, got ${agent.status} ${agent.body.error?.code}`);
    const app = await json('/v1/contacts', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ contact_id: `eco:nosuch-app#${A.name}@${NODE_ID}` }) });
    assert(app.status === 404 && app.body.error?.code === 'CONTACT_NOT_FOUND', `app expected 404 CONTACT_NOT_FOUND, got ${app.status} ${app.body.error?.code}`);
    const malformed = await json('/v1/contacts', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ contact_id: 'eco:broken' }) });
    assert(malformed.status === 400, `malformed GEAI expected 400, got ${malformed.status}`);
});

await test('15. An agent contact resolves a display name (it used to read back null)', async () => {
    // Registration creates the owner and GHII only, never an agent, so this suite makes one.
    const made = await json('/v1/agents', {
        method: 'POST', headers: auth(A.token),
        body: JSON.stringify({ name: 'namedbot', owner: A.name, display_name: 'Named Bot', description: 'display-name probe' }),
    });
    assert(made.status === 201, `agent register ${made.status}: ${JSON.stringify(made.body.error)}`);
    const agents = await json('/v1/agents', { headers: auth(A.token) });
    assert(agents.status === 200, `agents ${agents.status}`);
    const own = (agents.body.data.agents ?? []).find((a: any) => a.name === 'namedbot');
    assert(!!own && own.display_name === 'Named Bot', `the agent exists with a name: ${JSON.stringify(own)}`);
    const save = await json('/v1/contacts', { method: 'POST', headers: auth(B.token), body: JSON.stringify({ contact_id: own.gaii }) });
    assert(save.status === 201, `saving a real agent ${save.status}: ${JSON.stringify(save.body.error)}`);
    const row = (await contactsOf(B.token)).find(c => c.contact_id === own.gaii);
    assert(!!row && row.kind === 'gaii', `agent row: ${JSON.stringify(row)}`);
    assert(!!row.display_name && row.display_name === own.display_name, `agent display name: ${JSON.stringify(row)}`);
});

// -- The card --

await test('16. PATCH edits what the owner knows; a stranger cannot (404)', async () => {
    const email = `card-${Date.now()}@example.com`;
    const made = await json('/v1/contacts', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ name: 'Card Carl', email }) });
    assert(made.status === 201, `create ${made.status}`);
    const id = made.body.data.contact_id as string;

    const patch = await json(`/v1/contacts/${encodeURIComponent(id)}`, {
        method: 'PATCH', headers: auth(A.token),
        body: JSON.stringify({ note: 'follows up in March', relation: 'following', links: [{ label: 'site', url: 'https://example.com/carl' }] }),
    });
    assert(patch.status === 200, `patch ${patch.status}: ${JSON.stringify(patch.body.error)}`);
    const row = (await contactsOf(A.token)).find(c => c.contact_id === id);
    assert(row.note === 'follows up in March' && row.relation === 'following', `card updated: ${JSON.stringify(row)}`);
    assert(row.email === email, 'the address is not editable through the card');

    // Cross-owner: absent and not-yours answer identically.
    const theirs = await json(`/v1/contacts/${encodeURIComponent(id)}`, { method: 'PATCH', headers: auth(B.token), body: JSON.stringify({ note: 'mine now' }) });
    assert(theirs.status === 404, `cross-owner patch expected 404, got ${theirs.status}`);
    const del = await json(`/v1/contacts/${encodeURIComponent(id)}`, { method: 'DELETE', headers: auth(B.token) });
    assert(del.status === 404, `cross-owner delete expected 404, got ${del.status}`);
    const still = (await contactsOf(A.token)).find(c => c.contact_id === id);
    assert(still.note === 'follows up in March', 'the card survived both attempts');
});

await test('17. A link that is not http(s) is dropped, not stored', async () => {
    const made = await json('/v1/contacts', {
        method: 'POST', headers: auth(A.token),
        body: JSON.stringify({
            name: 'Link Lena', email: `lena-${Date.now()}@example.com`,
            links: [{ label: 'bad', url: 'javascript:alert(1)' }, { label: 'good', url: 'https://example.com/lena' }],
        }),
    });
    assert(made.status === 201, `create ${made.status}`);
    const row = (await contactsOf(A.token)).find(c => c.contact_id === made.body.data.contact_id);
    assert(row.links.length === 1 && row.links[0].url === 'https://example.com/lena', `links filtered: ${JSON.stringify(row.links)}`);
});

await test('18. Removing a person deletes the card', async () => {
    const made = await json('/v1/contacts', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ name: 'Gone Greta', email: `greta-${Date.now()}@example.com` }) });
    const id = made.body.data.contact_id as string;
    const del = await json(`/v1/contacts/${encodeURIComponent(id)}`, { method: 'DELETE', headers: auth(A.token) });
    assert(del.status === 200, `delete ${del.status}: ${JSON.stringify(del.body.error)}`);
    assert(!(await contactsOf(A.token)).some(c => c.contact_id === id), 'the person is gone');
    const again = await json(`/v1/contacts/${encodeURIComponent(id)}`, { method: 'DELETE', headers: auth(A.token) });
    assert(again.status === 404, `second delete expected 404, got ${again.status}`);
});

// -- Promotion: the person joins --

await test('19. A saved person who later verifies that address becomes ONE row, card intact', async () => {
    const email = `joiner-${Date.now()}@example.com`;
    const made = await json('/v1/contacts', {
        method: 'POST', headers: auth(A.token),
        body: JSON.stringify({ name: 'Future Fiona', email, note: 'wants an account', relation: 'to invite' }),
    });
    assert(made.status === 201 && made.body.data.kind === 'mail', `pre-join save: ${JSON.stringify(made.body.data)}`);
    const mailId = made.body.data.contact_id as string;

    // Provision an account WITH that address verified - the code-invite flow, as in test 10.
    const org = await json('/v1/organisms', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ name: 'Promote Org', type: 'project', join_policy: 'invite_only', visibility: 'public' }) });
    assert(org.status === 201, `org ${org.status}`);
    const uname = `contxp${Date.now()}`;
    const mint = await json(`/v1/organisms/${org.body.data.organism.id}/invitations/code`, {
        method: 'POST', headers: auth(A.token),
        body: JSON.stringify({ email, username: uname, code: 'SuperSecret99', display_name: 'Fiona Real' }),
    });
    assert(mint.status === 201, `code mint ${mint.status}: ${JSON.stringify(mint.body.error)}`);

    const list = await contactsOf(A.token);
    const ghii = `${uname}@${NODE_ID}`;
    assert(!list.some(c => c.contact_id === mailId), `the mail row is gone: ${JSON.stringify(list.map(c => c.contact_id))}`);
    const row = list.find(c => c.contact_id === ghii);
    assert(!!row, `one row under the identity: ${JSON.stringify(list.map(c => c.contact_id))}`);
    assert(row.kind === 'ghii', `kind is now ghii: ${row.kind}`);
    // The node's own name wins for display; what the owner wrote is kept beside it.
    assert(row.display_name === 'Fiona Real', `profile name wins: ${row.display_name}`);
    assert(row.saved_name === 'Future Fiona', `the owner own name survives: ${row.saved_name}`);
    assert(row.note === 'wants an account' && row.relation === 'to invite', `card survives: ${JSON.stringify(row)}`);
    assert(row.email === email, `address kept: ${row.email}`);
});

await test('20. Saving a person whose address belongs to a BLOCKED identity is refused', async () => {
    const email = `blocked-${Date.now()}@example.com`;
    const uname = `contxb2${Date.now()}`;
    const org = await json('/v1/organisms', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ name: 'Block Org', type: 'project', join_policy: 'invite_only', visibility: 'public' }) });
    assert(org.status === 201, `org ${org.status}`);
    const mint = await json(`/v1/organisms/${org.body.data.organism.id}/invitations/code`, {
        method: 'POST', headers: auth(A.token),
        body: JSON.stringify({ email, username: uname, code: 'SuperSecret99', display_name: 'Blocked Bob' }),
    });
    assert(mint.status === 201, `code mint ${mint.status}: ${JSON.stringify(mint.body.error)}`);
    const ghii = `${uname}@${NODE_ID}`;
    const block = await json(`/v1/messages/contacts/${encodeURIComponent(ghii)}/block`, { method: 'POST', headers: auth(A.token), body: '{}' });
    assert(block.status === 200, `block ${block.status}: ${JSON.stringify(block.body.error)}`);

    // Same rule as saving the identity directly, and REFUSED BEFORE ANYTHING IS WRITTEN: the
    // address is resolved and the block is checked ahead of the row, not after it.
    const save = await json('/v1/contacts', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ name: 'Bob', email }) });
    assert(save.status === 409 && save.body.error?.code === 'BLOCKED', `expected 409 BLOCKED, got ${save.status} ${save.body.error?.code}`);
    const def = await contactsOf(A.token);
    assert(!def.some(c => c.email === email), `nothing was written: ${JSON.stringify(def.filter(c => c.email === email))}`);
});

await test('21. A person blocked AFTER being saved stays hidden (the card cannot put them back)', async () => {
    // The order that matters: the card exists first, the block comes later. The projection reads
    // three sources, and the two that are not the consent table must not reinstate a row the
    // consent table deliberately hid.
    const email = `laterblock-${Date.now()}@example.com`;
    const uname = `contxlb${Date.now()}`;
    const made = await json('/v1/contacts', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ name: 'Later Lars', email, note: 'kept' }) });
    assert(made.status === 201 && made.body.data.kind === 'mail', `pre-join save: ${JSON.stringify(made.body.data)}`);

    const org = await json('/v1/organisms', { method: 'POST', headers: auth(A.token), body: JSON.stringify({ name: 'Later Org', type: 'project', join_policy: 'invite_only', visibility: 'public' }) });
    assert(org.status === 201, `org ${org.status}`);
    const mint = await json(`/v1/organisms/${org.body.data.organism.id}/invitations/code`, {
        method: 'POST', headers: auth(A.token),
        body: JSON.stringify({ email, username: uname, code: 'SuperSecret99', display_name: 'Lars Real' }),
    });
    assert(mint.status === 201, `code mint ${mint.status}: ${JSON.stringify(mint.body.error)}`);
    const ghii = `${uname}@${NODE_ID}`;
    assert((await contactsOf(A.token)).some(c => c.contact_id === ghii), 'promoted before the block');

    const block = await json(`/v1/messages/contacts/${encodeURIComponent(ghii)}/block`, { method: 'POST', headers: auth(A.token), body: '{}' });
    assert(block.status === 200, `block ${block.status}: ${JSON.stringify(block.body.error)}`);

    const def = await contactsOf(A.token);
    assert(!def.some(c => c.contact_id === ghii), `blocked identity stays hidden: ${JSON.stringify(def.filter(c => c.contact_id === ghii))}`);
    assert(!def.some(c => c.email === email), `and does not come back as a mail row: ${JSON.stringify(def.filter(c => c.email === email))}`);
    const blocked = await contactsOf(A.token, '?state=blocked');
    assert(blocked.some(c => c.contact_id === ghii), 'still visible under ?state=blocked');
});

console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) process.exit(1);
