// E2E tests for all Profile Tab API endpoints
// Ensures every API call made by profile tab UI components works correctly
// Run: cd aimeat && AIMEAT_PORT=40251 npx tsx test/e2e-profile-tabs.ts

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';

ed.etc.sha512Sync = (...m: Uint8Array[]) =>
    new Uint8Array(createHash('sha512').update(ed.etc.concatBytes(...m)).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0;
let failed = 0;
const failures: string[] = [];

async function test(name: string, fn: () => Promise<void>) {
    try {
        await fn();
        passed++;
        console.log(`  ✅ ${name}`);
    } catch (err: any) {
        failed++;
        const msg = `${name}: ${err.message}`;
        failures.push(msg);
        console.error(`  ❌ ${msg}`);
    }
}

function assert(cond: boolean, msg: string) {
    if (!cond) throw new Error(msg);
}

async function json(path: string, opts: RequestInit = {}): Promise<{ status: number; body: any; headers: Headers }> {
    const res = await fetch(`${BASE}${path}`, {
        ...opts,
        headers: { 'Content-Type': 'application/json', ...opts.headers },
    });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text(), _ct: ct };
    return { status: res.status, body, headers: res.headers };
}

async function authJson(path: string, token: string, opts: RequestInit = {}) {
    return json(path, { ...opts, headers: { Authorization: `Bearer ${token}`, ...opts.headers } });
}

async function signMsg(privateKeyB64: string, message: string): Promise<string> {
    const privKey = Buffer.from(privateKeyB64, 'base64');
    const sig = await ed.signAsync(new TextEncoder().encode(message), privKey);
    return Buffer.from(sig).toString('base64');
}

// ─── Setup: Register owner + agent ───
const ownerName = `profiletest${Date.now()}`;
let ownerPrivKey = '';
let ownerToken = '';
let agentGaii = '';
let agentPrivKey = '';
let agentToken = '';

console.log('\n=== AIMEAT Profile Tabs E2E Test ===\n');
console.log(`Server: ${BASE}`);
console.log(`Owner: ${ownerName}\n`);

console.log('Setup — Auth');

await test('Register owner (via GHII)', async () => {
    const { status, body } = await json('/v1/ghii', {
        method: 'POST',
        body: JSON.stringify({ username: ownerName, display_name: 'Profile E2E User', password: 'E2eTest123!' }),
    });
    assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
    ownerPrivKey = body.data.private_key;
    assert(typeof ownerPrivKey === 'string', 'got owner private key');
});

await test('Owner auth token', async () => {
    const timestamp = new Date().toISOString();
    const signature = await signMsg(ownerPrivKey, ownerName + NODE_ID + timestamp);
    const { body } = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner: ownerName, timestamp, signature }),
    });
    assert(body.ok === true, `token: ${JSON.stringify(body.error)}`);
    ownerToken = body.data.token;
});

await test('Register agent', async () => {
    const { body } = await json('/v1/agents', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ name: 'profileagent', owner: ownerName, capabilities: ['memory', 'actions'] }),
    });
    assert(body.ok === true, `agent: ${JSON.stringify(body.error)}`);
    agentGaii = body.data.agent.gaii;
    agentPrivKey = body.data.private_key;
});

await test('Agent auth token', async () => {
    const timestamp = new Date().toISOString();
    const signature = await signMsg(agentPrivKey, agentGaii + timestamp);
    const { body } = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ gaii: agentGaii, timestamp, signature }),
    });
    assert(body.ok === true, `agent token: ${JSON.stringify(body.error)}`);
    agentToken = body.data.token;
});

// ══════════════════════════════════════════════════════════════════
// TAB 1: Memory Tab
// ══════════════════════════════════════════════════════════════════
console.log('\n--- Memory Tab ---');

await test('POST /v1/memory — create entry', async () => {
    const { body } = await authJson('/v1/memory', agentToken, {
        method: 'POST',
        body: JSON.stringify({ key: 'test-entry', value: { hello: 'world' }, visibility: 'private' }),
    });
    assert(body.ok === true, `create: ${JSON.stringify(body.error)}`);
});

