/**
 * @file test/e2e-security-txt.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description GET /.well-known/security.txt (RFC 9116) and the two operator settings it reads.
 *   With no contact set the address answers 404, as before the route existed: the node never invents
 *   a contact. The operator sets the contact on PUT /v1/admin/config (the route the Config tab and
 *   aimeat_admin_config_set use), and the file then answers 200 text/plain with each Contact line in
 *   order, an Expires about 180 days ahead, the Canonical address, the Policy line and the preferred
 *   languages. A value that is not a mailto: or https: address is refused and changes nothing, and an
 *   account that is not an operator cannot set it.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=security-txt
 * @version-history
 *   v1.0.0 — 2026-11-19 — Initial (feature audit 2026-11-19, report 4.7).
 */
import { registerOwner, ownerSignIn } from './helpers/owner-login.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (e) { failed++; console.log(`  ❌ ${name}: ${(e as Error).message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }

async function json(path: string, token: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...opts.headers } });
    const text = await res.text();
    let body: any = { _raw: text };
    try { body = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, body };
}
const setting = (token: string, changes: Array<{ path: string; value: unknown }>) =>
    json('/v1/admin/config', token, { method: 'PUT', body: JSON.stringify({ changes }) });
const fetchTxt = () => fetch(`${BASE}/.well-known/security.txt`);

const stamp = Date.now().toString(36);
let operator = '';
let member = '';

console.log('\n=== AIMEAT security.txt E2E ===\n');

await test('setup: the operator (first account) and a second account', async () => {
    const op = `sectxtop${stamp}`;
    await registerOwner(BASE, op);
    operator = (await ownerSignIn(BASE, op)).body.data.token;
    const m = `sectxtm${stamp}`;
    await registerOwner(BASE, m);
    member = (await ownerSignIn(BASE, m)).body.data.token;
    assert(!!operator && !!member, 'both signed in');
});

await test('with no contact set, /.well-known/security.txt answers 404', async () => {
    const res = await fetchTxt();
    assert(res.status === 404, `expected 404, got ${res.status}: ${(await res.text()).slice(0, 200)}`);
});

await test('a contact that is not a mailto: or https: address is refused and changes nothing', async () => {
    for (const value of ['security@example.org', 'http://example.org/report', 'mailto:security@example.org, javascript:alert(1)', 'mailto:nobody']) {
        const r = await setting(operator, [{ path: 'operator.security_contact', value }]);
        assert(r.status === 400 && r.body.error?.code === 'INVALID_INPUT', `${JSON.stringify(value)}: ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`);
        // The setting's own refusal, not "unknown setting": the row exists and its check said no.
        assert(JSON.stringify(r.body).includes('mailto: address'), `the refusal says what the setting takes: ${JSON.stringify(r.body).slice(0, 400)}`);
    }
    const policy = await setting(operator, [{ path: 'operator.security_policy_url', value: 'ftp://example.org/policy' }]);
    assert(policy.status === 400, `a policy that is not https: ${policy.status}`);
    const res = await fetchTxt();
    assert(res.status === 404, `still no file: ${res.status}`);
});

await test('an account that is not an operator cannot set the contact', async () => {
    const r = await setting(member, [{ path: 'operator.security_contact', value: 'mailto:attacker@example.org' }]);
    assert(r.status === 403, `expected 403, got ${r.status}`);
    assert((await fetchTxt()).status === 404, 'still no file');
});

await test('the operator sets the contact and the policy, and the file answers 200 with every line', async () => {
    const r = await setting(operator, [
        { path: 'operator.security_contact', value: 'mailto:security@example.org, https://example.org/report-a-vulnerability' },
        { path: 'operator.security_policy_url', value: 'https://example.org/disclosure-policy' },
    ]);
    assert(r.status === 200 && (r.body.data.errors ?? []).length === 0, `set: ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`);
    const res = await fetchTxt();
    assert(res.status === 200, `status ${res.status}`);
    assert((res.headers.get('content-type') ?? '').startsWith('text/plain'), `content-type ${res.headers.get('content-type')}`);
    const lines = (await res.text()).trim().split('\n');
    const field = (name: string) => lines.filter(l => l.startsWith(`${name}: `)).map(l => l.slice(name.length + 2));
    assert(JSON.stringify(field('Contact')) === JSON.stringify(['mailto:security@example.org', 'https://example.org/report-a-vulnerability']), `Contact: ${JSON.stringify(lines)}`);
    const [expires] = field('Expires');
    const ahead = Date.parse(expires ?? '') - Date.now();
    const day = 24 * 60 * 60 * 1000;
    assert(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(expires ?? '') && ahead > 179 * day && ahead < 181 * day, `Expires ${expires}`);
    const [canonical] = field('Canonical');
    assert(/^https?:\/\/\S+\/\.well-known\/security\.txt$/.test(canonical ?? ''), `Canonical ${canonical}`);
    assert(field('Policy')[0] === 'https://example.org/disclosure-policy', `Policy: ${JSON.stringify(lines)}`);
    assert(field('Preferred-Languages')[0] === 'en, fi', `Preferred-Languages: ${JSON.stringify(lines)}`);
});

await test('the contact cleared, the address answers 404 again', async () => {
    const r = await setting(operator, [
        { path: 'operator.security_contact', value: '' },
        { path: 'operator.security_policy_url', value: '' },
    ]);
    assert(r.status === 200, `clear: ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`);
    assert((await fetchTxt()).status === 404, 'no file once the contact is empty');
});

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
