/**
 * @file e2e-organism-owner-repair.ts
 * @description Can an organism whose creator is unreachable be put back, and by whom?
 *
 *   The incident this suite is written from: an agent called POST /v1/organisms/{id}/transfer twice
 *   in a test run — add a member, hand them the organism — and eleven seconds later this node's own
 *   development organism belonged to somebody else. Nothing on any surface could undo it. An admin
 *   cannot remove a creator (CANNOT_REMOVE_CREATOR), cannot demote one, and cannot transfer without
 *   being one, so the previous owner is left holding the second-highest role and no route back. The
 *   node operator had no override either, and the repair was a hand-written SQL transaction against
 *   the production database.
 *
 *   So the suite asserts the trap first — an admin really is stuck — and then that exactly one door
 *   opens: the operator's, and only for a principal that names itself. The four refusals matter as
 *   much as the repair, because a break-glass every agent of the operator holds by default is the
 *   same incident one level up with a node-wide blast radius. That is why the scope is tested as an
 *   exact string here: an agent with '*' must be refused.
 * @usage cd aimeat && rm -f test/.ownerrepair.db* && AIMEAT_PORT=40432 AIMEAT_DB_PATH=test/.ownerrepair.db \
 *   pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-organism-owner-repair
 * @version-history
 *   v1.0.0 — 2026-08-15 — Initial, with the operator break-glass it was written to hold in place.
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
import { createStorage, type StorageProvider } from '../src/storage/storage-factory.js';
import type { Storage } from '../src/storage/interface.js';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const tag = `rep${Date.now() % 1000000}`;
const OP = `${tag}op`;
const FOUNDER = `${tag}founder`;
const TAKER = `${tag}taker`;
const OUTSIDER = `${tag}outsider`;
const BLOCKED = `${tag}blocked`;

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: unknown) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

interface Envelope { ok?: boolean; data?: Record<string, any>; error?: { code?: string; message?: string } }
async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as Envelope : { _raw: await res.text() } as Envelope;
    return { status: res.status, body };
}
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function signMsg(privB64: string, message: string): Promise<string> {
    return Buffer.from(await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'))).toString('base64');
}

/** Owner keys are handed out once, at registration. Keep them: a role change needs a fresh token,
 *  because roles are copied into the session at mint time and never re-read from the record. */
const ownerKeys = new Map<string, string>();

async function ownerToken(name: string): Promise<string> {
    const priv = ownerKeys.get(name)!;
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner: name, timestamp: ts, signature: await signMsg(priv, name + NODE_ID + ts) }),
    });
    assert(tok.body.ok === true, `owner token ${name}: ${JSON.stringify(tok.body.error)}`);
    return tok.body.data!.token as string;
}

async function registerOwner(name: string): Promise<string> {
    let reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name, public_key: 'placeholder' }) });
    for (let i = 0; reg.status === 429 && i < 8; i++) {
        await new Promise(r => setTimeout(r, 1500));
        reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name, public_key: 'placeholder' }) });
    }
    assert(reg.status === 201, `register ${name}: ${reg.status} ${JSON.stringify(reg.body)}`);
    ownerKeys.set(name, reg.body.data!.private_key as string);
    return ownerToken(name);
}

async function createAgent(ownerName: string, ownerTok: string, name: string, scopes: string[]) {
    const r = await json('/v1/agents', {
        method: 'POST', headers: auth(ownerTok),
        body: JSON.stringify({ name, owner: ownerName, display_name: name, capabilities: [], scopes }),
    });
    assert(r.status === 201, `create agent ${name}: ${r.status} ${JSON.stringify(r.body)}`);
    return { gaii: r.body.data!.agent.gaii as string, key: r.body.data!.private_key as string };
}

async function mintAgentToken(a: { gaii: string; key: string }): Promise<string> {
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ gaii: a.gaii, timestamp: ts, signature: await signMsg(a.key, a.gaii + ts) }),
    });
    assert(tok.body.ok === true, `agent token ${a.gaii}: ${JSON.stringify(tok.body.error)}`);
    return tok.body.data!.token as string;
}

/** The operator role is granted to the FIRST owner on a node, which a shared test database has
 *  already spent. Grant it on the record directly so the suite does not depend on run order. */