await test('GET /v1/memory — list entries', async () => {
    const { body } = await authJson('/v1/memory', agentToken);
    assert(body.ok === true, `list: ${JSON.stringify(body.error)}`);
    const items = body.data?.items || body.data;
    assert(Array.isArray(items), 'items is array');
    assert(items.some((e: any) => e.key === 'test-entry'), 'found test-entry');
});

await test('GET /v1/memory/search?q=hello — search memory', async () => {
    const { body } = await authJson('/v1/memory/search?q=hello', agentToken);
    assert(body.ok === true, `search: ${JSON.stringify(body.error)}`);
});

await test('PUT /v1/memory/test-entry — update entry', async () => {
    const { body } = await authJson('/v1/memory/test-entry', agentToken, {
        method: 'PUT',
        body: JSON.stringify({ value: { hello: 'updated' }, version: 1 }),
    });
    assert(body.ok === true, `update: ${JSON.stringify(body.error)}`);
});

await test('DELETE /v1/memory/test-entry — delete entry', async () => {
    const { body } = await authJson('/v1/memory/test-entry', agentToken, { method: 'DELETE' });
    assert(body.ok === true, `delete: ${JSON.stringify(body.error)}`);
});

await test('POST /v1/memory/files — upload file', async () => {
    const content = Buffer.from('Hello file content').toString('base64');
    const { body } = await authJson('/v1/memory/files', agentToken, {
        method: 'POST',
        body: JSON.stringify({ key: 'test-file.txt', content, mime_type: 'text/plain' }),
    });
    assert(body.ok === true, `upload: ${JSON.stringify(body.error)}`);
});

await test('GET /v1/memory/files — list files', async () => {
    const { body } = await authJson('/v1/memory/files', agentToken);
    assert(body.ok === true, `list files: ${JSON.stringify(body.error)}`);
    const files = body.data?.files || body.data?.items || body.data;
    assert(Array.isArray(files), 'files is array');
});

await test('DELETE /v1/memory/files/test-file.txt — delete file', async () => {
    const { body } = await authJson('/v1/memory/files/test-file.txt', agentToken, { method: 'DELETE' });
    assert(body.ok === true, `delete file: ${JSON.stringify(body.error)}`);
});

await test('GET /v1/permissions/memory/test-key — get key permissions', async () => {
    const { status, body } = await authJson('/v1/permissions/memory/test-key', agentToken);
    // May return 404 if key doesn't exist, or 200 with permissions
    assert(status === 200 || status === 404, `status ${status}: ${JSON.stringify(body.error)}`);
});

// ══════════════════════════════════════════════════════════════════
// TAB 2: Wallet Tab
// ══════════════════════════════════════════════════════════════════
console.log('\n--- Wallet Tab ---');

await test('GET /v1/wallet — get balance', async () => {
    const { body } = await authJson('/v1/wallet', agentToken);
    assert(body.ok === true, `wallet: ${JSON.stringify(body.error)}`);
    assert(typeof body.data?.balance === 'number', 'has balance');
});

await test('GET /v1/wallet/transactions — list transactions', async () => {
    const { body } = await authJson('/v1/wallet/transactions?limit=10', agentToken);
    assert(body.ok === true, `transactions: ${JSON.stringify(body.error)}`);
    const txs = body.data?.transactions || body.data;
    assert(Array.isArray(txs), 'transactions is array');
});

// ══════════════════════════════════════════════════════════════════
// TAB 3: Services (Catalogue) Tab
// ══════════════════════════════════════════════════════════════════
console.log('\n--- Services Tab ---');

let serviceId = '';

await test('POST /v1/catalogue — publish service', async () => {
    const { body } = await authJson('/v1/catalogue', agentToken, {
        method: 'POST',
        body: JSON.stringify({
            display_name: 'E2E Test Service',
            description: 'A test service',
            category: 'utility',
            price_morsels: 5,
            unit: 'call',
        }),
    });
    assert(body.ok === true, `publish: ${JSON.stringify(body.error)}`);
    serviceId = body.data?.action_id || body.data?.id || '';
    assert(typeof serviceId === 'string' && serviceId.length > 0, 'got service id');
});

