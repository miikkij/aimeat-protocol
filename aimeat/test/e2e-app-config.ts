/**
 * @file test/e2e-app-config.ts
 * @description App config: what an app declares it needs to work, filled in by a package install and
 *   changed by its owner later (services/app-config.ts, services/package-config.ts).
 *
 *   WHAT IT PROVES. Publish refuses a declaration it cannot use (a secret field, not JSON) and stores a
 *   good one. The config reads publicly with defaults and names the required fields still empty. Only
 *   the owner and their agents change it, over REST and MCP, and a value the declaration does not
 *   accept is refused. An install fills an app part's config and an extension part's config, a secret
 *   there is stored encrypted and reaches the sandbox, every bad value is refused before anything
 *   registers, and a required field left empty refuses the install naming it. An update keeps the
 *   config, and a managed install still lets the owner change it.
 * @structure
 *   - Phase 1: fixtures (owner, stranger, the owner's agent)
 *   - Phase 2: the declaration at publish
 *   - Phase 3: reading and changing the config
 *   - Phase 4: a package install with config
 *   - Phase 5: an update keeps the config; a managed install allows config_set
 *   - Phase 6: what a package needs the node to have (expects): listed, refused, carried by a ZIP
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=app-config
 * @version-history
 *   v1.0.0 — 2026-09-28 — Initial (install packages, phase 2).
 */

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>): Promise<void> {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (e) { failed++; console.error(`  ❌ ${name}: ${(e as Error).message}`); }
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
const b64 = (s: string): string => Buffer.from(s, 'utf8').toString('base64');

async function makeOwner(name: string): Promise<{ token: string; owner: string }> {
    const owner = `${name}${Date.now().toString(36).slice(-6)}`;
    for (let attempt = 0; ; attempt++) {
        const reg = await json('/v1/ghii', {
            method: 'POST',
            body: JSON.stringify({ username: owner, display_name: owner, password: 'AppConfigTest1234' }),
        });
        if (reg.status === 429 && attempt < 8) { await new Promise((r) => setTimeout(r, 1500)); continue; }
        assert(reg.status === 201, `registration failed: ${reg.status} ${JSON.stringify(reg.body)}`);
        const privKey = reg.body.data.private_key as string;
        const timestamp = new Date().toISOString();
        const signature = await signMsg(privKey, owner + NODE_ID + timestamp);
        const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner, timestamp, signature }) });
        assert(tok.status === 200, `token failed: ${tok.status}`);
        return { token: tok.body.data.token as string, owner };
    }
}

async function makeAgent(ownerCtx: { token: string; owner: string }, scopes: string[]): Promise<{ token: string }> {
    const name = `ac${Date.now().toString(36).slice(-5)}${Math.floor(Math.random() * 1000)}`;
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
    return { token: tok.body.data.token as string };
}

interface McpSession { token: string; sessionId?: string }
let rpcId = 0;

async function mcpRpc(session: McpSession, method: string, params: Record<string, any> = {}): Promise<any> {
    const id = ++rpcId;
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
        const msgs = (await res.text()).split('\n').filter((l) => l.startsWith('data: '))
            .map((l) => { try { return JSON.parse(l.slice(6)); } catch { return null; } }).filter(Boolean);
        return msgs.find((m: any) => m.id === id) ?? msgs[0] ?? {};
    }
    return await res.json();
}

async function openSession(token: string): Promise<McpSession> {
    const session: McpSession = { token };
    await mcpRpc(session, 'initialize', {
        protocolVersion: '2025-03-26', capabilities: {},
        clientInfo: { name: 'e2e-app-config', version: '1.0.0' },
    });
    return session;
}

async function callTool(session: McpSession, name: string, args: Record<string, unknown>): Promise<{ isError: boolean; data: any; text: string }> {
    const body = await mcpRpc(session, 'tools/call', { name, arguments: args });
    const text = body?.result?.content?.[0]?.text ?? JSON.stringify(body?.error ?? body ?? {});
    let data: any;
    try { data = JSON.parse(text); } catch { data = { _text: text }; }
    return { isError: body?.result?.isError === true || body?.error !== undefined, data, text };
}

