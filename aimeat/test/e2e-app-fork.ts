/**
 * @file e2e-app-fork.ts
 * @description E2E tests for the server-side app Fork endpoint + the `forkable`
 *   permission flag. Covers: the forkable flag lifecycle (default off, PATCH
 *   on/off, carry-forward across a re-publish, cross-owner PATCH 404, type
 *   validation); fork authorization (an outsider is blocked on a non-forkable app
 *   → 403 but allowed once it is flagged forkable; the owner and the owner's own
 *   agent can always fork their own app); provenance (the fork carries
 *   manifest.forkedFrom and the copied source bytes; the child is itself not
 *   forkable by default); the paid-source paywall (an unlicensed outsider fork →
 *   402); and the input failure modes (missing new_filename → 400, unknown source
 *   → 404, duplicate target filename → 409). Backs POST
 *   /v1/apps/:owner/:filename/fork and the catalog UI's Fork button + "Allow
 *   forking" toggle.
 * @usage
 *   cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx \
 *     test/run-e2e-ci.ts --test=e2e-app-fork
 * @version-history
 *   v1.0.0 — 2026-07-07 — initial: forkable flag, fork authorization gates,
 *     provenance, paid paywall, input failure modes.
 *   v1.1.0 — 2026-07-07 — Phase 4: fork statistics + lineage — listing forks count,
 *     GET /forks (direct forks + live status), GET /lineage (cross-owner tree,
 *     2-level ancestry/descendants), and a deleted fork surviving as status=deleted.
 *   v1.2.0 — 2026-08-11 — Phase 5: the MCP door. aimeat_app_fork and aimeat_app_delete now go
 *     through the same service as the routes above, so the fork copies the source screenshot, a
 *     duplicate target gives the shared ALREADY_EXISTS answer, and a delete takes the app's
 *     screenshot with it instead of leaving it for whoever republishes the filename.
 *   v1.3.0 — 2026-08-16 — August 2026 test-quality audit, two findings. The paid-fork test read a
 *     201 as "the marketplace must be disabled" and skipped, so it passed exactly when the paywall
 *     leaked; the flag is now read from POST /v1/app-store/purchase (403 APP_STORE_DISABLED before
 *     it looks at the body) and the 402 is unconditional. Phase 5b adds the MCP door across an
 *     owner boundary: both gates in src/mcp/apps-fork.ts open with !sameOwner and every fork in
 *     phase 5 was the agent forking its own owner, so neither had ever been reached.
 */

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) =>
    new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const ownerAName = `forkowna${Date.now() % 100000}`;
const ownerBName = `forkownb${Date.now() % 100000}`;
const agentName = 'forkagent';
const SRC_FILE = 'fork-source.html';

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

async function signMsg(privateKeyB64: string, message: string): Promise<string> {
    const privKey = Buffer.from(privateKeyB64, 'base64');
    const sig = await ed.signAsync(new TextEncoder().encode(message), privKey);
    return Buffer.from(sig).toString('base64');
}

const b64 = (html: string) => Buffer.from(html, 'utf8').toString('base64');
const SRC_HTML = '<!DOCTYPE html><html><body><h1>original app</h1></body></html>';

// ── State ──
let aToken = '';
let bToken = '';
let agentGaii = '';
let agentPriv = '';
let agentToken = '';

function aAuthed(opts: RequestInit = {}): RequestInit {
    return { ...opts, headers: { ...((opts.headers ?? {}) as Record<string, string>), Authorization: `Bearer ${aToken}` } };
}
function bAuthed(opts: RequestInit = {}): RequestInit {
    return { ...opts, headers: { ...((opts.headers ?? {}) as Record<string, string>), Authorization: `Bearer ${bToken}` } };
}
function agentAuthed(opts: RequestInit = {}): RequestInit {
    return { ...opts, headers: { ...((opts.headers ?? {}) as Record<string, string>), Authorization: `Bearer ${agentToken}` } };
}

async function registerOwner(name: string): Promise<string> {
    const reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name, public_key: 'placeholder' }) });
    assert(reg.status === 201, `register ${name} status ${reg.status}: ${JSON.stringify(reg.body)}`);
    const priv = reg.body.data.private_key;
    const timestamp = new Date().toISOString();
    const signature = await signMsg(priv, name + NODE_ID + timestamp);
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp, signature }) });
    assert(tok.body.ok === true, `token ${name}: ${JSON.stringify(tok.body.error)}`);
    return tok.body.data?.token as string;
}

