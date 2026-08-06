/**
 * @file e2e-mcp-extensions.ts
 * @description E2E tests for MCP extensions module — 2 tools + 1 resource.
 *   Tests extension listing, action invocation, and the extension details resource.
 * @version-history
 *   v1.0.0 — 2026-03-21 — Initial creation
 *   v1.1.0 — 2026-08-05 — Test 9b: ctx.files reaches the sandbox over MCP (write + read back +
 *     missing ref), guarding the makeExtensionFiles parity fix in mcp/extensions.ts
 */

// Run: cd aimeat && pnpm exec tsx test/e2e-mcp-extensions.ts

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
const ownerName = `mcpext${Date.now()}`;
const agentName = 'mcpextagent';

// OAuth state
let clientId = '';
let clientSecret = '';

// Extension state
const extName = `mcp-ext-test-${Date.now()}`;

// Minimal extension manifest + script for testing
const testManifest = `
metadata:
  name: ${extName}
  version: 1.0.0
  description: MCP extensions E2E test extension
  author: e2e-test
actions:
  - id: echo
    method: POST
    path: /echo
    script: echo_script
    input:
      type: object
      properties:
        message:
          type: string
    output:
      type: object
  - id: filewrite
    method: POST
    path: /filewrite
    script: file_script
    input:
      type: object
      properties:
        b64:
          type: string
    output:
      type: object
  - id: notifytest
    method: POST
    path: /notifytest
    script: notify_script
    input:
      type: object
      properties:
        message:
          type: string
        to:
          type: string
    output:
      type: object
limits:
  memory_mb: 16
  timeout_ms: 5000
  max_api_calls: 10
`.trim();

const testScripts = {
    echo_script: `export default async function(ctx, input) { return { echoed: input.message ?? 'hello', from: 'mcp-test' }; }`,
    // ctx.files parity with the REST door: write a file, read it back, and probe a missing ref.
    file_script: `export default async function(ctx, input) {
        if (!ctx.files) return { available: false };
        const w = await ctx.files.write('probe.txt', input.b64, { mime: 'text/plain', visibility: 'public' });
        const r = await ctx.files.read(w.key);
        const missing = await ctx.files.read('no-such-file.bin');
        return { available: true, key: w.key, url: w.url, size: w.size, readBack: r ? r.base64 : null, missing };
    }`,
    // Cross-owner notify: delivered ONLY when the target consented (extension_notify + ext:{name}).
    notify_script: `export default async function(ctx, input) {
        const sent = await ctx.notify(input.message, { title: 'cross', to: input.to });
        return { sent };
    }`,
};

console.log('\n=== AIMEAT MCP Extensions E2E Test ===\n');

// ─── Setup: Register GHII + agent + MCP OAuth token ───
console.log('Setup — Owner, Agent, MCP OAuth');