// ── Fixtures ────────────────────────────────────────────────────────────────────────────────

const tag = Date.now().toString(36).slice(-6);
const APP = `cfg-shop-${tag}.html`;
const PLAIN_APP = `cfg-plain-${tag}.html`;
const PKG = `cfg-pack-${tag}`;
const EXT = `cfgext${tag}`;
const SECRET = `sk-test-${tag}-do-not-print`;

const CONFIG_DECL = {
    type: 'object',
    properties: {
        company: { type: 'string', description: 'The company name shown in the header' },
        currency: { type: 'string', enum: ['EUR', 'USD', 'SEK'], default: 'EUR' },
        showPrices: { type: 'boolean', default: true },
    },
    required: ['company'],
};

const htmlWith = (title: string, decl: unknown, marker = ''): string =>
    `<!DOCTYPE html><html><head><title>${title}</title>`
    + (decl === undefined ? '' : `<script type="application/json" id="aimeat-config">${typeof decl === 'string' ? decl : JSON.stringify(decl)}</script>`)
    + `</head><body><h1>${title}</h1>${marker ? `<p>${marker}</p>` : ''}</body></html>`;

const extManifest = (version: string) => [
    'metadata:',
    `  name: ${EXT}`,
    `  version: ${version}`,
    '  description: Config fixture for the app config suite',
    '  author: e2e',
    'actions:',
    '  - id: ping',
    '    method: POST',
    '    path: /ping',
    '    script: ping',
    'config:',
    '  region:',
    '    type: string',
    '    default: eu',
    '    description: Where the shop sells',
    '  apiKey:',
    '    type: secret',
    '    description: The payment provider key',
].join('\n');
const extScript = (v: string) =>
    `export default async function(ctx, input){ return { v: '${v}', region: ctx.config.region, hasKey: typeof ctx.config.apiKey === 'string' && ctx.config.apiKey.length > 0, keyTail: typeof ctx.config.apiKey === 'string' ? ctx.config.apiKey.slice(-6) : null }; }`;
const extComponent = (v: string) => ({
    id: 'ext-cfg', type: 'extension', label: 'Config extension',
    content: JSON.stringify({ manifest: extManifest(v), scripts: { ping: extScript(v) } }), dependencies: [],
});
const appComponent = (marker: string) => ({
    id: 'app-shop.html', type: 'app', label: 'Shop', content: htmlWith('Configured shop', CONFIG_DECL, marker), dependencies: ['ext-cfg'],
    meta: { app: { name: 'Configured shop', description: 'A shop that asks for its company name', category: 'utility' } },
});

let owner = { token: '', owner: '' };
let stranger = { token: '', owner: '' };
let installer = { token: '', owner: '' };
let agentSession: McpSession;
let installerSession: McpSession;
let groupId = '';
let encodedGroupId = '';
let instanceId = '';
let installedApp = '';
let installedExt = '';

console.log('\n═══ App config E2E ═══');
console.log('\nPhase 1 — Fixtures');

await test('Owner, stranger, installer and agents', async () => {
    owner = await makeOwner('cfgowner');
    stranger = await makeOwner('cfgstranger');
    installer = await makeOwner('cfginstaller');
    agentSession = await openSession((await makeAgent(owner, ['app:write', 'memory:read'])).token);
    installerSession = await openSession((await makeAgent(installer, ['packages:write', 'app:write', 'memory:read'])).token);
    assert(!!agentSession.sessionId && !!installerSession.sessionId, 'both agents have MCP sessions');
});

console.log('\nPhase 2 — The declaration at publish');

const publish = (filename: string, html: string, token = owner.token) => json('/v1/apps', {
    method: 'POST', headers: authed(token),
    body: JSON.stringify({ filename, content: b64(html), name: 'Config fixture', description: 'A fixture for the app config suite', category: 'utility', tags: [] }),
});

