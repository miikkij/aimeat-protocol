/**
 * @file e2e-secret-canary-sweep.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The secret canary SWEEP: a known value is planted in every secret store this node has,
 *   and then every GET route the contract declares (openapi.yaml), and every read-only MCP tool that
 *   takes no required argument, is called as six principals. Each whole answer is searched for every
 *   planted value, for AES-GCM ciphertext and for a password hash. What a principal is MEANT to see
 *   is listed in INTENDED with a reason; anything else that matches fails the suite.
 *
 *   e2e-secret-canaries.ts is the short, named list of routes the 2026-10-09 audit found leaking. This
 *   suite is the net: a route added tomorrow is in it without anyone adding it, because the list of
 *   routes is read from the contract and the list of tools from the MCP server.
 *
 *   THE STORES, each with its own route: the owner's AI key (PUT /v1/openrouter/settings), the
 *   seller's Stripe key and webhook secret (PUT /v1/commerce/payout/stripe), a vault secret
 *   (PUT /v1/secrets/:name), an extension's secret config field (POST /v1/extensions), a personal
 *   access token (POST /v1/access/tokens), an agent's webhook signing secret
 *   (PUT /v1/agents/:name/webhook), a two-step sign-in secret (POST /v1/ghii/totp/setup), and a
 *   protected app's access code (POST /v1/apps).
 *
 *   THE PRINCIPALS: the owner in person, an agent of the owner holding '*', an agent holding only
 *   memory:read, another owner, the operator (the first account on the node), and nobody.
 *   Not covered here, and said so: an app grant and an ecosystem app (both act through scopes the
 *   two agents already bracket), and a visitor from another node (needs a second node; the
 *   federation suites own that).
 *
 *   ROUTES WITH PATH PARAMETERS are called when every parameter is one this suite can fill with the
 *   owner's own identifiers ({owner}, {name}, {ghii}, {gaii}, {agent}); the rest are skipped and
 *   counted, and the count is printed, so a shrinking sweep is visible.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-secret-canary-sweep
 * @version-history
 *   v1.0.0 — 2026-10-09 — Initial (secrets audit 2026-10-09, wish "widen the canary suite").
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';
const STAMP = Date.now() % 1000000;

// ── The planted values ──────────────────────────────────────────────────────────────────────────
const C = {
    aiKey: `sk-or-sweep-${STAMP}-ai-9e1c`,
    stripeKey: `sk_test_sweep_${STAMP}_5b7d`,
    stripeHook: `whsec_sweep_${STAMP}_2c8f`,
    vault: `sweep-vault-${STAMP}-41aa`,
    extSecret: `sweep-ext-secret-${STAMP}-77b0`,
    webhook: `sweep-webhook-${STAMP}-ab12cd34ef56`,
    accessCode: `swp${STAMP}`,
};
/** Values learned during setup (minted by the node, so not known in advance). */
const learned: Record<string, string> = {};

/**
 * What a principal is MEANT to see. Key: `${principal} ${METHOD} ${path}` (path as the contract
 * writes it), value: the canary names it may carry, and why.
 */
const INTENDED: Record<string, { canaries: string[]; why: string }> = {
    'owner GET /v1/apps': { canaries: ['accessCode'], why: 'the owner in person reads their own protected app\'s code (routes/apps/catalogue-admin.ts, mayReadCodes)' },
    'agentWide GET /v1/apps': { canaries: ['accessCode'], why: 'an agent of the owner holding app:write could set the code, so it may read it (secrets audit 2026-10-09, 1.5)' },
};

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
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
async function signMsg(privB64: string, message: string): Promise<string> {
    return Buffer.from(await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'))).toString('base64');
}

async function setupOwner(label: string) {
    const name = `swp${label}${STAMP}`;
    const reg0 = () => json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Sweep', password: 'SweepTest12345' }) });
    let reg = await reg0();
    for (let i = 0; reg.status === 429 && i < 8; i++) { await new Promise(r => setTimeout(r, 1500)); reg = await reg0(); }
    assert(reg.status === 201, `ghii ${reg.status}: ${JSON.stringify(reg.body?.error)}`);
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', {
        method: 'POST', body: JSON.stringify({ owner: name, timestamp: ts, signature: await signMsg(reg.body.data.private_key, name + NODE_ID + ts) }),
    });
    assert(tok.body?.ok === true, `token: ${JSON.stringify(tok.body?.error)}`);
    return { name, ghii: `${name}@${NODE_ID}`, token: tok.body.data.token as string };
}