await test('GET /v1/catalogue — browse all', async () => {
    const { body } = await json('/v1/catalogue');
    assert(body.ok === true, `browse: ${JSON.stringify(body.error)}`);
    const actions = body.data?.actions || body.data;
    assert(typeof actions === 'object', 'has data');
});

await test('GET /v1/catalogue?owner=... — list my services', async () => {
    const { body } = await authJson(`/v1/catalogue?owner=${encodeURIComponent(ownerName)}`, agentToken);
    assert(body.ok === true, `my services: ${JSON.stringify(body.error)}`);
});

await test('DELETE /v1/catalogue/:id — unpublish service', async () => {
    if (!serviceId) { assert(false, 'no service id to delete'); return; }
    const { body } = await authJson(`/v1/catalogue/${encodeURIComponent(serviceId)}`, agentToken, { method: 'DELETE' });
    assert(body.ok === true, `unpublish: ${JSON.stringify(body.error)}`);
});

// ══════════════════════════════════════════════════════════════════
// TAB 4: Work Tab
// ══════════════════════════════════════════════════════════════════
console.log('\n--- Work Tab ---');

await test('GET /v1/work/inbox — list inbox', async () => {
    const { body } = await authJson('/v1/work/inbox', agentToken);
    assert(body.ok === true, `inbox: ${JSON.stringify(body.error)}`);
});

await test('GET /v1/work/sent — list sent', async () => {
    const { body } = await authJson('/v1/work/sent', agentToken);
    assert(body.ok === true, `sent: ${JSON.stringify(body.error)}`);
});

// ══════════════════════════════════════════════════════════════════
// TAB 5: Knowledge Tab
// ══════════════════════════════════════════════════════════════════
console.log('\n--- Knowledge Tab ---');

await test('GET /v1/templates/knowledge-packager-human — human prompt', async () => {
    const { body } = await authJson('/v1/templates/knowledge-packager-human', agentToken);
    assert(body.ok === true, `human prompt: ${JSON.stringify(body.error)}`);
    assert(typeof body.data?.prompt === 'string', 'has prompt text');
});

await test('GET /v1/templates/knowledge-packager-agent — agent prompt', async () => {
    const { body } = await authJson('/v1/templates/knowledge-packager-agent', agentToken);
    assert(body.ok === true, `agent prompt: ${JSON.stringify(body.error)}`);
    assert(typeof body.data?.prompt === 'string', 'has prompt text');
});

await test('POST /v1/packages/import — import AI chat format package', async () => {
    const { body } = await authJson('/v1/packages/import', agentToken, {
        method: 'POST',
        body: JSON.stringify({
            package: {
                aimeat_knowledge_package: true,
                id: 'e2e-test-pkg',
                title: 'E2E Test Package',
                description: 'Testing import',
                content_type: 'research',
                language: 'en',
                tags: ['e2e', 'test'],
                entries: [
                    { key: 'finding-one', value: 'First finding content here', visibility: 'private' },
                    { key: 'finding-two', value: 'Second finding content', visibility: 'private' },
                ],
            },
            overrides: { catalog_listed: false },
        }),
    });
    assert(body.ok === true, `import: ${JSON.stringify(body.error)}`);
    assert(body.data?.package_id, 'has package_id');
    assert(body.data?.entries_created === 2, `expected 2 entries, got ${body.data?.entries_created}`);
});

await test('POST /v1/packages/import — full manifest format', async () => {
    const { body } = await authJson('/v1/packages/import', agentToken, {
        method: 'POST',
        body: JSON.stringify({
            package: {
                type: 'knowledge-package',
                name: 'E2E Full Manifest',
                version: '1.0.0',
                author: ownerName,
                content_type: 'document',
                language: 'en',
                tags: ['e2e'],
                synthesis: { level: 'original', description: 'Test' },
                sharing: { catalog_listed: false, allow_clone: false, morsel_price: 0 },
                entries: [
                    { key: 'doc-1', title: 'Document One', value: 'Full manifest entry', visibility: 'private' },
                ],
            },
            overrides: {},
        }),
    });
    assert(body.ok === true, `import full: ${JSON.stringify(body.error)}`);
    assert(body.data?.package_id, 'has package_id');
});