await test('A config field marked secret is refused at publish', async () => {
    const decl = { type: 'object', properties: { apiKey: { type: 'string', writeOnly: true } } };
    const { status, body } = await publish(`cfg-secret-${tag}.html`, htmlWith('Secret', decl));
    assert(status === 422 && body.error?.code === 'APP_CONFIG_SCHEMA_INVALID', `expected 422, got ${status} ${JSON.stringify(body)}`);
    assert(/secret/i.test(body.error?.message ?? ''), `says why, got ${body.error?.message}`);
});

await test('A declaration that is not JSON is refused at publish', async () => {
    const { status, body } = await publish(`cfg-broken-${tag}.html`, htmlWith('Broken', '{ "type": "object", '));
    assert(status === 422 && body.error?.code === 'APP_CONFIG_SCHEMA_INVALID', `expected 422, got ${status} ${JSON.stringify(body)}`);
});

await test('A good declaration publishes and is stored on the manifest', async () => {
    const { status, body } = await publish(APP, htmlWith('Configured', CONFIG_DECL));
    assert(status === 201, `publish: ${status} ${JSON.stringify(body)}`);
    const plain = await publish(PLAIN_APP, htmlWith('Plain', undefined));
    assert(plain.status === 201, `plain publish: ${plain.status}`);
});

console.log('\nPhase 3 — Reading and changing the config');

await test('The config reads without a session, with defaults and the empty required field', async () => {
    const { status, body } = await json(`/v1/apps/${owner.owner}/${APP}/config`);
    assert(status === 200, `read: ${status} ${JSON.stringify(body)}`);
    assert(body.data.schema?.properties?.company, 'the schema is there');
    assert(body.data.values.currency === 'EUR' && body.data.values.showPrices === true, `defaults, got ${JSON.stringify(body.data.values)}`);
    assert(body.data.missing.length === 1 && body.data.missing[0].field === 'company', `missing company, got ${JSON.stringify(body.data.missing)}`);
    assert(body.data.missing[0].description === 'The company name shown in the header', 'says what it is for');
});

await test('An app that declares no config reads schema null', async () => {
    const { status, body } = await json(`/v1/apps/${owner.owner}/${PLAIN_APP}/config`);
    assert(status === 200 && body.data.schema === null, `got ${status} ${JSON.stringify(body)}`);
});

await test('Changing it needs a session (401) and the owner (403 for a stranger)', async () => {
    const anon = await json(`/v1/apps/${owner.owner}/${APP}/config`, { method: 'PUT', body: JSON.stringify({ values: { company: 'X' } }) });
    assert(anon.status === 401, `anon: ${anon.status}`);
    const other = await json(`/v1/apps/${owner.owner}/${APP}/config`, {
        method: 'PUT', headers: authed(stranger.token), body: JSON.stringify({ values: { company: 'Hijack' } }),
    });
    assert(other.status === 403, `stranger: ${other.status} ${JSON.stringify(other.body)}`);
});

await test('A value of the wrong type and a field the app does not declare are refused with 422', async () => {
    const wrong = await json(`/v1/apps/${owner.owner}/${APP}/config`, {
        method: 'PUT', headers: authed(owner.token), body: JSON.stringify({ values: { showPrices: 'yes' } }),
    });
    assert(wrong.status === 422 && wrong.body.error?.code === 'INVALID_CONFIG', `wrong type: ${wrong.status} ${JSON.stringify(wrong.body)}`);
    const unknown = await json(`/v1/apps/${owner.owner}/${APP}/config`, {
        method: 'PUT', headers: authed(owner.token), body: JSON.stringify({ values: { colour: 'red' } }),
    });
    assert(unknown.status === 422, `unknown field: ${unknown.status} ${JSON.stringify(unknown.body)}`);
    const enumOff = await json(`/v1/apps/${owner.owner}/${APP}/config`, {
        method: 'PUT', headers: authed(owner.token), body: JSON.stringify({ values: { currency: 'GBP' } }),
    });
    assert(enumOff.status === 422, `off the enum: ${enumOff.status}`);
});