async function agentToken(owner: { name: string; token: string }, agentName: string, scopes: string[]): Promise<{ token: string; gaii: string; key: string }> {
    const da = await json('/v1/agents/device-authorize', { method: 'POST', body: JSON.stringify({ agent_name: agentName, owner: owner.name }) });
    assert(da.status === 200, `device-authorize ${da.status}`);
    const ok = await json('/v1/agents/verify', {
        method: 'POST', body: JSON.stringify({ user_code: da.body.data.user_code, action: 'approve', scopes, owner_token: owner.token }),
    });
    assert(ok.status === 200, `approve ${ok.status} ${JSON.stringify(ok.body?.error)}`);
    const poll = await json('/v1/agents/device-token', {
        method: 'POST', body: JSON.stringify({ device_code: da.body.data.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }),
    });
    assert(poll.status === 200 && typeof poll.body?.token === 'string', `device-token ${poll.status}`);
    return {
        token: poll.body.token as string,
        gaii: poll.body.gaii ?? `${agentName}#${owner.name}@${NODE_ID}`,
        key: String(poll.body.private_key ?? poll.body.privateKey ?? ''),
    };
}

/** Every planted value found in `text`, by canary name; plus ciphertext and password-hash shapes. */
function found(text: string): string[] {
    const hits: string[] = [];
    for (const [k, v] of Object.entries({ ...C, ...learned })) if (v && text.includes(v)) hits.push(k);
    const shapes: Array<[string, RegExp]> = [
        ['ciphertext', /[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]{8,}/],
        // A secret field carrying a value (a null or an empty string says nothing).
        ['secret-field', /"(passwordHash|totpSecret|webhookSecret|totpBackupCodes)"\s*:\s*("[^"]+"|\[\s*")/],
    ];
    for (const [name, re] of shapes) {
        const m = re.exec(text);
        if (m) hits.push(`${name} near ${JSON.stringify(text.slice(Math.max(0, m.index - 60), m.index + 60))}`);
    }
    return hits;
}

// ── The routes ─────────────────────────────────────────────────────────────────────────────────
/** GET paths from the contract, with the parameters this suite can fill. */
function contractGets(fill: Record<string, string>): { declared: string; path: string }[] {
    const doc = parseYaml(readFileSync(resolve(process.cwd(), '..', 'openapi.yaml'), 'utf8')) as { paths: Record<string, Record<string, unknown>> };
    const out: { declared: string; path: string }[] = [];
    let skipped = 0;
    for (const [declared, ops] of Object.entries(doc.paths)) {
        if (!ops || typeof ops !== 'object' || !('get' in ops)) continue;
        // Streams and sockets hold the connection open; they are not answers to search.
        if (/\/events$|\/stream|\/ws$|\/sse|\/tunnel|\/listen/.test(declared)) continue;
        let path = declared;
        let ok = true;
        for (const m of declared.matchAll(/\{([^}]+)\}/g)) {
            const v = fill[m[1]!];
            if (v === undefined) { ok = false; break; }
            path = path.replace(m[0], encodeURIComponent(v));
        }
        if (ok) out.push({ declared, path }); else skipped++;
    }
    console.log(`    contract GET routes: ${out.length} called, ${skipped} skipped for a parameter this suite cannot fill`);
    return out;
}

async function getText(path: string, token: string | null): Promise<{ status: number; text: string }> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 10_000);
    try {
        const res = await fetch(`${BASE}${path}`, { headers: token ? auth(token) : {}, signal: ctl.signal, redirect: 'manual' });
        const ct = res.headers.get('content-type') ?? '';
        if (ct.includes('event-stream') || ct.startsWith('image/') || ct.includes('octet-stream') || ct.includes('zip')) {
            res.body?.cancel().catch(() => undefined);
            return { status: res.status, text: '' };
        }
        return { status: res.status, text: await res.text() };
    } catch {
        return { status: 0, text: '' };
    } finally {
        clearTimeout(timer);
    }
}

