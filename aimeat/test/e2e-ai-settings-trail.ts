/**
 * @file test/e2e-ai-settings-trail.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A change to the person's AI settings leaves a line on their account events, naming
 *   who applied it and which setting it was. An agent proposes a change to the routing, the model
 *   rules, the roles and the image rules, and applies each with the confirm token it got; after each
 *   one GET /v1/account/events holds an `ai_settings_changed` row whose actor is the agent and whose
 *   `changed` names the setting. A proposal alone writes no row, and the owner's own change names the
 *   owner.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=ai-settings-trail
 * @version-history
 *   v1.1.0 — 2026-11-19 — On the shared harness and test/helpers/agent-device.ts; an agent without
 *     memory:write-reserved is refused the change (403 SCOPE_DENIED) and no row is written.
 *   v1.0.0 — 2026-11-19 — Initial (feature audit 2026-11-19, report 2.3).
 */
import { registerOwner, ownerSignIn } from './helpers/owner-login.js';
import { BASE, assert, expectRefusal, finish, json as request, test } from './helpers/harness.js';
import { connectAgentByDevice } from './helpers/agent-device.js';

const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

/** The harness request, signed in with `token`. */
function json(path: string, token: string, opts: RequestInit = {}) {
    return request(path, { ...opts, headers: { Authorization: `Bearer ${token}`, ...(opts.headers as Record<string, string> | undefined) } });
}
const show = (r: { status: number; body: any }) => `${r.status} ${JSON.stringify(r.body?.error ?? r.body?.data ?? r.body).slice(0, 300)}`;

async function connectAgent(ownerName: string, ownerToken: string, agentName: string, scopes: string[]): Promise<string> {
    return (await connectAgentByDevice(BASE, { owner: ownerName, ownerToken, name: agentName, scopes })).token;
}

/** The four settings, each with its route, its body key and a change any account can make. */
const KINDS: Array<{ changed: string; path: string; key: string; value: Record<string, unknown> }> = [
    { changed: 'routing', path: '/v1/ai/routing', key: 'routing', value: { rules: { maxAttempts: 2 } } },
    { changed: 'model rules', path: '/v1/ai/policy', key: 'policy', value: { mode: 'open' } },
    { changed: 'roles', path: '/v1/ai/roles', key: 'roles', value: { roles: { 'trail-notes': { title: 'Notes', purpose: 'Drafts short notes' } } } },
    { changed: 'image rules', path: '/v1/ai/gen-rules', key: 'gen_rules', value: { rules: { 'people-artistic': false } } },
];

const stamp = Date.now().toString(36);
const ownerName = `aitrail${stamp}`;
const agentName = `trailbot${stamp}`;
let owner = '';
let agent = '';
const ownerGhii = `${ownerName}@${NODE_ID}`;
const agentGaii = `${agentName}#${ownerName}@${NODE_ID}`;

const events = async () => {
    const r = await json('/v1/account/events?limit=100', owner);
    assert(r.status === 200, `events ${show(r)}`);
    return (r.body.data.events as Array<{ kind: string; actorGaii: string; data: Record<string, string> }>).filter(e => e.kind === 'ai_settings_changed');
};

console.log('\n=== AIMEAT AI settings trail E2E ===\n');

await test('setup: an owner and an agent that administers the account', async () => {
    await registerOwner(BASE, ownerName);
    owner = (await ownerSignIn(BASE, ownerName)).body.data.token;
    agent = await connectAgent(ownerName, owner, agentName, ['ai:use', 'memory:read', 'memory:write-reserved']);
    assert(!!owner && !!agent, 'both have tokens');
});

for (const k of KINDS) {
    await test(`${k.changed}: a proposal writes no row; the agent's confirmed change writes one that names the agent`, async () => {
        const before = (await events()).length;
        const p = await json(k.path, agent, { method: 'PUT', body: JSON.stringify({ [k.key]: k.value }) });
        assert(p.status === 200 && p.body.data.mode === 'proposal' && typeof p.body.data.confirm_token === 'string', `proposal ${show(p)}`);
        assert((await events()).length === before, 'a proposal is not a change');
        const a = await json(k.path, agent, { method: 'PUT', body: JSON.stringify({ [k.key]: k.value, confirm_token: p.body.data.confirm_token }) });
        assert(a.status === 200 && a.body.data.mode === 'applied', `apply ${show(a)}`);
        const rows = await events();
        assert(rows.length === before + 1, `one new row, got ${rows.length - before}`);
        const row = rows.find(e => e.data?.changed === k.changed);
        assert(!!row && row.actorGaii === agentGaii && row.data.by === agentGaii, `the row names the agent and the setting: ${JSON.stringify(rows[0])}`);
    });
}

await test('the owner\'s own change names the owner, with no `by`', async () => {
    const r = await json('/v1/ai/routing', owner, { method: 'PUT', body: JSON.stringify({ routing: { rules: { maxAttempts: 3 } } }) });
    assert(r.status === 200 && r.body.data.mode === 'applied', `owner ${show(r)}`);
    const rows = await events();
    const newest = rows[0];
    assert(newest?.data?.changed === 'routing' && newest.actorGaii === ownerGhii && !newest.data.by, `newest: ${JSON.stringify(newest)}`);
});

await test('an agent of the owner without memory:write-reserved is refused the change, and no row is written', async () => {
    const reader = await connectAgent(ownerName, owner, `trailread${stamp}`, ['ai:use', 'memory:read']);
    const before = (await events()).length;
    const r = await json('/v1/ai/routing', reader, { method: 'PUT', body: JSON.stringify({ routing: { rules: { maxAttempts: 4 } } }) });
    expectRefusal(r, 403, 'SCOPE_DENIED');
    assert((await events()).length === before, 'a refused change writes no row');
});

finish();
