/**
 * @file e2e-mcp-companies.ts
 * @description E2E for the company MCP tools over the real JSON-RPC surface — registration
 *   is not the same as working, so every tool is called the way an AI chat with the AIMEAT
 *   connector calls it.
 *
 *   The case that only exists on this path: aimeat_company_update merges onto the CURRENT
 *   record. A chat gathers details over several turns, and an update that blanked whatever the
 *   previous turn wrote would quietly destroy the earlier answers — so a second call carrying
 *   one field must leave the first call's fields standing.
 *
 *   Also covers the scope fence (an agent without company:write is refused) and the ownership
 *   fence (the tools resolve the agent's OWNER, never a client-supplied id).
 * @version-history
 *   v1.0.0 — 2026-08-08 — Initial: list/create/update/front_page/portfolio_publish.
 */

// Run: cd aimeat && pnpm exec tsx test/e2e-mcp-companies.ts

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const CO_HOST = process.env.AIMEAT_CO_HOST ?? 'co.localhost';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>): Promise<void> {
    try {
        await fn();
        passed++;
        console.log(`  ✅ ${name}`);
    } catch (err) {
        failed++;
        console.error(`  ❌ ${name}: ${(err as Error).message}`);
    }
}

function assert(cond: unknown, msg: string): asserts cond {
    if (!cond) throw new Error(msg);
}

async function json(path: string, opts: RequestInit = {}): Promise<{ status: number; body: any }> {
    const res = await fetch(`${BASE}${path}`, {
        ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers ?? {}) },
    });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body };
}

(ed as any).hashes.sha512 = (...msgs: Uint8Array[]) => {
    const h = createHash('sha512');
    for (const m of msgs) h.update(m);
    return new Uint8Array(h.digest());
};
async function signMsg(privB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}

function parseSSE(text: string): any[] {
    const out: any[] = [];
    for (const evt of text.split('\n\n')) {
        let data = '';
        for (const line of evt.trim().split('\n')) if (line.startsWith('data: ')) data += line.slice(6);
        if (data) { try { out.push(JSON.parse(data)); } catch { /* not a JSON-RPC frame */ } }
    }
    return out;
}

/** One MCP session: the token and session id a connected chat would hold. */
interface McpSession { token: string; sessionId: string }

async function mcpRpc(session: McpSession, method: string, params: Record<string, any> = {}, id = 1): Promise<any> {
    const res = await fetch(`${BASE}/v1/mcp`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
            Authorization: `Bearer ${session.token}`,
            ...(session.sessionId ? { 'mcp-session-id': session.sessionId, 'mcp-protocol-version': '2025-03-26' } : {}),
        },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    });
    const sid = res.headers.get('mcp-session-id');
    if (sid) session.sessionId = sid;
    const ct = res.headers.get('content-type') ?? '';
    if (ct.includes('text/event-stream')) {
        const msgs = parseSSE(await res.text());
        return msgs.find((m) => m.id === id) ?? msgs[0] ?? {};
    }
    return await res.json();
}

/** The text an MCP tool returns, parsed — every company tool answers JSON. */
function toolJson(body: any): any {
    const text = body?.result?.content?.[0]?.text;
    assert(typeof text === 'string', `no tool content: ${JSON.stringify(body).slice(0, 240)}`);
    return JSON.parse(text);
}
function toolError(body: any): string {
    return String(body?.result?.content?.[0]?.text ?? body?.error?.message ?? '');
}

let seq = 100;
const nextId = (): number => ++seq;

