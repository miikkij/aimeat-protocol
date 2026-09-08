/**
 * @file test/e2e-mcp-extensions-apps.ts
 * @description The refusal arms of the extension and app tools on the node's own MCP door, and the
 *   four app tools nothing had ever called.
 *
 *   WHY THIS SUITE EXISTS. test/e2e-mcp-extensions.ts drives the happy path of the extension tools
 *   and their lifecycle side effects. What it does not touch is every arm where the tool decides to
 *   say no: the instance that does not exist or is paused, the paywall standing in front of a priced
 *   action, the four install refusals (scripts with no manifest, a manifest with no scripts, a name
 *   already taken, an update attempted by somebody who did not install it) and the presigned upload
 *   road that a real author actually takes for anything bigger than a paragraph. Each of those is a
 *   branch in src/mcp/extensions.ts with no route behind it, so no REST suite covers it by accident.
 *
 *   The app side is worse: aimeat_app_draft_save, _publish, _discard and aimeat_app_versions are the
 *   staging workflow the build prompts tell an agent to use, and none of the four had ever been
 *   called by a test. aimeat_app_publish's own refusals — the filename rule, the crew-def validation
 *   and the presigned branch — were likewise unasserted.
 *
 *   ONE FINDING, FIXED THE SAME DAY. aimeat_app_publish refuses inline content over `appMaxSizeMb`
 *   (5 MB by default) with a message naming the limit, but /v1/mcp was parsed at `jsonBodyLimitMb`,
 *   also 5 MB, and base64 is a third larger than the bytes it carries, so the express parser
 *   answered 413 long before the tool's own check could run. server.ts parses /v1/mcp at the large
 *   limit now; test 21 asserts the tool's own message.
 *
 *   HOW IT IS BUILT. Everything is seeded through the doors the green REST suites already use, and
 *   read back through them: an extension installed over MCP is read with GET /v1/extensions, an app
 *   published over MCP is read with GET /v1/apps.
 * @structure
 *   - Phase 1: fixtures (an author owner + agent, a second owner + agent, a scope-less agent)
 *   - Phase 2: the scope fence, and an anonymous caller on the same door
 *   - Phase 3: aimeat_extension_install — the four refusals and the presigned ZIP road
 *   - Phase 4: aimeat_extension_get, and the not-found arms of activate / deactivate / delete
 *   - Phase 5: aimeat_extension_invoke — the instance checks and the paywall
 *   - Phase 6: aimeat_app_publish — bad filename, crew-defs, the presigned road, the size ceiling
 *   - Phase 7: the draft workflow and aimeat_app_versions
 *   - Phase 8: aimeat_app_delete, both refusal arms and the real delete
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=mcp-extensions-apps
 * @version-history
 *   v1.1.0 — 2026-09-08 — Test 21 asserts the tool's own ceiling now that /v1/mcp admits it.
 *   v1.0.0 — 2026-09-08 — Initial: the extension and app refusal arms, the two presigned roads, the
 *     draft workflow, and the app-size finding pinned on test 21.
 */

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
import { ZipArchive } from 'archiver';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>): Promise<void> {
    try { await fn(); passed++; console.log(`✅ ${name}`); }
    catch (e) { failed++; console.log(`❌ ${name}: ${(e as Error).message}`); }
}

function assert(cond: unknown, msg: string): asserts cond {
    if (!cond) throw new Error(msg);
}

async function json(path: string, opts: RequestInit = {}): Promise<{ status: number; body: any }> {
    for (let attempt = 0; ; attempt++) {
        const res = await fetch(`${BASE}${path}`, {
            ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers ?? {}) },
        });
        if (res.status === 429 && attempt < 5) { await new Promise((r) => setTimeout(r, 1200)); continue; }
        const text = await res.text();
        let body: any;
        try { body = JSON.parse(text); } catch { body = { _raw: text }; }
        return { status: res.status, body };
    }
}