console.log('\n=== App Fork + forkable-flag E2E Tests ===\n');
console.log('Phase 0: Setup');

await test('Register owner A + owner B', async () => {
    aToken = await registerOwner(ownerAName);
    bToken = await registerOwner(ownerBName);
    assert(!!aToken && !!bToken, 'both owner tokens issued');
});

await test('Register A\'s agent and get its token', async () => {
    const reg = await json('/v1/agents', aAuthed({
        method: 'POST',
        body: JSON.stringify({ name: agentName, owner: ownerAName, capabilities: ['actions'], scopes: ['*'], model: 'test-model' }),
    }));
    assert(reg.status === 201, `status ${reg.status}: ${JSON.stringify(reg.body)}`);
    agentGaii = reg.body.data.agent.gaii;
    agentPriv = reg.body.data.private_key;
    const timestamp = new Date().toISOString();
    const signature = await signMsg(agentPriv, agentGaii + timestamp);
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ gaii: agentGaii, timestamp, signature }) });
    assert(tok.body.ok === true, `agent token: ${JSON.stringify(tok.body.error)}`);
    agentToken = tok.body.data?.token;
    assert(typeof agentToken === 'string', 'got agent token');
});

await test('Owner A publishes the source app', async () => {
    const { status } = await json('/v1/apps', aAuthed({
        method: 'POST',
        body: JSON.stringify({ filename: SRC_FILE, content: b64(SRC_HTML), name: 'Fork Source', description: 'the app to fork', category: 'utility', tags: ['demo'] }),
    }));
    assert(status === 201, `publish status ${status}`);
});

// ── Phase 1: the forkable flag lifecycle ──
console.log('\nPhase 1: forkable flag lifecycle');

await test('A new app is NOT forkable by default (listing forkable=false)', async () => {
    const { body } = await json('/v1/apps?limit=200');
    const mine = (body.data?.apps ?? []).find((a: any) => a.filename === SRC_FILE && a.owner === ownerAName);
    assert(!!mine, 'source app present in listing');
    assert(mine.forkable === false, `default forkable=false, got ${mine.forkable}`);
});

await test('PATCH { forkable: true } enables forking (200, forkable=true)', async () => {
    const { status, body } = await json(`/v1/apps/${SRC_FILE}`, aAuthed({ method: 'PATCH', body: JSON.stringify({ forkable: true }) }));
    assert(status === 200, `status ${status}: ${JSON.stringify(body)}`);
    assert(body.data?.forkable === true, `response forkable=true, got ${body.data?.forkable}`);
    const list = await json('/v1/apps?limit=200');
    const mine = (list.body.data?.apps ?? []).find((a: any) => a.filename === SRC_FILE && a.owner === ownerAName);
    assert(mine?.forkable === true, 'listing reflects forkable=true');
});

await test('Re-publishing a forkable app KEEPS it forkable (carry-forward)', async () => {
    const { status } = await json('/v1/apps', aAuthed({
        method: 'POST',
        body: JSON.stringify({ filename: SRC_FILE, content: b64(SRC_HTML + '<!--v2-->'), name: 'Fork Source', category: 'utility', tags: ['demo'] }),
    }));
    assert(status === 201, `re-publish status ${status}`);
    const list = await json('/v1/apps?limit=200');
    const mine = (list.body.data?.apps ?? []).find((a: any) => a.filename === SRC_FILE && a.owner === ownerAName);
    assert(mine?.forkable === true, 'still forkable after a re-publish');
});

await test('PATCH { forkable: "yes" } is rejected (400, must be boolean)', async () => {
    const { status } = await json(`/v1/apps/${SRC_FILE}`, aAuthed({ method: 'PATCH', body: JSON.stringify({ forkable: 'yes' }) }));
    assert(status === 400, `non-boolean forkable must 400, got ${status}`);
});