/** Register an owner + agent with the given scopes, and open an MCP session as that agent. */
async function connectAgent(label: string, scopes: string[]): Promise<{ session: McpSession; owner: string }> {
    const owner = `${label}${Date.now().toString(36).slice(-6)}`;
    const reg = await json('/v1/ghii', {
        method: 'POST',
        body: JSON.stringify({ username: owner, display_name: owner, password: 'McpCompany1234' }),
    });
    assert(reg.status === 201, `ghii ${reg.status}: ${JSON.stringify(reg.body)}`);
    const ownerPriv = reg.body.data.private_key as string;

    let ts = new Date().toISOString();
    const ownerTok = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner, timestamp: ts, signature: await signMsg(ownerPriv, owner + NODE_ID + ts) }),
    });
    const ownerToken = ownerTok.body.data.token as string;

    const agent = await json('/v1/agents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ name: `${label}agent`, owner, scopes }),
    });
    assert(agent.status === 201, `agent ${agent.status}: ${JSON.stringify(agent.body)}`);
    const gaii = agent.body.data.agent.gaii as string;
    const agentPriv = agent.body.data.private_key as string;

    const client = await json('/v1/mcp/register', {
        method: 'POST',
        body: JSON.stringify({ client_name: `MCP Company E2E ${label}`, redirect_uris: [] }),
    });
    ts = new Date().toISOString();
    const params = new URLSearchParams({
        response_type: 'code', client_id: client.body.client_id, gaii,
        signature: await signMsg(agentPriv, gaii + NODE_ID + ts), timestamp: ts,
    });
    const auth = await json(`/v1/mcp/authorize?${params}`);
    const tok = await json('/v1/mcp/token', {
        method: 'POST',
        body: JSON.stringify({
            grant_type: 'authorization_code', code: auth.body.code,
            client_id: client.body.client_id, client_secret: client.body.client_secret,
        }),
    });
    assert(tok.status === 200, `mcp token ${tok.status}: ${JSON.stringify(tok.body)}`);

    const session: McpSession = { token: tok.body.access_token as string, sessionId: '' };
    await mcpRpc(session, 'initialize', {
        protocolVersion: '2025-03-26', capabilities: {},
        clientInfo: { name: 'MCP Company E2E', version: '1.0.0' },
    }, nextId());
    await fetch(`${BASE}/v1/mcp`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
            Authorization: `Bearer ${session.token}`,
            'mcp-session-id': session.sessionId,
            'mcp-protocol-version': '2025-03-26',
        },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    });
    return { session, owner };
}

console.log('\n=== AIMEAT MCP Companies E2E ===\n');

console.log('Setup — owner, agent, MCP OAuth');
const full = await connectAgent('mcpco', ['company:read', 'company:write', 'memory:read']);
const narrow = await connectAgent('mcpnarrow', ['memory:read']);

let companyId = '';
let slug = '';

console.log('\nPhase 1 — the tools are actually there');

await test('1. all five company tools appear in tools/list', async () => {
    const body = await mcpRpc(full.session, 'tools/list', {}, nextId());
    const names: string[] = (body.result?.tools ?? []).map((t: any) => t.name);
    for (const n of ['aimeat_company_list', 'aimeat_company_create', 'aimeat_company_update',
        'aimeat_company_front_page', 'aimeat_company_portfolio_publish']) {
        assert(names.includes(n), `missing ${n} (${names.length} tools listed)`);
    }
});

console.log('\nPhase 2 — registering and describing a company');

await test('2. aimeat_company_create registers the company and reserves its address', async () => {
    const body = await mcpRpc(full.session, 'tools/call', {
        name: 'aimeat_company_create',
        arguments: { name: `MCP Yritys ${Date.now().toString(36).slice(-5)}`, business_id: '1234567-8', city: 'Espoo' },
    }, nextId());
    const out = toolJson(body);
    companyId = out.company.id;
    slug = out.company.slug;
    assert(companyId && slug, `no company in ${JSON.stringify(out).slice(0, 200)}`);
    assert(out.company.businessId === '1234567-8', 'the business id given at creation must stick');
    assert(String(out.company.address).includes(`${slug}.${CO_HOST}`), `address wrong: ${out.company.address}`);
});

await test('3. the company appears in aimeat_company_list', async () => {
    const body = await mcpRpc(full.session, 'tools/call', { name: 'aimeat_company_list', arguments: {} }, nextId());
    const out = toolJson(body);
    assert(out.companies.some((c: any) => c.id === companyId), 'the created company is not listed');
});

await test('4. a second update keeps what the first one wrote', async () => {
    // The whole point of the MCP merge: a chat gathers details over several turns.
    const first = toolJson(await mcpRpc(full.session, 'tools/call', {
        name: 'aimeat_company_update',
        arguments: { company_id: companyId, iban: 'FI2112345600000785', vat_id: 'FI12345678' },
    }, nextId()));
    assert(first.company.iban === 'FI2112345600000785', 'the iban was not written');

    const second = toolJson(await mcpRpc(full.session, 'tools/call', {
        name: 'aimeat_company_update',
        arguments: { company_id: companyId, email: 'lasku@example.com' },
    }, nextId()));
    assert(second.company.email === 'lasku@example.com', 'the email was not written');
    assert(second.company.iban === 'FI2112345600000785', 'the second update blanked the iban from the first');
    assert(second.company.vatId === 'FI12345678', 'the second update blanked the vat id from the first');
    assert(second.company.businessId === '1234567-8', 'the second update blanked the business id from creation');
    assert(second.company.city === 'Espoo', 'the second update blanked the city from creation');
});

