/**
 * @file e2e-organism-scope-gate.ts
 * @description Does organism:write decide anything at the three organism WRITE doors?
 *
 *   Until 2026-08-14 all three used requireRoleOrScope('agent', 'organism:write'), and that helper's
 *   role path runs BEFORE it looks at a scope — so an agent passed on being an agent. The same word
 *   was enforced on the MCP tool surface, which drops a tool the session has no scope for at
 *   registration time, so an agent could not even SEE aimeat_organism_create while POST /v1/organisms
 *   answered it 201 Created. A permission that binds the surface the owner reads and not the door
 *   that writes is security DNA invariant 15, and it is what this suite is about.
 *
 *   Four things have to hold at once, which is why they are in one file: the word refuses an agent
 *   that lacks it, admits one that holds it, never touches the account holder's own session, and
 *   costs no existing agent a capability. The last is the expensive one — changelog 1.33.1 records
 *   the fleet-wide outage from naming a scope on a door agents already used — so the migration that
 *   hands the word out at boot is exercised here against the real backend, not stubbed.
 * @usage cd aimeat && rm -f test/.orgscope.db* && AIMEAT_PORT=40431 AIMEAT_DB_PATH=test/.orgscope.db \
 *   pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-organism-scope-gate
 * @version-history
 *   v1.0.0 — 2026-08-14 — Initial (August 2026 audit: the organism scope gate).
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
import { createStorage, type StorageProvider } from '../src/storage/storage-factory.js';
import { migrateAgentScopeVocabulary } from '../src/services/scope-vocabulary-migration.js';
import type { Storage } from '../src/storage/interface.js';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const owner = `orgscope${Date.now() % 1000000}`;

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

async function registerOwner(name: string): Promise<string> {
    let reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name, public_key: 'placeholder' }) });
    for (let i = 0; reg.status === 429 && i < 8; i++) {
        await new Promise(r => setTimeout(r, 1500));
        reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name, public_key: 'placeholder' }) });
    }
    assert(reg.status === 201, `register ${name}: ${reg.status} ${JSON.stringify(reg.body)}`);
    const priv = reg.body.data!.private_key as string;
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner: name, timestamp: ts, signature: await signMsg(priv, name + NODE_ID + ts) }),
    });
    assert(tok.body.ok === true, `owner token ${name}: ${JSON.stringify(tok.body.error)}`);
    return tok.body.data!.token as string;
}

/** An agent under `owner` with EXACTLY these scopes, plus its key so a later token can be minted. */
async function createAgent(name: string, scopes: string[]): Promise<{ gaii: string; key: string }> {
    const r = await json('/v1/agents', {
        method: 'POST', headers: auth(ownerToken),
        body: JSON.stringify({ name, owner, display_name: name, capabilities: [], scopes }),
    });
    assert(r.status === 201, `create agent ${name}: ${r.status} ${JSON.stringify(r.body)}`);
    return { gaii: r.body.data!.agent.gaii as string, key: r.body.data!.private_key as string };
}

/** Mint a session JWT for an agent. Scopes are copied from the agent record AT MINT TIME. */
async function mintAgentToken(a: { gaii: string; key: string }): Promise<string> {
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ gaii: a.gaii, timestamp: ts, signature: await signMsg(a.key, a.gaii + ts) }),
    });
    assert(tok.body.ok === true, `agent token ${a.gaii}: ${JSON.stringify(tok.body.error)}`);
    return tok.body.data!.token as string;
}

const MANIFEST = {
    manifestVersion: '1', name: 'Notes', kind: 'project',
    objectTypes: [{ name: 'note', namespace: 'notes.items', mode: 'records', backing: 'memory', writeRole: 'member', schemaRef: 'schema:note@1' }],
};
const SCHEMAS = {
    'notes.items': { type: 'object', additionalProperties: false, required: ['id'], properties: { id: { type: 'string' }, text: { type: 'string' } } },
};

let ownerToken = '';
let orgId = '';
let wsId = '';

