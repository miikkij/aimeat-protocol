/**
 * @file test/e2e-disputes-operator.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The operator's side of a work dispute: the list of what waits for a ruling
 *   (GET /v1/admin/disputes), one dispute with its audit trail (GET /v1/admin/disputes/:id), a party
 *   refused both, and a ruling through the MCP tool aimeat_admin_dispute_rule that moves the morsels and
 *   takes the dispute off the list. The REST ruling's money rules are e2e-disputes.ts.
 * @structure setup (operator, provider owner, two agents) · escalatedDispute() · tests · finish()
 * @usage pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=disputes-operator
 * @version-history
 *   v1.0.0 — 2026-11-15 — Initial (wish-ilmoitus-vie-jonnekin-ja-sen-tekstin-voi-kopioida): an operator
 *     told that a dispute waits could rule it only with a hand-written REST call.
 */
import { assert, expectRefusal, finish, json, test, BASE } from './helpers/harness.js';
import { registerOwner, type RegisteredOwner } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool, type McpAgent, type McpSession } from './helpers/mcp-session.js';

const STAMP = Date.now().toString(36);
let op: RegisteredOwner;
let prov: RegisteredOwner;
let requester: McpAgent;
let provider: McpAgent;
let opAdmin: McpSession;
const TOLL = 10;

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const balance = async (token: string) => Number((await json('/v1/wallet', { headers: auth(token) })).body.data.balance);

/** A delivered work item whose dispute the requester opened and escalated to the operator. */
async function escalatedDispute(): Promise<{ tc: string; id: string }> {
    const sub = await json('/v1/work', {
        method: 'POST', headers: auth(requester.token),
        body: JSON.stringify({ action_id: 'disp-op-action', provider_gaii: provider.gaii, input: { text: 'x' } }),
    });
    assert(sub.body.ok, `work submit: ${JSON.stringify(sub.body.error)}`);
    const tc = sub.body.data.tracking_code as string;
    for (const [step, body] of [['accept', undefined], ['deliver', { output: { result: 'y' } }]] as const) {
        const r = await json(`/v1/work/${tc}/${step}`, { method: 'POST', headers: auth(provider.token), body: body ? JSON.stringify(body) : undefined });
        assert(r.body.ok, `work ${step}: ${JSON.stringify(r.body.error)}`);
    }
    const open = await json(`/v1/work/${tc}/dispute`, { method: 'POST', headers: auth(requester.token), body: JSON.stringify({ reason: 'The output is wrong' }) });
    assert(open.status === 201, `dispute: ${open.status} ${JSON.stringify(open.body.error)}`);
    const esc = await json(`/v1/work/${tc}/escalate`, { method: 'POST', headers: auth(requester.token) });
    assert(esc.status === 200, `escalate: ${esc.status} ${JSON.stringify(esc.body.error)}`);
    return { tc, id: open.body.data.dispute_id as string };
}

console.log('\n=== The operator\'s disputes: list, one, refusals, ruling over MCP ===\n');

let first: { tc: string; id: string };
let second: { tc: string; id: string };

await test('Setup: the operator, a provider owner, a requester and a provider agent, two escalated disputes', async () => {
    op = await registerOwner(BASE, `dispop${STAMP}`);
    prov = await registerOwner(BASE, `dispopprov${STAMP}`);
    assert(op.roles.includes('operator'), `the first owner must be the operator, roles ${op.roles.join(',')}`);
    requester = await makeAgent(BASE, op, ['*'], 'requester');
    provider = await makeAgent(BASE, prov, ['*'], 'provider');
    opAdmin = await openSession(BASE, (await makeAgent(BASE, op, ['operator:admin'])).token, 'op-admin');
    const act = await json('/v1/actions', {
        method: 'POST', headers: auth(provider.token),
        body: JSON.stringify({
            id: 'disp-op-action', display_name: 'Dispute operator action', description: 'For the operator dispute suite',
            input_schema: { type: 'object', properties: { text: { type: 'string' } } },
            output_schema: { type: 'object', properties: { result: { type: 'string' } } },
            pricing: { toll_morsels: TOLL },
        }),
    });
    assert(act.status === 201, `action: ${act.status} ${JSON.stringify(act.body.error)}`);
    first = await escalatedDispute();
    second = await escalatedDispute();
});

