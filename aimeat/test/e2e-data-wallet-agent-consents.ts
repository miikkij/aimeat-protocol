/**
 * @file test/e2e-data-wallet-agent-consents.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Data Wallet page shows the consents the person's agents gave, and the person revokes
 *   one from there (feature audit 2026-11-19, 1.4). GET /v1/consent and aimeat_consent_list already
 *   listed the account's consents, the agents' included (services/consent/write.ts listAccountConsents),
 *   while GET /v1/data-wallet, which the page reads, listed the person's own only, and its trail and its
 *   permission count left the agents' out as well.
 *
 *   alice gives one consent in person and her agent gives one of its own. alice's wallet lists both,
 *   counts both as active, carries the agent's grant in the trail and in GET /v1/consent/audit, and
 *   alice revokes the agent's consent from the wallet's own revoke route. bob, another owner, sees none
 *   of it and cannot revoke it. The agent, which holds no consent:read-as-owner, still sees only its own.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-data-wallet-agent-consents
 * @version-history
 *   v1.1.0 — 2026-11-19 — Each consent carries its `holder`, so the page names the agent that gave it.
 *   v1.0.0 — 2026-11-19 — Initial (feature audit 2026-11-19, 1.4).
 */
import { assert, BASE, expectRefusal, finish, json, test } from './helpers/harness.js';
import { registerOwner, type RegisteredOwner } from './helpers/owner-login.js';
import { makeAgent, type McpAgent } from './helpers/mcp-session.js';

const stamp = Date.now().toString(36).slice(-6);
const N = (s: string) => `dwa${s}${stamp}`;
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

let alice!: RegisteredOwner, bob!: RegisteredOwner;
let agent!: McpAgent;
let ownConsent = '', agentConsent = '';

async function grant(token: string, pattern: string): Promise<string> {
    const r = await json('/v1/consent', { method: 'POST', headers: auth(token), body: JSON.stringify({ data_pattern: `${pattern}.*`, recipient: 'someone@example.node', purpose: 'data wallet probe', scope: 'local' }) });
    assert(r.status === 201, `grant ${pattern}: ${r.status} ${JSON.stringify(r.body?.error)}`);
    return r.body.data.id as string;
}
async function wallet(token: string) {
    const r = await json('/v1/data-wallet?days=7&entry_limit=200', { headers: auth(token) });
    assert(r.status === 200, `data-wallet ${r.status} ${JSON.stringify(r.body?.error)}`);
    return r.body.data;
}
const ids = (w: any): string[] => (w.consents.consents as any[]).map(c => c.id);

console.log('\n=== The Data Wallet shows the consents the agents gave ===\n');

await test('setup: alice gives a consent in person, her agent gives one of its own', async () => {
    alice = await registerOwner(BASE, N('alice'));
    bob = await registerOwner(BASE, N('bob'));
    agent = await makeAgent(BASE, alice, ['consent:manage'], N('agent'));
    ownConsent = await grant(alice.token, N('own'));
    agentConsent = await grant(agent.token, N('agentnotes'));
    const listed = await json('/v1/consent', { headers: auth(alice.token) });
    assert((listed.body.data.consents as any[]).some(c => c.id === agentConsent), 'GET /v1/consent lists the agent\'s consent for alice (the existing account-wide list)');
});

await test('alice\'s wallet lists both consents, counts both as active, and keeps the totals in step', async () => {
    const w = await wallet(alice.token);
    assert(ids(w).includes(ownConsent), `her own consent is still there: ${JSON.stringify(ids(w))}`);
    assert(ids(w).includes(agentConsent), `the agent's consent is listed: ${JSON.stringify(ids(w))}`);
    assert(w.consents.total === w.consents.consents.length, `total ${w.consents.total} matches the list`);
    assert(w.permSummary.active_consents >= 2, `both are counted active: ${w.permSummary.active_consents}`);
});

await test('each consent says who gave it: the agent\'s carries the agent, alice\'s own carries alice', async () => {
    const w = await wallet(alice.token);
    const rows = w.consents.consents as any[];
    const theirs = rows.find(c => c.id === agentConsent);
    const hers = rows.find(c => c.id === ownConsent);
    assert(theirs?.holder === agent.gaii, `the agent's consent is filed under the agent: ${theirs?.holder} vs ${agent.gaii}`);
    assert(typeof hers?.holder === 'string' && !hers.holder.includes('#') && hers.holder.startsWith(`${alice.name}@`), `alice's own is filed under her: ${hers?.holder}`);
});

await test('the agent\'s grant is in alice\'s trail, on the wallet and on GET /v1/consent/audit', async () => {
    const w = await wallet(alice.token);
    assert((w.audit.entries as any[]).some(e => e.consent_id === agentConsent), `the wallet's trail carries it: ${JSON.stringify(w.audit.entries).slice(0, 300)}`);
    const a = await json(`/v1/consent/audit?days=7&consent_id=${encodeURIComponent(agentConsent)}`, { headers: auth(alice.token) });
    assert(a.status === 200 && (a.body.data.entries as any[]).some(e => e.consent_id === agentConsent), `GET /v1/consent/audit carries it: ${a.status} ${JSON.stringify(a.body?.data?.entries ?? a.body?.error).slice(0, 300)}`);
});

await test('FAILURE: bob\'s wallet shows none of alice\'s consents, and bob cannot revoke the agent\'s', async () => {
    const w = await wallet(bob.token);
    assert(!ids(w).includes(agentConsent) && !ids(w).includes(ownConsent), `bob sees alice's consents: ${JSON.stringify(ids(w))}`);
    const r = await json(`/v1/consent/${agentConsent}`, { method: 'DELETE', headers: auth(bob.token) });
    expectRefusal(r, 403, 'ACCESS_DENIED');
    const after = await wallet(alice.token);
    assert((after.consents.consents as any[]).find(c => c.id === agentConsent)?.status === 'active', 'the agent\'s consent is still active');
});

await test('FAILURE: the agent, without consent:read-as-owner, still sees only its own consent in its wallet', async () => {
    const w = await wallet(agent.token);
    assert(ids(w).includes(agentConsent), `the agent sees its own: ${JSON.stringify(ids(w))}`);
    assert(!ids(w).includes(ownConsent), `the agent sees alice's own consent: ${JSON.stringify(ids(w))}`);
});

await test('alice revokes the agent\'s consent from the wallet, and the wallet shows it revoked', async () => {
    // The page's revoke button calls DELETE /v1/consent/:id (public/js/services/consent.js revokeConsent).
    const r = await json(`/v1/consent/${agentConsent}`, { method: 'DELETE', headers: auth(alice.token) });
    assert(r.status === 200, `revoke ${r.status} ${JSON.stringify(r.body?.error)}`);
    const w = await wallet(alice.token);
    const row = (w.consents.consents as any[]).find(c => c.id === agentConsent);
    assert(row?.status === 'revoked' && typeof row.revoked_at === 'string', `the wallet keeps it as revoked: ${JSON.stringify(row)}`);
});

await test('cleanup: alice\'s own consent is revoked', async () => {
    const r = await json(`/v1/consent/${ownConsent}`, { method: 'DELETE', headers: auth(alice.token) });
    assert(r.status === 200, `revoke ${r.status}`);
});

finish();