await test('The owner sets a field; a null puts another back to its default', async () => {
    const set = await json(`/v1/apps/${owner.owner}/${APP}/config`, {
        method: 'PUT', headers: authed(owner.token), body: JSON.stringify({ values: { company: 'Acme Oy', currency: 'SEK' } }),
    });
    assert(set.status === 200, `set: ${set.status} ${JSON.stringify(set.body)}`);
    assert(set.body.data.values.company === 'Acme Oy' && set.body.data.missing.length === 0, `set: ${JSON.stringify(set.body.data)}`);
    const back = await json(`/v1/apps/${owner.owner}/${APP}/config`, {
        method: 'PUT', headers: authed(owner.token), body: JSON.stringify({ values: { currency: null } }),
    });
    assert(back.body.data.values.currency === 'EUR' && back.body.data.values.company === 'Acme Oy', `null restores the default: ${JSON.stringify(back.body.data.values)}`);
});

await test('The owner\'s agent reads and changes it with aimeat_app_manage', async () => {
    const got = await callTool(agentSession, 'aimeat_app_manage', { action: 'config_get', filename: APP });
    assert(!got.isError && got.data.values.company === 'Acme Oy', `config_get: ${got.text.slice(0, 300)}`);
    const set = await callTool(agentSession, 'aimeat_app_manage', { action: 'config_set', filename: APP, values: { showPrices: false } });
    assert(!set.isError && set.data.values.showPrices === false, `config_set: ${set.text.slice(0, 300)}`);
    const bad = await callTool(agentSession, 'aimeat_app_manage', { action: 'config_set', filename: APP, values: { showPrices: 'no' } });
    assert(bad.isError && bad.text.startsWith('INVALID_CONFIG'), `refused, got ${bad.text.slice(0, 200)}`);
    const none = await callTool(agentSession, 'aimeat_app_manage', { action: 'config_set', filename: PLAIN_APP, values: { a: 1 } });
    assert(none.isError && none.text.startsWith('NO_CONFIG_SCHEMA'), `no schema, got ${none.text.slice(0, 200)}`);
});

await test('The served data library carries appConfig()', async () => {
    const lib = await (await fetch(`${BASE}/v1/libs/aimeat-data.js`)).text();
    assert(lib.includes('appConfig') && lib.includes('aimeat-app-ref'), 'the bundle reads the app ref and offers appConfig');
});

console.log('\nPhase 4 — A package install with config');

await test('The owner publishes a package with a configured app and a configured extension', async () => {
    const { status, body } = await json('/v1/packages', {
        method: 'POST', headers: authed(owner.token),
        body: JSON.stringify({
            name: PKG, description: 'A shop and its payment extension', category: 'utility',
            visibility: 'public', components: [extComponent('1.0.0'), appComponent('v1')],
        }),
    });
    assert(status === 201, `create: ${status} ${JSON.stringify(body)}`);
    groupId = body.data.packageGroupId;
    encodedGroupId = encodeURIComponent(groupId);
    const pub = await json(`/v1/packages/${encodedGroupId}/versions/${encodeURIComponent(body.data.version)}`, {
        method: 'PATCH', headers: authed(owner.token), body: JSON.stringify({ status: 'published' }),
    });
    assert(pub.status === 200 && pub.body.data.status === 'published', `publish: ${pub.status} ${JSON.stringify(pub.body)}`);
});

await test('A dry run lists each part\'s fields and the empty required one, without refusing', async () => {
    const { status, body } = await json(`/v1/packages/${encodedGroupId}/install`, {
        method: 'POST', headers: authed(installer.token), body: JSON.stringify({ label: 'Preview', dry_run: true }),
    });
    assert(status === 200, `dry run: ${status} ${JSON.stringify(body)}`);
    const app = body.data.config.find((c: any) => c.component_id === 'app-shop.html');
    const ext = body.data.config.find((c: any) => c.component_id === 'ext-cfg');
    assert(app?.missing?.[0]?.field === 'company', `app missing company: ${JSON.stringify(app)}`);
    assert(ext?.fields?.includes('region') && ext?.secret_fields?.includes('apiKey') && ext?.unset_secrets?.includes('apiKey'),
        `extension fields: ${JSON.stringify(ext)}`);
});