console.log('\nPhase 3 — publishing the page and pointing the address at it');

const MARKER = 'MCP JULKAISI TAMAN';
const PAGE = `<!doctype html><html lang="fi"><head><meta charset="utf-8"><title>${MARKER}</title></head><body><h1>${MARKER}</h1></body></html>`;

await test('5. choosing the portfolio front page before a page exists is refused', async () => {
    const body = await mcpRpc(full.session, 'tools/call', {
        name: 'aimeat_company_front_page', arguments: { company_id: companyId, kind: 'portfolio' },
    }, nextId());
    assert(body.result?.isError === true, 'expected a tool error');
    assert(toolError(body).includes('NO_PORTFOLIO'), `expected NO_PORTFOLIO, got: ${toolError(body)}`);
});

await test('6. aimeat_company_portfolio_publish serves the page at the address', async () => {
    const out = toolJson(await mcpRpc(full.session, 'tools/call', {
        name: 'aimeat_company_portfolio_publish', arguments: { company_id: companyId, html: PAGE },
    }, nextId()));
    assert(out.company.frontPage.kind === 'portfolio', `front page did not switch: ${out.company.frontPage.kind}`);
    assert(out.portfolio.published === true, 'the page reports as unpublished');

    const served = await fetch(`${BASE}/`, {
        redirect: 'manual',
        headers: { 'X-Co-Origin': '1', 'X-Subdomain': slug, Host: `${slug}.${CO_HOST}` },
    });
    assert(served.status === 200, `the address must serve the page, got ${served.status}`);
    assert((await served.text()).includes(MARKER), 'the served document is not the published page');
});

await test("7. an app front page pointing at someone else's app is refused", async () => {
    const body = await mcpRpc(full.session, 'tools/call', {
        name: 'aimeat_company_front_page',
        arguments: { company_id: companyId, kind: 'app', target: 'someone-else/their-app.html' },
    }, nextId());
    assert(body.result?.isError === true, 'expected a tool error');
    assert(/FRONT_PAGE_NOT_YOURS|APP_NOT_FOUND/.test(toolError(body)), `unexpected error: ${toolError(body)}`);
});

console.log('\nPhase 4 — the fences');

await test('8. an agent without the company scopes cannot reach any of it', async () => {
    const read = await mcpRpc(narrow.session, 'tools/call', { name: 'aimeat_company_list', arguments: {} }, nextId());
    const readErr = read.result?.isError === true || read.error !== undefined;
    assert(readErr, `a scopeless read should fail: ${JSON.stringify(read).slice(0, 200)}`);

    const write = await mcpRpc(narrow.session, 'tools/call', {
        name: 'aimeat_company_create', arguments: { name: 'Luvaton Oy' },
    }, nextId());
    const writeErr = write.result?.isError === true || write.error !== undefined;
    assert(writeErr, `a scopeless create should fail: ${JSON.stringify(write).slice(0, 200)}`);
});

await test("9. an agent cannot touch another owner's company", async () => {
    const other = await connectAgent('mcpother', ['company:read', 'company:write']);
    const body = await mcpRpc(other.session, 'tools/call', {
        name: 'aimeat_company_update', arguments: { company_id: companyId, city: 'Kaapattu' },
    }, nextId());
    assert(body.result?.isError === true, 'expected a tool error');
    assert(/NOT_FOUND|not found/i.test(toolError(body)), `expected a not-found style refusal, got: ${toolError(body)}`);

    // ...and the record is untouched.
    const mine = toolJson(await mcpRpc(full.session, 'tools/call', { name: 'aimeat_company_list', arguments: {} }, nextId()));
    const c = mine.companies.find((x: any) => x.id === companyId);
    assert(c.city === 'Espoo', `the company was modified across owners: city is ${c.city}`);
});

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed}`);
if (failed > 0) process.exit(1);