await test("Another owner cannot toggle A's forkable flag (PATCH → 404)", async () => {
    const { status } = await json(`/v1/apps/${SRC_FILE}`, bAuthed({ method: 'PATCH', body: JSON.stringify({ forkable: false }) }));
    assert(status === 404, `cross-owner forkable PATCH must 404, got ${status}`);
});

// ── Phase 2: fork authorization ──
console.log('\nPhase 2: fork authorization');

await test('Disable forking, then an OUTSIDER fork is blocked (403)', async () => {
    const off = await json(`/v1/apps/${SRC_FILE}`, aAuthed({ method: 'PATCH', body: JSON.stringify({ forkable: false }) }));
    assert(off.status === 200 && off.body.data?.forkable === false, 'forking disabled');
    const { status, body } = await json(`/v1/apps/${ownerAName}/${SRC_FILE}/fork`, bAuthed({
        method: 'POST', body: JSON.stringify({ new_filename: 'b-steal.html' }),
    }));
    assert(status === 403, `outsider fork of a non-forkable app must 403, got ${status}: ${JSON.stringify(body)}`);
});

await test('The OWNER can always fork their OWN app (even when not forkable) → 201', async () => {
    const { status, body } = await json(`/v1/apps/${ownerAName}/${SRC_FILE}/fork`, aAuthed({
        method: 'POST', body: JSON.stringify({ new_filename: 'a-own-fork.html' }),
    }));
    assert(status === 201, `owner self-fork must 201, got ${status}: ${JSON.stringify(body)}`);
    assert(body.data?.forked_from?.owner === ownerAName && body.data?.forked_from?.filename === SRC_FILE, 'response records forked_from source');
    assert(body.data?.forkable === false, 'the fork is itself not forkable by default');
});

await test("The owner's OWN AGENT can fork the owner's app (same owner) → 201", async () => {
    const { status, body } = await json(`/v1/apps/${ownerAName}/${SRC_FILE}/fork`, agentAuthed({
        method: 'POST', body: JSON.stringify({ new_filename: 'agent-fork.html' }),
    }));
    assert(status === 201, `agent (same owner) fork must 201, got ${status}: ${JSON.stringify(body)}`);
});

await test('Once flagged forkable, an OUTSIDER can fork it → 201 with provenance + copied bytes', async () => {
    const on = await json(`/v1/apps/${SRC_FILE}`, aAuthed({ method: 'PATCH', body: JSON.stringify({ forkable: true }) }));
    assert(on.status === 200 && on.body.data?.forkable === true, 'forking enabled');
    const { status, body } = await json(`/v1/apps/${ownerAName}/${SRC_FILE}/fork`, bAuthed({
        method: 'POST', body: JSON.stringify({ new_filename: 'b-fork.html' }),
    }));
    assert(status === 201, `outsider fork of a forkable app must 201, got ${status}: ${JSON.stringify(body)}`);
    assert(body.data?.forked_from?.owner === ownerAName, 'forked_from credits owner A');
    // The fork lands in B's catalogue and serves the copied source bytes.
    const forked = await fetch(`${BASE}/v1/apps/${ownerBName}/b-fork.html`);
    assert(forked.status === 200, `fork downloadable under B, got ${forked.status}`);
    assert((await forked.text()) === SRC_HTML + '<!--v2-->', 'fork carries the copied source bytes (latest version)');
});

await test('The fork\'s manifest records forkedFrom provenance', async () => {
    const { body } = await json('/v1/apps?limit=200', bAuthed());
    const fork = (body.data?.apps ?? []).find((a: any) => a.filename === 'b-fork.html' && a.owner === ownerBName);
    assert(!!fork, 'fork present in B\'s listing');
    assert(fork.manifest?.forkedFrom?.owner === ownerAName && fork.manifest?.forkedFrom?.filename === SRC_FILE,
        `manifest.forkedFrom points at the source, got ${JSON.stringify(fork.manifest?.forkedFrom)}`);
    assert(fork.forkable === false, 'the outsider fork is itself not forkable by default');
});

await test('Forking to a filename the caller already owns is rejected (409)', async () => {
    const { status } = await json(`/v1/apps/${ownerAName}/${SRC_FILE}/fork`, bAuthed({
        method: 'POST', body: JSON.stringify({ new_filename: 'b-fork.html' }),
    }));
    assert(status === 409, `duplicate fork target must 409, got ${status}`);
});