(ed as any).hashes.sha512 = (...msgs: Uint8Array[]) => {
    const h = createHash('sha512');
    for (const m of msgs) h.update(m);
    return new Uint8Array(h.digest());
};
async function signMsg(privB64: string, msg: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(msg), Buffer.from(privB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}

const authed = (token: string): Record<string, string> => ({ Authorization: `Bearer ${token}` });

/** A ZIP in memory, for the presigned extension road. */
function makeZip(entries: { name: string; data: Buffer | string }[]): Promise<Buffer> {
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

async function makeOwner(name: string): Promise<{ token: string; owner: string; ghii: string }> {
    const owner = `${name}${Date.now().toString(36).slice(-6)}`;
    for (let attempt = 0; ; attempt++) {
        const reg = await json('/v1/ghii', {
            method: 'POST',
            body: JSON.stringify({ username: owner, display_name: owner, password: 'ExtAppsTest1234' }),
        });
        if (reg.status === 429 && attempt < 8) { await new Promise((r) => setTimeout(r, 1500)); continue; }
        assert(reg.status === 201, `registration failed: ${reg.status} ${JSON.stringify(reg.body)}`);
        const privKey = reg.body.data.private_key as string;
        const timestamp = new Date().toISOString();
        const signature = await signMsg(privKey, owner + NODE_ID + timestamp);
        const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner, timestamp, signature }) });
        assert(tok.status === 200, `token failed: ${tok.status}`);
        return { token: tok.body.data.token as string, owner, ghii: `${owner}@${NODE_ID}` };
    }
}

/** An agent token carrying exactly the scopes named — the fence this suite tests runs on them. */
async function makeAgent(
    ownerCtx: { token: string; owner: string }, scopes: string[],
): Promise<{ token: string; gaii: string; name: string }> {
    const name = `ea${Date.now().toString(36).slice(-5)}${Math.floor(Math.random() * 1000)}`;
    const reg = await json('/v1/agents', {
        method: 'POST', headers: authed(ownerCtx.token),
        body: JSON.stringify({ name, owner: ownerCtx.owner, scopes }),
    });
    assert(reg.status === 201, `agent registration failed: ${reg.status} ${JSON.stringify(reg.body)}`);
    const gaii = reg.body.data.agent.gaii as string;
    const privKey = reg.body.data.private_key as string;
    const timestamp = new Date().toISOString();
    const signature = await signMsg(privKey, gaii + timestamp);
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ gaii, timestamp, signature }) });
    assert(tok.status === 200, `agent token failed: ${tok.status}`);
    return { token: tok.body.data.token as string, gaii, name };
}

// ── The node's own MCP door ────────────────────────────────────────────────────────────────────

interface McpSession { token: string; sessionId?: string }

function parseSSE(text: string): any[] {
    return text.split('\n')
        .filter((l) => l.startsWith('data: '))
        .map((l) => { try { return JSON.parse(l.slice(6)); } catch { return null; } })
        .filter(Boolean);
}

let rpcId = 0;
const nextId = (): number => ++rpcId;

