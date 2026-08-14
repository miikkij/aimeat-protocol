/**
 * @file test/e2e-capability-webhook-update.ts
 * @description E2E for the webhook policy gate on PUT /v1/capabilities/{id}.
 *
 *   WHAT THIS PROVES. `POST /v1/capabilities` has always asked the node's webhook policy before
 *   storing a webhookUrl. `PUT` asked nobody, so a node running capabilityWebhooks 'disabled' or
 *   'allowlist_only' was defeated in two requests: create a capability with no webhook, then PUT one
 *   on. The operator's setting decided nothing at all.
 *
 *   AND WHAT IT PROVES ABOUT THE SHAPE OF THE FIX. The gate fires on a CHANGE of the webhook the
 *   node would end up calling, never on its presence in the body, because a UI PUTs the whole record
 *   back and an unchanged webhookUrl therefore arrives with every unrelated edit. Gating on presence
 *   would refuse a rename on a 'disabled' node, which is a capability the owner already has. Half of
 *   the cases below are there for that half of the rule.
 * @usage
 *   pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-capability-webhook-update
 * @version-history
 *   v1.0.0 — 2026-08-14 — Written with the August 2026 audit fix to routes/capabilities.ts.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const ADMIN_PW = process.env.AIMEAT_ADMIN_PASSWORD ?? 'TestAdminPw123!';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
    try {
        await fn();
        passed++;
        console.log(`  ✅ ${name}`);
    } catch (err: any) {
        failed++;
        console.error(`  ❌ ${name}: ${err.message}`);
    }
}

function assert(cond: boolean, msg: string) {
    if (!cond) throw new Error(msg);
}

// `base` is the node being driven. Phase 1 runs against the shared test server, which boots with the
// shipped default (webhooks disabled); Phase 2 spawns its own, because the policy is read at boot.
async function json(path: string, opts: RequestInit = {}, base = BASE) {
    const res = await fetch(`${base}${path}`, {
        ...opts,
        headers: { 'Content-Type': 'application/json', ...opts.headers },
    });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text(), _ct: ct };
    return { status: res.status, body };
}

/** Register an owner through the admin door and come back with a token. */
async function newOwner(prefix: string, base: string): Promise<{ name: string; token: string }> {
    const name = prefix + Math.random().toString(36).slice(2, 8);
    const reg = await json('/v1/admin/setup/register', {
        method: 'POST', headers: { 'X-Admin-Password': ADMIN_PW }, body: JSON.stringify({ name }),
    }, base);
    assert(reg.body.ok === true, `register ${name}: ${JSON.stringify(reg.body)}`);
    const tok = await json('/v1/admin/setup/token', {
        method: 'POST', headers: { 'X-Admin-Password': ADMIN_PW },
        body: JSON.stringify({ owner: name, private_key: reg.body.private_key }),
    }, base);
    assert(tok.body.ok === true, `token ${name}: ${JSON.stringify(tok.body.error)}`);
    return { name, token: tok.body.token };
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function readCap(id: string, token: string, base = BASE) {
    const { status, body } = await json(`/v1/capabilities/${id}`, { headers: auth(token) }, base);
    assert(status === 200, `read ${id}: status ${status}`);
    return body.data;
}

console.log('\n=== AIMEAT Capability Webhook Update Gate E2E ===\n');

// ─── Phase 1: a node with webhooks DISABLED ───
// The owner here is also the node operator, which is the harder case: the operator is exempt from
// the publishing policy and is NOT exempt from the webhook policy, at create or at update. A node
// that admits no webhooks admits none from anyone.
console.log('Phase 1 — capabilityWebhooks=disabled');

const owner = await newOwner('caphook-', BASE);
const OFF_LIST = 'https://elsewhere.test/hook';
let capId = '';

await test('This node boots with capabilityWebhooks=disabled', async () => {
    const { body } = await json('/v1/capabilities');
    assert(body.data?.policy?.webhooks === 'disabled',
        `expected 'disabled', got '${body.data?.policy?.webhooks}'`);
});

await test('Create a capability with no webhook', async () => {
    capId = 'hookupd-' + Math.random().toString(36).slice(2, 8);
    const { status, body } = await json('/v1/capabilities', {
        method: 'POST', headers: auth(owner.token),
        body: JSON.stringify({
            id: capId, name: 'Update gate', summary: 'no webhook yet', visibility: 'private',
            source: { type: 'manual', ref: 'manual', version: '1.0.0' },
        }),
    });
    assert(status === 201, `expected 201, got ${status}: ${JSON.stringify(body.error ?? body)}`);
    assert(body.data.webhookUrl === null, `webhookUrl should start null: ${body.data.webhookUrl}`);
});

await test('A full-record PUT that leaves the webhook alone is accepted', async () => {
    // What a UI does: read the record, change one field, send the whole thing back. `webhookUrl`
    // rides along in the body unchanged, and refusing that would refuse every edit on this node.
    const record = await readCap(capId, owner.token);
    const { status, body } = await json(`/v1/capabilities/${capId}`, {
        method: 'PUT', headers: auth(owner.token),
        body: JSON.stringify({ ...record, summary: 'renamed with the whole record' }),
    });
    assert(status === 200, `expected 200, got ${status}: ${JSON.stringify(body.error ?? body)}`);
    assert(body.data.summary === 'renamed with the whole record', `summary: ${body.data.summary}`);
    assert(body.data.webhookUrl === null, `webhookUrl should still be null: ${body.data.webhookUrl}`);
});

await test('Adding a webhook is refused, and nothing is stored', async () => {
    const { status, body } = await json(`/v1/capabilities/${capId}`, {
        method: 'PUT', headers: auth(owner.token),
        body: JSON.stringify({ webhookUrl: OFF_LIST }),
    });
    assert(status === 403 && body.error?.code === 'WEBHOOKS_DISABLED',
        `expected 403 WEBHOOKS_DISABLED, got ${status} ${body.error?.code ?? JSON.stringify(body.data)}`);
    const back = await readCap(capId, owner.token);
    assert(back.webhookUrl === null, `a refused webhook must not be stored, got '${back.webhookUrl}'`);
});

await test('The two-step way in is closed: a parked webhook cannot be turned manual', async () => {
    // Step one is allowed on purpose. Create does not gate a webhookUrl on a non-manual source and
    // invoke never calls one, so a webhook sitting on an extension-sourced record is dead data.
    const parkId = 'hookpark-' + Math.random().toString(36).slice(2, 8);
    const create = await json('/v1/capabilities', {
        method: 'POST', headers: auth(owner.token),
        body: JSON.stringify({
            id: parkId, name: 'Parked', summary: 'webhook on a non-manual source', visibility: 'private',
            source: { type: 'extension', ref: 'ext:demo', version: '1.0.0' }, webhookUrl: OFF_LIST,
        }),
    });
    assert(create.status === 201, `park create: ${create.status} ${JSON.stringify(create.body.error ?? '')}`);

    // Step two is the attack: no webhookUrl in the body at all, so a gate that only compared URLs
    // would see nothing changing, and the record would land as a manual webhook capability this node
    // refuses to be handed in one request.
    const { status, body } = await json(`/v1/capabilities/${parkId}`, {
        method: 'PUT', headers: auth(owner.token),
        body: JSON.stringify({ source: { type: 'manual', ref: 'manual', version: '1.0.0' } }),
    });
    assert(status === 403 && body.error?.code === 'WEBHOOKS_DISABLED',
        `expected 403 WEBHOOKS_DISABLED, got ${status} ${body.error?.code ?? JSON.stringify(body.data)}`);
    const back = await readCap(parkId, owner.token);
    assert(back.source.type === 'extension', `source must not have flipped, got '${back.source.type}'`);
});

// ─── Phase 2: a node with an ALLOWLIST ───
// A boot-time setting, so it needs a node of its own. The port is derived from this suite's own so
// two suites running side by side cannot land on the same one, and the offset differs from the one
// e2e-capabilities uses for the same reason.
console.log('\nPhase 2 — capabilityWebhooks=allowlist_only');

const ALT_PORT = String(Number(new URL(BASE).port || '80') + 501);
const ALT_BASE = `http://localhost:${ALT_PORT}`;
const ALT_DB = resolve(process.cwd(), `test/.hookupd-allowlist-${ALT_PORT}.db`);
const ALLOWED = 'https://hooks.example.test/first';
const ALLOWED_OTHER = 'https://hooks.example.test/second';
let altNode: ChildProcess | null = null;
let altToken = '';
let altCapId = '';

function cleanupAltDb() {
    for (const f of [ALT_DB, ALT_DB + '-wal', ALT_DB + '-shm']) {
        try { if (existsSync(f)) unlinkSync(f); } catch { /* a leftover file is not worth failing over */ }
    }
}

async function startAllowlistNode(): Promise<ChildProcess> {
    cleanupAltDb();
    const child = spawn('node', ['--import', 'tsx', 'src/index.ts', 'start', '--db', 'sqlite', '--db-path', ALT_DB], {
        env: {
            ...process.env,
            AIMEAT_PORT: ALT_PORT,
            AIMEAT_BASE_URL: ALT_BASE,
            AIMEAT_DB_PATH: ALT_DB,
            AIMEAT_CAPABILITY_WEBHOOKS: 'allowlist_only',
            AIMEAT_CAPABILITY_WEBHOOK_DOMAIN_ALLOWLIST: 'hooks.example.test',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        cwd: process.cwd(),
    });
    child.stdout?.on('data', () => {});
    child.stderr?.on('data', () => {});
    const started = Date.now();
    while (Date.now() - started < 60_000) {
        try { if ((await fetch(`${ALT_BASE}/v1/spec`)).ok) return child; } catch { /* not up yet */ }
        await new Promise(r => setTimeout(r, 300));
    }
    child.kill('SIGTERM');
    throw new Error(`allowlist node did not start on port ${ALT_PORT}`);
}

await test('Start a node with capabilityWebhooks=allowlist_only', async () => {
    altNode = await startAllowlistNode();
    altToken = (await newOwner('caphookalw-', ALT_BASE)).token;
    const { body } = await json('/v1/capabilities', {}, ALT_BASE);
    assert(body.data?.policy?.webhooks === 'allowlist_only', `alt node policy: ${body.data?.policy?.webhooks}`);
});

await test('Create with a listed domain', async () => {
    altCapId = 'hookalw-' + Math.random().toString(36).slice(2, 8);
    const { status, body } = await json('/v1/capabilities', {
        method: 'POST', headers: auth(altToken),
        body: JSON.stringify({
            id: altCapId, name: 'Allowed hook', summary: 'on the list', visibility: 'private',
            source: { type: 'manual', ref: 'manual', version: '1.0.0' }, webhookUrl: ALLOWED,
        }),
    }, ALT_BASE);
    assert(status === 201, `expected 201, got ${status}: ${JSON.stringify(body.error ?? body)}`);
    assert(body.data.webhookUrl === ALLOWED, `webhook stored: ${body.data.webhookUrl}`);
});

await test('A full-record PUT with the webhook unchanged is accepted', async () => {
    const record = await readCap(altCapId, altToken, ALT_BASE);
    const { status, body } = await json(`/v1/capabilities/${altCapId}`, {
        method: 'PUT', headers: auth(altToken),
        body: JSON.stringify({ ...record, summary: 'edited, hook untouched' }),
    }, ALT_BASE);
    assert(status === 200, `expected 200, got ${status}: ${JSON.stringify(body.error ?? body)}`);
    assert(body.data.summary === 'edited, hook untouched', `summary: ${body.data.summary}`);
    assert(body.data.webhookUrl === ALLOWED, `webhook should survive an unrelated edit: ${body.data.webhookUrl}`);
});

await test('Changing the domain is refused, and the stored webhook is untouched', async () => {
    const { status, body } = await json(`/v1/capabilities/${altCapId}`, {
        method: 'PUT', headers: auth(altToken),
        body: JSON.stringify({ webhookUrl: OFF_LIST }),
    }, ALT_BASE);
    assert(status === 403 && body.error?.code === 'WEBHOOK_DOMAIN_NOT_ALLOWED',
        `expected 403 WEBHOOK_DOMAIN_NOT_ALLOWED, got ${status} ${body.error?.code ?? JSON.stringify(body.data)}`);
    const back = await readCap(altCapId, altToken, ALT_BASE);
    assert(back.webhookUrl === ALLOWED, `stored webhook must be untouched, got '${back.webhookUrl}'`);
});

await test('A URL that is not a URL is refused with INVALID_WEBHOOK_URL', async () => {
    // Same code create gives, so a client cannot tell the two doors apart by the refusal it gets.
    const { status, body } = await json(`/v1/capabilities/${altCapId}`, {
        method: 'PUT', headers: auth(altToken),
        body: JSON.stringify({ webhookUrl: 'not-a-url' }),
    }, ALT_BASE);
    assert(status === 400 && body.error?.code === 'INVALID_WEBHOOK_URL',
        `expected 400 INVALID_WEBHOOK_URL, got ${status} ${body.error?.code ?? JSON.stringify(body.data)}`);
});

await test('Another address on the listed domain goes through', async () => {
    // The gate refuses a change the policy refuses, not every change. What the operator allowed is
    // still allowed, or this fix would have taken a working capability away.
    const { status, body } = await json(`/v1/capabilities/${altCapId}`, {
        method: 'PUT', headers: auth(altToken),
        body: JSON.stringify({ webhookUrl: ALLOWED_OTHER }),
    }, ALT_BASE);
    assert(status === 200, `expected 200, got ${status}: ${JSON.stringify(body.error ?? body)}`);
    assert(body.data.webhookUrl === ALLOWED_OTHER, `webhook: ${body.data.webhookUrl}`);
});

await test('Clearing the webhook is accepted', async () => {
    // Always allowed, on every policy: taking the node's outbound call away asks nothing of it.
    const { status, body } = await json(`/v1/capabilities/${altCapId}`, {
        method: 'PUT', headers: auth(altToken),
        body: JSON.stringify({ webhookUrl: null }),
    }, ALT_BASE);
    assert(status === 200, `expected 200, got ${status}: ${JSON.stringify(body.error ?? body)}`);
    assert(body.data.webhookUrl === null, `webhook should be cleared, got '${body.data.webhookUrl}'`);
});

await test('Stop the allowlist node', async () => {
    if (!altNode) return;
    const ended = new Promise<void>(r => altNode!.once('exit', () => r()));
    altNode.kill('SIGTERM');
    await Promise.race([ended, new Promise(r => setTimeout(r, 5000))]);
    if (!altNode.killed) altNode.kill('SIGKILL');
    cleanupAltDb();
});

// ─── Cleanup ───
console.log('\nCleanup');
await test('Delete test owner (cascade)', async () => {
    const { body } = await json(`/v1/owners/${owner.name}`, { method: 'DELETE', headers: auth(owner.token) });
    assert(body.ok === true, `delete: ${JSON.stringify(body.error)}`);
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed out of ${passed + failed} ===\n`);
process.exit(failed > 0 ? 1 : 0);