await test('Forking an unknown source app returns 404', async () => {
    const { status } = await json(`/v1/apps/${ownerAName}/does-not-exist.html/fork`, bAuthed({
        method: 'POST', body: JSON.stringify({ new_filename: 'x.html' }),
    }));
    assert(status === 404, `unknown source fork must 404, got ${status}`);
});

await test('Forking without new_filename is rejected (400)', async () => {
    const { status } = await json(`/v1/apps/${ownerAName}/${SRC_FILE}/fork`, bAuthed({
        method: 'POST', body: JSON.stringify({}),
    }));
    assert(status === 400, `missing new_filename must 400, got ${status}`);
});

// ── Phase 3: paid-source paywall ──
// A paid app's bytes must not be copied by an unlicensed outsider even when the
// app is forkable — the fork endpoint mirrors the read paywall (402). The owner
// (seller) can always fork their own paid app.
console.log('\nPhase 3: paid-source paywall');

const PAID_FILE = 'paid-fork-src.html';

await test('Owner A publishes a PAID, forkable app', async () => {
    const pub = await json('/v1/apps', aAuthed({
        method: 'POST',
        body: JSON.stringify({ filename: PAID_FILE, content: b64('<h1>paid app</h1>'), name: 'Paid App', description: 'costs morsels', category: 'utility', tags: [], price_morsels: 50, license_type: 'single' }),
    }));
    assert(pub.status === 201, `paid publish status ${pub.status}`);
    const on = await json(`/v1/apps/${PAID_FILE}`, aAuthed({ method: 'PATCH', body: JSON.stringify({ forkable: true }) }));
    assert(on.status === 200 && on.body.data?.forkable === true, 'paid app flagged forkable');
});

// Whether the paywall applies is a property of the NODE, and it is read from a door that has nothing
// to do with forking: POST /v1/app-store/purchase answers 403 APP_STORE_DISABLED before it looks at
// anything in the body, so an empty body is a read-only probe of config.marketplaceEnabled. It used
// to be derived from the fork response itself, which meant a 201 — the paywall failing — was read as
// "the feature must be off" and the test passed exactly when the money leaked.
async function marketplaceEnabled(): Promise<boolean> {
    const { status, body } = await json('/v1/app-store/purchase', bAuthed({ method: 'POST', body: JSON.stringify({}) }));
    if (status === 403 && body?.error?.code === 'APP_STORE_DISABLED') return false;
    assert(status === 400, `the marketplace probe must be 400 (enabled) or 403 APP_STORE_DISABLED (off), got ${status}: ${JSON.stringify(body).slice(0, 160)}`);
    return true;
}
let marketplaceOn = true;

await test('Read the marketplace flag from the node, not from the response under test', async () => {
    marketplaceOn = await marketplaceEnabled();
    console.log(`    (marketplace ${marketplaceOn ? 'enabled — the paywall must hold' : 'disabled — the paid-fork cases do not apply'})`);
});

await test('An unlicensed OUTSIDER cannot fork the paid app (402)', async () => {
    if (!marketplaceOn) { console.log('    (skipped: the node has no marketplace)'); return; }
    const { status, body } = await json(`/v1/apps/${ownerAName}/${PAID_FILE}/fork`, bAuthed({
        method: 'POST', body: JSON.stringify({ new_filename: 'b-paid-fork.html' }),
    }));
    assert(status === 402, `unlicensed outsider paid fork must 402, got ${status}: ${JSON.stringify(body)}`);
    // A 402 that still copied the bytes would be worse than no gate at all.
    const leaked = await fetch(`${BASE}/v1/apps/${ownerBName}/b-paid-fork.html`);
    assert(leaked.status === 404, `the refused fork must not exist in B's catalogue, got ${leaked.status}`);
});

await test('The seller (owner) can still fork their OWN paid app → 201', async () => {
    const { status, body } = await json(`/v1/apps/${ownerAName}/${PAID_FILE}/fork`, aAuthed({
        method: 'POST', body: JSON.stringify({ new_filename: 'a-paid-fork.html' }),
    }));
    assert(status === 201, `owner self-fork of a paid app must 201, got ${status}: ${JSON.stringify(body)}`);
    // The fork is created free (paid terms dropped).
    const { body: listBody } = await json('/v1/apps?limit=200', aAuthed());
    const fork = (listBody.data?.apps ?? []).find((a: any) => a.filename === 'a-paid-fork.html' && a.owner === ownerAName);
    assert(!!fork && !fork.manifest?.priceMorsels, 'the fork is free (source price dropped)');
});