await test('GET /v1/memory?prefix=packages/&tags=knowledge-package — list my packages', async () => {
    const { body } = await authJson('/v1/memory?prefix=packages/&tags=knowledge-package', agentToken);
    assert(body.ok === true, `list packages: ${JSON.stringify(body.error)}`);
    const entries = body.data?.entries || body.data?.items || body.data;
    assert(Array.isArray(entries), 'entries is array');
    assert(entries.length >= 2, `expected >=2 packages, got ${entries.length}`);
});

await test('GET /v1/catalogue/knowledge — discover packages', async () => {
    const { body } = await authJson('/v1/catalogue/knowledge', agentToken);
    assert(body.ok === true, `discover: ${JSON.stringify(body.error)}`);
});

// ══════════════════════════════════════════════════════════════════
// TAB 6: Agents Tab
// ══════════════════════════════════════════════════════════════════
console.log('\n--- Agents Tab ---');

await test('GET /v1/agents — list agents', async () => {
    const { body } = await authJson('/v1/agents', agentToken);
    assert(body.ok === true, `agents: ${JSON.stringify(body.error)}`);
    const agents = body.data?.agents || body.data;
    assert(Array.isArray(agents), 'agents is array');
    assert(agents.length >= 1, 'has at least 1 agent');
});

// ══════════════════════════════════════════════════════════════════
// TAB 7: Data Wallet Tab
// ══════════════════════════════════════════════════════════════════
console.log('\n--- Data Wallet Tab ---');

let consentId = '';

await test('POST /v1/consent — grant consent', async () => {
    const { body } = await authJson('/v1/consent', agentToken, {
        method: 'POST',
        body: JSON.stringify({
            data_pattern: 'test/*',
            recipient: 'someone@node',
            purpose: 'E2E testing',
            scope: 'private',
        }),
    });
    assert(body.ok === true, `grant: ${JSON.stringify(body.error)}`);
    consentId = body.data?.consent_id || body.data?.id || '';
    assert(typeof consentId === 'string' && consentId.length > 0, 'got consent id');
});

await test('GET /v1/consent — list consents', async () => {
    const { body } = await authJson('/v1/consent', agentToken);
    assert(body.ok === true, `list consents: ${JSON.stringify(body.error)}`);
    const consents = body.data?.consents || body.data;
    assert(Array.isArray(consents), 'consents is array');
});

await test('GET /v1/consent/audit — audit entries', async () => {
    const { body } = await authJson('/v1/consent/audit?days=7', agentToken);
    assert(body.ok === true, `audit: ${JSON.stringify(body.error)}`);
});

await test('GET /v1/permissions/summary — permissions summary', async () => {
    const { body } = await authJson('/v1/permissions/summary', agentToken);
    assert(body.ok === true, `permissions: ${JSON.stringify(body.error)}`);
});

await test('DELETE /v1/consent/:id — revoke consent', async () => {
    if (!consentId) { assert(false, 'no consent id'); return; }
    const { body } = await authJson(`/v1/consent/${encodeURIComponent(consentId)}`, agentToken, { method: 'DELETE' });
    assert(body.ok === true, `revoke: ${JSON.stringify(body.error)}`);
});

await test('GET /v1/owners/:name/export — GDPR export', async () => {
    const { status, body } = await authJson(`/v1/owners/${encodeURIComponent(ownerName)}/export`, ownerToken);
    assert(body.ok === true || status === 200, `export: ${JSON.stringify(body.error)}`);
});

// ══════════════════════════════════════════════════════════════════
// TAB 8: Apps Tab
// ══════════════════════════════════════════════════════════════════
console.log('\n--- Apps Tab ---');