await test('Installing without the required field is refused naming it, and nothing is installed', async () => {
    const { status, body } = await json(`/v1/packages/${encodedGroupId}/install`, {
        method: 'POST', headers: authed(installer.token), body: JSON.stringify({ label: 'Missing' }),
    });
    assert(status === 400 && body.error?.code === 'CONFIG_REQUIRED', `expected 400 CONFIG_REQUIRED, got ${status} ${JSON.stringify(body)}`);
    assert(body.error.message.includes('app-shop.html.company') && body.error.message.includes('The company name shown in the header'),
        `names the field and its purpose: ${body.error.message}`);
    const list = await json('/v1/instances', { headers: authed(installer.token) });
    assert(list.body.data.total === 0, `no instance, got ${list.body.data.total}`);
});

await test('An unknown part, an undeclared extension field and a wrong type are refused before anything registers', async () => {
    const cases = [
        { 'no-such-part': { a: 1 } },
        { 'app-shop.html': { company: 'A' }, 'ext-cfg': { colour: 'red' } },
        { 'app-shop.html': { company: 5 } },
    ];
    for (const config of cases) {
        const { status, body } = await json(`/v1/packages/${encodedGroupId}/install`, {
            method: 'POST', headers: authed(installer.token), body: JSON.stringify({ label: 'Bad', config }),
        });
        assert(status === 400 && body.error?.code === 'INVALID_INPUT', `${JSON.stringify(config)}: ${status} ${JSON.stringify(body)}`);
    }
    const list = await json('/v1/instances', { headers: authed(installer.token) });
    assert(list.body.data.total === 0, `no instance, got ${list.body.data.total}`);
});

await test('The install with config fills the app and the extension', async () => {
    const { status, body } = await json(`/v1/packages/${encodedGroupId}/install`, {
        method: 'POST', headers: authed(installer.token),
        body: JSON.stringify({
            label: 'Configured',
            config: { 'app-shop.html': { company: 'Kauppa Oy', currency: 'USD' }, 'ext-cfg': { region: 'north', apiKey: SECRET } },
        }),
    });
    assert(status === 201, `install: ${status} ${JSON.stringify(body)}`);
    instanceId = body.data.id;
    const comps = body.data.installedComponents as any[];
    installedApp = comps.find((c) => c.type === 'app').registeredAs;
    installedExt = comps.find((c) => c.type === 'extension').registeredAs;
    const cfg = await json(`/v1/apps/${installer.owner}/${installedApp}/config`);
    assert(cfg.body.data.values.company === 'Kauppa Oy' && cfg.body.data.values.currency === 'USD' && cfg.body.data.missing.length === 0,
        `app config: ${JSON.stringify(cfg.body.data)}`);
});

await test('The extension\'s secret is stored encrypted and never shown, and its code reads it', async () => {
    const ext = await json(`/v1/extensions/${installedExt}`, { headers: authed(installer.token) });
    assert(ext.status === 200, `read extension: ${ext.status}`);
    const text = JSON.stringify(ext.body);
    assert(!text.includes(SECRET), 'the secret is not in the answer');
    const cfg = ext.body.data?.config ?? ext.body.data?.extension?.config ?? {};
    assert(cfg.region === 'north', `region, got ${JSON.stringify(cfg)}`);
    const run = await json(`/v1/ext/${installedExt}/ping`, { method: 'POST', headers: authed(installer.token), body: '{}' });
    assert(run.status === 200, `invoke: ${run.status} ${JSON.stringify(run.body)}`);
    const out = run.body.data?.result ?? run.body.data ?? {};
    assert(out.region === 'north' && out.hasKey === true && out.keyTail === SECRET.slice(-6), `the sandbox reads it: ${JSON.stringify(out)}`);
});

