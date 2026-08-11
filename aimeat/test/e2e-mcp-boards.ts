/**
 * @file e2e-mcp-boards.ts
 * @description E2E tests for MCP boards module — 7 tools + 1 resource.
 *   Tests board creation, listing, posting, reactions, replies, subscriptions,
 *   member management, deletion, and the board posts resource.
 * @version-history
 *   v1.1.0 — 2026-08-11 — August 2026 audit step 8. Three refusals the tool surface did not have
 *     before create/react/members went through services/board-write.ts: an empty board name, a
 *     reaction past 32 characters, and a roster call asking for nothing. The HTTP door has refused
 *     all three since it was written; over MCP the first two stored and the third reported success.
 *   v1.0.0 — 2026-03-21 — Initial creation
 */

// Run: cd aimeat && pnpm exec tsx test/e2e-mcp-boards.ts

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

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
    const res = await fetch(`${BASE}${path}`, {
        ...opts,
        headers: { 'Content-Type': 'application/json', ...opts.headers },
    });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text(), _ct: ct };
    return { status: res.status, body, headers: res.headers };
}

// Helper: sign a message with a base64 private key
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) =>
    new Uint8Array(createHash('sha512').update(m).digest());

async function signMsg(privateKeyB64: string, message: string): Promise<string> {
    const privKey = Buffer.from(privateKeyB64, 'base64');
    const sig = await ed.signAsync(new TextEncoder().encode(message), privKey);
    return Buffer.from(sig).toString('base64');
}

// Parse SSE text into JSON-RPC messages
function parseSSE(text: string): any[] {
    const messages: any[] = [];
    const events = text.split('\n\n');
    for (const evt of events) {
        const lines = evt.trim().split('\n');
        let data = '';
        for (const line of lines) {
            if (line.startsWith('data: ')) {
                data += line.slice(6);
            }
        }
        if (data) {
            try { messages.push(JSON.parse(data)); } catch { /* skip */ }
        }
    }
    return messages;
}

// JSON-RPC helper for MCP calls
let mcpToken = '';
let sessionId = '';

async function mcpRpc(method: string, params: Record<string, any> = {}, id: number = 1) {
    const res = await fetch(`${BASE}/v1/mcp`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
            ...(mcpToken ? { Authorization: `Bearer ${mcpToken}` } : {}),
            ...(sessionId ? { 'mcp-session-id': sessionId, 'mcp-protocol-version': '2025-03-26' } : {}),
        },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    });
    const sid = res.headers.get('mcp-session-id');
    if (sid) sessionId = sid;

    const ct = res.headers.get('content-type') ?? '';
    let body: any;
    if (ct.includes('text/event-stream')) {
        const text = await res.text();
        const messages = parseSSE(text);
        body = messages.find(m => m.id === id) ?? messages[0] ?? {};
    } else {
        body = await res.json() as any;
    }
    return { status: res.status, body, headers: res.headers };
}

// ─── State ───
let ownerToken = '';
let ownerPrivKey = '';
let agentPrivKey = '';
let agentGaii = '';
const ownerName = `mcpbrd${Date.now()}`;
const agentName = 'mcpbrdagent';

// OAuth state
let clientId = '';
let clientSecret = '';

// Board state
let boardId = '';
let postId = '';

console.log('\n=== AIMEAT MCP Boards E2E Test ===\n');

// ─── Setup: Register GHII + agent + MCP OAuth token ───
console.log('Setup — Owner, Agent, MCP OAuth');

await test('Register GHII identity', async () => {
    const { status, body } = await json('/v1/ghii', {
        method: 'POST',
        body: JSON.stringify({ username: ownerName, display_name: 'MCP Boards Test', password: 'McpBrd1234' }),
    });
    assert(status === 201, `ghii status ${status}: ${JSON.stringify(body)}`);
    ownerPrivKey = body.data.private_key;
});

await test('Owner auth token', async () => {
    const timestamp = new Date().toISOString();
    const message = ownerName + NODE_ID + timestamp;
    const signature = await signMsg(ownerPrivKey, message);
    const { body } = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner: ownerName, timestamp, signature }),
    });
    assert(body.ok === true, `token: ${JSON.stringify(body.error)}`);
    ownerToken = body.data.token;
});

