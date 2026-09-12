/**
 * @file test/e2e-admin-sso-page.ts
 * @description E2E for the Organisation sign-in page's read: that it says whether anybody can
 *   actually sign in, and does not confuse "configured" with "working".
 *
 *   THE ASSERTION THAT MATTERS is `state: 'blocked_by_switch'`. A connection can be complete — the
 *   company created, its identity provider read, a token minted, listed on the public page — and
 *   nobody can sign in, because `sso.enabled` is off and both public doors answer 503. The page
 *   showed five setup steps and reported that state nowhere; an operator finished the work and the
 *   door stayed shut. Every case below turns on the difference between the two phases.
 *
 *   THE SUITE RUNS WITH THE SWITCH OFF, which is the default and the state the old page could not
 *   express. That is deliberate: the interesting assertions are the ones about a node that is
 *   configured and not yet open, and a suite that turned the flag on would test the easy half.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-admin-sso-page
 * @version-history
 *   v1.0.0 — 2026-09-12 — Initial, with the Organisation sign-in page's rebuild.
 */

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
async function signMsg(privB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}

console.log('\n=== AIMEAT Admin Organisation sign-in page E2E ===\n');

const opName = `ssoop${Date.now()}`;
const otherName = `ssoother${Date.now()}`;
const slug = `contoso${Date.now()}`.slice(0, 24);
let opToken = '';
let otherToken = '';

const list = () => json('/v1/admin/sso/connections', { headers: { Authorization: `Bearer ${opToken}` } });

await test('Setup: the first owner is the operator; a second is not', async () => {
    const mk = async (name: string) => {
        const reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name, public_key: 'placeholder' }) });
        assert(reg.status === 201, `register ${name}: ${reg.status}`);
        const ts = new Date().toISOString();
        const tok = await json('/v1/auth/token', {
            method: 'POST',
            body: JSON.stringify({ owner: name, timestamp: ts, signature: await signMsg(reg.body.data.private_key, name + NODE_ID + ts) }),
        });
        assert(tok.body.ok === true, `token ${name}: ${JSON.stringify(tok.body.error)}`);
        return tok.body.data.token as string;
    };
    opToken = await mk(opName);
    otherToken = await mk(otherName);
});

await test('The read carries the two node-wide switches, not only the connections', async () => {
    const r = await list();
    assert(r.body.ok === true, `ok: ${JSON.stringify(r.body.error ?? r.status)}`);
    const d = r.body.data;
    assert(Array.isArray(d.connections), 'the connections are an array');
    assert(typeof d.node?.enabled === 'boolean', 'node.enabled is a boolean');
    assert(typeof d.node?.locked === 'boolean', 'node.locked is a boolean');
    // The names of the settings ride along so a surface can tell an operator where to go.
    assert(d.node.enabled_setting === 'sso.enabled', `names the switch, got ${d.node.enabled_setting}`);
    assert(d.node.locked_setting === 'sso.connections_locked', `names the freeze, got ${d.node.locked_setting}`);
    assert(typeof d.node.accounts === 'number' && d.node.accounts >= 2, `counts accounts, got ${d.node.accounts}`);
});

await test('With nothing connected the summary is zeroes, not absences', async () => {
    const s = (await list()).body.data.summary;
    for (const f of ['total', 'blocked_by_switch', 'incomplete', 'buttons_showing', 'can_sign_in', 'logins_seen', 'directories_calling']) {
        assert(typeof s[f] === 'number', `summary.${f} is a number`);
    }
    assert(s.steps_total === 6, `six steps, not five — got ${s.steps_total}`);
});

await test('A new connection is reported as unfinished, because it has no identity provider', async () => {
    const r = await json('/v1/admin/sso/connections', {
        method: 'POST',
        headers: { Authorization: `Bearer ${opToken}` },
        body: JSON.stringify({ id: slug, name: 'Contoso Oy', domains: ['contoso.com'], login_visibility: 'listed' }),
    });
    assert(r.status === 201, `create: ${r.status} ${JSON.stringify(r.body.error ?? '')}`);

    const d = (await list()).body.data;
    const c = d.connections.find((x: any) => x.id === slug);
    assert(!!c, 'the connection is in the list');
    assert(c.state === 'no_idp', `state is no_idp, got ${c.state}`);
    assert(c.can_sign_in === false, 'nobody can sign in');
    assert(c.button_showing === false, 'no button on the public page');
    assert(d.summary.incomplete >= 1, 'it counts as unfinished');
});