await test('aimeat_package_install takes config: its dry run shows the given field as given', async () => {
    const out = await callTool(installerSession, 'aimeat_package_install', {
        group_id: groupId, dry_run: true, config: { 'app-shop.html': { company: 'Via MCP' } },
    });
    assert(!out.isError, `tool: ${out.text.slice(0, 300)}`);
    const app = out.data.config.find((c: any) => c.component_id === 'app-shop.html');
    assert(app.given.includes('company') && app.missing.length === 0, `given: ${JSON.stringify(app)}`);
});

console.log('\nPhase 5 — Updates and managed installs');

await test('An update keeps the app\'s config and the extension\'s config, secret included', async () => {
    await new Promise((r) => setTimeout(r, 1100));
    const v2 = await json(`/v1/packages/${encodedGroupId}/versions`, {
        method: 'POST', headers: authed(owner.token),
        body: JSON.stringify({ changelog: 'v2', status: 'published', components: [extComponent('2.0.0'), appComponent('v2')] }),
    });
    assert(v2.status === 201, `new version: ${v2.status} ${JSON.stringify(v2.body)}`);
    const upd = await json(`/v1/instances/${instanceId}/update`, { method: 'POST', headers: authed(installer.token), body: '{}' });
    assert(upd.status === 200 && upd.body.data.applied && (upd.body.data.applied.failedComponents ?? []).length === 0,
        `update: ${upd.status} ${JSON.stringify(upd.body)}`);
    const run = await json(`/v1/ext/${installedExt}/ping`, { method: 'POST', headers: authed(installer.token), body: '{}' });
    const out = run.body.data?.result ?? run.body.data ?? {};
    assert(out.v === '2.0.0', `the new code runs, got ${JSON.stringify(out)}`);
    assert(out.region === 'north' && out.hasKey === true, `the extension config survived the update: ${JSON.stringify(out)}`);
    const cfg = await json(`/v1/apps/${installer.owner}/${installedApp}/config`);
    assert(cfg.body.data.values.company === 'Kauppa Oy', `the app config survived: ${JSON.stringify(cfg.body.data.values)}`);
});

await test('A managed install still lets its owner change the app config', async () => {
    const { status, body } = await json(`/v1/packages/${encodedGroupId}/install`, {
        method: 'POST', headers: authed(installer.token),
        body: JSON.stringify({ label: 'Managed', mode: 'managed', config: { 'app-shop.html': { company: 'Managed Oy' } } }),
    });
    assert(status === 201, `managed install: ${status} ${JSON.stringify(body)}`);
    const app = (body.data.installedComponents as any[]).find((c) => c.type === 'app').registeredAs;
    const out = await callTool(installerSession, 'aimeat_app_manage', { action: 'config_set', filename: app, values: { company: 'Renamed Oy' } });
    assert(!out.isError && out.data.values.company === 'Renamed Oy', `config_set on a managed app: ${out.text.slice(0, 300)}`);
    await json(`/v1/instances/${body.data.id}?removeComponents=true`, { method: 'DELETE', headers: authed(installer.token) });
});

console.log('\nPhase 6 — What a package needs the node to have');