async function grantOperator(name: string): Promise<void> {
    const provider = (process.env.AIMEAT_DB ?? 'sqlite') as StorageProvider;
    const sqlitePath = process.env.AIMEAT_DB_PATH ?? '';
    const dbUrl = process.env.AIMEAT_DB_URL;
    // An in-memory backend lives inside the server process: a second handle would open a different
    // empty database and grant the role to nobody. The first owner on a fresh node is an operator
    // anyway, which is what this path falls back to.
    if (!((provider === 'sqlite' && sqlitePath) || (provider === 'postgres-kysely' && dbUrl))) return;
    const storage: Storage = await createStorage({ provider, sqlitePath, dbUrl });
    const owner = await storage.getOwner(name);
    assert(!!owner, `owner ${name} missing from storage`);
    if (!owner!.roles.includes('operator')) {
        await storage.updateOwner(name, { roles: [...owner!.roles, 'operator'] });
    }
    await storage.close?.();
}

/** The organism RECORD (camelCase, straight from storage), not the roster. */
async function orgRecord(id: string, token: string): Promise<Record<string, any>> {
    const got = await json(`/v1/organisms/${id}`, { headers: auth(token) });
    assert(got.body.ok === true, `read organism: ${got.status} ${JSON.stringify(got.body)}`);
    return got.body.data!.organism as Record<string, any>;
}

/** Membership rows with their roles, which the organism record does not carry. */
async function roster(id: string, token: string): Promise<Array<{ ghii: string; role: string; status: string }>> {
    const got = await json(`/v1/organisms/${id}/members`, { headers: auth(token) });
    assert(got.body.ok === true, `read roster: ${got.status} ${JSON.stringify(got.body)}`);
    return got.body.data!.members as Array<{ ghii: string; role: string; status: string }>;
}

