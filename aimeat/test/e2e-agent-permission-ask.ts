/**
 * @file e2e-agent-permission-ask.ts
 * @description An agent that lacks a permission hands its person one address, the person allows it
 *   with one press, and the agent goes on in the same conversation.
 *
 *   Measured 2026-10-17: a person's ChatGPT (MCP OAuth) could neither send a message nor attach a PDF
 *   for her, and told her only the name of a missing permission. aimeat_dm_send was not on its tool
 *   list at all (wish-puuttuva-lupa-ai-neuvoo-ihmist-yhdell-salli-painikkeella-eik).
 *
 *   The claims, each separate:
 *     1. An MCP OAuth agent without messages:send still has aimeat_dm_send on its list, and its
 *        instructions say what a refused call carries; operator tools stay off.
 *     2. The call answers SCOPE_DENIED with the allow address and a sentence for the person.
 *     3. A REST refusal hands an agent `details.allow_url`.
 *     4. Nobody but the owner in person allows: the agent itself (403), another owner (404); a
 *        powerful permission is not one press (400 NEEDS_AGENT_PAGE).
 *     5. The owner's bell gets one notice with an Allow button that calls the allow route.
 *     6. The page reads the request; Allow adds the permission and only it; a second press adds nothing.
 *     7. The token issued before the Allow answers 401 invalid_token; the refreshed one sends the
 *        message in the same MCP session.
 *     8. A refused permission one press does not give (AI use) reaches the owner's bell once, with the
 *        agent's page and no Allow button, and reaches nobody else (2026-10-18).
 * @usage
 *   cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx \
 *     test/run-e2e-ci.ts --test=agent-permission-ask
 * @version-history
 *   v1.2.0 — 2026-10-25 — Phase 3: the notice carries Don't allow, and the agent is told the Allow on
 *     its inbox (secaudit2026oct22, the approval standard).
 *   v1.1.0 — 2026-10-18 — Phase 5: a refusal one press cannot answer reaches the bell too.
 *   v1.0.0 — 2026-10-17 — Initial, with the feature.
 */
import { createHash, randomBytes } from 'node:crypto';
import * as ed from '@noble/ed25519';
import { registerOwner } from './helpers/owner-login.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const owner = `pask${Date.now() % 100000}`;
const stranger = `paskx${Date.now() % 100000}`;
const AGENT = 'chatgpt-like';
/** The node default before 2026-10-17: what the person's ChatGPT agent held. */
const OLD_DEFAULT = ['memory:read', 'memory:write', 'memory:delete', 'catalogue:read', 'organism:read', 'agent:read'];

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
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body, www: res.headers.get('www-authenticate') ?? '' };
}

const auth = (token: string, opts: RequestInit = {}): RequestInit =>
    ({ ...opts, headers: { ...((opts.headers ?? {}) as Record<string, string>), Authorization: `Bearer ${token}` } });

let rpcId = 0;
async function mcp(token: string, session: string | null, method: string, params: unknown) {
    const res = await fetch(`${BASE}/v1/mcp`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
            Authorization: `Bearer ${token}`, ...(session ? { 'mcp-session-id': session } : {}),
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
    });
    const text = await res.text();
    const line = text.split('\n').find(l => l.startsWith('data: '));
    let msg: any = null;
    try { msg = JSON.parse(line ? line.slice(6) : text); } catch { /* a 401 body may be JSON-RPC or empty */ }
    return { status: res.status, session: res.headers.get('mcp-session-id'), msg, www: res.headers.get('www-authenticate') ?? '' };
}

const SEND = { name: 'aimeat_dm_send', arguments: { to: '', subject: 'Hei', body: 'Kehitystoiveet' } };

let ownerToken = '';
let strangerToken = '';
let strangerGhii = '';
let agentGaii = '';
let agentRestToken = '';
let client = { id: '', secret: '' };
let access = '';
let refresh = '';
let session = '';
let allowUrl = '';

console.log('\n=== Agent permission ask E2E Tests ===\n');

await test('Register the owner and a second owner', async () => {
    ownerToken = (await registerOwner(BASE, owner)).token;
    const s = await registerOwner(BASE, stranger);
    strangerToken = s.token;
    strangerGhii = s.ghii;
    SEND.arguments.to = strangerGhii;
    assert(!!ownerToken && !!strangerToken, 'no owner tokens');
});

