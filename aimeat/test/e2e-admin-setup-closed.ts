/**
 * @file test/e2e-admin-setup-closed.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The admin password creates the node's FIRST operator and no other (secrets audit
 *   2026-10-09, 1.4). Until then POST /v1/admin/setup/register created an owner with the operator
 *   role for anyone holding the admin password for the life of the process, also on a node that
 *   already had operators, and a node without AIMEAT_ADMIN_PASSWORD wrote its generated password to
 *   stderr. Reading the server log was enough to become an operator.
 *
 *   Runs against a node started with AIMEAT_ADMIN_SETUP_OPEN_AFTER_FIRST_OPERATOR=false, the shipped
 *   setting: the runner lists this suite in ADMIN_SETUP_CLOSED_SUITES (run-e2e-server.ts). Every
 *   other suite runs with the route kept open, because they register several operators per run.
 * @structure
 *   - The first operator registers with the admin password (200), and setup/token still answers
 *   - A second register with the same password → 410 SETUP_CLOSED, and no owner by that name exists
 *   - A wrong password still gets 401, so the closed state is told only to the password holder
 *   - The route the refusal names works: an ordinary account, then POST /v1/admin/roles/grant
 * @usage
 *   cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts \
 *     --test=e2e-admin-setup-closed
 * @version-history
 *   v1.0.0 — 2026-10-09 — Initial (secrets audit 2026-10-09, 1.4).
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const ADMIN_PW = process.env.AIMEAT_ADMIN_PASSWORD ?? 'test-admin-pw';

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

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, {
        ...opts,
        headers: { 'Content-Type': 'application/json', ...opts.headers },
    });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text(), _ct: ct };
    return { status: res.status, body, headers: res.headers };
}

ed.hashes.sha512 = (m: Uint8Array) =>
    new Uint8Array(createHash('sha512').update(m).digest());

async function signMsg(privateKeyB64: string, message: string): Promise<string> {
    const priv = Buffer.from(privateKeyB64, 'base64');
    const sig = await ed.signAsync(new TextEncoder().encode(message), priv);
    return Buffer.from(sig).toString('base64');
}

async function ownerTokenFor(name: string, privKey: string): Promise<string> {
    const timestamp = new Date().toISOString();
    const signature = await signMsg(privKey, name + NODE_ID + timestamp);
    const { body } = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner: name, timestamp, signature }),
    });
    assert(body.ok === true, `token for ${name}: ${JSON.stringify(body.error)}`);
    return body.data.token as string;
}

// /v1/admin/setup/auth, /register and /token share one limiter: five requests per sixty seconds per
// IP (middleware/rate-limit.ts). This suite makes four of them.
function register(name: string, password = ADMIN_PW) {
    return json('/v1/admin/setup/register', {
        method: 'POST',
        headers: { 'X-Admin-Password': password },
        body: JSON.stringify({ name }),
    });
}

// ─── State ───
const stamp = Date.now();
const firstName = `setupop${stamp}`;
const secondName = `setupop2${stamp}`;
const wrongPwName = `setupop3${stamp}`;
const plainName = `setupplain${stamp}`;

let firstKey = '';
let operatorToken = '';

function op(opts: RequestInit = {}): RequestInit {
    return { ...opts, headers: { ...((opts.headers ?? {}) as Record<string, string>), Authorization: `Bearer ${operatorToken}` } };
}

async function ownerNames(): Promise<string[]> {
    const { status, body } = await json('/v1/admin/owners', op());
    assert(status === 200, `GET /v1/admin/owners ${status}: ${JSON.stringify(body)}`);
    return (body.data.owners as any[]).map(o => o.name as string);
}

console.log('\n=== AIMEAT admin setup closes after the first operator (secrets audit 1.4) ===\n');

await test('The first operator registers with the admin password → 200, with the operator role', async () => {
    const { status, body } = await register(firstName);
    assert(status === 200, `register ${status}: ${JSON.stringify(body)}`);
    assert(body.owner?.roles?.includes('operator'), `no operator role: ${JSON.stringify(body.owner)}`);
    firstKey = body.private_key as string;
    operatorToken = await ownerTokenFor(firstName, firstKey);
});

await test('The setup wizard\'s next step still works: setup/token for the first operator → 200', async () => {
    const { status, body } = await json('/v1/admin/setup/token', {
        method: 'POST',
        headers: { 'X-Admin-Password': ADMIN_PW },
        body: JSON.stringify({ owner: firstName, private_key: firstKey }),
    });
    assert(status === 200, `setup/token ${status}: ${JSON.stringify(body)}`);
    assert(typeof body.token === 'string' && body.token.length > 0, 'no token');
});

await test('A second register with the same admin password → 410 SETUP_CLOSED, naming the role grant', async () => {
    const { status, body } = await register(secondName);
    assert(status === 410, `expected 410, got ${status}: ${JSON.stringify(body)}`);
    assert(body.error?.code === 'SETUP_CLOSED', `code ${JSON.stringify(body.error)}`);
    assert(String(body.error?.message ?? '').includes('/v1/admin/roles/grant'),
        `the message does not name the way an operator adds another: ${body.error?.message}`);
    assert(!body.private_key, 'a refused register handed out a private key');
});

await test('And the refused register created no owner by that name', async () => {
    const names = await ownerNames();
    assert(names.includes(firstName), 'the first operator is missing from the list, so the check proves nothing');
    assert(!names.includes(secondName), `an owner ${secondName} exists after the 410`);
});

await test('A wrong admin password still gets 401, not 410: the closed state is told to the password holder only', async () => {
    const { status, body } = await register(wrongPwName, `${ADMIN_PW}-wrong`);
    assert(status === 401, `expected 401, got ${status}: ${JSON.stringify(body)}`);
    assert(!(await ownerNames()).includes(wrongPwName), `an owner ${wrongPwName} exists after the 401`);
});

await test('The route the refusal names works: an ordinary account, then the operator grants the role', async () => {
    const reg = await json('/v1/owners', {
        method: 'POST', body: JSON.stringify({ name: plainName, public_key: 'placeholder' }),
    });
    assert(reg.status === 201, `register ${reg.status}: ${JSON.stringify(reg.body)}`);
    assert(!(reg.body.data.owner?.roles ?? []).includes('operator'), 'a second owner became operator on sign-up');

    const { status, body } = await json('/v1/admin/roles/grant', op({
        method: 'POST', body: JSON.stringify({ owner: plainName, role: 'operator' }),
    }));
    assert(status === 200, `grant ${status}: ${JSON.stringify(body)}`);

    const owners = await json('/v1/admin/owners', op());
    const row = (owners.body.data.owners as any[]).find(o => o.name === plainName);
    assert(row?.roles?.includes('operator'), `the role did not land: ${JSON.stringify(row?.roles)}`);
});

// ─── Summary ───
console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
if (failed > 0) process.exit(1);