await test('The list holds both escalated disputes, with what delivery paid and both parties', async () => {
    const { status, body } = await json('/v1/admin/disputes', { headers: auth(op.token) });
    assert(status === 200, `status ${status}: ${JSON.stringify(body.error)}`);
    const row = body.data.disputes.find((d: any) => d.id === first.id);
    assert(row?.id === first.id, `dispute ${first.id} not listed: ${JSON.stringify(body.data.disputes.map((d: any) => d.id))}`);
    assert(row.tracking_code === first.tc && row.status === 'escalated', `row: ${JSON.stringify(row)}`);
    assert(row.paid_morsels === TOLL, `paid_morsels ${row.paid_morsels}, the toll is ${TOLL}`);
    assert(row.requester === requester.gaii && row.provider === provider.gaii, `parties: ${row.requester} / ${row.provider}`);
    assert(row.timed_out === false && typeof row.waits_since === 'string', `wait: ${JSON.stringify(row)}`);
    assert(body.data.disputes.some((d: any) => d.id === second.id), 'the second escalated dispute is missing');
});

await test('One dispute carries its audit trail; an unknown id is NOT_FOUND', async () => {
    const { status, body } = await json(`/v1/admin/disputes/${first.id}`, { headers: auth(op.token) });
    assert(status === 200 && body.data.dispute.id === first.id, `status ${status}: ${JSON.stringify(body)}`);
    const events = body.data.entries.map((e: any) => e.event);
    assert(events.includes('dispute_opened') && events.includes('escalated'), `events: ${events.join(',')}`);
    expectRefusal(await json('/v1/admin/disputes/no-such-dispute', { headers: auth(op.token) }), 404, 'NOT_FOUND');
});

await test('A party to the dispute is refused the list and the dispute; an unknown reading is refused', async () => {
    for (const path of ['/v1/admin/disputes', `/v1/admin/disputes/${first.id}`]) {
        const r = await json(path, { headers: auth(requester.token) });
        assert(r.status === 403, `${path} as the requester's agent: ${r.status}`);
    }
    expectRefusal(await json('/v1/admin/disputes?status=everything', { headers: auth(op.token) }), 400, 'INVALID_INPUT');
});

await test('The operator rules over MCP: the requester gets its share back from the provider, and the dispute leaves the list', async () => {
    const reqBefore = await balance(requester.token);
    const provBefore = await balance(provider.token);
    const tooMuch = await callTool(opAdmin, 'aimeat_admin_dispute_rule', { id: first.id, ruling: 'split', to_requester: TOLL + 1 });
    assert(tooMuch.isError && /RULING_EXCEEDS_ESCROW/.test(tooMuch.text), `above the toll: ${tooMuch.text.slice(0, 200)}`);
    const r = await callTool(opAdmin, 'aimeat_admin_dispute_rule', { id: first.id, ruling: 'split', to_requester: 6, burned: 1, reason: 'Half done' });
    assert(!r.isError && r.data.status === 'resolved', `ruling: ${r.text.slice(0, 300)}`);
    assert(r.data.ruling.distribution.to_provider === TOLL - 7, `kept by the provider: ${JSON.stringify(r.data.ruling)}`);
    assert(await balance(requester.token) - reqBefore === 6, 'the requester did not get its 6 back');
    assert(provBefore - await balance(provider.token) === 7, 'the provider did not give up 6 and the burned 1');
    const again = await callTool(opAdmin, 'aimeat_admin_dispute_rule', { id: first.id, ruling: 'split' });
    assert(again.isError && /DISPUTE_CLOSED/.test(again.text), `a second ruling: ${again.text.slice(0, 200)}`);
    const list = await callTool(opAdmin, 'aimeat_admin_disputes', {});
    assert(!list.data.disputes.some((d: any) => d.id === first.id), 'the ruled dispute is still listed as waiting');
    assert(list.data.disputes.some((d: any) => d.id === second.id), 'the other dispute left the list too');
    const all = await json('/v1/admin/disputes?status=all', { headers: auth(op.token) });
    assert(all.body.data.disputes.some((d: any) => d.id === first.id && d.status === 'resolved'), 'status=all does not hold the ruled one');
});

finish();