// ── Phase 4: fork statistics + lineage ──
// By now SRC_FILE has 3 direct forks from earlier phases: a-own-fork.html (owner),
// agent-fork.html (owner's agent), b-fork.html (owner B).
console.log('\nPhase 4: fork statistics + lineage');

await test('Listing carries a forks count for the source app (>= 3)', async () => {
    const { body } = await json('/v1/apps?limit=200');
    const src = (body.data?.apps ?? []).find((a: any) => a.filename === SRC_FILE && a.owner === ownerAName);
    assert(!!src, 'source app listed');
    assert(src.forks >= 3, `expected forks >= 3, got ${src.forks}`);
});

await test('GET /forks lists the direct forks with live status', async () => {
    const { status, body } = await json(`/v1/apps/${ownerAName}/${SRC_FILE}/forks`);
    assert(status === 200, `status ${status}`);
    assert(body.data.count >= 3, `count >= 3, got ${body.data.count}`);
    const bfork = (body.data.forks ?? []).find((f: any) => f.owner === ownerBName && f.filename === 'b-fork.html');
    assert(!!bfork && bfork.status === 'public', `b-fork present + public, got ${JSON.stringify(bfork)}`);
    assert(typeof bfork.forked_at === 'string', 'fork carries a forked_at timestamp');
});

await test('GET /lineage returns the tree (self + descendants, counts)', async () => {
    const { status, body } = await json(`/v1/apps/${ownerAName}/${SRC_FILE}/lineage`);
    assert(status === 200, `status ${status}`);
    assert(body.data.self === `${ownerAName}/${SRC_FILE}`, `self id, got ${body.data.self}`);
    assert(body.data.directForkCount >= 3, `directForkCount >= 3, got ${body.data.directForkCount}`);
    const selfNode = (body.data.nodes ?? []).find((n: any) => n.id === body.data.self);
    assert(selfNode?.relation === 'self', 'self node marked relation=self');
    const bNode = (body.data.nodes ?? []).find((n: any) => n.id === `${ownerBName}/b-fork.html`);
    assert(!!bNode && bNode.relation === 'descendant', 'b-fork is a descendant node');
});

const ownerCName = `forkownc${Date.now() % 100000}`;
let cToken = '';
await test('A grandchild fork appears in the ANCESTOR lineage (2 levels deep)', async () => {
    cToken = await registerOwner(ownerCName);
    const open = await json(`/v1/apps/b-fork.html`, bAuthed({ method: 'PATCH', body: JSON.stringify({ forkable: true }) }));
    assert(open.status === 200, `owner B enabling fork on b-fork status ${open.status}`);
    const fork = await json(`/v1/apps/${ownerBName}/b-fork.html/fork`, {
        method: 'POST', headers: { Authorization: `Bearer ${cToken}` }, body: JSON.stringify({ new_filename: 'c-grandfork.html' }),
    });
    assert(fork.status === 201, `owner C fork of b-fork status ${fork.status}: ${JSON.stringify(fork.body)}`);
    const { body } = await json(`/v1/apps/${ownerAName}/${SRC_FILE}/lineage`);
    const gNode = (body.data.nodes ?? []).find((n: any) => n.id === `${ownerCName}/c-grandfork.html`);
    assert(!!gNode, 'grandchild present in the root app lineage');
    const edge = (body.data.edges ?? []).find((e: any) => e.from === `${ownerBName}/b-fork.html` && e.to === `${ownerCName}/c-grandfork.html`);
    assert(!!edge, 'edge b-fork → c-grandfork present');
    assert(body.data.descendantCount >= 4, `descendantCount >= 4, got ${body.data.descendantCount}`);
});

