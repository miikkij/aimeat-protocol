/**
 * @file test/e2e-trail-recorded.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description E2E for the node's own record of what an agent did (services/place-trail.ts,
 *   services/usage/trail-summary.ts):
 *   - the owner's trail narrowed to one agent holds only that agent's calls, each with its time;
 *   - the summary counts the agent's calls and its refusal, with the reason;
 *   - the agent's activity answers recorded_by_node beside what the agent reported;
 *   - an actor of another account is refused, and another owner may not read the agent's activity.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=trail-recorded
 * @version-history
 *   v1.0.0 — 2026-11-26 — Initial (wish-a-trace-that-the-node-records-of-what-an-agent-or-app-did).
 */
import { BASE, assert, expectRefusal, finish, json, test } from './helpers/harness.js';
import { registerOwner } from './helpers/owner-login.js';
import { connectAgentByDevice } from './helpers/agent-device.js';

(async () => {
    console.log('\n── Trail: what the node itself recorded an agent doing ──');
    const alice = await registerOwner(BASE, `traila${Date.now()}`);
    const owner = { Authorization: `Bearer ${alice.token}` };
    const bot = await connectAgentByDevice(BASE, { owner: alice.name, ownerToken: alice.token, name: 'bot', scopes: ['memory:read', 'memory:write'] });
    const asBot = { Authorization: `Bearer ${bot.token}` };

    await test('setup: the agent writes two records and makes one write the node refuses', async () => {
        for (const k of ['a', 'b']) {
            const w = await json('/v1/memory', { method: 'POST', headers: asBot, body: JSON.stringify({ key: `trail.${k}`, value: { n: k } }) });
            assert(w.status === 201 || w.status === 200, `write ${k}: ${w.status} ${JSON.stringify(w.body?.error)}`);
        }
        const bad = await json('/v1/memory', { method: 'POST', headers: asBot, body: JSON.stringify({ value: { no: 'key' } }) });
        expectRefusal(bad, 400);
    });

    await test('the owner\'s trail narrowed to the agent holds only its calls, each with how long it took', async () => {
        const r = await json('/v1/build-with-you/trail?actor=bot&limit=50', { headers: owner });
        assert(r.status === 200, `trail: ${r.status} ${JSON.stringify(r.body?.error)}`);
        const entries = r.body.data.entries as Array<{ actor: string; code: string; ms?: number }>;
        assert(entries.length >= 2 && entries.every(e => e.actor.startsWith('bot#')), `only the agent: ${JSON.stringify(entries.map(e => e.actor))}`);
        assert(entries.some(e => e.code === 'POST /v1/memory' && typeof e.ms === 'number'), `a write with its time: ${JSON.stringify(entries.slice(0, 3))}`);
    });

    await test('the summary counts the agent\'s calls and its refusal, with the reason', async () => {
        const r = await json('/v1/build-with-you/trail?actor=bot&summary=true', { headers: owner });
        assert(r.status === 200, `summary: ${r.status} ${JSON.stringify(r.body?.error)}`);
        const s = r.body.data.summary;
        assert(s.calls >= 3 && s.ok >= 2 && s.refused + s.error >= 1, `counts: ${JSON.stringify(s)}`);
        assert(s.top.some((t: any) => t.code === 'POST /v1/memory' && t.calls >= 3 && t.failed >= 1), `top: ${JSON.stringify(s.top)}`);
        assert(s.reasons.length >= 1, `a reason is named: ${JSON.stringify(s.reasons)}`);
    });

    await test('the agent\'s activity answers recorded_by_node beside what it reported', async () => {
        const r = await json('/v1/agents/bot/activity', { headers: owner });
        assert(r.status === 200, `activity: ${r.status} ${JSON.stringify(r.body?.error)}`);
        const rec = r.body.data.recorded_by_node;
        assert(rec && rec.summary.calls >= 3 && String(rec.note).includes('Recorded by the node'), `recorded_by_node: ${JSON.stringify(rec)}`);
    });

    await test('an actor of another account is refused, and another owner may not read the agent\'s activity', async () => {
        expectRefusal(await json('/v1/build-with-you/trail?actor=bot%23someoneelse%40elsewhere', { headers: owner }), 400, 'INVALID_INPUT');
        const bob = await registerOwner(BASE, `trailb${Date.now()}`);
        // Alice's agent by its full name: `bot` alone would name an agent of bob's own.
        const node = alice.ghii.slice(alice.ghii.indexOf('@') + 1);
        const alicesBot = encodeURIComponent(`bot#${alice.name}@${node}`);
        const r = await json(`/v1/agents/${alicesBot}/activity`, { headers: { Authorization: `Bearer ${bob.token}` } });
        const theirs = await json(`/v1/build-with-you/trail?actor=${encodeURIComponent(`bot#${alice.name}`)}`, { headers: { Authorization: `Bearer ${bob.token}` } });
        assert(theirs.status === 400, `bob cannot name alice's agent: ${theirs.status} ${JSON.stringify(theirs.body?.error)}`);
        assert(r.status === 403, `bob does not get alice's agent: ${r.status} ${JSON.stringify(r.body?.error)}`);
        assert(!JSON.stringify(r.body).includes('trail.a'), 'nothing of alice\'s agent reaches bob');
    });

    finish();
})();
