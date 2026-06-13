/**
 * @file e2e-mcp-knowledge.ts
 * @description E2E tests for MCP knowledge module — 4 tools + 1 resource.
 *   Tests knowledge package listing, reading, entry contribution, links, and the
 *   knowledge resource template.
 * @version-history
 *   v1.0.0 — 2026-03-21 — Initial creation
 */

// Run: cd aimeat && pnpm exec tsx test/e2e-mcp-knowledge.ts

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
const ownerName = `mcpkwl${Date.now()}`;
const agentName = 'mcpkwlagent';

// OAuth state
let clientId = '';
let clientSecret = '';

// Knowledge state
let packageId = '';

console.log('\n=== AIMEAT MCP Knowledge E2E Test ===\n');

// ─── Setup: Register GHII + agent + MCP OAuth token ───
console.log('Setup — Owner, Agent, MCP OAuth');

await test('Register GHII identity', async () => {
    const { status, body } = await json('/v1/ghii', {
        method: 'POST',
        body: JSON.stringify({ username: ownerName, display_name: 'MCP Knowledge Test', password: 'McpKwl1234' }),
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
            capabilities: ['knowledge'],
            model: 'gpt-4o',
        }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    agentGaii = body.data.agent.gaii;
    agentPrivKey = body.data.private_key;
});

await test('OAuth client registration', async () => {
    const { status, body } = await json('/v1/mcp/register', {
        method: 'POST',
        body: JSON.stringify({ client_name: 'MCP Knowledge Test Client', redirect_uris: [] }),
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
        clientInfo: { name: 'MCP Knowledge E2E', version: '1.0.0' },
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

// ─── Phase 1: Tool registration ───
console.log('\nPhase 1 — Tool Registration');

await test('1. Knowledge tools appear in tools/list', async () => {
    const { body } = await mcpRpc('tools/list', {}, 100);
    const toolNames = body.result.tools.map((t: any) => t.name);
    assert(toolNames.includes('aimeat_knowledge_list'), 'has aimeat_knowledge_list');
    assert(toolNames.includes('aimeat_knowledge_get'), 'has aimeat_knowledge_get');
    assert(toolNames.includes('aimeat_knowledge_contribute'), 'has aimeat_knowledge_contribute');
    assert(toolNames.includes('aimeat_knowledge_links'), 'has aimeat_knowledge_links');
});

// ─── Phase 2: Create a package via HTTP, then list via MCP ───
console.log('\nPhase 2 — List packages via MCP');

await test('2. List returns empty array initially', async () => {
    const { body } = await mcpRpc('tools/call', {
        name: 'aimeat_knowledge_list',
        arguments: {},
    }, 101);
    const packages = JSON.parse(body.result.content[0].text);
    assert(Array.isArray(packages), 'is array');
});

await test('3. Import knowledge package via HTTP API (using agent token)', async () => {
    const { status, body } = await json('/v1/knowledge/import', {
        method: 'POST',
        headers: { Authorization: `Bearer ${mcpToken}` },
        body: JSON.stringify({
            package: {
                type: 'knowledge-package',
                name: 'MCP Test Package',
                version: '1.0.0',
                author: ownerName,
                content_type: 'document',
                tags: ['mcp-test'],
                language: 'en',
                maturity: 'draft',
                synthesis: { level: 'original', description: 'Test package for MCP E2E' },
                references: [],
                entries: [
                    { key: 'intro', title: 'Introduction', visibility: 'owner' },
                ],
                links: [],
                sharing: { catalog_listed: false, allow_clone: false, morsel_price: 0 },
            },
            entry_data: {
                intro: { title: 'Introduction', body: 'Hello knowledge world' },
            },
        }),
    });
    assert(status === 201, `import status ${status}: ${JSON.stringify(body)}`);
    packageId = body.data.package_id;
    assert(typeof packageId === 'string', `has package_id: ${packageId}`);
});

await test('4. List shows the imported package', async () => {
    const { body } = await mcpRpc('tools/call', {
        name: 'aimeat_knowledge_list',
        arguments: {},
    }, 102);
    const packages = JSON.parse(body.result.content[0].text);
    assert(Array.isArray(packages), 'is array');
    const found = packages.find((p: any) => p.package_id === packageId);
    assert(found !== undefined, `package ${packageId} in list`);
    assert(found.name === 'MCP Test Package', `name: ${found.name}`);
    assert(found.content_type === 'document', `content_type: ${found.content_type}`);
});

// ─── Phase 3: Get package ───
console.log('\nPhase 3 — Get Package');

await test('5. Get package returns manifest and entries', async () => {
    const { body } = await mcpRpc('tools/call', {
        name: 'aimeat_knowledge_get',
        arguments: { package_id: packageId },
    }, 103);
    assert(!body.result.isError, `unexpected error: ${body.result.content?.[0]?.text}`);
    const result = JSON.parse(body.result.content[0].text);
    assert(result.package_id === packageId, `package_id: ${result.package_id}`);
    assert(result.manifest !== null, 'has manifest');
    assert((result.manifest as any).name === 'MCP Test Package', `manifest name: ${(result.manifest as any).name}`);
    assert(Array.isArray(result.entries), 'has entries array');
});

await test('6. Get non-existent package returns error', async () => {
    const { body } = await mcpRpc('tools/call', {
        name: 'aimeat_knowledge_get',
        arguments: { package_id: 'nonexistent-package-id' },
    }, 104);
    assert(body.result.isError === true, 'isError');
});

// ─── Phase 4: Contribute ───
console.log('\nPhase 4 — Contribute Entry');

await test('7. Add entry to package', async () => {
    const { body } = await mcpRpc('tools/call', {
        name: 'aimeat_knowledge_contribute',
        arguments: {
            package_id: packageId,
            entry_key: 'chapter-1',
            content: JSON.stringify({ title: 'Chapter 1', body: 'This is the first chapter' }),
        },
    }, 105);
    assert(!body.result.isError, `unexpected error: ${body.result.content?.[0]?.text}`);
    const result = JSON.parse(body.result.content[0].text);
    assert(result.package_id === packageId, `package_id: ${result.package_id}`);
    assert(result.updated === true, `updated: ${result.updated}`);
    assert(typeof result.entry_key === 'string', `entry_key: ${result.entry_key}`);
});

await test('8. Get package shows the new entry', async () => {
    const { body } = await mcpRpc('tools/call', {
        name: 'aimeat_knowledge_get',
        arguments: { package_id: packageId },
    }, 106);
    const result = JSON.parse(body.result.content[0].text);
    assert(Array.isArray(result.entries), 'has entries');
    const chapter = result.entries.find((e: any) => e.key.includes('chapter-1'));
    assert(chapter !== undefined, 'chapter-1 entry found');
});

await test('9. Contribute plain text content', async () => {
    const { body } = await mcpRpc('tools/call', {
        name: 'aimeat_knowledge_contribute',
        arguments: {
            package_id: packageId,
            entry_key: 'notes',
            content: 'These are plain text notes',
        },
    }, 107);
    assert(!body.result.isError, `unexpected error: ${body.result.content?.[0]?.text}`);
    const result = JSON.parse(body.result.content[0].text);
    assert(result.updated === true, 'updated');
});

await test('10. Contribute to non-existent package fails', async () => {
    const { body } = await mcpRpc('tools/call', {
        name: 'aimeat_knowledge_contribute',
        arguments: {
            package_id: 'nonexistent-pkg',
            entry_key: 'test',
            content: 'test content',
        },
    }, 108);
    assert(body.result.isError === true, 'isError');
});

// ─── Phase 5: Links ───
console.log('\nPhase 5 — Knowledge Links');

await test('11. Get links for package (empty initially)', async () => {
    const { body } = await mcpRpc('tools/call', {
        name: 'aimeat_knowledge_links',
        arguments: { package_id: packageId },
    }, 109);
    assert(!body.result.isError, `unexpected error: ${body.result.content?.[0]?.text}`);
    const result = JSON.parse(body.result.content[0].text);
    assert(result.package_id === packageId, `package_id: ${result.package_id}`);
    assert(Array.isArray(result.links), 'has links array');
    assert(typeof result.count === 'number', 'has count');
});

await test('12. Create a link via HTTP API then read via MCP', async () => {
    // First import a second package to link to (use agent token so it stores under agent GAII)
    const { status: importStatus, body: importBody } = await json('/v1/knowledge/import', {
        method: 'POST',
        headers: { Authorization: `Bearer ${mcpToken}` },
        body: JSON.stringify({
            package: {
                type: 'knowledge-package',
                name: 'Linked Package',
                version: '1.0.0',
                author: ownerName,
                content_type: 'research',
                tags: ['linked'],
                language: 'en',
                maturity: 'draft',
                synthesis: { level: 'original', description: 'Package to link to' },
                references: [],
                entries: [
                    { key: 'summary', title: 'Summary', visibility: 'owner' },
                ],
                links: [],
                sharing: { catalog_listed: false, allow_clone: false, morsel_price: 0 },
            },
            entry_data: { summary: { title: 'Summary', body: 'Linked package summary' } },
        }),
    });
    assert(importStatus === 201, `import status ${importStatus}: ${JSON.stringify(importBody)}`);
    const linkedPackageId = importBody.data.package_id;

    // Create link from first package to second
    const { status: linkStatus } = await json(`/v1/knowledge/${packageId}/link`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${mcpToken}` },
        body: JSON.stringify({
            target: `packages/${linkedPackageId}/manifest`,
            relation: 'related-to',
            description: 'Test link between packages',
        }),
    });
    assert(linkStatus === 201, `link status ${linkStatus}`);

    // Read links via MCP
    const { body } = await mcpRpc('tools/call', {
        name: 'aimeat_knowledge_links',
        arguments: { package_id: packageId, direction: 'outgoing' },
    }, 110);
    const result = JSON.parse(body.result.content[0].text);
    assert(result.count >= 1, `expected >= 1 link, got ${result.count}`);
    const link = result.links.find((l: any) => l.target.includes(linkedPackageId));
    assert(link !== undefined, 'link to second package found');
    assert(link.relation === 'related-to', `relation: ${link.relation}`);
});

// ─── Phase 6: Resource ───
console.log('\nPhase 6 — Knowledge Resource');

await test('13. Read knowledge package via resource URI', async () => {
    const { status, body } = await mcpRpc('resources/read', {
        uri: `aimeat://knowledge/${packageId}`,
    }, 111);
    assert(status === 200, `status ${status}`);
    assert(body.result?.contents?.[0] !== undefined, 'has contents');
    const result = JSON.parse(body.result.contents[0].text);
    assert(result.package_id === packageId, `package_id: ${result.package_id}`);
    assert(result.manifest !== null, 'has manifest');
    assert(typeof result.entry_count === 'number', 'has entry_count');
});

await test('14. Read non-existent package resource', async () => {
    const { body } = await mcpRpc('resources/read', {
        uri: 'aimeat://knowledge/nonexistent-pkg',
    }, 112);
    assert(body.result?.contents?.[0]?.text === 'Package not found', `text: ${body.result?.contents?.[0]?.text}`);
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
