/**
 * @file e2e-work-owner-acts.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A person acts in person for their own agent on the work it requested or provides,
 *   as the Work tab offers: accept, reject, progress and deliver as the provider agent's owner, rate
 *   as the requester agent's owner. The agent itself works as before, and the other party, the other
 *   party's agent and the other party's owner are refused. An empty delivery text is a valid delivery
 *   ({ text: "" }, what the portal sends), and the requester's sent list carries the delivered output.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-work-owner-acts
 * @version-history
 *   v1.0.0 — 2026-11-15 — Initial.
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
import { assert, BASE, expectRefusal, finish, json, test } from './helpers/harness.js';
import { registerOwner } from './helpers/owner-login.js';

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

async function signMsg(privateKeyB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privateKeyB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}

const stamp = Date.now();
const ACTION = 'owner-acts-action';
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

// alice owns the provider agent, bob owns the requester agent.
let alice = '';
let bob = '';
let aliceAgent = { gaii: '', token: '' };
let bobAgent = { gaii: '', token: '' };

async function agentOf(ownerName: string, ownerTok: string, name: string, capabilities: string[]): Promise<{ gaii: string; token: string }> {
    const made = await json('/v1/agents', {
        method: 'POST', headers: auth(ownerTok),
        body: JSON.stringify({ name, owner: ownerName, capabilities, model: 'gpt-4o' }),
    });
    assert(made.status === 201, `agent ${name}: ${made.status} ${JSON.stringify(made.body?.error)}`);
    const gaii = made.body.data.agent.gaii as string;
    const timestamp = new Date().toISOString();
    const signature = await signMsg(made.body.data.private_key, gaii + timestamp);
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ gaii, timestamp, signature }) });
    assert(tok.body?.ok === true, `token ${name}: ${JSON.stringify(tok.body?.error)}`);
    return { gaii, token: tok.body.data.token };
}

/** bob's agent asks alice's agent for work; returns the tracking code. */
async function requested(): Promise<string> {
    const r = await json('/v1/work/request', {
        method: 'POST', headers: auth(bobAgent.token),
        body: JSON.stringify({ action_id: ACTION, provider_gaii: aliceAgent.gaii, input: { text: 'hello' } }),
    });
    assert(r.status === 201, `work request: ${r.status} ${JSON.stringify(r.body?.error)}`);
    return r.body.data.tracking_code as string;
}