await test('Lineage of the grandchild shows its ancestry up to the root', async () => {
    const { body } = await json(`/v1/apps/${ownerCName}/c-grandfork.html/lineage`);
    const root = (body.data.nodes ?? []).find((n: any) => n.id === `${ownerAName}/${SRC_FILE}`);
    assert(!!root && root.relation === 'ancestor', 'root is an ancestor of the grandchild');
    const parent = (body.data.nodes ?? []).find((n: any) => n.id === `${ownerBName}/b-fork.html`);
    assert(!!parent && parent.relation === 'ancestor', 'immediate parent is an ancestor');
});

await test('A DELETED fork still appears in lineage with status=deleted', async () => {
    const del = await json(`/v1/apps/agent-fork.html`, aAuthed({ method: 'DELETE' }));
    assert(del.status === 200, `delete agent-fork status ${del.status}`);
    const { body } = await json(`/v1/apps/${ownerAName}/${SRC_FILE}/lineage`);
    const gone = (body.data.nodes ?? []).find((n: any) => n.id === `${ownerAName}/agent-fork.html`);
    assert(!!gone, 'deleted fork still present in lineage (the event log survives)');
    assert(gone.status === 'deleted', `status should be deleted, got ${gone.status}`);
});

// ── Phase 5: the MCP door performs the SAME act as the HTTP door ──
// aimeat_app_fork and aimeat_app_delete were second implementations of routes that live in
// routes/apps/fork-manage.ts. The fork never copied the source screenshot, and the delete never
// removed the app's own — so a fork made by an agent had no thumbnail, and republishing a filename
// an agent had deleted served the deleted app's picture. Both now go through
// services/app-lifecycle.ts, and these assertions are what tells the two apart.
console.log('\nPhase 5: the same act through the MCP door');

// A 1x1 PNG. Small enough to inline, real enough for decodeStrictBase64 and the mime sniffing.
const PIXEL_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function parseSSE(text: string): any[] {
    const messages: any[] = [];
    for (const evt of text.split('\n\n')) {
        let data = '';
        for (const line of evt.trim().split('\n')) {
            if (line.startsWith('data: ')) data += line.slice(6);
        }
        if (data) { try { messages.push(JSON.parse(data)); } catch { /* not a JSON frame */ } }
    }
    return messages;
}

let mcpToken = '';
let mcpSessionId = '';
let mcpRpcId = 1;

async function mcpRpc(method: string, params: Record<string, any> = {}) {
    const id = mcpRpcId++;
    const res = await fetch(`${BASE}/v1/mcp`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
            ...(mcpToken ? { Authorization: `Bearer ${mcpToken}` } : {}),
            ...(mcpSessionId ? { 'mcp-session-id': mcpSessionId, 'mcp-protocol-version': '2025-03-26' } : {}),
        },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    });
    const sid = res.headers.get('mcp-session-id');
    if (sid) mcpSessionId = sid;
    const ct = res.headers.get('content-type') ?? '';
    if (ct.includes('text/event-stream')) {
        const messages = parseSSE(await res.text());
        return messages.find(m => m.id === id) ?? messages[0] ?? {};
    }
    return await res.json() as any;
}

async function mcpCall(name: string, args: Record<string, any>): Promise<{ isError: boolean; text: string }> {
    const body = await mcpRpc('tools/call', { name, arguments: args });
    return { isError: !!body?.result?.isError, text: body?.result?.content?.[0]?.text ?? JSON.stringify(body) };
}

await test('Setup: an MCP session for owner A\'s agent', async () => {
    const { body: reg } = await json('/v1/mcp/register', {
        method: 'POST', body: JSON.stringify({ client_name: 'fork e2e client', redirect_uris: [] }),
    });
    const ts = new Date().toISOString();
    const params = new URLSearchParams({
        response_type: 'code', client_id: reg.client_id, gaii: agentGaii,
        signature: await signMsg(agentPriv, agentGaii + NODE_ID + ts), timestamp: ts,
    });
    const { body: auth } = await json(`/v1/mcp/authorize?${params}`);
    const { body: tok } = await json('/v1/mcp/token', {
        method: 'POST',
        body: JSON.stringify({ grant_type: 'authorization_code', code: auth.code, client_id: reg.client_id, client_secret: reg.client_secret }),
    });
    mcpToken = tok.access_token;
    assert(typeof mcpToken === 'string' && mcpToken.length > 10, `no MCP access token: ${JSON.stringify(tok).slice(0, 150)}`);
    const init = await mcpRpc('initialize', {
        protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'Fork E2E', version: '1.0.0' },
    });
    assert(!!init.result, `initialize failed: ${JSON.stringify(init).slice(0, 200)}`);
});