await test('The owner makes an agent with the old default permissions', async () => {
    const c = await json('/v1/agents', auth(ownerToken, { method: 'POST', body: JSON.stringify({ name: AGENT, owner, capabilities: ['memory'] }) }));
    assert(c.status === 201, `create ${c.status}: ${JSON.stringify(c.body.error)}`);
    agentGaii = c.body.data.agent.gaii;
    const p = await json(`/v1/agents/${AGENT}/scopes`, auth(ownerToken, { method: 'PATCH', body: JSON.stringify({ scopes: OLD_DEFAULT }) }));
    assert(p.status === 200, `scopes ${p.status}: ${JSON.stringify(p.body.error)}`);
    const ts = new Date().toISOString();
    const sig = await ed.signAsync(new TextEncoder().encode(agentGaii + ts), Buffer.from(c.body.data.private_key, 'base64'));
    const t = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ gaii: agentGaii, timestamp: ts, signature: Buffer.from(sig).toString('base64') }) });
    agentRestToken = t.body?.data?.token ?? '';
    assert(!!agentRestToken, `agent token ${t.status}: ${JSON.stringify(t.body?.error)}`);
});

await test('ChatGPT connects through MCP OAuth', async () => {
    const reg = await json('/v1/mcp/register', { method: 'POST', body: JSON.stringify({ client_name: 'ChatGPT', redirect_uris: ['http://localhost/cb'] }) });
    assert(reg.status === 201, `register ${reg.status}`);
    client = { id: reg.body.client_id, secret: reg.body.client_secret };
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const consent = await json('/v1/mcp/authorize-consent', { method: 'POST', body: JSON.stringify({
        client_id: client.id, redirect_uri: 'http://localhost/cb', state: 's', gaii: agentGaii, owner_token: ownerToken,
        code_challenge: challenge, code_challenge_method: 'S256', resource: `${BASE}/v1/mcp`,
    }) });
    assert(consent.status === 200, `consent ${consent.status}: ${JSON.stringify(consent.body)}`);
    const code = new URL(consent.body.redirect_url).searchParams.get('code');
    const tok = await json('/v1/mcp/token', { method: 'POST', body: JSON.stringify({
        grant_type: 'authorization_code', code, client_id: client.id, client_secret: client.secret,
        redirect_uri: 'http://localhost/cb', code_verifier: verifier, resource: `${BASE}/v1/mcp`,
    }) });
    assert(tok.status === 200 && !!tok.body.access_token, `token ${tok.status}: ${JSON.stringify(tok.body)}`);
    access = tok.body.access_token;
    refresh = tok.body.refresh_token;
});

console.log('\nPhase 1: the AI knows, and hands the person an address');

await test('aimeat_dm_send is on the list without messages:send; operator tools are not', async () => {
    const init = await mcp(access, null, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'ChatGPT', version: '1' } });
    assert(init.status === 200 && !!init.session, `initialize ${init.status}`);
    session = init.session!;
    assert(/allow it with one press/.test(init.msg?.result?.instructions ?? ''), 'instructions do not mention the allow address');
    await mcp(access, session, 'notifications/initialized', {});
    const list = await mcp(access, session, 'tools/list', {});
    const names: string[] = (list.msg?.result?.tools ?? []).map((t: any) => t.name);
    assert(names.includes('aimeat_dm_send'), 'aimeat_dm_send is not listed');
    assert(!names.includes('aimeat_admin_agents'), 'an operator tool is listed');
});