await test('Register agent', async () => {
    const { status, body } = await json('/v1/agents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({
            name: agentName,
            owner: ownerName,
            capabilities: ['social'],
            model: 'gpt-4o',
            // Spelled out rather than left to the node default, because this suite covers both
            // halves of the board surface and they are separate permissions: social:write posts,
            // replies and reacts, while social:members changes who may READ a shared board — the
            // one thing the HTTP route reserves to a logged-in person.
            scopes: ['social:read', 'social:write', 'social:members', 'memory:read', 'memory:write'],
        }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    agentGaii = body.data.agent.gaii;
    agentPrivKey = body.data.private_key;
});

await test('OAuth client registration', async () => {
    const { status, body } = await json('/v1/mcp/register', {
        method: 'POST',
        body: JSON.stringify({ client_name: 'MCP Boards Test Client', redirect_uris: [] }),
    });
    assert(status === 201, `status ${status}`);
    clientId = body.client_id;
    clientSecret = body.client_secret;
});

await test('OAuth authorize + token exchange', async () => {
    const timestamp = new Date().toISOString();
    const message = agentGaii + NODE_ID + timestamp;
    const signature = await signMsg(agentPrivKey, message);
    const params = new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        gaii: agentGaii,
        signature,
        timestamp,
    });
    const { body: authBody } = await json(`/v1/mcp/authorize?${params}`);
    assert(typeof authBody.code === 'string', 'has auth code');

    const { status, body: tokenBody } = await json('/v1/mcp/token', {
        method: 'POST',
        body: JSON.stringify({
            grant_type: 'authorization_code',
            code: authBody.code,
            client_id: clientId,
            client_secret: clientSecret,
        }),
    });
    assert(status === 200, `token status ${status}`);
    mcpToken = tokenBody.access_token;
});

await test('Initialize MCP session', async () => {
    const { status, body } = await mcpRpc('initialize', {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'MCP Boards E2E', version: '1.0.0' },
    });
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.result !== undefined, 'has result');

    // Send initialized notification
    await fetch(`${BASE}/v1/mcp`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
            Authorization: `Bearer ${mcpToken}`,
            'mcp-session-id': sessionId,
            'mcp-protocol-version': '2025-03-26',
        },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    });
});

// ─── Phase 1: Board tools are registered ───
console.log('\nPhase 1 — Tool Registration');

await test('1. Board tools appear in tools/list', async () => {
    const { body } = await mcpRpc('tools/list', {}, 100);
    const toolNames = body.result.tools.map((t: any) => t.name);
    assert(toolNames.includes('aimeat_board_list'), 'has aimeat_board_list');
    assert(toolNames.includes('aimeat_board_create'), 'has aimeat_board_create');
    assert(toolNames.includes('aimeat_board_subscribe'), 'has aimeat_board_subscribe');
    assert(toolNames.includes('aimeat_board_react'), 'has aimeat_board_react');
    assert(toolNames.includes('aimeat_board_reply'), 'has aimeat_board_reply');
    assert(toolNames.includes('aimeat_board_members'), 'has aimeat_board_members');
    assert(toolNames.includes('aimeat_board_delete'), 'has aimeat_board_delete');
});

// ─── Phase 2: Board CRUD ───
console.log('\nPhase 2 — Board CRUD');

await test('2. Create a shared board', async () => {
    const { body } = await mcpRpc('tools/call', {
        name: 'aimeat_board_create',
        arguments: { name: 'mcp-boards-test', visibility: 'shared', description: 'Test board for MCP' },
    }, 101);
    assert(body.result?.content?.[0]?.text !== undefined, 'has content');
    const result = JSON.parse(body.result.content[0].text);
    assert(typeof result.id === 'string', `has id: ${result.id}`);
    assert(result.name === 'mcp-boards-test', `name: ${result.name}`);
    assert(result.visibility === 'shared', `visibility: ${result.visibility}`);
    boardId = result.id;
});

await test('3. List boards shows the new board', async () => {
    const { body } = await mcpRpc('tools/call', {
        name: 'aimeat_board_list',
        arguments: {},
    }, 102);
    const boards = JSON.parse(body.result.content[0].text);
    assert(Array.isArray(boards), 'is array');
    const found = boards.find((b: any) => b.id === boardId);
    assert(found !== undefined, 'board appears in list');
    assert(found.name === 'mcp-boards-test', `name: ${found.name}`);
});