await test('aimeat_app_fork copies the source screenshot into the fork', async () => {
    const shot = await json(`/v1/apps/${ownerAName}/${SRC_FILE}/screenshot`, aAuthed({
        method: 'POST', body: JSON.stringify({ screenshot: PIXEL_PNG_B64, screenshot_mime_type: 'image/png' }),
    }));
    assert(shot.status === 200 || shot.status === 201, `setting the source screenshot: ${shot.status}`);

    const out = await mcpCall('aimeat_app_fork', {
        owner: ownerAName, filename: SRC_FILE, new_filename: 'mcp-fork.html',
    });
    assert(!out.isError, `fork over MCP failed: ${out.text.slice(0, 200)}`);

    const res = await fetch(`${BASE}/v1/apps/${ownerAName}/mcp-fork.html/screenshot`);
    assert(res.status === 200, `the fork should carry the source thumbnail, got ${res.status}`);
    assert((res.headers.get('content-type') ?? '').includes('image/png'), 'served as a PNG');
});

await test('aimeat_app_fork refuses a filename the owner already has', async () => {
    const out = await mcpCall('aimeat_app_fork', {
        owner: ownerAName, filename: SRC_FILE, new_filename: 'mcp-fork.html',
    });
    assert(out.isError, 'a duplicate fork target must be refused');
    assert(/already have an app named/.test(out.text), `expected the shared ALREADY_EXISTS wording, got: ${out.text.slice(0, 200)}`);
});

// ── Phase 5b: the MCP door across an owner boundary ──
// Every fork above is owner A's agent forking owner A's app, and both gates in src/mcp/apps-fork.ts
// start with `!sameOwner`, so neither had ever been reached. The claim that the tool "performs the
// same act as the HTTP door" is only worth something if its refusals are exercised too. Owner B
// publishes the sources; A's agent goes after them.
console.log('\nPhase 5b: the MCP fork door, across owners');

const B_LOCKED = 'b-locked.html';
const B_PAID = 'b-paid-mcp.html';

await test("Setup: owner B publishes a locked app and a paid one", async () => {
    const locked = await json('/v1/apps', bAuthed({
        method: 'POST',
        body: JSON.stringify({ filename: B_LOCKED, content: b64('<h1>b locked</h1>'), name: 'B Locked', description: 'not open for forking', category: 'utility', tags: [] }),
    }));
    assert(locked.status === 201, `B locked publish: ${locked.status} ${JSON.stringify(locked.body).slice(0, 160)}`);
    const paid = await json('/v1/apps', bAuthed({
        method: 'POST',
        body: JSON.stringify({ filename: B_PAID, content: b64('<h1>b paid</h1>'), name: 'B Paid', description: 'costs morsels', category: 'utility', tags: [], price_morsels: 50, license_type: 'single' }),
    }));
    assert(paid.status === 201, `B paid publish: ${paid.status} ${JSON.stringify(paid.body).slice(0, 160)}`);
    const on = await json(`/v1/apps/${B_PAID}`, bAuthed({ method: 'PATCH', body: JSON.stringify({ forkable: true }) }));
    assert(on.status === 200 && on.body.data?.forkable === true, 'B\'s paid app is forkable, so only the paywall can stop it');
    // A fresh publish is not forkable (services/app-publish.ts: forkable = !!live?.forkable).
    const { body: list } = await json('/v1/apps?limit=200', bAuthed());
    const lockedRow = (list.data?.apps ?? []).find((a: any) => a.filename === B_LOCKED && a.owner === ownerBName);
    assert(lockedRow?.forkable !== true, `B's locked app must not be forkable: ${JSON.stringify(lockedRow?.forkable)}`);
});