await test('Register GHII identity', async () => {
    const { status, body } = await json('/v1/ghii', {
        method: 'POST',
        body: JSON.stringify({ username: ownerName, display_name: 'MCP Ext Test', password: 'McpExt1234' }),
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
            capabilities: ['extensions'],
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
        body: JSON.stringify({ client_name: 'MCP Extensions Test Client', redirect_uris: [] }),
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
        clientInfo: { name: 'MCP Extensions E2E', version: '1.0.0' },
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

await test('1. Extension tools appear in tools/list', async () => {
    const { body } = await mcpRpc('tools/list', {}, 100);
    const toolNames = body.result.tools.map((t: any) => t.name);
    assert(toolNames.includes('aimeat_extension_list'), 'has aimeat_extension_list');
    assert(toolNames.includes('aimeat_extension_invoke'), 'has aimeat_extension_invoke');
});

// ─── Phase 2: Extension list (empty state) ───
console.log('\nPhase 2 — List Extensions (Empty)');

await test('2. aimeat_extension_list returns empty array when no active extensions', async () => {
    const { body } = await mcpRpc('tools/call', {
        name: 'aimeat_extension_list',
        arguments: {},
    }, 101);
    assert(body.result?.content?.[0]?.text !== undefined, 'has content');
    const result = JSON.parse(body.result.content[0].text);
    assert(Array.isArray(result), 'result is array');
    // May have 0 or more extensions from other tests, just check it's an array of active ones
});

// ─── Phase 3: Install + activate extension via REST, then use MCP ───
console.log('\nPhase 3 — Install Extension via REST');

await test('3. Install extension via REST', async () => {
    const { status, body } = await json('/v1/extensions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ manifest: testManifest, scripts: testScripts }),
    });
    assert(status === 201, `install status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.extension.name === extName, `name: ${body.data.extension.name}`);
    assert(body.data.extension.status === 'inactive', `status: ${body.data.extension.status}`);
});

await test('4. Activate extension via REST', async () => {
    const { status, body } = await json(`/v1/extensions/${extName}/activate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `activate status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.extension.status === 'active', `status: ${body.data.extension.status}`);
});

// ─── Phase 4: MCP extension listing ───
console.log('\nPhase 4 — MCP Extension List');

await test('5. aimeat_extension_list shows active extension', async () => {
    const { body } = await mcpRpc('tools/call', {
        name: 'aimeat_extension_list',
        arguments: {},
    }, 102);
    assert(body.result?.content?.[0]?.text !== undefined, 'has content');
    const result = JSON.parse(body.result.content[0].text);
    assert(Array.isArray(result), 'result is array');
    const ext = result.find((e: any) => e.name === extName);
    assert(ext !== undefined, `extension "${extName}" in list`);
    assert(Array.isArray(ext.actions), 'has actions array');
    assert(ext.actions.some((a: any) => a.id === 'echo'), 'has echo action');
});

// ─── Phase 5: MCP extension invocation ───
console.log('\nPhase 5 — MCP Extension Invocation');

await test('6. aimeat_extension_invoke executes echo action', async () => {
    const { body } = await mcpRpc('tools/call', {
        name: 'aimeat_extension_invoke',
        arguments: {
            extension_name: extName,
            action_id: 'echo',
            input: { message: 'hello-from-mcp' },
        },
    }, 103);
    assert(body.result?.content?.[0]?.text !== undefined, 'has content');
    assert(!body.result.isError, `not an error: ${body.result?.content?.[0]?.text}`);
    const result = JSON.parse(body.result.content[0].text);
    assert(result.echoed === 'hello-from-mcp', `echoed: ${result.echoed}`);
    assert(result.from === 'mcp-test', `from: ${result.from}`);
});

await test('7. aimeat_extension_invoke with no input uses defaults', async () => {
    const { body } = await mcpRpc('tools/call', {
        name: 'aimeat_extension_invoke',
        arguments: {
            extension_name: extName,
            action_id: 'echo',
        },
    }, 104);
    assert(body.result?.content?.[0]?.text !== undefined, 'has content');
    assert(!body.result.isError, `not an error: ${body.result?.content?.[0]?.text}`);
    const result = JSON.parse(body.result.content[0].text);
    assert(result.echoed === 'hello', `default echoed: ${result.echoed}`);
});

await test('8. aimeat_extension_invoke returns error for unknown extension', async () => {
    const { body } = await mcpRpc('tools/call', {
        name: 'aimeat_extension_invoke',
        arguments: {
            extension_name: 'nonexistent-extension',
            action_id: 'echo',
        },
    }, 105);
    assert(body.result?.isError === true, 'isError = true');
    assert(body.result.content[0].text.includes('not found'), `msg: ${body.result.content[0].text}`);
});

await test('9. aimeat_extension_invoke returns error for unknown action', async () => {
    const { body } = await mcpRpc('tools/call', {
        name: 'aimeat_extension_invoke',
        arguments: {
            extension_name: extName,
            action_id: 'nonexistent-action',
        },
    }, 106);
    assert(body.result?.isError === true, 'isError = true');
    assert(body.result.content[0].text.includes('not found'), `msg: ${body.result.content[0].text}`);
});

await test('9b. aimeat_extension_invoke gives the action ctx.files (write + read back, missing ref → null)', async () => {
    const payload = Buffer.from('mcp-files-ok').toString('base64');
    const { body } = await mcpRpc('tools/call', {
        name: 'aimeat_extension_invoke',
        arguments: {
            extension_name: extName,
            action_id: 'filewrite',
            input: { b64: payload },
        },
    }, 109);
    assert(body.result?.content?.[0]?.text !== undefined, 'has content');
    assert(!body.result.isError, `not an error: ${body.result?.content?.[0]?.text}`);
    const result = JSON.parse(body.result.content[0].text);
    assert(result.available === true, 'ctx.files is present over MCP');
    assert(result.key === `ext/${extName}/probe.txt`, `reserved ext/ prefix applied: ${result.key}`);
    assert(result.size === 12, `size: ${result.size}`);
    assert(result.readBack === payload, `read back what was written: ${result.readBack}`);
    assert(result.missing === null, 'missing ref reads as null');
});

const targetName = `mcpexttarget${Date.now()}`;
let targetToken = '';
let targetPriv = '';

await test('9c. Cross-owner notify is REFUSED without the target\'s consent', async () => {
  // A second owner who has granted nothing.
  const reg = await json('/v1/ghii', {
    method: 'POST',
    body: JSON.stringify({ username: targetName, display_name: 'Notify Target', password: 'NotifyT1234' }),
  });
  assert(reg.status === 201, `register target: ${reg.status}`);
  targetPriv = reg.body.data.private_key;
  const timestamp = new Date().toISOString();
  const signature = await signMsg(targetPriv, targetName + NODE_ID + timestamp);
  const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: targetName, timestamp, signature }) });
  assert(tok.body.ok === true, 'target token');
  targetToken = tok.body.data.token;

  const { body } = await mcpRpc('tools/call', {
    name: 'aimeat_extension_invoke',
    arguments: { extension_name: extName, action_id: 'notifytest', input: { message: 'hei', to: targetName } },
  }, 110);
  assert(!body.result.isError, `not an error: ${body.result?.content?.[0]?.text}`);
  const result = JSON.parse(body.result.content[0].text);
  assert(result.sent === false, `unconsented cross-notify must NOT deliver, sent=${result.sent}`);
});

await test('9d. Cross-owner notify DELIVERS once the target consents (extension_notify)', async () => {
  const grant = await json('/v1/consent', {
    method: 'POST', headers: { Authorization: `Bearer ${targetToken}` },
    body: JSON.stringify({ data_pattern: `ext:${extName}`, recipient: '*', purpose: 'extension_notify' }),
  });
  assert(grant.status === 201 || grant.status === 200, `consent grant: ${grant.status} ${JSON.stringify(grant.body).slice(0, 200)}`);

  const { body } = await mcpRpc('tools/call', {
    name: 'aimeat_extension_invoke',
    arguments: { extension_name: extName, action_id: 'notifytest', input: { message: 'kello soi', to: targetName } },
  }, 111);
  assert(!body.result.isError, `not an error: ${body.result?.content?.[0]?.text}`);
  const result = JSON.parse(body.result.content[0].text);
  assert(result.sent === true, `consented cross-notify should deliver, sent=${result.sent}`);

  // The notification landed in the TARGET's private list, attributed to the extension.
  const mem = await json(`/v1/memory/notifications.${targetName}`, { headers: { Authorization: `Bearer ${targetToken}` } });
  assert(mem.status === 200, `target notifications read: ${mem.status}`);
  const list = mem.body.data?.value ?? mem.body.data?.memory?.value ?? [];
  assert(Array.isArray(list) && list.some((n: any) => n.message === 'kello soi' && n.source === extName),
    `notification present for target: ${JSON.stringify(list).slice(0, 200)}`);
});

// ─── Phase 6: Extension resource ───
console.log('\nPhase 6 — Extension Resource');

await test('10. Extension resource is registered', async () => {
    const { body } = await mcpRpc('resources/list', {}, 200);
    const uris = (body.result?.resources ?? []).map((r: any) => r.uri as string);
    assert(uris.some(u => u.startsWith('aimeat://extensions/')), 'has extension resource URI');
});

await test('11. Extension resource read returns details', async () => {
    const uri = `aimeat://extensions/${encodeURIComponent(extName)}`;
    const { body } = await mcpRpc('resources/read', { uri }, 201);
    assert(body.result?.contents?.[0]?.text !== undefined, 'has content');
    const detail = JSON.parse(body.result.contents[0].text);
    assert(detail.name === extName, `name: ${detail.name}`);
    assert(detail.status === 'active', `status: ${detail.status}`);
    assert(Array.isArray(detail.actions), 'has actions');
    assert(detail.actions.some((a: any) => a.id === 'echo'), 'has echo action');
});

// ─── Phase 7: Deactivated extension not listed ───
console.log('\nPhase 7 — Deactivated Extension Hidden');

await test('12. Deactivate extension via REST', async () => {
    const { status, body } = await json(`/v1/extensions/${extName}/deactivate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
    });
    assert(status === 200, `deactivate status ${status}: ${JSON.stringify(body)}`);
    assert(body.data.extension.status === 'inactive', `status: ${body.data.extension.status}`);
});

await test('13. aimeat_extension_list does not show inactive extension', async () => {
    const { body } = await mcpRpc('tools/call', {
        name: 'aimeat_extension_list',
        arguments: {},
    }, 107);
    assert(body.result?.content?.[0]?.text !== undefined, 'has content');
    const result = JSON.parse(body.result.content[0].text);
    assert(Array.isArray(result), 'result is array');
    const ext = result.find((e: any) => e.name === extName);
    assert(ext === undefined, `inactive extension "${extName}" should not appear in list`);
});

await test('14. aimeat_extension_invoke returns error for inactive extension', async () => {
    const { body } = await mcpRpc('tools/call', {
        name: 'aimeat_extension_invoke',
        arguments: {
            extension_name: extName,
            action_id: 'echo',
            input: { message: 'should-fail' },
        },
    }, 108);
    assert(body.result?.isError === true, 'isError = true for inactive extension');
    assert(body.result.content[0].text.includes('not active'), `msg: ${body.result.content[0].text}`);
});

// ─── Summary ───
console.log(`\n${'─'.repeat(40)}`);
console.log(`${passed} passed, ${failed} failed out of ${passed + failed}`);
if (failed > 0) process.exit(1);