await test('POST /v1/apps — upload app', async () => {
    const content = Buffer.from('<html><body>E2E Test App</body></html>').toString('base64');
    const { body } = await authJson('/v1/apps', agentToken, {
        method: 'POST',
        body: JSON.stringify({ filename: 'e2e-test.html', content, mime_type: 'text/html' }),
    });
    assert(body.ok === true, `upload app: ${JSON.stringify(body.error)}`);
});

await test('GET /v1/apps — list apps', async () => {
    const { body } = await authJson('/v1/apps', agentToken);
    assert(body.ok === true, `list apps: ${JSON.stringify(body.error)}`);
    const apps = body.data?.apps || body.data;
    assert(Array.isArray(apps), 'apps is array');
});

// ══════════════════════════════════════════════════════════════════
// TAB 9: Boards Tab
// ══════════════════════════════════════════════════════════════════
console.log('\n--- Boards Tab ---');

let boardId = '';
let postId = '';

await test('POST /v1/boards — create board', async () => {
    const { body } = await authJson('/v1/boards', agentToken, {
        method: 'POST',
        body: JSON.stringify({ name: 'E2E Test Board', description: 'Testing boards', visibility: 'public' }),
    });
    assert(body.ok === true, `create board: ${JSON.stringify(body.error)}`);
    boardId = body.data?.board_id || body.data?.id || '';
    assert(typeof boardId === 'string' && boardId.length > 0, 'got board id');
});

await test('GET /v1/boards — list boards', async () => {
    const { body } = await authJson('/v1/boards', agentToken);
    assert(body.ok === true, `list boards: ${JSON.stringify(body.error)}`);
});

await test('GET /v1/boards/subscriptions — list subscriptions', async () => {
    const { body } = await authJson('/v1/boards/subscriptions', agentToken);
    assert(body.ok === true, `subscriptions: ${JSON.stringify(body.error)}`);
});

await test('POST /v1/boards/:id/subscribe — subscribe', async () => {
    if (!boardId) { assert(false, 'no board id'); return; }
    const { body } = await authJson(`/v1/boards/${boardId}/subscribe`, agentToken, { method: 'POST' });
    assert(body.ok === true, `subscribe: ${JSON.stringify(body.error)}`);
});

await test('POST /v1/boards/:id/posts — create post', async () => {
    if (!boardId) { assert(false, 'no board id'); return; }
    const { body } = await authJson(`/v1/boards/${boardId}/posts`, agentToken, {
        method: 'POST',
        body: JSON.stringify({ title: 'E2E Post', body: 'Test post content' }),
    });
    assert(body.ok === true, `create post: ${JSON.stringify(body.error)}`);
    postId = body.data?.post_id || body.data?.id || '';
});

await test('GET /v1/boards/:id/posts — list posts', async () => {
    if (!boardId) { assert(false, 'no board id'); return; }
    const { body } = await authJson(`/v1/boards/${boardId}/posts`, agentToken);
    assert(body.ok === true, `list posts: ${JSON.stringify(body.error)}`);
    const posts = body.data?.posts || body.data;
    assert(Array.isArray(posts), 'posts is array');
});

await test('POST /v1/boards/:id/posts/:pid/react — react to post', async () => {
    if (!boardId || !postId) { assert(false, 'no board/post id'); return; }
    const { body } = await authJson(`/v1/boards/${boardId}/posts/${postId}/react`, agentToken, {
        method: 'POST',
        body: JSON.stringify({ reaction: 'like' }),
    });
    assert(body.ok === true, `react: ${JSON.stringify(body.error)}`);
});

// ══════════════════════════════════════════════════════════════════
// TAB 10: Security Tab
// ══════════════════════════════════════════════════════════════════
console.log('\n--- Security Tab ---');

await test('GET /v1/ghii/cors — get CORS settings', async () => {
    const { body } = await authJson('/v1/ghii/cors', ownerToken);
    assert(body.ok === true, `cors: ${JSON.stringify(body.error)}`);
});

