/**
 * @file e2e-mcp-orientation.ts
 * @description E2E for what an agent meets when it connects: the `instructions` string in the
 *   initialize result, and the app's public web address on the MCP app tools. Self-spawns a server
 *   with the app origin provisioned (AIMEAT_APP_ORIGIN_ENABLED=true, AIMEAT_APP_HOST=apps.aimeat.test)
 *   — the shared CI runner pins that flag OFF, so this suite owns its server, the same way
 *   e2e-app-origin does. Verifies:
 *     - /v1/mcp initialize carries instructions naming aimeat_handbook_get as the way in;
 *     - /v2/mcp/agent names its own surface before the shared body;
 *     - aimeat_app_list and aimeat_app_get carry `url`, absolute, on the app host;
 *     - listing an app whose subdomain mapping is gone falls back to the shared path form and
 *       MINTS NOTHING (the whole reason the lister uses resolveAppUrls and not appOriginUrl);
 *     - a missing app is an error rather than an invented address;
 *     - prompts/list offers the portal prompt packages and withholds the librarian templates that
 *       share their group, and prompts/get returns a body with the node values already filled.
 * @usage cd aimeat && pnpm exec node --import tsx test/e2e-mcp-orientation.ts
 * @version-history
 *   v1.1.0 — 2026-08-09 — Phase 4: the managed prompts a person picks (MCP prompts primitive).
 *   v1.0.0 — 2026-08-09 — Initial: MCP handshake instructions + the public app URL.
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const PORT = process.env.E2E_MCP_ORIENTATION_PORT ?? '40268';
const BASE = `http://localhost:${PORT}`;
const APP_HOST = 'apps.aimeat.test';
const NODE_ID = 'aimeat-local-001-dev';
const DB_PATH = resolve(process.cwd(), 'test/.test-mcp-orientation.db');
// The app origin inherits scheme and port from the apex baseUrl and swaps only the host, so
// locally the address carries the port. In prod the baseUrl has none and the suffix is empty.
const APP_ORIGIN = `http://${APP_HOST}:${PORT}`;

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body, headers: res.headers };
}
async function signMsg(privB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

/** Parse an SSE body into the JSON-RPC messages it carried. */
function parseSSE(text: string): any[] {
    const out: any[] = [];
    for (const evt of text.split('\n\n')) {
        let data = '';
        for (const line of evt.trim().split('\n')) if (line.startsWith('data: ')) data += line.slice(6);
        if (data) { try { out.push(JSON.parse(data)); } catch { /* skip a partial frame */ } }
    }
    return out;
}

/**
 * A JSON-RPC caller bound to one MCP endpoint, holding its own session id. Each surface
 * (/v1/mcp, /v2/mcp/agent) is its own server with its own instructions, so the suite needs
 * one of these per surface rather than a single module-level session.
 */