async function mcpRpc(session: McpSession, method: string, params: Record<string, any> = {}, id = nextId()): Promise<any> {
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

async function openSession(token: string): Promise<McpSession> {
    const session: McpSession = { token };
    await mcpRpc(session, 'initialize', {
        protocolVersion: '2025-03-26', capabilities: {},
        clientInfo: { name: 'e2e-mcp-extensions-apps', version: '1.0.0' },
    });
    return session;
}

/** The text an MCP tool returns, parsed. */
function toolJson(body: any): any {
    const text = body?.result?.content?.[0]?.text ?? '';
    try { return JSON.parse(text); } catch { return { _text: text }; }
}

async function toolNames(session: McpSession): Promise<string[]> {
    const names: string[] = [];
    let cursor: string | undefined;
    do {
        const body = await mcpRpc(session, 'tools/list', cursor ? { cursor } : {});
        for (const t of body?.result?.tools ?? []) names.push(t.name);
        cursor = body?.result?.nextCursor;
    } while (cursor);
    return names;
}

/** Call one tool and return both halves: the parsed answer and whether the node refused. */
async function callTool(session: McpSession, name: string, args: Record<string, unknown>): Promise<{ isError: boolean; data: any; text: string }> {
    const body = await mcpRpc(session, 'tools/call', { name, arguments: args });
    const text = body?.result?.content?.[0]?.text ?? JSON.stringify(body?.error ?? body ?? {});
    return { isError: body?.result?.isError === true || body?.error !== undefined, data: toolJson(body), text };
}

// ── The run ────────────────────────────────────────────────────────────────────────────────────

console.log('═══ E2E: the extension and app tools on the node MCP surface ═══');
console.log(`Base: ${BASE}`);

const STAMP = Date.now().toString(36).slice(-6);
const EXT = `eamcp-${STAMP}`;
const ZIP_EXT = `eazip-${STAMP}`;
const APP = `ea-app-${STAMP}.html`;
const PRESIGNED_APP = `ea-presigned-${STAMP}.html`;

const SCRIPTS = {
    echo: 'export default async function(ctx, input) { return { echo: input, caller: ctx.caller.gaii }; }',
};

const manifestYaml = (name: string): string => `
metadata:
  name: ${name}
  version: 1.0.0
  description: MCP extension and app refusal-arm E2E
  author: e2e-test
actions:
  - id: echo
    method: POST
    path: /echo
    script: echo
    input:
      type: object
      properties:
        q:
          type: string
    output:
      type: object
  - id: expensive
    method: POST
    path: /expensive
    script: echo
    input:
      type: object
    output:
      type: object
    commercial:
      payMorsels: 9999
instances:
  supported: true
  config_per_instance:
    properties: {}
config:
  api_key:
    type: secret
    default: the-secret-nobody-reads-back
limits:
  memory_mb: 16
  timeout_ms: 5000
  max_api_calls: 5
`.trim();

/**
 * The ZIP road names its scripts by FILE, not by the inline key: services/upload-zip.ts maps
 * `scripts/<file>` verbatim, so a manifest inside a ZIP references `echo.js` where an inline one
 * references `echo`. Getting that wrong answers MISSING_SCRIPT, which is what this spelling avoids.
 */
const zipManifestYaml = (name: string): string => `
metadata:
  name: ${name}
  version: 1.0.0
  description: MCP presigned extension road E2E
  author: e2e-test
actions:
  - id: echo
    method: POST
    path: /echo
    script: echo.js
    input:
      type: object
    output:
      type: object
limits:
  memory_mb: 16
  timeout_ms: 5000
  max_api_calls: 5
`.trim();

let author: Awaited<ReturnType<typeof makeOwner>>;
let stranger: Awaited<ReturnType<typeof makeOwner>>;
let authorBot: Awaited<ReturnType<typeof makeAgent>>;
let strangerBot: Awaited<ReturnType<typeof makeAgent>>;
let mute: Awaited<ReturnType<typeof makeAgent>>;
let authorSession: McpSession;
let strangerSession: McpSession;
let muteSession: McpSession;

console.log('\nPhase 1 — fixtures');

await test('1. An author owner with a fully worded agent, a second owner, and a scope-less agent', async () => {
    author = await makeOwner('eaauth');
    stranger = await makeOwner('eastr');
    authorBot = await makeAgent(author, ['ext:write', 'ext:invoke', 'app:write', 'app:manage', 'storage:write']);
    strangerBot = await makeAgent(stranger, ['ext:write', 'ext:invoke', 'app:write']);
    mute = await makeAgent(author, ['memory:read']);
    assert(authorBot.gaii.endsWith(`@${NODE_ID}`), `agent gaii: ${authorBot.gaii}`);
});

await test('2. Three MCP sessions open on /v1/mcp', async () => {
    authorSession = await openSession(authorBot.token);
    strangerSession = await openSession(strangerBot.token);
    muteSession = await openSession(mute.token);
    assert(typeof authorSession.sessionId === 'string' && authorSession.sessionId.length > 0, 'the author session got no id');
});

console.log('\nPhase 2 — the scope fence, and the same door to an anonymous caller');

await test('3. An agent with no ext or app word is handed none of those tools', async () => {
    const names = await toolNames(muteSession);
    for (const gated of ['aimeat_extension_install', 'aimeat_extension_invoke', 'aimeat_extension_activate',
        'aimeat_extension_delete', 'aimeat_app_publish', 'aimeat_app_draft_save', 'aimeat_app_draft_publish',
        'aimeat_app_draft_discard', 'aimeat_app_delete']) {
        assert(!names.includes(gated), `${gated} was offered to an agent holding only memory:read`);
    }
    // aimeat_extension_get and aimeat_app_versions are deliberately ungated — they read what a
    // published extension and a published app already say in public.
    assert(names.includes('aimeat_extension_get'), 'aimeat_extension_get is a read and needs no word');
    assert(names.includes('aimeat_app_versions'), 'aimeat_app_versions is a read and needs no word');
});

await test('4. …and the author\'s agent IS handed the gated ones', async () => {
    const names = await toolNames(authorSession);
    for (const t of ['aimeat_extension_install', 'aimeat_extension_invoke', 'aimeat_app_publish',
        'aimeat_app_draft_save', 'aimeat_app_draft_publish', 'aimeat_app_draft_discard', 'aimeat_app_delete']) {
        assert(names.includes(t), `${t} missing from the author's surface`);
    }
});

await test('5. The REST twin refuses an anonymous install (401)', async () => {
    const anon = await json('/v1/extensions', {
        method: 'POST', body: JSON.stringify({ manifest: manifestYaml(`anon-${STAMP}`), scripts: SCRIPTS }),
    });
    assert(anon.status === 401, `an anonymous caller reached the install door: ${anon.status} ${JSON.stringify(anon.body)}`);
});

console.log('\nPhase 3 — aimeat_extension_install and its four refusals');

await test('6. Scripts without a manifest is refused, and nothing is installed', async () => {
    const r = await callTool(authorSession, 'aimeat_extension_install', { scripts: SCRIPTS });
    assert(r.isError, `scripts alone installed something: ${r.text}`);
    assert(/Inline mode needs BOTH manifest and scripts/.test(r.text), `wrong refusal: ${r.text}`);
    // The failure this arm exists for: falling through to upload mode would have handed back an
    // upload_url and dropped the scripts on the floor.
    assert(!r.text.includes('upload_url'), 'the refusal handed back an upload URL instead');
});

await test('7. A manifest without scripts is refused too', async () => {
    const r = await callTool(authorSession, 'aimeat_extension_install', { manifest: manifestYaml(EXT) });
    assert(r.isError, `a manifest alone installed something: ${r.text}`);
    assert(/scripts is required when using inline mode/.test(r.text), `wrong refusal: ${r.text}`);
});

await test('8. A real inline install lands, and activates in the same call', async () => {
    const r = await callTool(authorSession, 'aimeat_extension_install', {
        manifest: manifestYaml(EXT), scripts: SCRIPTS, activate: true,
    });
    assert(!r.isError, `install refused: ${r.text}`);
    assert(r.data.action === 'installed', `action: ${r.text.slice(0, 300)}`);
    assert(r.data.status === 'active', `status: ${r.data.status}`);
    assert((r.data.actions ?? []).some((a: any) => a.id === 'echo'), `actions: ${JSON.stringify(r.data.actions)}`);

    const rest = await json(`/v1/extensions/${EXT}`, { headers: authed(author.token) });
    assert(rest.status === 200, `GET /v1/extensions/${EXT} ${rest.status}`);
    assert(rest.body.data.extension.status === 'active', `the route sees ${rest.body.data.extension.status}`);
});

await test('9. Installing the same name again without update:true is refused by name', async () => {
    const r = await callTool(authorSession, 'aimeat_extension_install', { manifest: manifestYaml(EXT), scripts: SCRIPTS });
    assert(r.isError, `a second install of the same name succeeded: ${r.text}`);
    assert(r.text.includes('already installed') && r.text.includes('update: true'),
        `the refusal must name the remedy: ${r.text}`);
});

await test('10. An update by somebody who did not install it is refused', async () => {
    const r = await callTool(strangerSession, 'aimeat_extension_install', {
        manifest: manifestYaml(EXT), scripts: SCRIPTS, update: true,
    });
    assert(r.isError, `another owner overwrote this extension in place: ${r.text}`);
    assert(r.text.includes('only the installing owner may update it'), `wrong refusal: ${r.text}`);

    // Refuse before you write: the record still belongs to its installer.
    const rest = await json(`/v1/extensions/${EXT}`, { headers: authed(author.token) });
    assert(rest.body.data.extension.installedBy === author.owner,
        `the installer changed: ${JSON.stringify(rest.body.data.extension.installedBy)}`);
});

await test('11. Omitting the manifest hands back a presigned ZIP road, and the ZIP really installs', async () => {
    const minted = await callTool(authorSession, 'aimeat_extension_install', { activate: true });
    assert(!minted.isError, `upload-mode mint refused: ${minted.text}`);
    assert(minted.data.mode === 'upload', `mode: ${minted.text.slice(0, 300)}`);
    assert(typeof minted.data.upload_url === 'string' && minted.data.upload_url.includes('/v1/upload/'),
        `upload_url: ${minted.data.upload_url}`);
    assert(minted.data.upload_method === 'PUT' && minted.data.content_type === 'application/zip',
        `the road is a PUT of a zip: ${minted.data.upload_method} ${minted.data.content_type}`);
    assert(typeof minted.data.zip_structure === 'string' && minted.data.zip_structure.includes('manifest.yaml'),
        `the answer must say what the ZIP holds: ${minted.data.zip_structure}`);

    const zip = await makeZip([
        { name: 'manifest.yaml', data: zipManifestYaml(ZIP_EXT) },
        { name: 'scripts/echo.js', data: SCRIPTS.echo },
    ]);
    const put = await fetch(minted.data.upload_url, {
        method: 'PUT', headers: { 'Content-Type': 'application/zip' }, body: zip,
    });
    const out = await put.json() as any;
    assert(put.status === 200, `PUT of the zip ${put.status}: ${JSON.stringify(out).slice(0, 300)}`);
    assert(out.name === ZIP_EXT, `the uploaded extension is named ${out.name}`);
    // The intent carried in the token rather than being dropped: `activate: true` was passed to the
    // mint, and this is the assertion that it survived into the upload.
    assert(out.status === 'active', `activate:true did not survive the presigned road: ${out.status}`);
});

console.log('\nPhase 4 — aimeat_extension_get, and the not-found arms');

await test('12. aimeat_extension_get returns the whole record, with the secret MASKED', async () => {
    const r = await callTool(authorSession, 'aimeat_extension_get', { name: EXT });
    assert(!r.isError, `extension_get refused: ${r.text}`);
    assert(r.data.name === EXT && r.data.version === '1.0.0', `name/version: ${r.text.slice(0, 300)}`);
    assert(r.data.status === 'active', `status: ${r.data.status}`);
    assert(r.data.installed_by === author.owner, `installed_by: ${r.data.installed_by}`);
    const echo = (r.data.actions ?? []).find((a: any) => a.id === 'echo');
    assert(echo !== undefined && echo.method === 'POST' && echo.path === '/echo',
        `the action descriptor did not survive: ${JSON.stringify(r.data.actions)}`);
    assert(echo.input_schema?.properties?.q !== undefined, `the input schema is part of the answer: ${JSON.stringify(echo)}`);
    assert(r.data.instances?.supported === true, `instances: ${JSON.stringify(r.data.instances)}`);
    // An API surface returns the mask for a set secret, never the value.
    assert(JSON.stringify(r.data.config ?? {}).includes('the-secret-nobody-reads-back') === false,
        `the stored secret was handed back: ${JSON.stringify(r.data.config)}`);
    assert(r.data.used_by !== undefined, 'used_by is part of the record this tool returns');
});

await test('13. aimeat_extension_get on a name that does not exist refuses', async () => {
    const r = await callTool(authorSession, 'aimeat_extension_get', { name: `no-such-${STAMP}` });
    assert(r.isError, 'an unknown extension answered as if it existed');
    assert(r.text.includes('not found'), `wrong refusal: ${r.text}`);
});

await test('14. activate, deactivate and delete all refuse a name that does not exist', async () => {
    for (const tool of ['aimeat_extension_activate', 'aimeat_extension_deactivate', 'aimeat_extension_delete']) {
        const r = await callTool(authorSession, tool, { name: `no-such-${STAMP}` });
        assert(r.isError, `${tool} answered for a name that does not exist: ${r.text}`);
        assert(r.text.includes('not found'), `${tool} wrong refusal: ${r.text}`);
    }
});

console.log('\nPhase 5 — aimeat_extension_invoke');

await test('15. A free action runs, and the caller on the record is the invoking agent', async () => {
    const r = await callTool(authorSession, 'aimeat_extension_invoke', {
        extension_name: EXT, action_id: 'echo', input: { q: STAMP },
    });
    assert(!r.isError, `invoke refused: ${r.text}`);
    assert(r.data.echo?.q === STAMP, `echo: ${r.text.slice(0, 300)}`);
    assert(r.data.caller === authorBot.gaii, `the sandbox saw ${r.data.caller}`);
});

await test('16. An instance_id that names nothing is refused before the script runs', async () => {
    const r = await callTool(authorSession, 'aimeat_extension_invoke', {
        extension_name: EXT, action_id: 'echo', input: { q: 'x' }, instance_id: `ghost-${STAMP}`,
    });
    assert(r.isError, `an unknown instance ran the action: ${r.text}`);
    assert(r.text.includes('not found') && r.text.includes(`ghost-${STAMP}`),
        `the refusal must name the instance: ${r.text}`);
});

await test('17. …and a PAUSED instance is refused with the reason, not with "not found"', async () => {
    const made = await json(`/v1/extensions/${EXT}/instances`, {
        method: 'POST', headers: authed(author.token), body: JSON.stringify({ id: 'tenant-a', config: {} }),
    });
    assert(made.status === 201, `instance create ${made.status}: ${JSON.stringify(made.body)}`);

    const live = await callTool(authorSession, 'aimeat_extension_invoke', {
        extension_name: EXT, action_id: 'echo', input: { q: 'tenant' }, instance_id: 'tenant-a',
    });
    assert(!live.isError, `an active instance was refused: ${live.text}`);

    const paused = await json(`/v1/extensions/${EXT}/instances/tenant-a`, {
        method: 'PATCH', headers: authed(author.token), body: JSON.stringify({ status: 'paused' }),
    });
    assert(paused.status === 200, `pause ${paused.status}: ${JSON.stringify(paused.body)}`);

    const r = await callTool(authorSession, 'aimeat_extension_invoke', {
        extension_name: EXT, action_id: 'echo', input: { q: 'tenant' }, instance_id: 'tenant-a',
    });
    assert(r.isError, `a paused instance ran the action: ${r.text}`);
    assert(r.text.includes('is not active'), `wrong refusal: ${r.text}`);
});

await test('18. A priced action from another owner\'s agent meets the paywall over MCP too', async () => {
    // The owner and their own principals are free; everybody else pays or holds an entitlement. This
    // tool used to execute the script without asking, so a priced action was free through a tool call
    // and metered over HTTP. Priced above any welcome balance, so the refusal is deterministic.
    const r = await callTool(strangerSession, 'aimeat_extension_invoke', {
        extension_name: EXT, action_id: 'expensive', input: { q: 'free ride' },
    });
    assert(r.isError, `a priced action ran free through the tool door: ${r.text}`);
    assert(/^[A-Z_]+ \(\d{3}\):/.test(r.text), `a paywall refusal carries its code and status: ${r.text}`);
    assert(r.text.includes('402'), `expected a payment refusal, got: ${r.text}`);

    // …and the owner's own agent is not charged for its own tool, which is what makes the fence a
    // fence rather than a wall.
    const free = await callTool(authorSession, 'aimeat_extension_invoke', {
        extension_name: EXT, action_id: 'expensive', input: { q: 'my own tool' },
    });
    assert(!free.isError, `the owner's own agent was charged for its own action: ${free.text}`);
});

console.log('\nPhase 6 — aimeat_app_publish');

await test('19. A filename outside the rule is refused, and the rule is stated', async () => {
    const r = await callTool(authorSession, 'aimeat_app_publish', {
        filename: 'not a valid name!.html', name: 'Bad name',
        content_base64: Buffer.from('<!doctype html><title>x</title>', 'utf8').toString('base64'),
    });
    assert(r.isError, `an invalid filename was published: ${r.text}`);
    assert(/Invalid filename/.test(r.text) && /Max 100 chars/.test(r.text), `wrong refusal: ${r.text}`);
});

await test('20. A malformed cortex_agents entry rejects the publish before anything is written', async () => {
    const r = await callTool(authorSession, 'aimeat_app_publish', {
        filename: `ea-crew-${STAMP}.html`, name: 'Crew app',
        content_base64: Buffer.from('<!doctype html><title>crew</title>', 'utf8').toString('base64'),
        cortex_agents: [{ not_a_crew_def: true }],
    });
    assert(r.isError, `a malformed crew-def reached a fleet: ${r.text}`);
    assert(/Invalid cortex_agents/.test(r.text), `wrong refusal: ${r.text}`);

    const gone = await json(`/v1/apps/${encodeURIComponent(author.owner)}/ea-crew-${STAMP}.html/versions`);
    assert(gone.status === 404, `a refused publish left an app: ${gone.status}`);
});

await test('21. The inline size ceiling answers with the tool\'s own message', async () => {
    // aimeat_app_publish refuses content over config.appMaxSizeMb (5 MB) with a message naming the
    // limit. Until 2026-09-08 /v1/mcp was parsed at config.jsonBodyLimitMb, the same 5 MB, and
    // base64 carries a third more bytes than it encodes, so express answered 413 first; server.ts
    // now parses /v1/mcp at the large limit like the file doors it fronts.
    const html = Buffer.alloc(5 * 1024 * 1024 + 1024, 0x61);
    const r = await callTool(authorSession, 'aimeat_app_publish',
        { filename: `ea-huge-${STAMP}.html`, name: 'Too big', content_base64: html.toString('base64') });
    assert(r.isError, `a 5 MB + 1 kB app went through: ${r.text.slice(0, 200)}`);
    assert(r.text.includes('exceeds 5MB'), `the tool's own ceiling answers: ${r.text.slice(0, 200)}`);
    const gone = await json(`/v1/apps/ea-huge-${STAMP}.html`);
    assert(gone.status === 404, `a refused publish left an app: ${gone.status}`);
});

await test('22. A real inline publish lands, and GET /v1/apps sees it', async () => {
    const r = await callTool(authorSession, 'aimeat_app_publish', {
        filename: APP, name: `Extension and app doors ${STAMP}`,
        description: 'The app this suite stages a draft on',
        category: 'tool', icon: '🔧', tags: ['e2e'],
        content_base64: Buffer.from(`<!doctype html><title>v1 ${STAMP}</title><h1>version one</h1>`, 'utf8').toString('base64'),
        roadmap: 'First version, published straight to live.',
    });
    assert(!r.isError, `publish refused: ${r.text}`);
    assert(r.data.mode === 'inline' && r.data.filename === APP, `mode/filename: ${r.text.slice(0, 300)}`);
    assert(r.data.version_number === 1, `version_number: ${r.data.version_number}`);
    assert(r.data.is_update === false, `a first publish is not an update: ${r.data.is_update}`);

    const listed = await json('/v1/apps', { headers: authed(author.token) });
    assert(listed.status === 200, `GET /v1/apps ${listed.status}`);
    assert((listed.body.data.apps ?? []).some((a: any) => a.filename === APP), `the app is not listed: ${APP}`);
});

await test('23. Omitting the content hands back a presigned road, and the PUT publishes', async () => {
    const minted = await callTool(authorSession, 'aimeat_app_publish', {
        filename: PRESIGNED_APP, name: `Presigned ${STAMP}`, category: 'tool',
        description: 'The app this suite publishes through the presigned upload road rather than inline.',
        roadmap: 'Published through the upload road.',
    });
    assert(!minted.isError, `upload-mode mint refused: ${minted.text}`);
    assert(minted.data.mode === 'upload', `mode: ${minted.text.slice(0, 300)}`);
    assert(typeof minted.data.upload_url === 'string' && minted.data.upload_url.includes('/v1/upload/'),
        `upload_url: ${minted.data.upload_url}`);
    assert(minted.data.content_type === 'text/html', `content_type: ${minted.data.content_type}`);

    const put = await fetch(minted.data.upload_url, {
        method: 'PUT', headers: { 'Content-Type': 'text/html' },
        body: `<!doctype html><title>presigned ${STAMP}</title><h1>uploaded</h1>`,
    });
    const out = await put.json() as any;
    assert(put.status === 200, `PUT of the html ${put.status}: ${JSON.stringify(out).slice(0, 300)}`);
    assert(out.filename === PRESIGNED_APP, `the uploaded app is named ${out.filename}`);

    const versions = await json(`/v1/apps/${encodeURIComponent(author.owner)}/${PRESIGNED_APP}/versions`);
    assert(versions.status === 200, `the presigned app is not readable: ${versions.status}`);
    assert(versions.body.data.total === 1, `the presigned publish made ${versions.body.data.total} versions`);
});

console.log('\nPhase 7 — the draft workflow and the version list');

await test('24. aimeat_app_draft_save stages the next version WITHOUT touching the live one', async () => {
    const r = await callTool(authorSession, 'aimeat_app_draft_save', {
        filename: APP, name: `Extension and app doors ${STAMP}`,
        content_base64: Buffer.from(`<!doctype html><title>v2 ${STAMP}</title><h1>version two</h1>`, 'utf8').toString('base64'),
    });
    assert(!r.isError, `draft_save refused: ${r.text}`);
    assert(r.data.saved === true, `saved: ${r.text.slice(0, 300)}`);
    assert(r.data.has_live_version === true && r.data.live_version_number === 1,
        `the live version is not reported: ${r.data.has_live_version} / ${r.data.live_version_number}`);
    assert(typeof r.data.preview_url === 'string' && r.data.preview_url.includes('preview='),
        `preview_url: ${r.data.preview_url}`);

    // The live app is untouched, which is the whole point of staging.
    const live = await json(`/v1/apps/${encodeURIComponent(author.owner)}/${APP}?mode=inline`);
    assert(live.status === 200, `live fetch ${live.status}`);
    const text = typeof live.body._raw === 'string' ? live.body._raw : JSON.stringify(live.body);
    assert(text.includes('version one'), `the draft leaked into the live app: ${text.slice(0, 120)}`);
});

await test('25. aimeat_app_draft_publish promotes it and clears the slot', async () => {
    const r = await callTool(authorSession, 'aimeat_app_draft_publish', {
        filename: APP, roadmap: 'Promoted the staged version.',
    });
    assert(!r.isError, `draft_publish refused: ${r.text}`);
    assert(r.data.version_number === 2, `version_number: ${r.text.slice(0, 300)}`);
    assert(r.data.is_update === true, `is_update: ${r.data.is_update}`);
    assert(typeof r.data.note === 'string' && r.data.note.includes('draft slot is cleared'), `note: ${r.data.note}`);

    const live = await json(`/v1/apps/${encodeURIComponent(author.owner)}/${APP}?mode=inline`);
    const text = typeof live.body._raw === 'string' ? live.body._raw : JSON.stringify(live.body);
    assert(text.includes('version two'), `the promotion did not reach the live app: ${text.slice(0, 120)}`);
});

await test('26. Publishing with no draft saved is refused, and it names the tool that saves one', async () => {
    const r = await callTool(authorSession, 'aimeat_app_draft_publish', { filename: APP, roadmap: 'Nothing to promote.' });
    assert(r.isError, `an empty draft slot published something: ${r.text}`);
    assert(r.text.includes('No draft to publish') && r.text.includes('aimeat_app_draft_save'),
        `the refusal must name the remedy: ${r.text}`);
});

await test('27. aimeat_app_draft_discard throws a draft away, and refuses when there is none', async () => {
    const empty = await callTool(authorSession, 'aimeat_app_draft_discard', { filename: APP });
    assert(empty.isError, `discarding nothing succeeded: ${empty.text}`);
    assert(empty.text.includes('No draft to discard'), `wrong refusal: ${empty.text}`);

    const saved = await callTool(authorSession, 'aimeat_app_draft_save', {
        filename: APP,
        content_base64: Buffer.from(`<!doctype html><title>v3 ${STAMP}</title><h1>abandoned</h1>`, 'utf8').toString('base64'),
    });
    assert(!saved.isError, `draft_save refused: ${saved.text}`);

    const r = await callTool(authorSession, 'aimeat_app_draft_discard', { filename: APP });
    assert(!r.isError, `draft_discard refused: ${r.text}`);
    assert(r.data.discarded === true, `discarded: ${r.text}`);

    // The live app is where the promotion left it: discarding a draft touches nothing else.
    const live = await json(`/v1/apps/${encodeURIComponent(author.owner)}/${APP}?mode=inline`);
    const text = typeof live.body._raw === 'string' ? live.body._raw : JSON.stringify(live.body);
    assert(text.includes('version two'), `discarding a draft moved the live app: ${text.slice(0, 120)}`);
});

await test('28. aimeat_app_versions lists both versions, newest included', async () => {
    const r = await callTool(authorSession, 'aimeat_app_versions', { owner: author.owner, filename: APP });
    assert(!r.isError, `app_versions refused: ${r.text}`);
    assert(r.data.total === 2, `total: ${r.text.slice(0, 300)}`);
    const numbers = (r.data.versions ?? []).map((v: any) => v.version_number).sort();
    assert(JSON.stringify(numbers) === '[1,2]', `version numbers: ${JSON.stringify(numbers)}`);
    assert((r.data.versions ?? []).every((v: any) => typeof v.size === 'number' && typeof v.created_at === 'string'),
        `each row carries its size and date: ${JSON.stringify(r.data.versions)}`);

    const rest = await json(`/v1/apps/${encodeURIComponent(author.owner)}/${APP}/versions`);
    assert(rest.status === 200, `GET versions ${rest.status}`);
    assert((rest.body.data.versions ?? []).length === r.data.total,
        `the tool and the route disagree on the count: ${r.data.total} vs ${(rest.body.data.versions ?? []).length}`);
});

await test('29. aimeat_app_versions refuses an app that is not there', async () => {
    const r = await callTool(authorSession, 'aimeat_app_versions', { owner: author.owner, filename: `no-such-${STAMP}.html` });
    assert(r.isError, 'an unknown app answered with versions');
    assert(r.text.includes('not found'), `wrong refusal: ${r.text}`);
});

console.log('\nPhase 8 — aimeat_app_delete');

await test('30. Deleting a filename nobody published refuses, and says whose uploads were searched', async () => {
    const r = await callTool(authorSession, 'aimeat_app_delete', { filename: `no-such-${STAMP}.html` });
    assert(r.isError, 'deleting nothing succeeded');
    assert(r.text.includes('not found in your uploads'), `wrong refusal: ${r.text}`);
});

await test('31. Deleting a version that does not exist refuses and names the version', async () => {
    const r = await callTool(authorSession, 'aimeat_app_delete', { filename: APP, version: 99 });
    assert(r.isError, 'deleting a version that does not exist succeeded');
    assert(r.text.includes('version 99'), `the refusal must name the version: ${r.text}`);

    // Refuse before you write: both real versions are still there.
    const still = await callTool(authorSession, 'aimeat_app_versions', { owner: author.owner, filename: APP });
    assert(still.data.total === 2, `a refused delete removed a version: ${still.data.total}`);
});

await test('32. …and the real delete takes every version with it', async () => {
    const r = await callTool(authorSession, 'aimeat_app_delete', { filename: APP });
    assert(!r.isError, `app_delete refused: ${r.text}`);
    assert(typeof r.data.note === 'string' && r.data.note.includes('all versions'), `note: ${r.data.note}`);

    const gone = await json(`/v1/apps/${encodeURIComponent(author.owner)}/${APP}/versions`);
    assert(gone.status === 404, `the app is still readable after the delete: ${gone.status}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