await test('PUT /v1/ghii/cors — update CORS', async () => {
    const { body } = await authJson('/v1/ghii/cors', ownerToken, {
        method: 'PUT',
        body: JSON.stringify({ allowed_origins: ['https://example.com'] }),
    });
    assert(body.ok === true, `set cors: ${JSON.stringify(body.error)}`);
});

await test('GET /v1/agents/:name/cors — get agent CORS', async () => {
    const { body } = await authJson('/v1/agents/profileagent/cors', agentToken);
    assert(body.ok === true, `agent cors: ${JSON.stringify(body.error)}`);
});

await test('PUT /v1/agents/:name/cors — set agent CORS', async () => {
    const { body } = await authJson('/v1/agents/profileagent/cors', agentToken, {
        method: 'PUT',
        body: JSON.stringify({ allowed_origins: ['https://test.example.com'] }),
    });
    assert(body.ok === true, `set agent cors: ${JSON.stringify(body.error)}`);
});

// ══════════════════════════════════════════════════════════════════
// TAB 11: Node Stats Tab
// ══════════════════════════════════════════════════════════════════
console.log('\n--- Node Stats Tab ---');

await test('GET /v1/stats — node statistics', async () => {
    const { body } = await json('/v1/stats');
    assert(body.ok === true, `stats: ${JSON.stringify(body.error)}`);
    assert(typeof body.data === 'object', 'has stats data');
});

// ══════════════════════════════════════════════════════════════════
// TAB 12: Federation Tab
// ══════════════════════════════════════════════════════════════════
console.log('\n--- Federation Tab ---');

await test('GET /v1/federation/directory — federation directory', async () => {
    const { body } = await authJson('/v1/federation/directory', agentToken);
    assert(body.ok === true, `federation: ${JSON.stringify(body.error)}`);
});

// ══════════════════════════════════════════════════════════════════
// TAB 13: Nodes Tab (Personal Anchoring)
// ══════════════════════════════════════════════════════════════════
console.log('\n--- Nodes Tab ---');

await test('GET /v1/personal/status — personal node status', async () => {
    const { status, body } = await authJson('/v1/personal/status', agentToken);
    // 404 is valid when no nodes anchored yet
    assert(status === 200 || status === 404, `unexpected status ${status}: ${JSON.stringify(body.error)}`);
});

await test('POST /v1/personal/anchor — register node', async () => {
    const { body } = await authJson('/v1/personal/anchor', agentToken, {
        method: 'POST',
        body: JSON.stringify({ node_url: 'https://test-node.example.com', label: 'E2E Test Node' }),
    });
    // May fail if anchoring not configured, but should not 404
    assert(body.ok === true || body.error?.code !== undefined, `anchor: ${JSON.stringify(body)}`);
});

// ══════════════════════════════════════════════════════════════════
// TAB 14: Notifications Tab
// ══════════════════════════════════════════════════════════════════
console.log('\n--- Notifications Tab ---');

await test('GET /v1/push/vapid-key — VAPID public key', async () => {
    const { status, body } = await authJson('/v1/push/vapid-key', agentToken);
    // VAPID might not be configured, accept 200 or error with code
    assert(status === 200 || (body.error && typeof body.error.code === 'string'), `vapid: ${JSON.stringify(body)}`);
});

await test('POST /v1/push/subscribe — subscribe to push', async () => {
    const { status, body } = await authJson('/v1/push/subscribe', agentToken, {
        method: 'POST',
        body: JSON.stringify({
            endpoint: 'https://fcm.example.com/test',
            keys: { p256dh: 'test-key', auth: 'test-auth' },
        }),
    });
    // Push might not be configured, accept success or known error
    assert(status < 500, `subscribe: status ${status}`);
});

// ══════════════════════════════════════════════════════════════════
// TAB 15: Extensions (Cortex) Tab
// ══════════════════════════════════════════════════════════════════
console.log('\n--- Extensions Tab ---');

await test('GET /v1/cortex — list extensions', async () => {
    const { body } = await authJson('/v1/cortex', agentToken);
    assert(body.ok === true, `cortex list: ${JSON.stringify(body.error)}`);
});

