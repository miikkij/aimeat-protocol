/**
 * @file test/e2e-home-waiting.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What waits for the person, end to end: GET /v1/home/waiting and aimeat_home_waiting
 *   (services/home/waiting.ts). A fresh account has nothing waiting and every kind at zero. After a
 *   second owner writes to the first and invites them to an organism, and the first owner's agent
 *   proposes an agent, the items are there with their kind, group, page and one-press links, decide
 *   before answer before look; approving the proposal through its own `decide.approve` link takes it
 *   off the list; the limit stops the items and not the counts.
 *
 *   THE REFUSALS ARE HALF OF IT. The second owner never sees the first owner's items; no credential
 *   is 401; an agent without memory:read is refused on REST and MCP; an agent holding memory:read
 *   reads only the kinds its words cover, and is told which ones it could not read.
 * @usage pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=home-waiting
 * @version-history
 *   v1.1.0 — 2026-11-26 — The kinds approval and join_request: in the list of the person who can
 *     decide them, absent for a person who only asked and for a member whose role does not decide,
 *     withheld from an agent without organism:read, gone once decided.
 *   v1.0.0 — 2026-11-25 — Initial.
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
import { registerOwner, type RegisteredOwner } from './helpers/owner-login.js';
import { BASE, test, assert, json, finish } from './helpers/harness.js';

const KINDS = ['agent_proposal', 'agent_sign_in', 'invitation', 'publish_request', 'reply', 'help_question', 'workflow_input', 'team', 'open_item', 'unread', 'approval', 'join_request'];

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());
async function sign(privB64: string, msg: string): Promise<string> {
    return Buffer.from(await ed.signAsync(new TextEncoder().encode(msg), Buffer.from(privB64, 'base64'))).toString('base64');
}
const auth = (tok: string) => ({ Authorization: `Bearer ${tok}` });

/** An agent of `o` with exactly `scopes`, and a token of its own. */
async function agentWith(o: RegisteredOwner, name: string, scopes: string[]) {
    const ag = await json('/v1/agents', {
        method: 'POST', headers: auth(o.token),
        body: JSON.stringify({ name, owner: o.name, capabilities: [], mode: 'interactive', scopes }),
    });
    assert(ag.status === 201, `agent ${ag.status}: ${JSON.stringify(ag.body?.error)}`);
    const gaii = ag.body.data.agent.gaii as string;
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST', body: JSON.stringify({ gaii, timestamp: ts, signature: await sign(ag.body.data.private_key, gaii + ts) }),
    });
    assert(tok.status === 200, `agent token ${tok.status}`);
    return { name, gaii, token: tok.body.data.token as string };
}