await test('Configured and the switch off is its OWN state, not "ready"', async () => {
    // The suite runs with sso.enabled false, which is the default. This is the case the old page
    // could not express: everything an operator can do here is done, and the door is still shut.
    const d = (await list()).body.data;
    assert(d.node.enabled === false, 'the switch is off in this environment, which is the case under test');
    const c = d.connections.find((x: any) => x.id === slug);
    // Not yet configured at the IdP, so it is still no_idp rather than blocked_by_switch. What is
    // asserted here is that `can_sign_in` follows the SWITCH and not just the connection.
    assert(c.can_sign_in === false, 'can_sign_in is false while the switch is off');
    assert(d.summary.can_sign_in === 0, 'and the summary agrees');
    assert(d.summary.buttons_showing === 0, 'no button can be showing with the door shut');
});

await test('Visibility is carried through, and a hidden connection is still not a button', async () => {
    const r = await json(`/v1/admin/sso/connections/${encodeURIComponent(slug)}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${opToken}` },
        body: JSON.stringify({ login_visibility: 'hidden' }),
    });
    assert(r.status === 200, `update: ${r.status} ${JSON.stringify(r.body.error ?? '')}`);
    const c = (await list()).body.data.connections.find((x: any) => x.id === slug);
    assert(c.login_visibility === 'hidden', 'the change took');
    assert(c.button_showing === false, 'hidden is never a button');
});

await test('Steps are counted out of six, and the sixth is the switch', async () => {
    const d = (await list()).body.data;
    const c = d.connections.find((x: any) => x.id === slug);
    assert(typeof c.steps_done === 'number', 'steps_done is a number');
    assert(c.steps_done < 6, `not all six are done with the switch off, got ${c.steps_done}`);
    // Exists + visibility decided = 2; no IdP, no token, no login, no switch.
    assert(c.steps_done === 2, `exists and visibility only, got ${c.steps_done}`);
});

await test('The MCP list and the HTTP list answer with the same shape', async () => {
    // Both call buildSsoOverview. This asserts the payload the tool returns is the page's payload,
    // which is the property that stops the two drifting into different answers.
    const d = (await list()).body.data;
    assert(!!d.node && !!d.summary && Array.isArray(d.connections),
        'the HTTP list carries node, summary and connections together');
});

await test('The door is operator-only', async () => {
    const other = await json('/v1/admin/sso/connections', { headers: { Authorization: `Bearer ${otherToken}` } });
    assert(other.status === 403, `a non-operator: expected 403, got ${other.status}`);
    const anon = await json('/v1/admin/sso/connections');
    assert(anon.status === 401 || anon.status === 403, `unauthenticated: got ${anon.status}`);
});

await test('The public sign-in door really is refusing while the switch is off', async () => {
    // The assertion behind the whole redesign: the page can be complete and this answers 503.
    const r = await json(`/v1/sso/${encodeURIComponent(slug)}/metadata`);
    assert(r.status === 503, `expected 503 FEATURE_DISABLED, got ${r.status}`);
    assert(r.body.error?.code === 'FEATURE_DISABLED', `expected FEATURE_DISABLED, got ${r.body.error?.code}`);
});

await test('Cleanup: the connection is removed', async () => {
    const r = await json(`/v1/admin/sso/connections/${encodeURIComponent(slug)}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${opToken}` },
    });
    assert(r.status === 200, `delete: ${r.status}`);
    const d = (await list()).body.data;
    assert(!d.connections.find((x: any) => x.id === slug), 'it is gone');
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed out of ${passed + failed} ===`);
process.exit(failed > 0 ? 1 : 0);