/** The three doors this gate covers, each with a body the handler would accept. */
function doors(label: string) {
    return [
        {
            what: 'create an organism',
            call: (token: string) => json('/v1/organisms', {
                method: 'POST', headers: auth(token),
                body: JSON.stringify({ name: `${label} org`, description: 'scope gate', type: 'project', join_policy: 'open', visibility: 'public' }),
            }),
        },
        {
            what: 'create a workspace',
            call: (token: string) => json(`/v1/organisms/${orgId}/workspaces`, {
                method: 'POST', headers: auth(token),
                body: JSON.stringify({ name: `${label} ws`, manifest: MANIFEST, schemas: SCHEMAS }),
            }),
        },
        {
            what: 'comment on a workspace object',
            call: (token: string) => json(`/v1/organisms/${orgId}/comments`, {
                method: 'POST', headers: auth(token),
                body: JSON.stringify({ ws: wsId, space: 'notes.items', instance_id: 'n1', body: `${label} says hello` }),
            }),
        },
    ];
}

async function main() {
    console.log('\n=== organism:write on the three organism write doors ===\n');
    console.log('Phase 0: Setup');

    let narrow!: { gaii: string; key: string };
    let scoped!: { gaii: string; key: string };
    let wide!: { gaii: string; key: string };
    let narrowTokenBefore = '';
    let scopedToken = '';
    let wideToken = '';

    await test('an owner, and three agents whose only difference is organism:write', async () => {
        ownerToken = await registerOwner(owner);
        // organism:read on purpose: a neighbouring word in the same domain must not open a write door.
        narrow = await createAgent('narrowbot', ['memory:read', 'memory:write', 'organism:read']);
        scoped = await createAgent('orgbot', ['memory:read', 'memory:write', 'organism:write']);
        wide = await createAgent('widebot', ['*']);
        narrowTokenBefore = await mintAgentToken(narrow);
        scopedToken = await mintAgentToken(scoped);
        wideToken = await mintAgentToken(wide);
    });

    await test('the owner opens an organism and a workspace in their own session', async () => {
        const o = await json('/v1/organisms', {
            method: 'POST', headers: auth(ownerToken),
            body: JSON.stringify({ name: 'Scope Gate Org', description: 'x', type: 'project', join_policy: 'open', visibility: 'public' }),
        });
        assert(o.status === 201, `organism: ${o.status} ${JSON.stringify(o.body.error)}`);
        orgId = o.body.data!.organism.id as string;

        const w = await json(`/v1/organisms/${orgId}/workspaces`, {
            method: 'POST', headers: auth(ownerToken),
            body: JSON.stringify({ name: 'Notes', manifest: MANIFEST, schemas: SCHEMAS }),
        });
        assert(w.status === 201, `workspace: ${w.status} ${JSON.stringify(w.body.error)}`);
        wsId = w.body.data!.ws as string;
        assert(wsId.startsWith('ws-'), `ws id looks wrong: ${wsId}`);
    });

    console.log('\nPhase 1: An agent WITHOUT the word is refused, and told which word');

    for (const door of doors('narrow')) {
        await test(`an agent without organism:write cannot ${door.what}`, async () => {
            const r = await door.call(narrowTokenBefore);
            assert(r.status === 403, `expected 403, got ${r.status} ${JSON.stringify(r.body)}`);
            // SCOPE_DENIED rather than ACCESS_DENIED is what separates "you lack the permission" from
            // "you are not a member here" — and the membership gate sits INSIDE these handlers, so a
            // bare 403 would not prove the scope stopped anything.
            assert(r.body.error?.code === 'SCOPE_DENIED', `expected SCOPE_DENIED, got ${r.body.error?.code}: ${r.body.error?.message}`);
            assert((r.body.error?.message ?? '').includes('organism:write'),
                `the refusal must name the scope, got: ${r.body.error?.message}`);
        });
    }

    console.log('\nPhase 2: An agent WITH the word gets through all three');

    for (const door of doors('scoped')) {
        await test(`an agent holding organism:write can ${door.what}`, async () => {
            const r = await door.call(scopedToken);
            assert(r.status === 201, `expected 201, got ${r.status} ${JSON.stringify(r.body.error)}`);
        });
    }

    console.log('\nPhase 3: Full access still carries it, so no existing agent lost anything');

    for (const door of doors('wide')) {
        await test(`a '*' agent can ${door.what}`, async () => {
            const r = await door.call(wideToken);
            assert(r.status === 201, `expected 201, got ${r.status} ${JSON.stringify(r.body.error)}`);
        });
    }

    console.log('\nPhase 4: The account holder\'s own session is untouched');

    for (const door of doors('owner')) {
        await test(`the owner session can still ${door.what}`, async () => {
            const r = await door.call(ownerToken);
            assert(r.status === 201, `expected 201, got ${r.status} ${JSON.stringify(r.body.error)}`);
        });
    }

    console.log('\nPhase 5: The boot migration hands the word to an agent that already had the reach');

    const provider = (process.env.AIMEAT_DB ?? 'memory') as StorageProvider;
    const dbUrl = process.env.DATABASE_URL ?? process.env.AIMEAT_DB_URL ?? '';
    const sqlitePath = process.env.AIMEAT_DB_PATH ?? '';
    // An in-memory backend lives inside the server process, so a second handle would open a DIFFERENT
    // empty database and the phase would assert against nothing. Say so rather than passing hollow.
    const canOpenBackend = (provider === 'sqlite' && !!sqlitePath) || (provider === 'postgres-kysely' && !!dbUrl);

    if (!canOpenBackend) {
        console.log(`  … skipped: backend "${provider}" is not reachable from this process (no shared file or URL)`);
    } else {
        let storage!: Storage;

        await test('before the migration, the narrow agent has no organism:write on its record', async () => {
            storage = await createStorage({ provider, sqlitePath, dbUrl });
            const rec = await storage.getAgent(narrow.gaii);
            assert(!!rec, `agent record missing for ${narrow.gaii}`);
            assert(!(rec!.defaultScopes ?? []).includes('organism:write'),
                `expected no organism:write, record holds [${(rec!.defaultScopes ?? []).join(', ')}]`);
        });

        await test('the migration writes organism:write onto it', async () => {
            const changed = await migrateAgentScopeVocabulary(storage);
            assert(changed > 0, 'the migration reported no agent changed');
            const rec = await storage.getAgent(narrow.gaii);
            assert((rec!.defaultScopes ?? []).includes('organism:write'),
                `record still holds [${(rec!.defaultScopes ?? []).join(', ')}]`);
            // Nothing it already had was dropped on the way.
            assert((rec!.defaultScopes ?? []).includes('memory:read'), 'the migration must only add');
        });

        await test('a token minted AFTER the migration opens all three doors', async () => {
            const after = await mintAgentToken(narrow);
            for (const door of doors('migrated')) {
                const r = await door.call(after);
                assert(r.status === 201, `${door.what}: expected 201, got ${r.status} ${JSON.stringify(r.body.error)}`);
            }
        });

        await test('the token minted BEFORE it does not — a JWT carries the scopes it was minted with', async () => {
            const r = await doors('stale')[0].call(narrowTokenBefore);
            assert(r.status === 403, `expected 403 on the pre-migration token, got ${r.status}`);
        });

        await test('a \'*\' agent is left alone: the wildcard already covers the word at the door', async () => {
            const rec = await storage.getAgent(wide.gaii);
            assert(!(rec!.defaultScopes ?? []).includes('organism:write'),
                `a wildcard agent should not be rewritten, record holds [${(rec!.defaultScopes ?? []).join(', ')}]`);
            const r = await doors('wide2')[0].call(wideToken);
            assert(r.status === 201, `the '*' agent must still pass, got ${r.status}`);
        });

        // This migration runs at EVERY boot, so "it only happens once" is true of nothing in it. A
        // second pass reading its own output is how agent:permissions — conditional on agent:write,
        // which the same run grandfathers in — reached every agent on the node on boot two. That word
        // is outside every wildcard precisely because it lets an agent rewrite its own permissions.
        await test('running it a second time changes nothing, and hands out no new permission', async () => {
            const again = await migrateAgentScopeVocabulary(storage);
            assert(again === 0, `expected 0 agents changed on the second run, got ${again}`);
            for (const gaii of [narrow.gaii, scoped.gaii]) {
                const rec = await storage.getAgent(gaii);
                assert(!(rec!.defaultScopes ?? []).includes('agent:permissions'),
                    `${gaii} was handed agent:permissions by a re-run: [${(rec!.defaultScopes ?? []).join(', ')}]`);
            }
        });
    }

    console.log('\nPhase 6: Cleanup');

    await test('the owner erases their account', async () => {
        const r = await json(`/v1/owners/${owner}`, { method: 'DELETE', headers: auth(ownerToken) });
        assert(r.status === 200, `expected 200, got ${r.status} ${JSON.stringify(r.body)}`);
    });

    console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
    process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
