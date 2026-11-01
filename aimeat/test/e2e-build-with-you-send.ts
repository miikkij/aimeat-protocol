// E2E: a store place sends its one build request itself, with the person's own account on the
// builders' node, through the MCP server the person attached for that node.
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=build-with-you-send
//
// What it guards:
//   1. Not connected: 409 BUILD_CONNECT_FIRST, nothing stored, nothing called.
//   2. An agent without mcp:use is refused by the attached server's grant check: 403, nothing stored.
//   3. The builders' node saying no is 502 BUILD_SEND_FAILED, nothing stored, so it can be sent again.
//   4. Sent: the queue's app tool got the code, the node id, the language and the four fields, over the
//      attached server with its own token; the place keeps the queue's answer, asks its getStatus, and
//      never shows the status token; a second send is refused without a call; the operator has nothing
//      to take.
// Written after the test lane's chat could not send it by itself (aimeat-commercial-1c, crew54).
//
// v1.1.0 -- 2026-11-01 -- The fields under `spec` too, on REST and over MCP (crew55: the chat sent them nested).
// v1.0.0 -- 2026-11-01 -- Initial.

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import { McpServer } from '@modelcontextprotocol/server';
import { registerOwner, ownerToken } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool } from './helpers/mcp-session.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const ADMIN_PASSWORD = process.env.AIMEAT_ADMIN_PASSWORD ?? 'test-admin-pw';
const CODE = 'RK-0000-1111-2222';
const BUILDERS_TOKEN = 'builders-own-token';

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

async function json(path: string, opts: RequestInit = {}): Promise<{ status: number; body: any; text: string }> {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const text = await res.text();
    let body: any = null;
    try { body = JSON.parse(text); } catch { body = { _raw: text }; }
    return { status: res.status, body, text };
}

const bearer = (token: string, opts: RequestInit = {}): RequestInit => ({ ...opts, headers: { ...(opts.headers as Record<string, string> ?? {}), Authorization: `Bearer ${token}` } });

// ── The stub builders' node: an MCP endpoint offering aimeat_app_tool_invoke, and the queue's getStatus ──
const toolCalls: Array<{ args: any; authorization?: string }> = [];
const statusCalls: any[] = [];
const transports = new Map<string, NodeStreamableHTTPServerTransport>();
let builders: Server;
let buildersUrl = '';

async function readBody(req: IncomingMessage): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    return Buffer.concat(chunks).toString('utf8');
}

async function serveMcp(req: IncomingMessage, res: ServerResponse, raw: string): Promise<void> {
    // The builders' node answers only the token the person's server carries.
    if (req.headers.authorization !== `Bearer ${BUILDERS_TOKEN}`) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end('{"error":"unauthorized"}');
        return;
    }
    const sid = req.headers['mcp-session-id'] as string | undefined;
    let transport = sid ? transports.get(sid) : undefined;
    if (!transport) {
        const srv = new McpServer({ name: 'e2e-builders', version: '1.0.0' });
        srv.registerTool('aimeat_app_tool_invoke', {
            description: 'Invoke an app tool.',
            inputSchema: z.object({ owner: z.string(), app: z.string(), tool: z.string(), input: z.record(z.string(), z.unknown()) }),
        }, async (args) => {
            toolCalls.push({ args, authorization: req.headers.authorization });
            const input = args.input as { spec?: { what?: string } };
            if (input.spec?.what === 'FAIL') {
                return { content: [{ type: 'text', text: 'INVALID_CODE: this build code is not known' }], isError: true };
            }
            // The envelope the builders' node wraps an app tool's answer in.
            const answer = { ok: true, tool: args.tool, result: { requestId: 'q-1', statusToken: 'tok-q', state: 'queued', position: 3, queueLength: 7 } };
            return { content: [{ type: 'text', text: JSON.stringify(answer) }] };
        });
        const created = new NodeStreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            onsessioninitialized: (id: string) => transports.set(id, created),
        });
        transport = created;
        await srv.connect(created);
    }
    await transport.handleRequest(req, res, raw ? JSON.parse(raw) : undefined);
}

async function startBuilders(): Promise<void> {
    builders = createServer(async (req, res) => {
        const raw = await readBody(req);
        if (req.url?.startsWith('/v1/mcp')) { await serveMcp(req, res, raw); return; }
        res.setHeader('Content-Type', 'application/json');
        if (req.url === '/v1/ext/builder/rakennamme/getStatus') {
            const body = raw ? JSON.parse(raw) : {};
            statusCalls.push(body);
            if (body.statusToken === 'tok-q') {
                res.end(JSON.stringify({ ok: true, data: { state: 'building', position: 1, queueLength: 7 } }));
                return;
            }
            res.end(JSON.stringify({ ok: false, error: { message: 'NOT_FOUND: no such request' } }));
            return;
        }
        res.statusCode = 404;
        res.end('{"ok":false}');
    });
    await new Promise<void>((r) => builders.listen(0, '127.0.0.1', () => r()));
    const addr = builders.address();
    buildersUrl = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
}

const stamp = Date.now().toString(36);
const operatorName = `bwsop${stamp}`;
const customerName = `bwscust${stamp}`;
let operatorToken = '';
let customerToken = '';

const spec = {
    what: 'An agent that answers the shop\'s email in Finnish',
    forWhom: 'The two people who run the shop',
    use: 'Answering the ten questions customers ask every week',
    readyWhen: 'It drafts an answer for every new email and we approve it with one press',
};
const send = (token: string, body: Record<string, unknown>) =>
    json('/v1/build-with-you/request', bearer(token, { method: 'POST', body: JSON.stringify(body) }));
const stored = async () => (await json('/v1/build-with-you/request', bearer(customerToken))).body.data.request;

