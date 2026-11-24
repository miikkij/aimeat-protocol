/**
 * @file test/e2e-ai-standing.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description E2E for the owner's "Allow always" setting (services/ai-standing/, routes/agents/ai-standing.ts):
 *   the permissions every one of the owner's AIs holds without the owner answering each time, and the
 *   line on the owner's feed when an AI acts on one without asking. Asserted:
 *     - GET /v1/ai-standing names the words a person gives by name, with the node's money and delete
 *       words refused by default and the permission-changing words absent;
 *     - DENIAL: an agent cannot change it (403), a money, a delete or a never-given word is refused
 *       with its code and nothing is written;
 *     - a refused powerful permission's notice carries "Allow always" with the section's address;
 *     - the owner turns ai:use on: an existing agent's list gets it, its fresh token works on the route
 *       that refused it, and the feed gets ai_standing_changed and one ai_acted_without_asking line
 *       naming the setting and since when;
 *     - the agent reads the setting over REST and over the MCP tool aimeat_ai_standing_get;
 *     - an agent made later gets the word at approval; a word the owner took off one agent's page
 *       stays off when the setting changes again;
 *     - turning the word off takes it off the agents that got it from the setting, and an agent that
 *       held it before keeps it;
 *     - DENIAL: another owner sees none of it.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=ai-standing
 * @version-history
 *   v1.0.0 — 2026-11-20 — Initial (wish-ai-toimii-itsen-isesti-omistajan-asetuksella-salli-aina-ja-k).
 */
import * as ed from '@noble/ed25519';
import { BASE, assert, expectRefusal, finish, json, test } from './helpers/harness.js';
import { registerOwner, type RegisteredOwner } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool, type McpAgent } from './helpers/mcp-session.js';