// ── MCP ───────────────────────────────────────────────────────────────────────────────────────
/** OAuth PATH A (the agent's signature) for an MCP access token, as e2e-mcp-scopes.ts does. */
async function mcpToken(gaii: string, privKey: string): Promise<string> {
    const reg = await json('/v1/mcp/register', { method: 'POST', body: JSON.stringify({ client_name: 'sweep-e2e' }) });
    const timestamp = new Date().toISOString();
    const signature = await signMsg(privKey, gaii + NODE_ID + timestamp);
    const qs = new URLSearchParams({ response_type: 'code', client_id: reg.body.client_id, gaii, signature, timestamp });
    const code = (await json(`/v1/mcp/authorize?${qs}`)).body.code as string;
    const tok = await json('/v1/mcp/token', {
        method: 'POST', body: JSON.stringify({ grant_type: 'authorization_code', code, client_id: reg.body.client_id, client_secret: reg.body.client_secret }),
    });
    return tok.body.access_token as string;
}

async function mcpSession(token: string) {
    let sessionId = '';
    let id = 0;
    async function rpc(method: string, params: Record<string, unknown>) {
        const rid = ++id;
        const res = await fetch(`${BASE}/v1/mcp`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${token}`,
                ...(sessionId ? { 'mcp-session-id': sessionId, 'mcp-protocol-version': '2025-03-26' } : {}),
            },
            body: JSON.stringify({ jsonrpc: '2.0', id: rid, method, params }),
        });
        const sid = res.headers.get('mcp-session-id');
        if (sid) sessionId = sid;
        return { status: res.status, text: await res.text() };
    }
    const init = await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'sweep-e2e', version: '1.0.0' } });
    if (init.status !== 200) return null;
    await fetch(`${BASE}/v1/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${token}`, 'mcp-session-id': sessionId, 'mcp-protocol-version': '2025-03-26' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    });
    return rpc;
}

function sseOrJson(text: string): any {
    const line = text.split('\n').find(l => l.startsWith('data:'));
    try { return JSON.parse(line ? line.slice(5) : text); } catch { return {}; }
}

async function main() {
    console.log('\n=== Secret canary sweep (secrets audit 2026-10-09) ===\n');
    // The first account on a fresh node becomes its operator (routes/ghii/register-login.ts).
    const operator = await setupOwner('op');
    const owner = await setupOwner('own');
    const other = await setupOwner('oth');
    let wide = { token: '', gaii: '', key: '' }, narrow = { token: '', gaii: '', key: '' };
    const extName = `swpext${STAMP}`;
    const appFile = `swpapp${STAMP}.html`;

    await test('setup: a value is planted in every secret store, each through its own route', async () => {
        const steps: Array<[string, Promise<{ status: number; body: any }>]> = [
            ['AI key', json('/v1/openrouter/settings', { method: 'PUT', headers: auth(owner.token), body: JSON.stringify({ apiKey: C.aiKey }) })],
            ['Stripe', json('/v1/commerce/payout/stripe', { method: 'PUT', headers: auth(owner.token), body: JSON.stringify({ secret_key: C.stripeKey, webhook_secret: C.stripeHook }) })],
            ['vault', json('/v1/secrets/SWEEP_TOKEN', { method: 'PUT', headers: auth(owner.token), body: JSON.stringify({ value: C.vault }) })],
            ['extension', json('/v1/extensions', {
                method: 'POST', headers: auth(owner.token),
                body: JSON.stringify({
                    manifest: JSON.stringify({
                        metadata: { name: extName, version: '1.0.0', description: 'sweep e2e', author: 'e2e' },
                        actions: [{ id: 'echo', method: 'POST', path: '/echo', script: 'echo' }],
                        config: { apiKey: { type: 'secret', default: C.extSecret } },
                        limits: { timeout_ms: 5000, max_api_calls: 1 },
                    }),
                    scripts: { echo: 'export default async function(){ return { ok: true }; }' },
                }),
            })],
            ['app', json('/v1/apps', {
                method: 'POST', headers: auth(owner.token),
                body: JSON.stringify({ filename: appFile, content: Buffer.from('<!DOCTYPE html><title>s</title><p>sweep').toString('base64'), mime_type: 'text/html', description: 'sweep', access_code: C.accessCode }),
            })],
        ];
        for (const [what, p] of steps) {
            const r = await p;
            assert(r.status >= 200 && r.status < 300, `${what}: ${r.status} ${JSON.stringify(r.body?.error)}`);
        }
        const pat = await json('/v1/access/tokens', { method: 'POST', headers: auth(owner.token), body: JSON.stringify({ label: 'sweep', scopes: ['memory:read'] }) });
        assert(pat.status === 201 || pat.status === 200, `PAT ${pat.status} ${JSON.stringify(pat.body?.error)}`);
        learned.pat = String(pat.body.data?.token ?? pat.body.data?.access_token ?? '');
        assert(learned.pat.length > 10, `the PAT value came back once: ${JSON.stringify(pat.body.data).slice(0, 200)}`);
        const totp = await json('/v1/ghii/totp/setup', { method: 'POST', headers: auth(owner.token), body: '{}' });
        assert(totp.status === 200, `TOTP setup ${totp.status} ${JSON.stringify(totp.body?.error)}`);
        learned.totp = String(totp.body.data?.totp_secret ?? '');
        assert(learned.totp.length >= 16, 'the TOTP secret came back once');
        wide = await agentToken(owner, `swpwide${STAMP}`, ['*']);
        narrow = await agentToken(owner, `swpnarrow${STAMP}`, ['memory:read']);
        const hook = await json(`/v1/agents/swpwide${STAMP}/webhook`, {
            method: 'PUT', headers: auth(owner.token), body: JSON.stringify({ url: 'https://example.com/aimeat-sweep-hook', secret: C.webhook }),
        });
        assert(hook.status === 200 || hook.status === 201, `webhook ${hook.status} ${JSON.stringify(hook.body?.error)}`);
    });

    const principals: Array<[string, () => string | null]> = [
        ['owner', () => owner.token], ['agentWide', () => wide.token], ['agentNarrow', () => narrow.token],
        ['other', () => other.token], ['operator', () => operator.token], ['anonymous', () => null],
    ];
    const fill = { owner: owner.name, name: owner.name, ghii: owner.ghii, gaii: wide.gaii, agent: `swpwide${STAMP}`, ownerName: owner.name };

    for (const [who, tok] of principals) {
        await test(`every contract GET route carries no planted secret to: ${who}`, async () => {
            const leaks: string[] = [];
            for (const { declared, path } of contractGets({ ...fill, gaii: wide.gaii })) {
                const r = await getText(path, tok());
                if (!r.text) continue;
                const hits = found(r.text).filter(h => !(INTENDED[`${who} GET ${declared}`]?.canaries ?? []).includes(h));
                if (hits.length) leaks.push(`${declared} (${r.status}): ${hits.join(', ')}`);
            }
            assert(leaks.length === 0, `\n      ${leaks.join('\n      ')}`);
        });
    }

    await test('every read-only MCP tool that needs no argument carries no planted secret, to an agent holding *', async () => {
        assert(wide.key.length > 0, 'the device-token answer carried the agent key');
        const rpc = await mcpSession(await mcpToken(wide.gaii, wide.key));
        assert(!!rpc, 'an MCP session opens with the agent token');
        const listed = sseOrJson((await rpc!('tools/list', {})).text);
        const tools = (listed.result?.tools ?? []) as Array<{ name: string; annotations?: { readOnlyHint?: boolean }; inputSchema?: { required?: string[] } }>;
        const readOnly = tools.filter(t => t.annotations?.readOnlyHint === true && !(t.inputSchema?.required?.length));
        console.log(`    MCP: ${tools.length} tools listed, ${readOnly.length} read-only with no required argument called`);
        assert(readOnly.length > 10, `expected a real read surface, got ${readOnly.length}`);
        const leaks: string[] = [];
        for (const t of readOnly) {
            const r = await rpc!('tools/call', { name: t.name, arguments: {} });
            const hits = found(r.text).filter(h => !(INTENDED[`agentWide MCP ${t.name}`]?.canaries ?? []).includes(h));
            if (hits.length) leaks.push(`${t.name}: ${hits.join(', ')}`);
        }
        assert(leaks.length === 0, `\n      ${leaks.join('\n      ')}`);
    });

    await test('a refusal is still a refusal: another owner reading the owner\'s vault list is refused', async () => {
        const r = await json('/v1/secrets', { headers: auth(other.token) });
        assert(r.status === 200 || r.status === 403 || r.status === 401, `vault list ${r.status}`);
        assert(!JSON.stringify(r.body).includes('SWEEP_TOKEN'), 'another owner sees the owner\'s secret name');
        const own = await json(`/v1/apps/${owner.name}/${appFile}`, { headers: auth(other.token) });
        assert(own.status === 403, `another owner opening the protected app without its code: ${own.status}`);
    });

    console.log(`\n=== Secret canary sweep: ${passed} passed, ${failed} failed ===\n`);
    if (failed > 0) process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