const post = (path: string, token: string, body?: unknown) =>
    json(path, { method: 'POST', headers: auth(token), ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

console.log('\n=== A person acts for their own agent on its work ===\n');

await test('setup: alice with a provider agent, bob with a requester agent', async () => {
    const a = await registerOwner(BASE, `ownactsa${stamp}`);
    const b = await registerOwner(BASE, `ownactsb${stamp}`);
    alice = a.token;
    bob = b.token;
    aliceAgent = await agentOf(a.name, alice, 'doer', ['work', 'actions']);
    bobAgent = await agentOf(b.name, bob, 'asker', ['work']);
    const action = await post('/v1/actions', aliceAgent.token, {
        id: ACTION, display_name: 'Owner Acts Action', description: 'Action for the owner rule',
        input_schema: { type: 'object' }, output_schema: { type: 'object' }, pricing: { toll_morsels: 1 },
    });
    assert(action.status === 201, `action: ${action.status} ${JSON.stringify(action.body?.error)}`);
});

await test('1. bob and bob\'s agent cannot accept alice\'s agent\'s work; alice in person accepts it', async () => {
    const tc = await requested();
    const byBob = await post(`/v1/work/${tc}/accept`, bob);
    expectRefusal(byBob, 403, 'ACCESS_DENIED');
    const byBobAgent = await post(`/v1/work/${tc}/accept`, bobAgent.token);
    expectRefusal(byBobAgent, 403, 'ACCESS_DENIED');
    const byAlice = await post(`/v1/work/${tc}/accept`, alice);
    assert(byAlice.status === 200, `alice accepts: ${byAlice.status} ${JSON.stringify(byAlice.body?.error)}`);
});

await test('2. alice in person starts and delivers her agent\'s work, an empty text included; bob and his agent cannot', async () => {
    const tc = await requested();
    assert((await post(`/v1/work/${tc}/accept`, alice)).status === 200, 'accept');
    const progressByBob = await post(`/v1/work/${tc}/progress`, bob);
    expectRefusal(progressByBob, 403, 'ACCESS_DENIED');
    const progress = await post(`/v1/work/${tc}/progress`, alice);
    assert(progress.status === 200, `alice starts it: ${progress.status} ${JSON.stringify(progress.body?.error)}`);
    const byBob = await post(`/v1/work/${tc}/deliver`, bob, { output: { text: 'x' } });
    expectRefusal(byBob, 403, 'ACCESS_DENIED');
    const byBobAgent = await post(`/v1/work/${tc}/deliver`, bobAgent.token, { output: { text: 'x' } });
    expectRefusal(byBobAgent, 403, 'ACCESS_DENIED');
    // What the portal sends for an empty text area.
    const byAlice = await post(`/v1/work/${tc}/deliver`, alice, { output: { text: '' } });
    assert(byAlice.status === 200, `alice delivers: ${byAlice.status} ${JSON.stringify(byAlice.body?.error)}`);
    assert(byAlice.body.data.status === 'delivered' && byAlice.body.data.output?.text === '', `delivered with an empty text: ${JSON.stringify(byAlice.body.data)}`);

    // The requester's sent list, and the Work tab's overview, carry what was delivered.
    const sent = await json('/v1/work/sent', { headers: auth(bob) });
    const row = (sent.body?.data?.items ?? []).find((w: any) => w.tracking_code === tc);
    assert(row && row.output && row.output.text === '', `the sent list carries the output: ${JSON.stringify(row)}`);
    const ov = await json('/v1/work/overview', { headers: auth(bob) });
    const ovRow = (ov.body?.data?.sent ?? []).find((w: any) => w.tracking_code === tc);
    assert(ovRow && ovRow.output && ovRow.output.text === '', `the overview carries the output: ${JSON.stringify(ovRow)}`);

    // bob in person rates his agent's delivered work; alice and her agent cannot.
    const rateByAlice = await post(`/v1/work/${tc}/rate`, alice, { rating: 'positive' });
    expectRefusal(rateByAlice, 403, 'ACCESS_DENIED');
    const rateByAliceAgent = await post(`/v1/work/${tc}/rate`, aliceAgent.token, { rating: 'positive' });
    expectRefusal(rateByAliceAgent, 403, 'ACCESS_DENIED');
    const rate = await post(`/v1/work/${tc}/rate`, bob, { rating: 'positive', comment: 'thanks' });
    assert(rate.status === 200, `bob rates: ${rate.status} ${JSON.stringify(rate.body?.error)}`);
});

await test('3. alice in person declines her agent\'s work; bob cannot', async () => {
    const tc = await requested();
    const byBob = await post(`/v1/work/${tc}/reject`, bob, { reason: 'no' });
    expectRefusal(byBob, 403, 'ACCESS_DENIED');
    const byAlice = await post(`/v1/work/${tc}/reject`, alice, { reason: 'Not this week' });
    assert(byAlice.status === 200 && byAlice.body.data.status === 'cancelled', `alice declines: ${byAlice.status} ${JSON.stringify(byAlice.body?.error ?? byAlice.body?.data)}`);
});

await test('4. KEPT: the agents themselves accept, deliver and rate as before', async () => {
    const tc = await requested();
    assert((await post(`/v1/work/${tc}/accept`, aliceAgent.token)).status === 200, 'the provider agent accepts');
    const del = await post(`/v1/work/${tc}/deliver`, aliceAgent.token, { output: { text: 'done' } });
    assert(del.status === 200, `the provider agent delivers: ${del.status} ${JSON.stringify(del.body?.error)}`);
    const rate = await post(`/v1/work/${tc}/rate`, bobAgent.token, { rating: 'positive' });
    assert(rate.status === 200, `the requester agent rates: ${rate.status} ${JSON.stringify(rate.body?.error)}`);
});

finish();