async function mcpSession(token: string) {
    let sid: string | undefined;
    let id = 0;
    const rpc = async (method: string, params: Record<string, unknown> = {}) => {
        const res = await fetch(`${BASE}/v1/mcp`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${token}`,
                ...(sid ? { 'mcp-session-id': sid, 'mcp-protocol-version': '2025-03-26' } : {}),
            },
            body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
        });
        sid = res.headers.get('mcp-session-id') ?? sid;
        const text = await res.text();
        const line = text.split('\n').find(l => l.startsWith('data: '));
        return JSON.parse(line ? line.slice(6) : text);
    };
    await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'e2e-home-waiting', version: '1' } });
    return async (name: string, args: Record<string, unknown>) => {
        const body = await rpc('tools/call', { name, arguments: args });
        const t = body?.result?.content?.[0]?.text ?? JSON.stringify(body?.error ?? body);
        return { isError: body?.result?.isError === true || !!body?.error, text: t as string };
    };
}

const waiting = (tok: string, q = '') => json(`/v1/home/waiting${q}`, { headers: auth(tok) });

(async () => {
    console.log('\n  e2e-home-waiting\n');
    const stamp = Date.now().toString(36);
    const alice = await registerOwner(BASE, `hwalice${stamp}`, { displayName: 'Alice Waiting' });
    const bob = await registerOwner(BASE, `hwbob${stamp}`, { displayName: 'Bob Writer' });
    const scout = await agentWith(alice, 'scout', ['memory:read', 'memory:write']);
    const bare = await agentWith(alice, 'bare', ['organism:read']);
    let proposalId = '';
    let orgId = '';

    await test('a fresh account has nothing waiting, and every kind is there at zero', async () => {
        const r = await waiting(alice.token);
        assert(r.status === 200, `status ${r.status}: ${JSON.stringify(r.body?.error)}`);
        const d = r.body.data;
        assert(d.total === 0, `total ${d.total}: ${JSON.stringify(d.items)}`);
        assert(Array.isArray(d.items) && d.items.length === 0, `items ${JSON.stringify(d.items)}`);
        assert(JSON.stringify(Object.keys(d.by_kind).sort()) === JSON.stringify([...KINDS].sort()), `kinds ${JSON.stringify(d.by_kind)}`);
        assert(Object.values(d.by_kind).every(v => v === 0), `counts ${JSON.stringify(d.by_kind)}`);
        assert(d.withheld === undefined && d.partial === undefined, `withheld ${d.withheld} partial ${d.partial}`);
        assert(typeof d.note === 'string' && d.note.includes('act_with'), `note ${d.note}`);
    });

    await test('setup: bob writes to alice and she takes the thread, alice\'s agent proposes an agent, bob invites her to an organism', async () => {
        const sent = await json('/v1/messages', { method: 'POST', headers: auth(bob.token), body: JSON.stringify({ to: alice.ghii, body: 'Hello Alice, can you look at the plan before Friday?' }) });
        assert(sent.status === 201, `send ${sent.status}: ${JSON.stringify(sent.body?.error)}`);
        const acc = await json(`/v1/messages/requests/${encodeURIComponent(bob.ghii)}/accept`, { method: 'POST', headers: auth(alice.token) });
        assert(acc.status === 200, `accept ${acc.status}: ${JSON.stringify(acc.body?.error)}`);
        const p = await json('/v1/agents/v2/agent-proposals', {
            method: 'POST', headers: auth(scout.token),
            body: JSON.stringify({ name: 'digest', display_name: 'Morning digest', purpose: 'Reads the news every morning and writes a short summary.', scopes: ['memory:read'] }),
        });
        assert(p.status === 201, `propose ${p.status}: ${JSON.stringify(p.body?.error)}`);
        proposalId = p.body.data.proposal.id;
        const o = await json('/v1/organisms', { method: 'POST', headers: auth(bob.token), body: JSON.stringify({ name: 'Plan desk', description: 'Where the plan is kept', type: 'project', join_policy: 'invite', visibility: 'private' }) });
        assert(o.status === 201, `org ${o.status}: ${JSON.stringify(o.body?.error)}`);
        orgId = o.body.data.organism.id;
        const inv = await json(`/v1/organisms/${orgId}/invitations`, { method: 'POST', headers: auth(bob.token), body: JSON.stringify({ invitee: alice.name }) });
        assert(inv.status === 201, `invite ${inv.status}: ${JSON.stringify(inv.body?.error)}`);
    });

    await test('the items are there with their kind, group, page and one-press links, decide before answer before look', async () => {
        const r = await waiting(alice.token);
        assert(r.status === 200, `status ${r.status}`);
        const d = r.body.data;
        const of = (kind: string) => d.items.filter((i: any) => i.kind === kind);
        const [prop] = of('agent_proposal');
        assert(prop && prop.id === proposalId && prop.group === 'decide', `proposal ${JSON.stringify(prop)}`);
        assert(prop.subject === 'Morning digest' && prop.from === 'scout', `proposal names ${JSON.stringify(prop)}`);
        assert(prop.href === `/v1/home?new-agent=1&proposal=${encodeURIComponent(proposalId)}`, `proposal href ${prop.href}`);
        assert(prop.decide?.approve?.method === 'POST' && prop.decide.approve.url === `/v1/agents/v2/agent-proposals/${encodeURIComponent(proposalId)}/approve`, `approve ${JSON.stringify(prop.decide)}`);
        assert(prop.decide.decline.url === `/v1/agents/v2/agent-proposals/${encodeURIComponent(proposalId)}/decline`, `decline ${JSON.stringify(prop.decide)}`);
        const [inv] = of('invitation');
        assert(inv && inv.id === orgId && inv.group === 'decide' && inv.subject === 'Plan desk' && inv.from === 'Bob Writer', `invitation ${JSON.stringify(inv)}`);
        assert(inv.href === '/v1/profile?tab=organisms' && inv.act_with === 'aimeat_organism_invitation_respond', `invitation page ${JSON.stringify(inv)}`);
        assert(inv.decide?.approve?.url === `/v1/organisms/${encodeURIComponent(orgId)}/invitations/accept` && inv.decide.decline.url === `/v1/organisms/${encodeURIComponent(orgId)}/invitations/decline`, `invitation links ${JSON.stringify(inv.decide)}`);
        const [reply] = of('reply');
        assert(reply && reply.group === 'answer' && reply.from === 'Bob Writer' && /plan before Friday/.test(reply.detail ?? ''), `reply ${JSON.stringify(reply)}`);
        assert(reply.href === '/v1/profile?tab=messages' && reply.act_with === 'aimeat_dm_send_as_owner' && !reply.decide, `reply page ${JSON.stringify(reply)}`);
        const [unread] = of('unread');
        assert(unread && unread.group === 'look' && unread.count >= 1 && unread.href === '/v1/profile?tab=messages', `unread ${JSON.stringify(unread)}`);
        const rank: Record<string, number> = { decide: 0, answer: 1, look: 2 };
        const ranks = d.items.map((i: any) => rank[i.group]);
        assert(ranks.every((r: number, i: number) => i === 0 || ranks[i - 1] <= r), `order ${d.items.map((i: any) => i.group).join(',')}`);
        assert(d.by_kind.agent_proposal === 1 && d.by_kind.invitation === 1 && d.by_kind.reply === 1, `by_kind ${JSON.stringify(d.by_kind)}`);
        // total is what needs a yes, a no or words; the counts to open stand apart in to_open, because
        // they repeat it (the proposal made an open item, the waiting thread holds the unread message).
        const sum = Object.values(d.by_kind as Record<string, number>).reduce((n, v) => n + v, 0);
        const looks = d.items.filter((i: any) => i.group === 'look').reduce((n: number, i: any) => n + (i.count ?? 1), 0);
        assert(d.to_open === looks && looks >= 1, `to_open ${d.to_open} is the sum of the look counts ${looks}`);
        assert(d.total === sum - looks && d.total >= 3, `total ${d.total} is the decide and answer items, ${sum} - ${looks}`);
    });

    await test('the limit stops the items, never the counts; out of range is clamped as GET /v1/home/agents clamps it', async () => {
        const all = (await waiting(alice.token)).body.data;
        const one = await waiting(alice.token, '?limit=1');
        assert(one.status === 200 && one.body.data.items.length === 1 && one.body.data.total === all.total && one.body.data.to_open === all.to_open, `limit=1 ${JSON.stringify(one.body.data?.items?.length)} ${one.body.data?.total} ${one.body.data?.to_open}`);
        assert(one.body.data.items[0].group === 'decide', `the first item is a decision: ${JSON.stringify(one.body.data.items[0])}`);
        for (const q of ['?limit=0', '?limit=-3', '?limit=abc', '?limit=999']) {
            const r = await waiting(alice.token, q);
            assert(r.status === 200 && r.body.data.items.length === all.items.length && r.body.data.items.length <= 50, `${q}: ${r.status} ${r.body.data?.items?.length}`);
        }
    });

    await test('approving the proposal through its own decide.approve link takes it off the list', async () => {
        const d = (await waiting(alice.token)).body.data;
        const prop = d.items.find((i: any) => i.kind === 'agent_proposal');
        const r = await json(prop.decide.approve.url, { method: prop.decide.approve.method, headers: auth(alice.token), body: '{}' });
        assert(r.status === 200, `approve ${r.status}: ${JSON.stringify(r.body?.error)}`);
        const after = (await waiting(alice.token)).body.data;
        assert(!after.items.some((i: any) => i.kind === 'agent_proposal'), `still listed: ${JSON.stringify(after.items)}`);
        assert(after.by_kind.agent_proposal === 0, `by_kind ${JSON.stringify(after.by_kind)}`);
    });

    await test('ISOLATION: bob never sees alice\'s items', async () => {
        const r = await waiting(bob.token);
        assert(r.status === 200, `status ${r.status}`);
        const text = JSON.stringify(r.body.data);
        assert(!text.includes(proposalId) && !r.body.data.items.some((i: any) => i.kind === 'agent_proposal' || i.kind === 'invitation'), `bob sees: ${text.slice(0, 400)}`);
        assert(r.body.data.by_kind.agent_proposal === 0 && r.body.data.by_kind.invitation === 0, `bob's counts ${JSON.stringify(r.body.data.by_kind)}`);
    });

    await test('DENIAL: no credential is 401', async () => {
        const r = await json('/v1/home/waiting');
        assert(r.status === 401, `status ${r.status}`);
    });

    await test('DENIAL: an agent without memory:read is refused on REST and MCP', async () => {
        const r = await waiting(bare.token);
        assert(r.status === 403, `REST ${r.status}`);
        const call = await mcpSession(bare.token);
        const m = await call('aimeat_home_waiting', {});
        assert(m.isError, `MCP answered: ${m.text.slice(0, 200)}`);
    });

    await test('an agent holding memory:read reads the kinds its words cover, is told which it could not, and MCP answers what REST answers', async () => {
        const r = await waiting(scout.token);
        assert(r.status === 200, `status ${r.status}: ${JSON.stringify(r.body?.error)}`);
        const d = r.body.data;
        for (const k of ['reply', 'unread', 'invitation', 'open_item', 'workflow_input', 'team', 'help_question']) {
            assert(d.withheld?.includes(k), `${k} should be withheld: ${JSON.stringify(d.withheld)}`);
            assert(!(k in d.by_kind), `${k} counted for the agent: ${JSON.stringify(d.by_kind)}`);
        }
        assert(!d.items.some((i: any) => i.kind === 'reply' || i.kind === 'invitation'), `the agent sees ${JSON.stringify(d.items)}`);
        assert('agent_proposal' in d.by_kind && 'publish_request' in d.by_kind, `the kinds its words cover ${JSON.stringify(d.by_kind)}`);
        const call = await mcpSession(scout.token);
        const m = await call('aimeat_home_waiting', { limit: 5 });
        assert(!m.isError, `MCP: ${m.text.slice(0, 200)}`);
        const v = JSON.parse(m.text);
        assert(v.total === d.total && JSON.stringify(v.by_kind) === JSON.stringify(d.by_kind) && JSON.stringify(v.withheld) === JSON.stringify(d.withheld), `MCP ${m.text.slice(0, 300)} vs REST ${JSON.stringify(d).slice(0, 300)}`);
    });

    // ── An organism's approvals and join requests: the two kinds the Settings overview listed alone
    //    until 2026-11-26 (GET /v1/organisms/waiting), now in the one list. ──
    let deskId = '';
    let joinRequestId = '';
    let approvalId = '';

    await test('an approval alice can decide and a request to join her organism are in her list, each with its page and its tool', async () => {
        const before = (await waiting(alice.token)).body.data;
        const o = await json('/v1/organisms', { method: 'POST', headers: auth(alice.token), body: JSON.stringify({ name: 'Front desk', description: 'Where visitors ask', type: 'project', join_policy: 'approval_required', visibility: 'public' }) });
        assert(o.status === 201, `org ${o.status}: ${JSON.stringify(o.body?.error)}`);
        deskId = o.body.data.organism.id;
        const j = await json(`/v1/organisms/${deskId}/join`, { method: 'POST', headers: auth(bob.token), body: JSON.stringify({ message: 'I answer the phones on Fridays.' }) });
        assert(j.status === 202, `join ${j.status}: ${JSON.stringify(j.body)}`);
        const a = await json(`/v1/organisms/${deskId}/approvals`, { method: 'POST', headers: auth(alice.token), body: JSON.stringify({ action: 'external-release', risk: 'low' }) });
        assert(a.status === 201 && a.body.data.gated === true, `approval ${a.status}: ${JSON.stringify(a.body?.data ?? a.body?.error)}`);
        approvalId = a.body.data.approval.id;

        const d = (await waiting(alice.token)).body.data;
        const jr = d.items.find((i: any) => i.kind === 'join_request');
        assert(jr && jr.group === 'decide' && jr.from === 'Bob Writer' && jr.subject === 'Front desk' && jr.detail === 'I answer the phones on Fridays.', `join request ${JSON.stringify(jr)}`);
        assert(jr.href === `/v1/profile?tab=organisms&org=${encodeURIComponent(deskId)}` && jr.act_with === 'aimeat_organism_join_request_review' && !jr.decide, `join request page ${JSON.stringify(jr)}`);
        joinRequestId = jr.id;
        const ap = d.items.find((i: any) => i.kind === 'approval');
        assert(ap && ap.group === 'decide' && ap.count === 1 && ap.from === 'Front desk' && ap.subject === 'Front desk', `approval ${JSON.stringify(ap)}`);
        assert(ap.href === `/v1/profile?tab=organisms&org=${encodeURIComponent(deskId)}` && ap.act_with === 'aimeat_organism_approvals' && !ap.decide, `approval page ${JSON.stringify(ap)}`);
        assert(d.by_kind.join_request === 1 && d.by_kind.approval === 1, `by_kind ${JSON.stringify(d.by_kind)}`);
        assert(d.total === before.total + 2, `total ${before.total} -> ${d.total}`);
    });

    await test('ISOLATION: bob, who only asked to join, sees neither; an agent without organism:read is told both are withheld', async () => {
        const b = (await waiting(bob.token)).body.data;
        assert(b.by_kind.join_request === 0 && b.by_kind.approval === 0, `bob's counts ${JSON.stringify(b.by_kind)}`);
        assert(!JSON.stringify(b).includes(deskId), `bob sees the organism: ${JSON.stringify(b.items).slice(0, 300)}`);
        const s = (await waiting(scout.token)).body.data;
        for (const k of ['approval', 'join_request']) {
            assert(s.withheld?.includes(k) && !(k in s.by_kind), `${k} for the agent: withheld ${JSON.stringify(s.withheld)} by_kind ${JSON.stringify(s.by_kind)}`);
        }
        assert(!s.items.some((i: any) => i.kind === 'approval' || i.kind === 'join_request'), `the agent sees ${JSON.stringify(s.items)}`);
    });

    await test('EDGE: once bob is a member, the approval that needs the owner is not his to decide, and the request leaves alice\'s list', async () => {
        const rev = await json(`/v1/organisms/${deskId}/join-requests/${joinRequestId}/review`, { method: 'POST', headers: auth(alice.token), body: JSON.stringify({ decision: 'approved' }) });
        assert(rev.status === 200, `review ${rev.status}: ${JSON.stringify(rev.body?.error)}`);
        const b = (await waiting(bob.token)).body.data;
        assert(b.by_kind.approval === 0 && !b.items.some((i: any) => i.kind === 'approval'), `bob's list ${JSON.stringify(b.by_kind)}`);
        // The organisms' own route keeps its answer: it counts the approval for every member.
        const old = await json('/v1/organisms/waiting', { headers: auth(bob.token) });
        assert(old.status === 200 && old.body.data.items.some((i: any) => i.kind === 'review' && i.orgId === deskId && i.n === 1), `GET /v1/organisms/waiting for bob: ${JSON.stringify(old.body?.data)}`);
        const a = (await waiting(alice.token)).body.data;
        assert(a.by_kind.join_request === 0 && a.by_kind.approval === 1, `alice's counts ${JSON.stringify(a.by_kind)}`);
    });

    await test('a decided approval leaves the list', async () => {
        const r = await json(`/v1/organisms/${deskId}/approvals/${approvalId}`, { method: 'POST', headers: auth(alice.token), body: JSON.stringify({ decision: 'approve' }) });
        assert(r.status === 200, `decide ${r.status}: ${JSON.stringify(r.body?.error)}`);
        const a = (await waiting(alice.token)).body.data;
        assert(a.by_kind.approval === 0 && !a.items.some((i: any) => i.kind === 'approval'), `alice's list ${JSON.stringify(a.by_kind)}`);
    });

    finish();
})().catch((err) => { console.error(err); process.exit(1); });