async function main() {
    console.log('\n=== organism ownership: the trap, and the one door out ===\n');
    console.log('Phase 0: Setup');

    let opToken = '', founderToken = '', takerToken = '', outsiderToken = '';
    let orgId = '';

    await test('an operator, a founder, and three other owners', async () => {
        opToken = await registerOwner(OP);
        founderToken = await registerOwner(FOUNDER);
        takerToken = await registerOwner(TAKER);
        outsiderToken = await registerOwner(OUTSIDER);
        await registerOwner(BLOCKED);
        await grantOperator(OP);
        // The operator's own session must be re-minted: roles are read at mint time.
        opToken = await ownerToken(OP);
    });

    await test('the founder creates an organism and takes in one member', async () => {
        const r = await json('/v1/organisms', {
            method: 'POST', headers: auth(founderToken),
            body: JSON.stringify({ name: `${tag} org`, description: 'ownership repair', type: 'project', join_policy: 'open', visibility: 'public' }),
        });
        assert(r.status === 201, `create organism: ${r.status} ${JSON.stringify(r.body)}`);
        orgId = (r.body.data!.organism?.id ?? r.body.data!.id) as string;

        const add = await json(`/v1/organisms/${orgId}/members`, {
            method: 'POST', headers: auth(founderToken),
            body: JSON.stringify({ ghii: TAKER, role: 'member' }),
        });
        assert(add.status === 200 || add.status === 201, `add member: ${add.status} ${JSON.stringify(add.body)}`);
    });

    console.log('\nPhase 1: The trap — the founder hands it over and cannot get it back');

    await test('the handover succeeds and demotes the founder to admin', async () => {
        const r = await json(`/v1/organisms/${orgId}/transfer`, {
            method: 'POST', headers: auth(founderToken), body: JSON.stringify({ to: TAKER }),
        });
        assert(r.body.ok === true, `transfer: ${r.status} ${JSON.stringify(r.body)}`);
        assert(r.body.data!.creator === TAKER, `creator is ${r.body.data!.creator}, expected ${TAKER}`);
        const rec = await orgRecord(orgId, founderToken);
        assert(rec.creatorGhii === TAKER, `the organism record still names ${rec.creatorGhii}`);
    });

    await test('the founder, now an admin, cannot remove the creator', async () => {
        const r = await json(`/v1/organisms/${orgId}/members/${TAKER}`, { method: 'DELETE', headers: auth(founderToken) });
        assert(r.status === 400, `expected 400, got ${r.status}`);
        assert(r.body.error?.code === 'CANNOT_REMOVE_CREATOR', `expected CANNOT_REMOVE_CREATOR, got ${r.body.error?.code}`);
    });

    await test('the founder cannot transfer it back either', async () => {
        const r = await json(`/v1/organisms/${orgId}/transfer`, {
            method: 'POST', headers: auth(founderToken), body: JSON.stringify({ to: FOUNDER }),
        });
        assert(r.status === 403, `expected 403, got ${r.status} ${JSON.stringify(r.body)}`);
    });

    console.log('\nPhase 2: The refusals — who does NOT get the break-glass');

    await test('an ordinary owner is refused the operator door', async () => {
        const r = await json(`/v1/admin/organisms/${orgId}/ownership`, {
            method: 'POST', headers: auth(outsiderToken), body: JSON.stringify({ ghii: OUTSIDER }),
        });
        assert(r.status === 403, `expected 403, got ${r.status} ${JSON.stringify(r.body)}`);
    });

    await test("the organism's own creator is refused it too — this is not a member route", async () => {
        const r = await json(`/v1/admin/organisms/${orgId}/ownership`, {
            method: 'POST', headers: auth(takerToken), body: JSON.stringify({ ghii: TAKER }),
        });
        assert(r.status === 403, `expected 403, got ${r.status} ${JSON.stringify(r.body)}`);
    });

    await test("an operator's agent holding '*' is refused: no wildcard carries this word", async () => {
        const wide = await createAgent(OP, opToken, `${tag}wide`, ['*']);
        const token = await mintAgentToken(wide);
        const r = await json(`/v1/admin/organisms/${orgId}/ownership`, {
            method: 'POST', headers: auth(token), body: JSON.stringify({ ghii: FOUNDER }),
        });
        assert(r.status === 403, `expected 403, got ${r.status} ${JSON.stringify(r.body)}`);
        assert(r.body.error?.code === 'SCOPE_DENIED', `expected SCOPE_DENIED, got ${r.body.error?.code}`);
    });

    await test("a non-operator's agent holding the exact word is still refused", async () => {
        const impostor = await createAgent(OUTSIDER, outsiderToken, `${tag}imp`, ['operator:organism-repair']);
        const token = await mintAgentToken(impostor);
        const r = await json(`/v1/admin/organisms/${orgId}/ownership`, {
            method: 'POST', headers: auth(token), body: JSON.stringify({ ghii: OUTSIDER }),
        });
        assert(r.status === 403, `expected 403, got ${r.status} ${JSON.stringify(r.body)}`);
    });

    console.log('\nPhase 3: The repair');

    await test("an operator's agent holding the exact word gets in — an agent does what its person can", async () => {
        const repairbot = await createAgent(OP, opToken, `${tag}fixer`, ['memory:read', 'operator:organism-repair']);
        const token = await mintAgentToken(repairbot);
        const r = await json(`/v1/admin/organisms/${orgId}/ownership`, { headers: auth(token) });
        assert(r.body.ok === true, `read as operator agent: ${r.status} ${JSON.stringify(r.body)}`);
        assert(r.body.data!.creator === TAKER, `creator reads as ${r.body.data!.creator}`);

        const w = await json(`/v1/admin/organisms/${orgId}/ownership`, {
            method: 'POST', headers: auth(token), body: JSON.stringify({ ghii: FOUNDER }),
        });
        assert(w.body.ok === true, `repair as operator agent: ${w.status} ${JSON.stringify(w.body)}`);
        assert(w.body.data!.creator === FOUNDER, `creator is ${w.body.data!.creator}`);
        // Put it back where phase 3 expects to find it, so the next test starts from the trap.
        const undo = await json(`/v1/admin/organisms/${orgId}/ownership`, {
            method: 'POST', headers: auth(opToken), body: JSON.stringify({ ghii: TAKER }),
        });
        assert(undo.body.ok === true, `restore: ${undo.status} ${JSON.stringify(undo.body)}`);
    });

    await test('the operator reads the ownership state first', async () => {
        const r = await json(`/v1/admin/organisms/${orgId}/ownership`, { headers: auth(opToken) });
        assert(r.body.ok === true, `read: ${r.status} ${JSON.stringify(r.body)}`);
        assert(r.body.data!.creator === TAKER, `creator reads as ${r.body.data!.creator}`);
        assert((r.body.data!.members as any[]).length === 2, 'the roster is not what the repair will re-point');
    });

    await test('the operator puts the founder back, and the taker keeps a seat as admin', async () => {
        const r = await json(`/v1/admin/organisms/${orgId}/ownership`, {
            method: 'POST', headers: auth(opToken), body: JSON.stringify({ ghii: FOUNDER }),
        });
        assert(r.body.ok === true, `repair: ${r.status} ${JSON.stringify(r.body)}`);
        assert(r.body.data!.creator === FOUNDER, `creator is ${r.body.data!.creator}`);
        assert(r.body.data!.previous_creator === TAKER, `previous is ${r.body.data!.previous_creator}`);

        const rec = await orgRecord(orgId, founderToken);
        assert(rec.creatorGhii === FOUNDER, `the organism record still names ${rec.creatorGhii}`);
        assert((rec.admins as string[]).includes(TAKER), 'the previous creator lost their seat');
        const members = await roster(orgId, founderToken);
        assert(members.find(m => m.ghii === FOUNDER)?.role === 'creator', 'the membership row still says admin');
        assert(members.find(m => m.ghii === TAKER)?.role === 'admin', 'the taker was not demoted to admin');
    });

    await test('the founder can now do what only a creator can — remove the other one', async () => {
        const r = await json(`/v1/organisms/${orgId}/members/${TAKER}`, { method: 'DELETE', headers: auth(founderToken) });
        assert(r.body.ok === true, `remove: ${r.status} ${JSON.stringify(r.body)}`);
    });

    console.log('\nPhase 4: The repair case that has nobody left inside');

    await test('the operator can seat an owner who was never a member', async () => {
        const r = await json(`/v1/admin/organisms/${orgId}/ownership`, {
            method: 'POST', headers: auth(opToken), body: JSON.stringify({ ghii: OUTSIDER }),
        });
        assert(r.body.ok === true, `seat: ${r.status} ${JSON.stringify(r.body)}`);
        assert(r.body.data!.membership_created === true, 'the outsider should have been seated');
        const rec = await orgRecord(orgId, outsiderToken);
        assert(rec.creatorGhii === OUTSIDER, `the outsider did not become the creator (${rec.creatorGhii})`);
        const members = await roster(orgId, outsiderToken);
        assert(members.find(m => m.ghii === OUTSIDER)?.role === 'creator', 'the seated row does not say creator');
    });

    await test('a blocked owner is refused — lifting a block is its own act', async () => {
        const add = await json(`/v1/organisms/${orgId}/members`, {
            method: 'POST', headers: auth(outsiderToken), body: JSON.stringify({ ghii: BLOCKED, role: 'member' }),
        });
        assert(add.status === 200 || add.status === 201, `add blocked-to-be: ${add.status} ${JSON.stringify(add.body)}`);
        const ban = await json(`/v1/organisms/${orgId}/members/${BLOCKED}?ban=true`, { method: 'DELETE', headers: auth(outsiderToken) });
        assert(ban.body.ok === true, `ban: ${ban.status} ${JSON.stringify(ban.body)}`);

        const r = await json(`/v1/admin/organisms/${orgId}/ownership`, {
            method: 'POST', headers: auth(opToken), body: JSON.stringify({ ghii: BLOCKED }),
        });
        assert(r.status === 400, `expected 400, got ${r.status} ${JSON.stringify(r.body)}`);
        assert(r.body.error?.code === 'MEMBER_BANNED', `expected MEMBER_BANNED, got ${r.body.error?.code}`);
    });

    await test('an owner name nobody registered is refused', async () => {
        const r = await json(`/v1/admin/organisms/${orgId}/ownership`, {
            method: 'POST', headers: auth(opToken), body: JSON.stringify({ ghii: `${tag}ghost` }),
        });
        assert(r.status === 404, `expected 404, got ${r.status} ${JSON.stringify(r.body)}`);
    });

    console.log(`\n${'='.repeat(60)}\nPassed: ${passed}  Failed: ${failed}\n${'='.repeat(60)}\n`);
    if (failed > 0) process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