await test('4. Create a public board succeeds (first owner is operator)', async () => {
    const { body } = await mcpRpc('tools/call', {
        name: 'aimeat_board_create',
        arguments: { name: 'public-board', visibility: 'public' },
    }, 103);
    const result = JSON.parse(body.result.content[0].text);
    assert(result.visibility === 'public', `visibility: ${result.visibility}`);
    assert(typeof result.id === 'string', 'has id');
});

await test('4b. A board with an empty name is refused', async () => {
    // The HTTP door has run BoardCreateSchema (name 1-128) since it was written. This tool declared
    // z.string(), so a nameless board stored and then showed up as a blank row in every board list.
    const { body } = await mcpRpc('tools/call', {
        name: 'aimeat_board_create',
        arguments: { name: '', visibility: 'private' },
    }, 120);
    assert(body.result.isError === true, 'isError for an empty board name');
});

// ─── Phase 3: Post, React, Reply ───
console.log('\nPhase 3 — Post, React, Reply');

await test('5. Post to board (via core aimeat_board_post)', async () => {
    const { body } = await mcpRpc('tools/call', {
        name: 'aimeat_board_post',
        arguments: { board_id: boardId, title: 'Hello MCP', body: 'Testing board posting via MCP' },
    }, 104);
    const result = JSON.parse(body.result.content[0].text);
    assert(result.posted === true, 'posted');
    assert(typeof result.id === 'string', `has post id: ${result.id}`);
    postId = result.id;
});

await test('6. React to post', async () => {
    const { body } = await mcpRpc('tools/call', {
        name: 'aimeat_board_react',
        arguments: { board_id: boardId, post_id: postId, emoji: '👍' },
    }, 105);
    const result = JSON.parse(body.result.content[0].text);
    assert(result.success === true, 'success');
});

await test('7. React to non-existent post fails', async () => {
    const { body } = await mcpRpc('tools/call', {
        name: 'aimeat_board_react',
        arguments: { board_id: boardId, post_id: 'nonexistent-post', emoji: '👍' },
    }, 106);
    assert(body.result.isError === true, 'isError');
});

await test('7b. A reaction longer than 32 characters is refused', async () => {
    // BoardReactionSchema bounds it at 1-32 on the HTTP door. Here `emoji` was z.string(), so the
    // reactions map on a post could take a key of any length from any agent.
    const { body } = await mcpRpc('tools/call', {
        name: 'aimeat_board_react',
        arguments: { board_id: boardId, post_id: postId, emoji: 'x'.repeat(64) },
    }, 121);
    assert(body.result.isError === true, 'isError for an over-long reaction');
});

await test('8. Reply to post', async () => {
    const { body } = await mcpRpc('tools/call', {
        name: 'aimeat_board_reply',
        arguments: { board_id: boardId, post_id: postId, body: 'Great post!' },
    }, 107);
    const result = JSON.parse(body.result.content[0].text);
    assert(result.reply_to === postId, `reply_to: ${result.reply_to}`);
    assert(result.title === 'Re: Hello MCP', `title: ${result.title}`);
    assert(typeof result.id === 'string', 'has reply id');
});

await test('9. Reply to non-existent post fails', async () => {
    const { body } = await mcpRpc('tools/call', {
        name: 'aimeat_board_reply',
        arguments: { board_id: boardId, post_id: 'nonexistent', body: 'test' },
    }, 108);
    assert(body.result.isError === true, 'isError');
});

// ─── Phase 4: Subscriptions ───
console.log('\nPhase 4 — Subscriptions');

await test('10. Subscribe to board', async () => {
    const { body } = await mcpRpc('tools/call', {
        name: 'aimeat_board_subscribe',
        arguments: { board_id: boardId },
    }, 109);
    const result = JSON.parse(body.result.content[0].text);
    assert(result.board_id === boardId, `board_id: ${result.board_id}`);
    assert(typeof result.subscription_id === 'string', `has subscription_id: ${result.subscription_id}`);
});

await test('11. Double subscribe fails', async () => {
    const { body } = await mcpRpc('tools/call', {
        name: 'aimeat_board_subscribe',
        arguments: { board_id: boardId },
    }, 110);
    assert(body.result.isError === true, 'isError for duplicate subscription');
});