function mcpClient(path: string, token: () => string) {
    let sessionId = '';
    return async function rpc(method: string, params: Record<string, any> = {}, id = 1) {
        const res = await fetch(`${BASE}${path}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json, text/event-stream',
                Authorization: `Bearer ${token()}`,
                ...(sessionId ? { 'mcp-session-id': sessionId, 'mcp-protocol-version': '2025-03-26' } : {}),
            },
            body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
        });
        const sid = res.headers.get('mcp-session-id');
        if (sid) sessionId = sid;
        const ct = res.headers.get('content-type') ?? '';
        let body: any;
        if (ct.includes('text/event-stream')) {
            const msgs = parseSSE(await res.text());
            body = msgs.find(m => m.id === id) ?? msgs[0] ?? {};
        } else {
            body = await res.json() as any;
        }
        return { status: res.status, body };
    };
}

/** The text a tool call returned, which every AIMEAT MCP tool serves as one text block. */
function toolText(body: any): string {
    return body?.result?.content?.[0]?.text ?? '';
}

function cleanupDb() {
    for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm']) {
        try { if (existsSync(f)) unlinkSync(f); } catch { /* ignore */ }
    }
}

async function startServer(): Promise<ChildProcess> {
    cleanupDb();
    const env = {
        ...process.env,
        AIMEAT_PORT: PORT,
        AIMEAT_BASE_URL: BASE,
        AIMEAT_NODE_ID: NODE_ID,
        AIMEAT_APP_HOST: APP_HOST,
        AIMEAT_APP_ORIGIN_ENABLED: 'true',
        AIMEAT_RL_GLOBAL: '10000', AIMEAT_RL_AUTH: '1000', AIMEAT_RL_WORK: '1000',
        AIMEAT_RL_MEMORY: '1000', AIMEAT_RL_CATALOGUE: '10000',
        AIMEAT_DEFAULT_AGENT_SCOPES: '*',
    };
    const child = spawn('node', ['--import', 'tsx', 'src/index.ts', 'start', '--db', 'sqlite', '--db-path', DB_PATH],
        { env, stdio: ['ignore', 'pipe', 'pipe'], cwd: process.cwd() });
    child.stdout?.on('data', () => {}); child.stderr?.on('data', () => {});
    const start = Date.now();
    while (Date.now() - start < 60_000) {
        try { if ((await fetch(`${BASE}/v1/spec`)).ok) return child; } catch { /* not up yet */ }
        await new Promise(r => setTimeout(r, 300));
    }
    child.kill('SIGTERM');
    throw new Error('Server failed to start');
}

async function main() {
    const server = await startServer();
    try {
        const stamp = Date.now() % 100000;
        const operatorName = `mcporientop${stamp}`;
        const ownerName = `mcporient${stamp}`;
        const agentName = 'orientagent';
        const filename = 'orient-demo.html';
        // The subdomain publish derives from the filename, so the suite knows it in advance.
        const SUB = 'orient-demo';
        const HTML = '<!DOCTYPE html><html><body><h1>orientation demo</h1></body></html>';

        let operatorToken = '';
        let ownerToken = '';
        let agentGaii = '';
        let agentPrivKey = '';
        let mcpToken = '';

        const v1 = mcpClient('/v1/mcp', () => mcpToken);
        const v2agent = mcpClient('/v2/mcp/agent', () => mcpToken);

        console.log('\n=== MCP Orientation E2E (instructions + public app URL) ===\n');
        console.log(`Phase 0: Setup (app origin ON, app host ${APP_HOST})`);

        await test('register the operator (first real owner)', async () => {
            const { status, body } = await json('/v1/owners', {
                method: 'POST', body: JSON.stringify({ name: operatorName, public_key: 'placeholder' }),
            });
            assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
            const ts = new Date().toISOString();
            const sig = await signMsg(body.data.private_key, operatorName + NODE_ID + ts);
            const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: operatorName, timestamp: ts, signature: sig }) });
            assert(tok.body.ok === true, `operator token: ${JSON.stringify(tok.body.error)}`);
            operatorToken = tok.body.data.token;
        });

        await test('register the GHII owner MCP will connect as', async () => {
            const { status, body } = await json('/v1/ghii', {
                method: 'POST',
                body: JSON.stringify({ username: ownerName, display_name: 'MCP Orientation Test', password: 'McpOrient1234' }),
            });
            assert(status === 201, `ghii status ${status}: ${JSON.stringify(body)}`);
            const ts = new Date().toISOString();
            const sig = await signMsg(body.data.private_key, ownerName + NODE_ID + ts);
            const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: ownerName, timestamp: ts, signature: sig }) });
            assert(tok.body.ok === true, `owner token: ${JSON.stringify(tok.body.error)}`);
            ownerToken = tok.body.data.token;
        });

        await test('register the agent', async () => {
            const { status, body } = await json('/v1/agents', {
                method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
                body: JSON.stringify({ name: agentName, owner: ownerName, capabilities: ['apps'], model: 'gpt-4o' }),
            });
            assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
            agentGaii = body.data.agent.gaii;
            agentPrivKey = body.data.private_key;
        });

        await test('OAuth client registration + token exchange', async () => {
            const reg = await json('/v1/mcp/register', {
                method: 'POST', body: JSON.stringify({ client_name: 'MCP Orientation Test Client', redirect_uris: [] }),
            });
            assert(reg.status === 201, `register status ${reg.status}`);
            const ts = new Date().toISOString();
            const sig = await signMsg(agentPrivKey, agentGaii + NODE_ID + ts);
            const params = new URLSearchParams({ response_type: 'code', client_id: reg.body.client_id, gaii: agentGaii, signature: sig, timestamp: ts });
            const auth = await json(`/v1/mcp/authorize?${params}`);
            assert(typeof auth.body.code === 'string', 'has auth code');
            const tok = await json('/v1/mcp/token', {
                method: 'POST',
                body: JSON.stringify({
                    grant_type: 'authorization_code', code: auth.body.code,
                    client_id: reg.body.client_id, client_secret: reg.body.client_secret,
                }),
            });
            assert(tok.status === 200, `token status ${tok.status}`);
            mcpToken = tok.body.access_token;
        });

        await test('publish an app', async () => {
            const { status, body } = await json('/v1/apps', {
                method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
                body: JSON.stringify({
                    filename, content: b64(HTML), name: 'Orientation Demo',
                    description: 'An app whose address the chat should be able to hand over',
                    category: 'utility', tags: ['demo'],
                }),
            });
            assert(status === 201, `publish status ${status}: ${JSON.stringify(body)}`);
        });

        // ── Phase 1: the orientation an agent reads before it has called anything ──
        console.log('\nPhase 1: the initialize result orients the agent');

        await test('1. /v1/mcp initialize carries instructions naming the way in', async () => {
            const { status, body } = await v1('initialize', {
                protocolVersion: '2025-03-26', capabilities: {},
                clientInfo: { name: 'MCP Orientation E2E', version: '1.0.0' },
            });
            assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
            const instructions = body.result?.instructions;
            assert(typeof instructions === 'string' && instructions.length > 0, `expected an instructions string, got ${JSON.stringify(instructions)}`);
            assert(instructions.includes('aimeat_handbook_get'), 'instructions name aimeat_handbook_get as the entry point');
            assert(instructions.includes('aimeat_app_list'), 'instructions name aimeat_app_list');
        });

        await test('2. /v2/mcp/agent names its own surface before the shared body', async () => {
            const { status, body } = await v2agent('initialize', {
                protocolVersion: '2025-03-26', capabilities: {},
                clientInfo: { name: 'MCP Orientation E2E', version: '1.0.0' },
            });
            assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
            const instructions = body.result?.instructions ?? '';
            assert(instructions.startsWith('This surface is the owner'), `agent surface introduces itself first: ${instructions.slice(0, 60)}`);
            assert(instructions.includes('aimeat_handbook_get'), 'the shared body follows the surface line');
        });

        // ── Phase 2: the address a person can open ──
        console.log('\nPhase 2: the app tools carry an address a person can open');

        await test('3. aimeat_app_list carries an absolute url on the app host', async () => {
            const { body } = await v1('tools/call', { name: 'aimeat_app_list', arguments: {} }, 100);
            const listed = JSON.parse(toolText(body));
            const app = listed.apps.find((a: any) => a.filename === filename);
            assert(!!app, `the published app is listed: ${toolText(body).slice(0, 200)}`);
            assert(typeof app.url === 'string', `url is a string, got ${JSON.stringify(app.url)}`);
            assert(app.url === `http://${SUB}.${APP_HOST}:${PORT}/`, `url is the app's own subdomain, got ${app.url}`);
            // The node-relative download path stays, since it is a different thing from the address.
            assert(app.download_url.startsWith('/v1/apps/'), `download_url unchanged, got ${app.download_url}`);
        });

        await test('4. aimeat_app_get carries the same url', async () => {
            const { body } = await v1('tools/call', { name: 'aimeat_app_get', arguments: { owner: ownerName, filename } }, 101);
            const detail = JSON.parse(toolText(body));
            assert(detail.url === `http://${SUB}.${APP_HOST}:${PORT}/`, `detail url, got ${detail.url}`);
        });

        // ── Phase 3: listing reads, and never assigns ──
        console.log('\nPhase 3: listing an app resolves its address without minting one');

        await test('5. with the subdomain mapping gone, listing falls back to the path form and mints nothing', async () => {
            const before = await json('/v1/admin/subdomains', { headers: { Authorization: `Bearer ${operatorToken}` } });
            assert(before.status === 200, `admin list status ${before.status}: ${JSON.stringify(before.body)}`);
            const mapping = before.body.data.sites.find((s: any) => s.subdomain === SUB);
            assert(!!mapping, `the publish assigned "${SUB}": ${JSON.stringify(before.body.data.sites)}`);

            const del = await json(`/v1/admin/subdomains/${SUB}`, { method: 'DELETE', headers: { Authorization: `Bearer ${operatorToken}` } });
            assert(del.status === 200, `delete status ${del.status}: ${JSON.stringify(del.body)}`);

            const afterDelete = await json('/v1/admin/subdomains', { headers: { Authorization: `Bearer ${operatorToken}` } });
            const countAfterDelete = afterDelete.body.data.total;

            const { body } = await v1('tools/call', { name: 'aimeat_app_list', arguments: {} }, 102);
            const app = JSON.parse(toolText(body)).apps.find((a: any) => a.filename === filename);
            assert(app.url === `${APP_ORIGIN}/${encodeURIComponent(ownerName)}/${encodeURIComponent(filename)}`,
                `expected the shared path form, got ${app.url}`);

            // appOriginUrl would have minted a fresh mapping here. resolveAppUrls only reads, so a
            // listing of someone's whole catalogue leaves the subdomain table exactly as it found it.
            const afterList = await json('/v1/admin/subdomains', { headers: { Authorization: `Bearer ${operatorToken}` } });
            assert(afterList.body.data.total === countAfterDelete,
                `listing minted ${afterList.body.data.total - countAfterDelete} subdomain(s)`);
        });

        await test('6. an app that does not exist is an error, with no address invented', async () => {
            const { body } = await v1('tools/call', { name: 'aimeat_app_get', arguments: { owner: ownerName, filename: 'no-such-app.html' } }, 103);
            assert(body.result?.isError === true, `expected isError, got ${JSON.stringify(body.result).slice(0, 200)}`);
            assert(!toolText(body).includes(APP_HOST), `the error names no address: ${toolText(body)}`);
        });

        // ── Phase 4: the managed prompts a person picks ──
        console.log('\nPhase 4: the node offers its prompt packages as MCP prompts');

        await test('7. prompts/list offers the portal packages and leaves the service templates out', async () => {
            const { status, body } = await v1('prompts/list', {}, 200);
            assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
            const names: string[] = (body.result?.prompts ?? []).map((p: any) => p.name);
            assert(names.length > 0, `expected prompts, got ${JSON.stringify(body.result)}`);
            for (const want of ['app-builder-game', 'platform-mcp', 'manifest-architect', 'csm-builder']) {
                assert(names.includes(want), `offers ${want}; got ${names.join(', ')}`);
            }
            // The librarian and living-document templates share the `builders` group with the
            // packages above, and a person has no use for them: they take a note from a service.
            for (const internal of ['notebook-classify', 'notebook-plan', 'notebook-distribute', 'living-author']) {
                assert(!names.includes(internal), `${internal} is node machinery and stays off the picker`);
            }
            // Tier handbooks are for the model, and aimeat_handbook_get already serves them.
            assert(!names.some(n => n.startsWith('tier-')), `no tier handbooks on the picker; got ${names.join(', ')}`);
        });

        await test('8. a prompt names itself, and asks only for what the node cannot fill', async () => {
            const { body } = await v1('prompts/list', {}, 201);
            const entry = (body.result?.prompts ?? []).find((p: any) => p.name === 'platform-app-builder');
            assert(!!entry, 'platform-app-builder is offered');
            assert(typeof entry.title === 'string' && entry.title.length > 0, `has a title, got ${JSON.stringify(entry.title)}`);
            assert(typeof entry.description === 'string' && entry.description.length > 0, 'has a description');
            const args: string[] = (entry.arguments ?? []).map((a: any) => a.name);
            // node_url and node_id are things the session knows, so the person is never asked.
            assert(!args.includes('node_url') && !args.includes('node_id'), `node-known variables stay off the form; got ${args.join(', ')}`);
            assert(args.includes('agent_count') && args.includes('action_count'), `the rest are offered as arguments; got ${args.join(', ')}`);
            assert(args.includes('language'), `language is offered so a Finnish body can be asked for; got ${args.join(', ')}`);
        });

        await test('9. prompts/get returns the body with the node values already substituted', async () => {
            const { status, body } = await v1('prompts/get', { name: 'platform-mcp', arguments: {} }, 202);
            assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
            const messages = body.result?.messages ?? [];
            assert(messages.length > 0, `has messages, got ${JSON.stringify(body.result)}`);
            const text = messages[0]?.content?.text ?? '';
            assert(messages[0]?.role === 'user', `the prompt arrives as the person's turn, got ${messages[0]?.role}`);
            assert(text.includes(BASE), `node_url is filled in, got: ${text.slice(0, 200)}`);
            assert(!text.includes('{{node_url}}'), 'no placeholder is left for the person to fix');
        });

        await test('10. a prompt that does not exist is an error about the NAME, not the method', async () => {
            const { body } = await v1('prompts/get', { name: 'no-such-prompt', arguments: {} }, 203);
            assert(body.error !== undefined, `expected a JSON-RPC error, got ${JSON.stringify(body).slice(0, 200)}`);
            // -32601 is "method not found", which is what a server offering no prompts at all
            // answers. Anything else means prompts/get is served and this one name is unknown.
            assert(body.error.code !== -32601, `the server serves prompts/get: ${JSON.stringify(body.error)}`);
        });

        // ── Phase 5: the app index as an MCP App ──
        console.log('\nPhase 5: the app index is a page the host can render in the conversation');

        await test('11. aimeat_app_list points at a ui:// page', async () => {
            const { body } = await v1('tools/list', {}, 300);
            const tool = (body.result?.tools ?? []).find((t: any) => t.name === 'aimeat_app_list');
            assert(!!tool, 'aimeat_app_list is listed');
            const uri = tool._meta?.ui?.resourceUri;
            assert(uri === 'ui://aimeat/app-index.html', `_meta.ui.resourceUri, got ${JSON.stringify(tool._meta)}`);
        });

        await test('12. that page is served as an MCP App resource', async () => {
            const { status, body } = await v1('resources/read', { uri: 'ui://aimeat/app-index.html' }, 301);
            assert(status === 200, `status ${status}: ${JSON.stringify(body).slice(0, 200)}`);
            const entry = (body.result?.contents ?? [])[0];
            assert(!!entry, `has contents, got ${JSON.stringify(body.result)}`);
            assert(entry.mimeType === 'text/html;profile=mcp-app', `the MCP App mime type, got ${entry.mimeType}`);
            assert(entry.text.startsWith('<!DOCTYPE html>'), 'is an HTML document');
            assert(entry.text.includes('ui/initialize'), 'speaks the MCP Apps handshake');
            assert(entry.text.includes('ui/notifications/tool-result'), 'listens for the tool result');
        });

        await test('13. the page loads nothing from anywhere (the sandbox CSP denies by default)', async () => {
            const { body } = await v1('resources/read', { uri: 'ui://aimeat/app-index.html' }, 302);
            const html: string = body.result.contents[0].text;
            // An external load would be refused by the host's deny-by-default policy and the frame
            // would render half-built, with nothing in the tool result to explain it. Declaring an
            // origin in _meta.ui.csp is the way to add one, and it is a decision worth failing over.
            for (const forbidden of ['src="http', "src='http", 'href="http', "href='http", 'src="//', '@import', 'fetch(']) {
                assert(!html.includes(forbidden), `page is self-contained; found ${forbidden}`);
            }
        });

        await test('14. an unknown ui:// page is an error rather than an empty frame', async () => {
            const { body } = await v1('resources/read', { uri: 'ui://aimeat/no-such-page.html' }, 303);
            assert(body.error !== undefined, `expected a JSON-RPC error, got ${JSON.stringify(body).slice(0, 200)}`);
        });

        console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
    } finally {
        server.kill('SIGTERM');
        await new Promise(r => setTimeout(r, 300));
        cleanupDb();
    }
    if (failed > 0) process.exit(1);
}

await main();