await test("aimeat_app_fork refuses another owner's NON-FORKABLE app", async () => {
    const out = await mcpCall('aimeat_app_fork', {
        owner: ownerBName, filename: B_LOCKED, new_filename: 'a-took-b-locked.html',
    });
    assert(out.isError, `the tool must refuse a locked cross-owner source, got: ${out.text.slice(0, 200)}`);
    assert(/not open for forking/.test(out.text), `expected the forkable wording, got: ${out.text.slice(0, 200)}`);
    const leaked = await fetch(`${BASE}/v1/apps/${ownerAName}/a-took-b-locked.html`);
    assert(leaked.status === 404, `the refused fork must not exist, got ${leaked.status}`);
});

await test("aimeat_app_fork refuses another owner's PAID app with no license", async () => {
    if (!marketplaceOn) { console.log('    (skipped: the node has no marketplace)'); return; }
    const out = await mcpCall('aimeat_app_fork', {
        owner: ownerBName, filename: B_PAID, new_filename: 'a-took-b-paid.html',
    });
    assert(out.isError, `the tool must refuse an unlicensed paid source, got: ${out.text.slice(0, 200)}`);
    assert(/costs 50 morsels/.test(out.text) && /Purchase it first/.test(out.text), `expected the purchase wording, got: ${out.text.slice(0, 200)}`);
    const leaked = await fetch(`${BASE}/v1/apps/${ownerAName}/a-took-b-paid.html`);
    assert(leaked.status === 404, `the refused paid fork must not exist, got ${leaked.status}`);
});

await test('…and when B opens the app, the same call succeeds (so the refusals were the gates)', async () => {
    const on = await json(`/v1/apps/${B_LOCKED}`, bAuthed({ method: 'PATCH', body: JSON.stringify({ forkable: true }) }));
    assert(on.status === 200 && on.body.data?.forkable === true, 'B opened the app for forking');
    const out = await mcpCall('aimeat_app_fork', {
        owner: ownerBName, filename: B_LOCKED, new_filename: 'a-took-b-locked.html',
    });
    assert(!out.isError, `an opened cross-owner fork must succeed: ${out.text.slice(0, 200)}`);
    const forked = await fetch(`${BASE}/v1/apps/${ownerAName}/a-took-b-locked.html`);
    assert(forked.status === 200, `the fork should now be in A's catalogue, got ${forked.status}`);
});

await test('aimeat_app_delete removes the app\'s screenshot with it', async () => {
    const DEL_FILE = 'mcp-delete-me.html';
    const pub = await json('/v1/apps', aAuthed({
        method: 'POST',
        body: JSON.stringify({
            filename: DEL_FILE, content: b64('<!DOCTYPE html><html><body><h1>delete me</h1></body></html>'),
            name: 'Delete Me', description: 'published to be deleted again', category: 'utility', tags: [],
        }),
    }));
    assert(pub.status === 201, `publish status ${pub.status}: ${JSON.stringify(pub.body).slice(0, 200)}`);
    const shot = await json(`/v1/apps/${ownerAName}/${DEL_FILE}/screenshot`, aAuthed({
        method: 'POST', body: JSON.stringify({ screenshot: PIXEL_PNG_B64, screenshot_mime_type: 'image/png' }),
    }));
    assert(shot.status === 200 || shot.status === 201, `setting the screenshot: ${shot.status}`);

    const out = await mcpCall('aimeat_app_delete', { filename: DEL_FILE });
    assert(!out.isError, `delete over MCP failed: ${out.text.slice(0, 200)}`);

    // Republish the SAME filename. The app exists again, so a 404 here can only mean the screenshot
    // went with the delete — which is the difference this test is for. Before the shared delete, the
    // new app served the deleted one's picture.
    const again = await json('/v1/apps', aAuthed({
        method: 'POST',
        body: JSON.stringify({
            filename: DEL_FILE, content: b64('<!DOCTYPE html><html><body><h1>fresh</h1></body></html>'),
            name: 'Delete Me', description: 'republished under the same name', category: 'utility', tags: [],
        }),
    }));
    assert(again.status === 201, `republish status ${again.status}`);
    const { status, body } = await json(`/v1/apps/${ownerAName}/${DEL_FILE}/screenshot`);
    assert(status === 404, `a republished filename must not inherit the deleted app's thumbnail, got ${status}`);
    assert(/Screenshot not found/.test(JSON.stringify(body)), `expected the screenshot 404, got ${JSON.stringify(body).slice(0, 160)}`);
});

// ── Summary ──
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