async function uploadZip(path: string, zipBuf: Buffer, token: string): Promise<{ status: number; body: any }> {
    const boundary = '----FormBoundary' + Date.now();
    const body = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="package.zip"\r\nContent-Type: application/zip\r\n\r\n`),
        zipBuf,
        Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const res = await fetch(`${BASE}${path}`, {
        method: 'POST', headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, Authorization: `Bearer ${token}` }, body,
    });
    const text = await res.text();
    let parsed: any;
    try { parsed = JSON.parse(text); } catch { parsed = { _raw: text }; }
    return { status: res.status, body: parsed };
}

const NEEDS_PKG = `cfg-needs-${tag}`;
const MISSING_EXT = `missing-ext-${tag}`;
let needsGroup = '';

await test('A package names an extension this node does not have; the dry run lists it', async () => {
    const created = await json('/v1/packages', {
        method: 'POST', headers: authed(owner.token),
        body: JSON.stringify({
            name: NEEDS_PKG, description: 'An app that calls an extension installed separately', category: 'utility', visibility: 'public',
            manifest: JSON.stringify({ expects: { cortex: [], extensions: [MISSING_EXT], packs: ['aimeat-data'] } }),
            components: [{ id: 'app-needs.html', type: 'app', label: 'Needs', content: htmlWith('Needs an extension', undefined), dependencies: [] }],
        }),
    });
    assert(created.status === 201, `create: ${created.status} ${JSON.stringify(created.body)}`);
    needsGroup = encodeURIComponent(created.body.data.packageGroupId);
    const pub = await json(`/v1/packages/${needsGroup}/versions/${encodeURIComponent(created.body.data.version)}`, {
        method: 'PATCH', headers: authed(owner.token), body: JSON.stringify({ status: 'published' }),
    });
    assert(pub.status === 200, `publish: ${pub.status} ${JSON.stringify(pub.body)}`);
    const dry = await json(`/v1/packages/${needsGroup}/install`, {
        method: 'POST', headers: authed(installer.token), body: JSON.stringify({ label: 'Needs', dry_run: true }),
    });
    assert(dry.status === 200, `dry run: ${dry.status} ${JSON.stringify(dry.body)}`);
    assert(dry.body.data.expects_missing?.extensions?.includes(MISSING_EXT), `lists the extension: ${JSON.stringify(dry.body.data)}`);
    assert(!dry.body.data.expects_missing.packs.includes('aimeat-data'), 'a pack the node serves is not missing');
});

await test('The install is refused naming what is missing, and nothing is installed', async () => {
    const before = (await json('/v1/instances', { headers: authed(installer.token) })).body.data.total;
    const { status, body } = await json(`/v1/packages/${needsGroup}/install`, {
        method: 'POST', headers: authed(installer.token), body: JSON.stringify({ label: 'Needs' }),
    });
    assert(status === 409 && body.error?.code === 'EXPECTS_MISSING', `expected 409 EXPECTS_MISSING, got ${status} ${JSON.stringify(body)}`);
    assert(body.error.message.includes(MISSING_EXT), `names it: ${body.error.message}`);
    const after = (await json('/v1/instances', { headers: authed(installer.token) })).body.data.total;
    assert(after === before, `no new instance (${before} → ${after})`);
});

await test('What the package needs survives an export and an import on another account', async () => {
    const res = await fetch(`${BASE}/v1/packages/${needsGroup}/export`, { headers: authed(owner.token) });
    assert(res.status === 200, `export: ${res.status}`);
    const zip = Buffer.from(await res.arrayBuffer());
    const imported = await uploadZip('/v1/packages/import', zip, stranger.token);
    assert(imported.status === 201, `import: ${imported.status} ${JSON.stringify(imported.body)}`);
    const theirs = encodeURIComponent(`${NEEDS_PKG}::${stranger.owner}`);
    const dry = await json(`/v1/packages/${theirs}/install`, {
        method: 'POST', headers: authed(stranger.token), body: JSON.stringify({ label: 'Imported', dry_run: true }),
    });
    assert(dry.status === 200 && dry.body.data.expects_missing?.extensions?.includes(MISSING_EXT),
        `the imported copy still needs the extension: ${dry.status} ${JSON.stringify(dry.body.data ?? dry.body)}`);
    await json(`/v1/packages/${theirs}`, { method: 'DELETE', headers: authed(stranger.token) });
});

console.log('\nCleanup');
if (needsGroup) await json(`/v1/packages/${needsGroup}`, { method: 'DELETE', headers: authed(owner.token) });
if (instanceId) await json(`/v1/instances/${instanceId}?removeComponents=true`, { method: 'DELETE', headers: authed(installer.token) });
if (encodedGroupId) await json(`/v1/packages/${encodedGroupId}`, { method: 'DELETE', headers: authed(owner.token) });
for (const f of [APP, PLAIN_APP]) await json(`/v1/apps/${f}`, { method: 'DELETE', headers: authed(owner.token) });

console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