await test('The call answers SCOPE_DENIED with the allow address and a sentence for the person', async () => {
    const r = await mcp(access, session, 'tools/call', SEND);
    const text: string = r.msg?.result?.content?.[0]?.text ?? '';
    assert(r.msg?.result?.isError === true && text.startsWith('SCOPE_DENIED: '), `not refused: ${text.slice(0, 200)}`);
    allowUrl = (text.match(/https?:\/\/\S+\/v1\/allow\?[^\s"]+/) ?? [''])[0];
    assert(allowUrl.includes(`agent=${AGENT}`) && allowUrl.includes('need=messages%3Asend'), `no allow address: ${text}`);
    assert(/without naming any permission or tool/.test(text), 'no instruction to keep the permission word away from the person');
});

await test('A REST refusal hands an agent details.allow_url', async () => {
    assert(!!agentRestToken, 'no agent REST token');
    const r = await json('/v1/messages', auth(agentRestToken, { method: 'POST', body: JSON.stringify({ to: strangerGhii, subject: 'x', body: 'y' }) }));
    assert(r.status === 403 && r.body?.error?.code === 'SCOPE_DENIED', `expected SCOPE_DENIED, got ${r.status} ${JSON.stringify(r.body?.error)}`);
    assert(String(r.body?.error?.details?.allow_url ?? '').includes('/v1/allow?agent='), `no allow_url: ${JSON.stringify(r.body?.error)}`);
});

console.log('\nPhase 2: only the owner in person allows');

await test('The agent cannot allow itself, nor read the request (403)', async () => {
    const r = await json(`/v1/agents/${AGENT}/allow`, auth(agentRestToken, { method: 'POST', body: JSON.stringify({ scopes: ['messages:send'] }) }));
    assert(r.status === 403, `expected 403, got ${r.status}`);
    const g = await json(`/v1/agents/${AGENT}/allow?need=messages:send`, auth(agentRestToken));
    assert(g.status === 403, `GET: expected 403, got ${g.status}`);
});

await test('Another owner cannot allow it, nor read the request (404)', async () => {
    const r = await json(`/v1/agents/${AGENT}/allow`, auth(strangerToken, { method: 'POST', body: JSON.stringify({ scopes: ['messages:send'] }) }));
    assert(r.status === 404, `expected 404, got ${r.status}`);
    const g = await json(`/v1/agents/${AGENT}/allow?need=messages:send`, auth(strangerToken));
    assert(g.status === 404, `GET: expected 404, got ${g.status}`);
});

await test('A powerful permission is not one press (400 NEEDS_AGENT_PAGE)', async () => {
    const r = await json(`/v1/agents/${AGENT}/allow`, auth(ownerToken, { method: 'POST', body: JSON.stringify({ scopes: ['memory:purge'] }) }));
    assert(r.status === 400 && r.body?.error?.code === 'NEEDS_AGENT_PAGE', `got ${r.status} ${JSON.stringify(r.body?.error)}`);
});

console.log('\nPhase 3: the person is asked, and allows');

await test('The owner\'s bell holds one notice with an Allow button', async () => {
    let ask: any;
    for (let i = 0; i < 40 && !ask; i++) {
        const n = await json('/v1/notifications', auth(ownerToken));
        const items: any[] = n.body?.data?.notifications ?? [];
        ask = items.filter(x => x.type === 'agent_permission_ask');
        if (ask.length === 0) { ask = undefined; await new Promise(r => setTimeout(r, 100)); }
    }
    assert(!!ask, 'no agent_permission_ask notice');
    // Two refusals (MCP and REST) of the same permission open one question, not two.
    assert(ask.length === 1, `expected one notice, got ${ask.length}`);
    assert(ask[0].actions?.some((a: any) => a.kind === 'api' && a.endpoint === `/v1/agents/${AGENT}/allow`), 'no Allow button');
    // The approval standard (secaudit2026oct22): a question with only Allow cannot be answered no.
    assert(ask[0].actions?.some((a: any) => a.id === 'deny' && a.kind === 'api' && a.endpoint === `/v1/agents/${AGENT}/refusals/decline`
        && JSON.stringify(a.body?.needed) === '["messages:send"]'), `no Don't allow: ${JSON.stringify(ask[0].actions)}`);
});

await test('The page reads the request; Allow adds exactly the permission', async () => {
    const need = new URL(allowUrl).searchParams.get('need')!;
    const g = await json(`/v1/agents/${AGENT}/allow?need=${encodeURIComponent(need)}`, auth(ownerToken));
    assert(g.status === 200 && g.body.data.words[0].one_press === true && g.body.data.words[0].held === false, `read ${g.status} ${JSON.stringify(g.body.data)}`);
    const p = await json(`/v1/agents/${AGENT}/allow`, auth(ownerToken, { method: 'POST', body: JSON.stringify({ scopes: need.split(',') }) }));
    assert(p.status === 200 && JSON.stringify(p.body.data.added) === '["messages:send"]', `allow ${p.status} ${JSON.stringify(p.body)}`);
    const list = await json('/v1/agents', auth(ownerToken));
    const held: string[] = (list.body.data.agents as any[]).find(a => a.name === AGENT).default_scopes;
    assert([...OLD_DEFAULT, 'messages:send'].every(s => held.includes(s)) && held.length === OLD_DEFAULT.length + 1, `held ${JSON.stringify(held)}`);
    const again = await json(`/v1/agents/${AGENT}/allow`, auth(ownerToken, { method: 'POST', body: JSON.stringify({ scopes: ['messages:send'] }) }));
    assert(again.status === 200 && again.body.data.added.length === 0, 'a second press added something');
    // The agent hears the answer on its inbox, once (secaudit2026oct22, the approval standard).
    const inbox = await json(`/v1/agents/v2/messages?context_id=${encodeURIComponent(`permission-ask:${AGENT}`)}`, auth(ownerToken));
    const told = (inbox.body?.data?.messages ?? []).filter((m: any) => m.metadata?.kind === 'permission-ask');
    assert(told.length === 1 && told[0].parts?.[1]?.data?.outcome === 'allowed' && String(told[0].to).startsWith(`${AGENT}#`),
        `the agent was not told once: ${JSON.stringify(told)}`);
});

console.log('\nPhase 4: the same conversation goes on');

await test('The token issued before the Allow answers 401 invalid_token', async () => {
    const r = await mcp(access, session, 'tools/call', SEND);
    assert(r.status === 401 && /invalid_token/.test(r.www), `expected 401 invalid_token, got ${r.status} ${r.www}`);
});

await test('The refreshed token sends the message in the same MCP session', async () => {
    const t = await json('/v1/mcp/token', { method: 'POST', body: JSON.stringify({
        grant_type: 'refresh_token', refresh_token: refresh, client_id: client.id, client_secret: client.secret, resource: `${BASE}/v1/mcp`,
    }) });
    assert(t.status === 200 && !!t.body.access_token, `refresh ${t.status}`);
    const r = await mcp(t.body.access_token, session, 'tools/call', SEND);
    const text: string = r.msg?.result?.content?.[0]?.text ?? '';
    assert(r.status === 200 && r.msg?.result?.isError !== true && /delivered|pending|message_id/.test(text), `not sent: ${r.status} ${text.slice(0, 200)}`);
});

console.log('\nPhase 5: a permission one press does not give still reaches the person (2026-10-18)');

async function pageNotices(token: string): Promise<any[]> {
    const n = await json('/v1/notifications', auth(token));
    return (n.body?.data?.notifications ?? []).filter((x: any) => x.type === 'agent_permission_ask' && x.i18n?.key === 'agent_permission_ask_page');
}

await test('A refused powerful permission (AI use) answers with the agent\'s page, not one press', async () => {
    const r = await json('/v1/ai/models', auth(agentRestToken));
    assert(r.status === 403 && r.body?.error?.code === 'SCOPE_DENIED', `expected SCOPE_DENIED, got ${r.status} ${JSON.stringify(r.body?.error)}`);
    const d = r.body.error.details ?? {};
    assert(d.one_press === false && String(d.allow_url).includes(`/v1/profile?tab=agents&agent=${AGENT}`), `details ${JSON.stringify(d)}`);
});

await test('The owner\'s bell gets one notice with the agent\'s page and no Allow button', async () => {
    let found: any[] = [];
    for (let i = 0; i < 40 && found.length === 0; i++) {
        found = await pageNotices(ownerToken);
        if (found.length === 0) await new Promise(r => setTimeout(r, 100));
    }
    assert(found.length === 1, `expected one notice, got ${found.length}`);
    const n = found[0];
    assert(n.link === `/v1/profile?tab=agents&agent=${AGENT}`, `link ${n.link}`);
    assert(!(n.actions ?? []).some((a: any) => a.kind === 'api'), `an Allow button: ${JSON.stringify(n.actions)}`);
    assert((n.actions ?? []).some((a: any) => a.kind === 'navigate' && a.link === n.link), `no way to the agent's page: ${JSON.stringify(n.actions)}`);
});

await test('A second refusal of the same permission asks nothing new; the other owner hears none of it', async () => {
    const r = await json('/v1/ai/models', auth(agentRestToken));
    assert(r.status === 403, `expected 403, got ${r.status}`);
    await new Promise(res => setTimeout(res, 300));
    assert((await pageNotices(ownerToken)).length === 1, 'asked twice');
    assert((await pageNotices(strangerToken)).length === 0, 'the other owner was told');
});

console.log(`\n=== Agent permission ask: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
