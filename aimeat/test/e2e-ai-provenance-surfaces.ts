/**
 * @file e2e-ai-provenance-surfaces.ts
 * @description E2E for provenance PROPAGATION (TARGET-058 Phase 2): the same record, read four
 *   different ways, plus the serve-time HTML marks.
 *
 *   THE CRITERION THIS SUITE EXISTS FOR. One item — a published app — is fetched through the REST
 *   envelope, the markdown agent face, the WebMCP listing and the MCP tool result, and all four must
 *   carry the SAME provenance record id. A surface that silently drops it is the failure mode the
 *   whole phase is guarding against, and only reading all four at once catches it.
 *
 *   SERVE-TIME ONLY. The inline (runnable) HTML carries the `ai-disclosure` attribute, the meta tag,
 *   the link to the record and the schema.org JSON-LD; the raw download must be BYTE-IDENTICAL to
 *   what was uploaded. Marks that leak into the stored bundle would change the bytes the content
 *   hash is a statement about — and this codebase has published from a served copy before.
 * @structure owner + agent setup · agent publishes an app · four fetches · serve-time HTML
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=ai-provenance-surfaces
 * @version-history
 *   v1.0.0 — 2026-08-01 — TARGET-058 Phase 2.
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';

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
    return { status: res.status, body, headers: res.headers };
}

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());
async function sign(privB64: string, msg: string): Promise<string> {
    return Buffer.from(await ed.signAsync(new TextEncoder().encode(msg), Buffer.from(privB64, 'base64'))).toString('base64');
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

/** Server-sent-event framing is what /v1/mcp answers with when the client accepts it. */
function parseSSE(text: string): any[] {
    const out: any[] = [];
    const NL = String.fromCharCode(10);
    for (const evt of text.split(NL + NL)) {
        let data = '';
        for (const line of evt.trim().split(NL)) if (line.startsWith('data: ')) data += line.slice(6);
        if (data) { try { out.push(JSON.parse(data)); } catch { /* not a JSON frame */ } }
    }
    return out;
}

/** One MCP tool call on a fresh session, authenticated with the agent's own bearer token. */
async function mcpCall(token: string, name: string, args: Record<string, unknown>) {
    let sessionId = '';
    let id = 1;
    const rpc = async (method: string, params: Record<string, unknown>) => {
        const res = await fetch(`${BASE}/v1/mcp`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json, text/event-stream',
                Authorization: `Bearer ${token}`,
                ...(sessionId ? { 'mcp-session-id': sessionId, 'mcp-protocol-version': '2025-03-26' } : {}),
            },
            body: JSON.stringify({ jsonrpc: '2.0', id: id++, method, params }),
        });
        const sid = res.headers.get('mcp-session-id');
        if (sid) sessionId = sid;
        const ct = res.headers.get('content-type') ?? '';
        if (ct.includes('text/event-stream')) return parseSSE(await res.text())[0] ?? {};
        return await res.json() as any;
    };
    await rpc('initialize', {
        protocolVersion: '2025-03-26', capabilities: {},
        clientInfo: { name: 'Provenance surfaces E2E', version: '1.0.0' },
    });
    return await rpc('tools/call', { name, arguments: args });
}