console.log('\n=== Build it with you: the place sends it with the person\'s own account ===\n');
await startBuilders();

try {
    await test('setup: the operator (first account), a customer, the build code and the builders\' queue', async () => {
        await registerOwner(BASE, operatorName);
        operatorToken = await ownerToken(BASE, operatorName);
        await registerOwner(BASE, customerName);
        customerToken = await ownerToken(BASE, customerName);
        const put = await json('/v1/admin/config', bearer(operatorToken, {
            method: 'PUT', body: JSON.stringify({ changes: [
                { path: 'site.build_code', value: CODE },
                { path: 'site.build_queue_url', value: `${buildersUrl}/v1/ext/builder/rakennamme` },
            ] }),
        }));
        assert(put.status === 200, `settings: ${put.status} ${put.text}`);
    });

    await test('no credential is refused, and not connected is BUILD_CONNECT_FIRST with nothing stored or called', async () => {
        const anon = await json('/v1/build-with-you/request', { method: 'POST', body: JSON.stringify(spec) });
        assert(anon.status === 401, `no credential: ${anon.status}`);
        const post = await send(customerToken, spec);
        assert(post.status === 409 && post.body.error?.code === 'BUILD_CONNECT_FIRST', `post ${post.status} ${post.text}`);
        assert(post.text.includes('section=ac-mcp'), 'the answer says where to connect');
        assert(await stored() === null && toolCalls.length === 0, 'nothing stored, nothing called');
    });

    await test('setup: the customer attaches the builders\' node with their own token', async () => {
        const attach = await json('/v1/mcp-servers', bearer(customerToken, {
            method: 'POST', body: JSON.stringify({ name: 'aimeat', url: `${buildersUrl}/v1/mcp`, token: BUILDERS_TOKEN }),
        }));
        assert(attach.status === 201, `attach: ${attach.status} ${attach.text}`);
    });

    await test('an agent without mcp:use is refused by the server\'s grant check, and nothing is stored or called', async () => {
        const ai = await makeAgent(BASE, { name: customerName, token: customerToken }, ['memory:read', 'memory:write'], `bwsai${stamp}`);
        const s = await openSession(BASE, ai.token, 'bws-ai');
        const r = await callTool(s, 'aimeat_build_request_submit', spec);
        assert(r.isError && r.text.includes('BUILD_SEND_FAILED'), `agent: ${r.text.slice(0, 300)}`);
        assert(await stored() === null && toolCalls.length === 0, 'nothing stored, nothing called');
    });

    await test('the builders\' node saying no is 502 BUILD_SEND_FAILED with its reason, and nothing is stored', async () => {
        // REST with the fields under `spec`: the shape passes the route's validation and reaches the call.
        const post = await send(customerToken, { spec: { ...spec, what: 'FAIL' } });
        assert(post.status === 502 && post.body.error?.code === 'BUILD_SEND_FAILED' && post.text.includes('INVALID_CODE'), `post ${post.status} ${post.text}`);
        assert(toolCalls.length === 1, `calls ${toolCalls.length}`);
        assert(await stored() === null, 'a refused request is not stored, so it can be sent again');
    });

    await test('sent over MCP with the four fields under `spec`, as the status\'s `send` shows them: the queue\'s tool got them with the person\'s own token, and the place keeps the answer', async () => {
        // The place's chat holds every word, mcp:use with it; the fields go nested, as the test lane's chat sent them.
        const ai = await makeAgent(BASE, { name: customerName, token: customerToken }, ['memory:read', 'memory:write', 'mcp:use'], `bwschat${stamp}`);
        const s = await openSession(BASE, ai.token, 'bws-chat');
        const sent = await callTool(s, 'aimeat_build_request_submit', { spec, lang: 'fi' });
        assert(!sent.isError, `submit: ${sent.text.slice(0, 300)}`);
        const post = { text: sent.text, body: { data: sent.data } };
        const call = toolCalls[1];
        assert(call?.authorization === `Bearer ${BUILDERS_TOKEN}`, 'the attached server\'s own token was sent');
        assert(call.args.owner === 'builder' && call.args.app === 'rakennamme.html' && call.args.tool === 'submitRequest', `args ${JSON.stringify(call.args)}`);
        assert(call.args.input.code === CODE && call.args.input.nodeId === NODE_ID && call.args.input.lang === 'fi'
            && call.args.input.spec.readyWhen === spec.readyWhen, `input ${JSON.stringify(call.args.input)}`);
        const r = post.body.data.request;
        assert(r.state === 'queued' && r.position === 3 && r.queueLength === 7, `request ${JSON.stringify(r)}`);
        assert(!post.text.includes('tok-q'), 'the status token is not in the answer');
    });

    await test('the status read asks the queue\'s getStatus with the token, and shows its state', async () => {
        const r = await stored();
        assert(r.state === 'building' && r.position === 1, `request ${JSON.stringify(r)}`);
        assert(statusCalls.some((b) => b.requestId === 'q-1' && b.statusToken === 'tok-q' && b.nodeId === NODE_ID), `status calls ${JSON.stringify(statusCalls)}`);
    });

    await test('a second send is refused without a call, and the operator has nothing to take', async () => {
        const again = await send(customerToken, spec);
        assert(again.status === 409 && again.body.error?.code === 'BUILD_REQUEST_EXISTS', `again ${again.status} ${again.text}`);
        assert(toolCalls.length === 2, `calls ${toolCalls.length}`);
        const pending = await json('/v1/operator/build-request', { headers: { 'X-Admin-Password': ADMIN_PASSWORD } });
        assert(pending.status === 200 && pending.body.data.pending === null, `pending ${pending.text}`);
    });
} finally {
    builders.closeAllConnections();
    await new Promise<void>((r) => builders.close(() => r()));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