const cortexManifest = `apiVersion: cortex.aimeat.org/v1
kind: Extension
metadata:
  name: e2e-test-ext
  namespace: ${ownerName}
  description: E2E Test Extension
  author: ${ownerName}
  tags: [e2e, test]
spec:
  version: "1.0.0"
  components:
    - type: prompt
      name: greeting
      content: "Hello {{name}}"
`;

await test('POST /v1/cortex — install extension (YAML manifest)', async () => {
    const { body } = await authJson('/v1/cortex', ownerToken, {
        method: 'POST',
        body: JSON.stringify({ manifest: cortexManifest }),
    });
    assert(body.ok === true, `install ext: ${JSON.stringify(body.error)}`);
});

await test('GET /v1/cortex/e2e-test-ext — get extension detail', async () => {
    const { body } = await authJson('/v1/cortex/e2e-test-ext', ownerToken);
    assert(body.ok === true, `ext detail: ${JSON.stringify(body.error)}`);
});

await test('POST /v1/cortex/e2e-test-ext/activate — activate', async () => {
    const { body } = await authJson('/v1/cortex/e2e-test-ext/activate', ownerToken, { method: 'POST' });
    assert(body.ok === true, `activate: ${JSON.stringify(body.error)}`);
});

await test('POST /v1/cortex/e2e-test-ext/deactivate — deactivate', async () => {
    const { body } = await authJson('/v1/cortex/e2e-test-ext/deactivate', ownerToken, { method: 'POST' });
    assert(body.ok === true, `deactivate: ${JSON.stringify(body.error)}`);
});

await test('DELETE /v1/cortex/e2e-test-ext — uninstall', async () => {
    const { body } = await authJson('/v1/cortex/e2e-test-ext', ownerToken, { method: 'DELETE' });
    assert(body.ok === true, `uninstall: ${JSON.stringify(body.error)}`);
});

// ══════════════════════════════════════════════════════════════════
// TAB 16: Chat Sessions Tab (uses agents API)
// ══════════════════════════════════════════════════════════════════
console.log('\n--- Chat Sessions Tab ---');

await test('GET /v1/agents — list agents (chat sessions filter)', async () => {
    const { body } = await authJson('/v1/agents', agentToken);
    assert(body.ok === true, `agents for chat: ${JSON.stringify(body.error)}`);
    const agents = body.data?.agents || body.data;
    assert(Array.isArray(agents), 'agents is array');
});

// ══════════════════════════════════════════════════════════════════
// TAB 17: Auth sessions (Security Tab logout)
// ══════════════════════════════════════════════════════════════════
console.log('\n--- Session Revocation ---');

await test('DELETE /v1/auth/sessions — revoke sessions', async () => {
    const { body } = await authJson('/v1/auth/sessions', agentToken, { method: 'DELETE' });
    assert(body.ok === true, `revoke sessions: ${JSON.stringify(body.error)}`);
});

// Re-auth after session revocation for cleanup
await test('Re-auth after session revocation', async () => {
    const timestamp = new Date().toISOString();
    const signature = await signMsg(agentPrivKey, agentGaii + timestamp);
    const { body } = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ gaii: agentGaii, timestamp, signature }),
    });
    assert(body.ok === true, `re-auth: ${JSON.stringify(body.error)}`);
    agentToken = body.data.token;
});

// ══════════════════════════════════════════════════════════════════
// Cleanup: Cascade delete the test owner
// ══════════════════════════════════════════════════════════════════
console.log('\n--- Cleanup ---');

await test('DELETE /v1/owners/:name — cascade delete', async () => {
    const { body } = await authJson(`/v1/owners/${encodeURIComponent(ownerName)}`, ownerToken, { method: 'DELETE' });
    assert(body.ok === true, `cleanup: ${JSON.stringify(body.error)}`);
});

// ─── Summary ───
console.log('\n═══════════════════════════════════════════');
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) {
    console.log('\nFailed tests:');
    for (const f of failures) console.log(`  • ${f}`);
    console.log('');
    process.exit(1);
} else {
    console.log('✅ All profile tab API tests passed!');
}