async function setupOwner(label: string) {
    const name = `surf${label}${Date.now()}`.toLowerCase();
    let reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Surf', password: 'Provenance1234' }) });
    for (let i = 0; reg.status === 429 && i < 8; i++) {
        await new Promise(r => setTimeout(r, 1500));
        reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Surf', password: 'Provenance1234' }) });
    }
    assert(reg.status === 201, `ghii ${reg.status}: ${JSON.stringify(reg.body?.error)}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: await sign(reg.body.data.private_key, name + NODE_ID + ts) }) });
    assert(tok.status === 200 && tok.body?.data?.token, `auth/token ${tok.status}`);
    return { name, gaii: `${name}@${NODE_ID}`, token: tok.body.data.token as string };
}

async function connectAgent(ownerToken: string, ownerName: string, agentName: string, scopes: string[]) {
    const da = await json('/v1/agents/device-authorize', { method: 'POST', body: JSON.stringify({ agent_name: agentName, owner: ownerName }) });
    assert(da.status === 200, `device-authorize ${da.status}`);
    const v = await json('/v1/agents/verify', { method: 'POST', body: JSON.stringify({ user_code: da.body.data.user_code, action: 'approve', scopes, owner_token: ownerToken }) });
    assert(v.status === 200, `verify ${v.status}: ${JSON.stringify(v.body.error ?? v.body)}`);
    const t = await json('/v1/agents/device-token', { method: 'POST', body: JSON.stringify({ device_code: da.body.data.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }) });
    assert(t.status === 200, `device-token ${t.status}`);
    return { token: t.body.token as string, gaii: t.body.gaii as string };
}

/** A minimal single-file app. Deliberately contains a literal `</body>` inside its own script —
 *  the injector must not land inside app JavaScript, which has broken a live app before. */
const APP_HTML = [
    '<!doctype html>',
    '<html lang="en">',
    '<head><meta charset="utf-8"><title>Provenance surface test</title></head>',
    '<body>',
    '<h1>Surface test</h1>',
    '<script>const trap = "</" + "body>"; console.log(trap);</script>',
    '</body>',
    '</html>',
].join('\n');

(async () => {
    console.log('\n── AI Provenance surfaces (TARGET-058 Phase 2) ──');

    const o = await setupOwner('o');
    const agent = await connectAgent(o.token, o.name, `surfpub${Date.now()}`, ['memory:read', 'memory:write', 'apps:write']);
    const filename = `provsurface${Date.now()}.html`;

    let appProvId = '';

    await test('An AGENT publishing an app with no declaration gets it stamped (Mint-3)', async () => {
        const r = await json('/v1/apps', {
            method: 'POST', headers: auth(agent.token),
            body: JSON.stringify({
                filename, mime_type: 'text/html',
                content: Buffer.from(APP_HTML, 'utf-8').toString('base64'),
                name: 'Provenance surface test', description: 'Reads four ways.',
            }),
        });
        assert(r.status === 200 || r.status === 201, `publish ${r.status}: ${JSON.stringify(r.body?.error)}`);

        const versions = await json(`/v1/apps/${encodeURIComponent(o.name)}/${encodeURIComponent(filename)}/versions`);
        assert(versions.status === 200, `versions ${versions.status}`);
        appProvId = versions.body.meta?.provenance?.id;
        assert(!!appProvId, `no provenance on the app an agent published: ${JSON.stringify(versions.body.meta)}`);
        const rec = versions.body.meta.provenance.record;
        assert(rec.level === 'ai-generated' && rec.humanInvolvement === 'none', `level/involvement ${rec.level}/${rec.humanInvolvement}`);
        assert(rec.attestation.stampedBy === 'node' && rec.attestation.observed === false,
            'a Mint-3 stamp is the node inferring, not the node witnessing');
    });

    // ── THE criterion: one item, four fetches, one record id ──

    await test('1/4 — the REST envelope carries it in meta.provenance', async () => {
        const r = await json(`/v1/apps/${encodeURIComponent(o.name)}/${encodeURIComponent(filename)}/versions`);
        assert(r.body.meta?.provenance?.id === appProvId, `envelope: ${r.body.meta?.provenance?.id}`);
        assert(r.body.data.provenance === undefined, 'it belongs in meta, never in data');
        assert((r.headers.get('link') ?? '').includes('rel="ai-provenance"'), 'Link header absent');
    });

    await test('2/4 — the markdown agent face carries it in frontmatter AND in the body', async () => {
        const res = await fetch(`${BASE}/v1/apps/${encodeURIComponent(o.name)}/${encodeURIComponent(filename)}?format=md`);
        assert(res.status === 200, `md ${res.status}`);
        const text = await res.text();
        assert(text.startsWith('---'), 'no frontmatter block');
        assert(text.includes('ai_provenance:'), 'frontmatter carries no record');
        assert(text.includes(`/v1/provenance/${appProvId}`), `frontmatter points elsewhere`);
        // The body line is the half that survives being summarised.
        assert(text.includes('**AI provenance**'), 'no human-readable line in the body');
        assert((res.headers.get('ai-disclosure') ?? '').includes('mode='), 'AI-Disclosure header absent');
    });

    await test('3/4 — the WebMCP listing carries it', async () => {
        const r = await json(`/v1/apps/${encodeURIComponent(o.name)}/${encodeURIComponent(filename)}/webmcp`);
        assert(r.status === 200, `webmcp ${r.status}`);
        assert(r.body.ai_provenance?.spec === 'aimeat.provenance/v1', `webmcp record: ${JSON.stringify(r.body.ai_provenance)}`);
        assert(r.body.ai_provenance_url.endsWith(`/v1/provenance/${appProvId}`), `webmcp url ${r.body.ai_provenance_url}`);
    });

    await test('4/4 — the MCP tool result carries it', async () => {
        const r = await mcpCall(agent.token, 'aimeat_app_get', { owner: o.name, filename });
        const payload = JSON.parse(r.result.content[0].text);
        assert(payload.ai_provenance?.spec === 'aimeat.provenance/v1',
            `MCP result carries no record: ${JSON.stringify(payload.ai_provenance)}`);
        assert(payload.ai_provenance_url.endsWith(`/v1/provenance/${appProvId}`),
            `MCP points elsewhere: ${payload.ai_provenance_url}`);
    });

    await test('...and the one id all four named resolves anonymously, because the app is public', async () => {
        const r = await json(`/v1/provenance/${appProvId}`);
        assert(r.status === 200, `a published app's record must resolve anonymously: ${r.status}`);
        assert(r.body.data.provenance.spec === 'aimeat.provenance/v1', 'wrong document');
    });

    // ── Serve-time HTML marks, and the stored bundle unchanged ──

    await test('The inline HTML carries the disclosure marks', async () => {
        const res = await fetch(`${BASE}/v1/apps/${encodeURIComponent(o.name)}/${encodeURIComponent(filename)}?mode=inline`);
        assert(res.status === 200, `inline ${res.status}`);
        const html = await res.text();
        assert(/<html[^>]*\sai-disclosure="autonomous"/i.test(html), 'the ai-disclosure attribute is not on <html>');
        assert(html.includes('<meta name="ai-disclosure" content="autonomous">'), 'the meta tag is absent');
        assert(html.includes(`<link rel="ai-provenance" href="`), 'the link to the record is absent');
        assert(html.includes('application/ld+json'), 'the schema.org block is absent');
        assert(html.includes('trainedAlgorithmicMedia'), 'the JSON-LD carries no digitalSourceType');
        // The injector must not have landed inside the app's own JavaScript.
        assert(html.includes('const trap = "</" + "body>";'), 'the app script was corrupted by injection');
        assert((res.headers.get('ai-disclosure') ?? '').includes('mode=machine-generated'), 'header absent on the inline serve');
    });

    await test('...and the STORED bundle is byte-identical to what was uploaded', async () => {
        const res = await fetch(`${BASE}/v1/apps/${encodeURIComponent(o.name)}/${encodeURIComponent(filename)}`);
        assert(res.status === 200, `download ${res.status}`);
        const raw = Buffer.from(await res.arrayBuffer());
        assert(raw.equals(Buffer.from(APP_HTML, 'utf-8')),
            'the served marks reached the stored bundle — the content hash now describes bytes nobody uploaded');
        assert(!raw.toString('utf-8').includes('ai-disclosure'), 'a disclosure mark is in the stored bytes');
    });

    await test('The record was minted about the STORED bytes, not the served ones', async () => {
        const hash = `sha256:${createHash('sha256').update(APP_HTML).digest('hex')}`;
        const r = await json(`/v1/provenance/by-hash/${hash.replace('sha256:', '')}`);
        assert(r.status === 200, `by-hash ${r.status}`);
        assert(r.body.data.records.some((x: any) => x.id === appProvId),
            'a third party hashing the downloaded file cannot find the record this node minted');
    });

    // ── Parking the app un-publishes its record: visibility follows the content, for apps too ──

    await test('Parking the app takes its record back to the identical 404', async () => {
        const p = await json(`/v1/apps/${encodeURIComponent(filename)}`, {
            method: 'PATCH', headers: auth(o.token), body: JSON.stringify({ parked: true }),
        });
        assert(p.status === 200, `park ${p.status}: ${JSON.stringify(p.body?.error)}`);
        const anon = await json(`/v1/provenance/${appProvId}`);
        const missing = await json('/v1/provenance/00000000-0000-4000-8000-000000000000');
        assert(anon.status === 404, `a parked app's record still resolves: ${anon.status}`);
        assert(anon.body.error.message === missing.body.error.message, 'the 404s differ');
    });

    console.log(`\n  ${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
})();