await test('12. Subscribe to non-existent board fails', async () => {
    const { body } = await mcpRpc('tools/call', {
        name: 'aimeat_board_subscribe',
        arguments: { board_id: 'nonexistent-board-id' },
    }, 111);
    assert(body.result.isError === true, 'isError');
});

// ─── Phase 5: Member Management ───
console.log('\nPhase 5 — Member Management');

await test('13. Add member to board', async () => {
    const { body } = await mcpRpc('tools/call', {
        name: 'aimeat_board_members',
        arguments: { board_id: boardId, add: ['external-agent#someone@aimeat-fi-001-test'] },
    }, 112);
    const result = JSON.parse(body.result.content[0].text);
    assert(result.board_id === boardId, `board_id: ${result.board_id}`);
    assert(result.allowed_gaiis.includes('external-agent#someone@aimeat-fi-001-test'), 'member added');
});

await test('14. Remove member from board', async () => {
    const { body } = await mcpRpc('tools/call', {
        name: 'aimeat_board_members',
        arguments: { board_id: boardId, remove: ['external-agent#someone@aimeat-fi-001-test'] },
    }, 113);
    const result = JSON.parse(body.result.content[0].text);
    assert(!result.allowed_gaiis.includes('external-agent#someone@aimeat-fi-001-test'), 'member removed');
});

await test('15. Manage members of non-existent board fails', async () => {
    const { body } = await mcpRpc('tools/call', {
        name: 'aimeat_board_members',
        arguments: { board_id: 'nonexistent', add: ['x#y@aimeat-fi-001-test'] },
    }, 114);
    assert(body.result.isError === true, 'isError');
});

await test('15b. A member change asking for nothing is refused', async () => {
    // The HTTP door answers 400 when neither add nor remove is given. The tool wrote the unchanged
    // roster back and reported success, which reads as "the change was applied".
    const { body } = await mcpRpc('tools/call', {
        name: 'aimeat_board_members',
        arguments: { board_id: boardId },
    }, 122);
    assert(body.result.isError === true, 'isError when neither add nor remove was given');
});

// ─── Phase 6: Board Resource ───
console.log('\nPhase 6 — Board Resource');

await test('16. Read board posts via resource', async () => {
    const { status, body } = await mcpRpc('resources/read', {
        uri: `aimeat://boards/${boardId}`,
    }, 115);
    assert(status === 200, `status ${status}`);
    assert(body.result?.contents?.[0] !== undefined, 'has contents');
    const posts = JSON.parse(body.result.contents[0].text);
    assert(Array.isArray(posts), 'is array');
    // Should have at least the original post
    assert(posts.length >= 1, `expected >= 1 posts, got ${posts.length}`);
    const original = posts.find((p: any) => p.id === postId);
    assert(original !== undefined, 'original post found');
    assert(original.title === 'Hello MCP', `title: ${original.title}`);
});

await test('17. Read non-existent board resource', async () => {
    const { body } = await mcpRpc('resources/read', {
        uri: 'aimeat://boards/nonexistent-board',
    }, 116);
    assert(body.result?.contents?.[0]?.text === 'Board not found', `text: ${body.result?.contents?.[0]?.text}`);
});

// ─── Phase 7: Board Deletion ───
console.log('\nPhase 7 — Board Deletion');

await test('18. Delete board', async () => {
    const { body } = await mcpRpc('tools/call', {
        name: 'aimeat_board_delete',
        arguments: { board_id: boardId },
    }, 117);
    const result = JSON.parse(body.result.content[0].text);
    assert(result.deleted === true, 'deleted');
});

await test('19. Delete non-existent board fails', async () => {
    const { body } = await mcpRpc('tools/call', {
        name: 'aimeat_board_delete',
        arguments: { board_id: boardId },
    }, 118);
    assert(body.result.isError === true, 'isError');
});

await test('20. List boards no longer shows deleted board', async () => {
    const { body } = await mcpRpc('tools/call', {
        name: 'aimeat_board_list',
        arguments: {},
    }, 119);
    const boards = JSON.parse(body.result.content[0].text);
    const found = boards.find((b: any) => b.id === boardId);
    assert(found === undefined, 'board not in list after deletion');
});

// ─── Cleanup ───
console.log('\nCleanup');

await test('Delete owner (cascade)', async () => {
    const { status } = await json(`/v1/owners/${ownerName}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `status ${status}`);
});

// ─── Summary ───
console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed}`);
process.exit(failed > 0 ? 1 : 0);