const stamp = Date.now();
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// Runtime assertions below check the HTTP contract at this untyped JSON boundary.
type Body = Record<string, any>;
const call = (method: 'GET' | 'PUT' | 'PATCH' | 'POST', path: string, token: string, body?: unknown) => json<Body>(path, {
    method,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const putStanding = (token: string, scopes: string[]) => call('PUT', '/v1/ai-standing', token, { scopes });
const wordOf = (view: Body, scope: string): Body | undefined => (view.words as Body[]).find(w => w.scope === scope);

async function scopesOf(owner: RegisteredOwner, name: string): Promise<string[]> {
    const r = await call('GET', '/v1/agents', owner.token);
    assert(r.status === 200, `agents list: ${r.status} ${JSON.stringify(r.body?.error)}`);
    const a = (r.body.data.agents as Body[]).find(x => x.name === name);
    assert(a, `agent ${name} in the list`);
    return (a.default_scopes ?? a.scopes ?? []) as string[];
}
async function events(owner: RegisteredOwner, kind: string): Promise<Body[]> {
    const r = await call('GET', '/v1/account/events?limit=200', owner.token);
    assert(r.status === 200, `account events: ${r.status} ${JSON.stringify(r.body?.error)}`);
    return (r.body.data.events as Body[]).filter(e => e.kind === kind);
}
/** A fresh token: a token is the ceiling of what its holder may do, so a word added later needs one. */
async function freshToken(agent: McpAgent): Promise<string> {
    const timestamp = new Date().toISOString();
    const sig = await ed.signAsync(new TextEncoder().encode(agent.gaii + timestamp), Buffer.from(agent.privateKey, 'base64'));
    const r = await call('POST', '/v1/auth/token', '', { gaii: agent.gaii, timestamp, signature: Buffer.from(sig).toString('base64') });
    assert(r.status === 200, `token: ${r.status} ${JSON.stringify(r.body?.error)}`);
    return r.body.data.token as string;
}

console.log('\n=== Allow always: what every AI of the owner may do without asking ===\n');

let alice!: RegisteredOwner, bob!: RegisteredOwner;
let worker!: McpAgent, keeper!: McpAgent;

await test('Setup: alice has an agent without AI use, and one that was given AI use by name; bob has an account', async () => {
    alice = await registerOwner(BASE, `stalice${stamp}`);
    bob = await registerOwner(BASE, `stbob${stamp}`);
    worker = await makeAgent(BASE, alice, ['memory:read', 'agent:read'], `stwork${stamp % 100000}`);
    keeper = await makeAgent(BASE, alice, ['memory:read', 'agent:read', 'ai:use'], `stkeep${stamp % 100000}`);
    assert(!(await scopesOf(alice, worker.name)).includes('ai:use'), 'the worker starts without ai:use');
});

await test('GET names the words a person gives by name; money and delete wait for the node; permission changes are never offered', async () => {
    const r = await call('GET', '/v1/ai-standing?lang=fi', alice.token);
    assert(r.status === 200, `read: ${r.status} ${JSON.stringify(r.body?.error)}`);
    const v = r.body.data;
    assert(v.enabled === true && v.money_allowed === false && v.delete_allowed === false, `node settings: ${JSON.stringify(v)}`);
    const ai = wordOf(v, 'ai:use'), pub = wordOf(v, 'publish:public');
    assert(ai && ai.on === false && ai.allowed === true && pub && pub.allowed === true, `ai:use and publish:public: ${JSON.stringify([ai, pub])}`);
    assert(typeof ai.plain === 'string' && ai.plain !== 'ai:use', `ai:use in plain words: ${ai.plain}`);
    assert(wordOf(v, 'commerce:psp')?.refusal_code === 'STANDING_MONEY_OFF', 'money waits for the node');
    assert(wordOf(v, 'memory:purge')?.refusal_code === 'STANDING_DELETE_OFF', 'delete waits for the node');
    for (const never of ['agent:permissions', 'agent:permissions-add', 'account:security', 'operator:admin']) {
        assert(!wordOf(v, never), `${never} is not offered`);
    }
    assert(String(v.page).includes('section=allow-always'), `the page: ${v.page}`);
});

await test('DENIAL: an agent cannot change the setting (403); money, delete and never-given words are refused with their code', async () => {
    const byAgent = await putStanding(worker.token, ['ai:use']);
    expectRefusal(byAgent, 403, 'ACCESS_DENIED');
    // An agent without agent:read, the word GET /v1/ai-standing asks, does not read it either.
    const blind = await makeAgent(BASE, alice, ['memory:read'], `stblind${stamp % 100000}`);
    const unread = await call('GET', '/v1/ai-standing', blind.token);
    expectRefusal(unread, 403, 'SCOPE_DENIED');
    assert(byAgent.status === 403 && unread.status === 403, 'both doors refuse the agent');
    for (const [word, code] of [['commerce:psp', 'STANDING_MONEY_OFF'], ['memory:purge', 'STANDING_DELETE_OFF'], ['agent:permissions', 'STANDING_WORD_NOT_GIVEN']]) {
        const r = await putStanding(alice.token, [word]);
        expectRefusal(r, 400, code);
        assert(r.body.error?.details?.scope === word, `${word} is named: ${JSON.stringify(r.body?.error)}`);
    }
    const v = (await call('GET', '/v1/ai-standing', alice.token)).body.data;
    assert((v.words as Body[]).every(w => !w.on), 'nothing was written');
    assert(!(await scopesOf(alice, worker.name)).includes('ai:use'), 'the worker is unchanged');
});

await test('A refused AI use asks the owner with "Allow always" beside the agent\'s page', async () => {
    const refused = await call('GET', '/v1/ai/models', worker.token);
    expectRefusal(refused, 403, 'SCOPE_DENIED');
    let notice: Body | undefined;
    for (let i = 0; i < 50 && !notice; i++) {
        const n = await call('GET', '/v1/notifications', alice.token);
        notice = (n.body?.data?.notifications as Body[] ?? []).find(x => x.type === 'agent_permission_ask' && String(x.link).includes(worker.name));
        if (!notice) await sleep(100);
    }
    assert(notice, 'the owner got a notice');
    const always = (notice.actions as Body[] ?? []).find(a => a.id === 'always');
    assert(always && always.kind === 'navigate' && String(always.link).includes('section=allow-always') && String(always.link).includes('word=ai%3Ause'),
        `"Allow always": ${JSON.stringify(notice.actions)}`);
});

await test('The owner turns AI use on for all: the worker\'s list gets it, its fresh token works, and the feed says so', async () => {
    const r = await putStanding(alice.token, ['ai:use']);
    assert(r.status === 200 && JSON.stringify(r.body.data.added) === '["ai:use"]', `PUT: ${r.status} ${JSON.stringify(r.body?.error ?? r.body?.data)}`);
    assert(r.body.data.agents_changed >= 1, `agents changed: ${r.body.data.agents_changed}`);
    assert((await scopesOf(alice, worker.name)).includes('ai:use'), 'the worker holds ai:use');
    assert(wordOf(r.body.data, 'ai:use')?.on === true && typeof wordOf(r.body.data, 'ai:use')?.set_at === 'string', 'the answer shows it on, with its date');
    assert((await events(alice, 'ai_standing_changed')).length === 1, 'one ai_standing_changed line');
    worker.token = await freshToken(worker);
    const m = await call('GET', '/v1/ai/models', worker.token);
    assert(m.status === 200, `the worker uses AI without asking: ${m.status} ${JSON.stringify(m.body?.error)}`);
});

await test('The act lands on the owner\'s feed once, naming the setting and since when', async () => {
    let lines: Body[] = [];
    for (let i = 0; i < 40 && lines.length === 0; i++) {
        lines = (await events(alice, 'ai_acted_without_asking')).filter(e => e.data?.name === worker.name);
        if (lines.length === 0) await sleep(500);
    }
    assert(lines.length === 1, `one line, got ${lines.length}`);
    const d = lines[0].data;
    assert(d.word === 'ai:use' && d.via === 'standing' && typeof d.setAt === 'string' && d.setBy?.startsWith(`stalice${stamp}`), `the line: ${JSON.stringify(d)}`);
    assert(String(d.call).includes('/v1/ai/models'), `what it did: ${d.call}`);
    await call('GET', '/v1/ai/models', worker.token);
    await sleep(6_000);
    assert((await events(alice, 'ai_acted_without_asking')).filter(e => e.data?.name === worker.name).length === 1, 'a second act the same day writes no second line');
});

await test('The agent reads the setting over REST and over aimeat_ai_standing_get', async () => {
    const r = await call('GET', '/v1/ai-standing', worker.token);
    assert(r.status === 200 && wordOf(r.body.data, 'ai:use')?.on === true, `REST: ${r.status} ${JSON.stringify(r.body?.error)}`);
    const session = await openSession(BASE, worker.token, 'ai-standing reader');
    const t = await callTool(session, 'aimeat_ai_standing_get', { lang: 'fi' });
    assert(!t.isError && t.text.includes('"ai:use"') && t.text.includes('"on":true'), `MCP: ${t.text.slice(0, 300)}`);
});

let later!: McpAgent;
await test('An agent made later gets the word at approval; a word the owner took off its page stays off', async () => {
    later = await makeAgent(BASE, alice, ['memory:read', 'agent:read'], `stlate${stamp % 100000}`);
    assert((await scopesOf(alice, later.name)).includes('ai:use'), 'the new agent holds ai:use');
    const off = await call('PATCH', `/v1/agents/${encodeURIComponent(later.name)}/scopes`, alice.token, { scopes: ['memory:read', 'agent:read'] });
    assert(off.status === 200, `owner narrows it: ${off.status} ${JSON.stringify(off.body?.error)}`);
    const r = await putStanding(alice.token, ['ai:use', 'publish:public']);
    assert(r.status === 200, `PUT: ${r.status} ${JSON.stringify(r.body?.error)}`);
    const held = await scopesOf(alice, later.name);
    assert(!held.includes('ai:use') && held.includes('publish:public'), `ai:use stays off, publish:public arrives: ${held}`);
});

await test('Turning a word off takes it off the agents that got it from the setting; an agent that held it before keeps it', async () => {
    const r = await putStanding(alice.token, ['publish:public']);
    assert(r.status === 200 && JSON.stringify(r.body.data.removed) === '["ai:use"]', `PUT: ${r.status} ${JSON.stringify(r.body?.error ?? r.body?.data)}`);
    assert(!(await scopesOf(alice, worker.name)).includes('ai:use'), 'the worker lost ai:use');
    assert((await scopesOf(alice, keeper.name)).includes('ai:use'), 'the keeper kept the ai:use it was given by name');
    const none = await putStanding(alice.token, []);
    assert(none.status === 200, `all off: ${none.status}`);
    assert(!(await scopesOf(alice, later.name)).includes('publish:public'), 'the later agent lost publish:public');
});

await test('DENIAL: another owner sees none of it', async () => {
    const r = await call('GET', '/v1/ai-standing', bob.token);
    assert(r.status === 200 && (r.body.data.words as Body[]).every(w => !w.on && w.set_at === null), `bob's own, untouched: ${JSON.stringify(r.body?.data?.words?.filter((w: Body) => w.on))}`);
    assert((await events(bob, 'ai_acted_without_asking')).length === 0 && (await events(bob, 'ai_standing_changed')).length === 0, 'bob\'s feed has none of alice\'s lines');
    const cross = await call('GET', '/v1/ai-standing', worker.token);
    assert(cross.status === 200 && (cross.body.data.words as Body[]).every(w => !w.on),
        `the worker reads its own owner's setting, now all off: ${cross.status} ${JSON.stringify(cross.body?.error ?? cross.body?.data?.words?.filter((w: Body) => w.on))}`);
});

finish();
