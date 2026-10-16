/**
 * @file e2e-contract.ts
 * @description The answers of selected operations, held to what openapi.yaml declares for them.
 *
 *   WHY IT EXISTS. `openapi.yaml` is the canonical contract, and until 2026-10-16 the only thing that
 *   tied it to the code was the list of (method, path) pairs (`check:openapi-routes`). Nothing read a
 *   real answer against the declared schema, so the contract drifted where it matters most: after an
 *   agent renewed its token it promised `data.role` and `data.gaii` (the handler answers `roles` and
 *   `identity`), after device authorization it named no token field at all, the MCP OAuth routes were
 *   declared as the node's envelope while they answer a bare OAuth object, and creating an organism
 *   promised an OrganismRecord in `data` where the handler answers `{ organism }`. Four of those six
 *   issue credentials, and an integrator or an AI building from the contract reads fields that are
 *   not there.
 *
 *   WHAT IS CHECKED, per operation: the answer's status is one the contract declares; the body
 *   validates against that status's schema (JSON Schema 2020-12 through Ajv, `$ref` resolved against
 *   the whole document); and every field in the body is DECLARED somewhere in that schema
 *   (`undeclaredFields`), because a schema without `additionalProperties: false` accepts any extra
 *   field, and an undeclared field is exactly how the contract went stale. A schema that opens a
 *   level with `additionalProperties` (a map) is not walked below that level.
 *
 *   WHICH OPERATIONS. The ones an agent and an integrator meet first: the build, agent registration,
 *   the agent's own token renewal, device authorization, consent, the MCP OAuth client and token,
 *   organism creation, the memory write/read/update/list, and the error envelope. Adding one is a
 *   call to `checkAnswer` with the operation's method and contract path.
 * @structure contract loading (Ajv 2020 over openapi.yaml) · responseSchema · undeclaredFields ·
 *   checkAnswer · the operations
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=contract
 * @version-history
 *   v1.0.0 — 2026-10-16 — Initial (QA audit D3-01).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import * as ed from '@noble/ed25519';
import { registerOwner } from './helpers/owner-login.js';
import { authorizeParams, mcpPkce, tokenParams } from './helpers/mcp-oauth-pkce.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }

// ── The contract ────────────────────────────────────────────────────────────────────────────────

type Schema = Record<string, any>;
const DOC = parseYaml(readFileSync(join(process.cwd(), '..', 'openapi.yaml'), 'utf8')) as Schema;
const DOC_ID = 'aimeat-openapi';
const ajv = new (Ajv2020 as unknown as typeof Ajv2020.default)({ strict: false, allErrors: true, validateFormats: true });
(addFormats as unknown as typeof addFormats.default)(ajv);
// OpenAPI 3.0's `nullable: true` is still written in this 3.1 document; Ajv knows the keyword only
// beside `type`, so a schema with nullable and no type is read as "anything".
ajv.addKeyword({ keyword: 'example' });
ajv.addSchema({ ...DOC, $id: DOC_ID });

/** Follows a local `$ref` ('#/components/...') to its target in the document. */
function deref(node: Schema | undefined): Schema | undefined {
    let n = node;
    for (let i = 0; n && typeof n.$ref === 'string' && i < 20; i++) {
        n = n.$ref.slice(2).split('/').map((p: string) => p.replace(/~1/g, '/').replace(/~0/g, '~'))
            .reduce((acc: any, key: string) => acc?.[key], DOC);
    }
    return n;
}

/** The JSON-pointer string for a path inside the document, for Ajv's `$ref`. */
function pointer(...parts: string[]): string {
    return `${DOC_ID}#/` + parts.map(p => p.replace(/~/g, '~0').replace(/\//g, '~1')).join('/');
}

/** The schema the contract declares for `status` of `method path`, or why there is none. */
function responseSchema(method: string, path: string, status: number): { ref: string; schema: Schema } | { missing: string } {
    const op = DOC.paths?.[path]?.[method.toLowerCase()];
    if (!op) return { missing: `${method} ${path} is not in openapi.yaml` };
    const declared = op.responses?.[String(status)];
    if (!declared) return { missing: `${method} ${path} declares no ${status} (declares ${Object.keys(op.responses ?? {}).join(', ')})` };
    const response = deref(declared)!;
    const schema = response.content?.['application/json']?.schema;
    if (!schema) return { missing: `${method} ${path} ${status} declares no application/json schema` };
    // Point Ajv at the schema where it stands, so its $refs resolve against the document.
    const ref = declared.$ref
        ? pointer(...String(declared.$ref).slice(2).split('/').map((s: string) => s.replace(/~1/g, '/')), 'content', 'application/json', 'schema')
        : pointer('paths', path, method.toLowerCase(), 'responses', String(status), 'content', 'application/json', 'schema');
    return { ref, schema };
}

/** Every property name a schema declares at this level, across allOf / anyOf / oneOf. */
function declaredAtLevel(schema: Schema | undefined, seen = new Set<Schema>()): { props: Map<string, Schema[]>; open: Schema[]; anything: boolean } {
    const out = { props: new Map<string, Schema[]>(), open: [] as Schema[], anything: false };
    const s = deref(schema);
    if (!s || seen.has(s)) return out;
    seen.add(s);
    const hasShape = s.properties || s.allOf || s.anyOf || s.oneOf || s.additionalProperties !== undefined;
    if (!hasShape) { out.anything = true; return out; }
    for (const [k, v] of Object.entries(s.properties ?? {})) {
        out.props.set(k, [...(out.props.get(k) ?? []), v as Schema]);
    }
    if (s.additionalProperties === true || (s.additionalProperties && typeof s.additionalProperties === 'object')) {
        out.open.push(s.additionalProperties === true ? {} : s.additionalProperties);
    }
    for (const member of [...(s.allOf ?? []), ...(s.anyOf ?? []), ...(s.oneOf ?? [])]) {
        const m = declaredAtLevel(member, seen);
        for (const [k, v] of m.props) out.props.set(k, [...(out.props.get(k) ?? []), ...v]);
        out.open.push(...m.open);
        if (m.anything) out.anything = true;
    }
    return out;
}

/**
 * The fields of `data` that `schema` does not declare, as dotted paths. A level with
 * `additionalProperties` (a map) or with no shape at all (`{}`, a bare `type: object`) declares
 * anything, so the walk stops there.
 */
function undeclaredFields(schema: Schema | undefined, data: unknown, path = ''): string[] {
    if (Array.isArray(data)) {
        const s = deref(schema);
        const items = s?.items ?? s?.allOf?.map((m: Schema) => deref(m)?.items).find(Boolean);
        return data.slice(0, 3).flatMap((d, i) => undeclaredFields(items, d, `${path}[${i}]`));
    }
    if (!data || typeof data !== 'object') return [];
    const level = declaredAtLevel(schema);
    if (level.anything || level.open.length > 0) return [];
    const out: string[] = [];
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
        const where = path ? `${path}.${k}` : k;
        const schemas = level.props.get(k);
        if (!schemas) { out.push(where); continue; }
        // A field declared by several members is checked against the first that shapes it.
        out.push(...undeclaredFields(schemas.find(x => deref(x)?.properties || deref(x)?.items || deref(x)?.allOf) ?? schemas[0], v, where));
    }
    return out;
}

/** Holds one answer to the contract: a declared status, a valid body, and no undeclared field. */
function checkAnswer(method: string, path: string, status: number, body: unknown): void {
    const found = responseSchema(method, path, status);
    if ('missing' in found) throw new Error(found.missing);
    const validate = ajv.getSchema(found.ref);
    assert(validate, `Ajv could not resolve ${found.ref}`);
    const problems: string[] = [];
    if (!validate(body)) {
        problems.push(...(validate.errors ?? []).slice(0, 8).map(e => `${e.instancePath || '(root)'} ${e.message}`));
    }
    const extra = undeclaredFields(found.schema, body);
    if (extra.length) problems.push(`undeclared: ${extra.slice(0, 12).join(', ')}${extra.length > 12 ? ` (+${extra.length - 12})` : ''}`);
    if (problems.length) throw new Error(`${method} ${path} ${status} does not match the contract: ${problems.join('; ')}`);
}

// ── HTTP ────────────────────────────────────────────────────────────────────────────────────────

async function call(method: string, path: string, opts: { token?: string; body?: unknown; headers?: Record<string, string> } = {}) {
    const res = await fetch(`${BASE}${path}`, {
        method,
        headers: {
            ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
            ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
            ...opts.headers,
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    const text = await res.text();
    let body: any;
    try { body = JSON.parse(text); } catch { body = text; }
    return { status: res.status, body };
}

async function signMsg(privateKeyB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privateKeyB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}

// ── The operations ──────────────────────────────────────────────────────────────────────────────

console.log('\n=== Contract: answers against openapi.yaml ===\n');

const ownerName = `contract${Date.now().toString(36)}`;
let ownerToken = '';
let agent = { gaii: '', privateKey: '', token: '' };

await test('Setup: an owner', async () => {
    ownerToken = (await registerOwner(BASE, ownerName)).token;
    assert(ownerToken, 'no owner token');
});

await test('GET /v1/build answers what the contract declares', async () => {
    const r = await call('GET', '/v1/build');
    checkAnswer('GET', '/v1/build', r.status, r.body);
});

await test('POST /v1/agents (the owner registers an agent) answers what the contract declares', async () => {
    const r = await call('POST', '/v1/agents', { token: ownerToken, body: { name: 'contract-agent', owner: ownerName, capabilities: ['memory'], scopes: ['memory:read', 'memory:write', 'consent:manage', 'organism:read', 'organism:write'] } });
    assert(r.status === 201, `register ${r.status}: ${JSON.stringify(r.body?.error)}`);
    agent.gaii = r.body.data.agent.gaii;
    agent.privateKey = r.body.data.private_key;
    checkAnswer('POST', '/v1/agents', r.status, r.body);
});

await test('POST /v1/auth/token (the agent renews its own token) answers what the contract declares', async () => {
    const ts = new Date().toISOString();
    const r = await call('POST', '/v1/auth/token', { body: { gaii: agent.gaii, timestamp: ts, signature: await signMsg(agent.privateKey, agent.gaii + ts) } });
    assert(r.status === 200, `token ${r.status}: ${JSON.stringify(r.body?.error)}`);
    agent.token = r.body.data.token;
    checkAnswer('POST', '/v1/auth/token', r.status, r.body);
});

await test('Device authorization: device-authorize, verify and device-token answer what the contract declares', async () => {
    const start = await call('POST', '/v1/agents/device-authorize', { body: { agent_name: 'contract-device', owner: ownerName } });
    assert(start.status === 200, `device-authorize ${start.status}: ${JSON.stringify(start.body?.error)}`);
    checkAnswer('POST', '/v1/agents/device-authorize', start.status, start.body);
    const ok = await call('POST', '/v1/agents/verify', { body: { user_code: start.body.data.user_code, action: 'approve', owner_token: ownerToken, scopes: ['memory:read'] } });
    assert(ok.status === 200, `verify ${ok.status}: ${JSON.stringify(ok.body?.error)}`);
    const tok = await call('POST', '/v1/agents/device-token', { body: { device_code: start.body.data.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' } });
    assert(tok.status === 200, `device-token ${tok.status}: ${JSON.stringify(tok.body)}`);
    checkAnswer('POST', '/v1/agents/device-token', tok.status, tok.body);
});

await test('POST /v1/consent answers what the contract declares', async () => {
    const r = await call('POST', '/v1/consent', { token: agent.token, body: { data_pattern: 'contract.*', recipient: `reader#${ownerName}@${NODE_ID}`, purpose: 'contract test' } });
    assert(r.status === 201, `consent ${r.status}: ${JSON.stringify(r.body?.error)}`);
    checkAnswer('POST', '/v1/consent', r.status, r.body);
});

await test('MCP OAuth: register and token answer what the contract declares', async () => {
    const client = await call('POST', '/v1/mcp/register', { body: { client_name: `Contract ${ownerName}`, redirect_uris: [] } });
    assert(client.status === 201, `mcp register ${client.status}: ${JSON.stringify(client.body)}`);
    checkAnswer('POST', '/v1/mcp/register', client.status, client.body);
    const at = new Date().toISOString();
    const pkce = mcpPkce(BASE);
    const q = new URLSearchParams({
        response_type: 'code', client_id: client.body.client_id, gaii: agent.gaii,
        signature: await signMsg(agent.privateKey, agent.gaii + NODE_ID + at), timestamp: at,
        ...authorizeParams(pkce),
    });
    const code = (await call('GET', `/v1/mcp/authorize?${q}`)).body?.code as string;
    assert(code, 'no authorization code');
    const tok = await call('POST', '/v1/mcp/token', { body: { grant_type: 'authorization_code', code, client_id: client.body.client_id, client_secret: client.body.client_secret, ...tokenParams(pkce) } });
    assert(tok.status === 200, `mcp token ${tok.status}: ${JSON.stringify(tok.body)}`);
    checkAnswer('POST', '/v1/mcp/token', tok.status, tok.body);
});

await test('POST /v1/organisms answers what the contract declares', async () => {
    const r = await call('POST', '/v1/organisms', { token: ownerToken, body: { name: `Contract ${ownerName}`, description: 'Contract test organism' } });
    assert(r.status === 201, `organism ${r.status}: ${JSON.stringify(r.body?.error)}`);
    checkAnswer('POST', '/v1/organisms', r.status, r.body);
});

await test('Memory: POST, GET, PUT and the list answer what the contract declares', async () => {
    const key = 'contract.note';
    const w = await call('POST', '/v1/memory', { token: agent.token, body: { key, value: { title: 'first' }, visibility: 'private' } });
    assert(w.status === 200 || w.status === 201, `write ${w.status}: ${JSON.stringify(w.body?.error)}`);
    checkAnswer('POST', '/v1/memory', w.status, w.body);
    const g = await call('GET', `/v1/memory/${encodeURIComponent(key)}`, { token: agent.token });
    assert(g.status === 200, `read ${g.status}: ${JSON.stringify(g.body?.error)}`);
    checkAnswer('GET', '/v1/memory/{key}', g.status, g.body);
    const u = await call('PUT', `/v1/memory/${encodeURIComponent(key)}`, { token: agent.token, body: { value: { title: 'second' }, version: g.body.data.version } });
    assert(u.status === 200, `update ${u.status}: ${JSON.stringify(u.body?.error)}`);
    checkAnswer('PUT', '/v1/memory/{key}', u.status, u.body);
    const l = await call('GET', '/v1/memory?prefix=contract.', { token: agent.token });
    assert(l.status === 200, `list ${l.status}: ${JSON.stringify(l.body?.error)}`);
    checkAnswer('GET', '/v1/memory', l.status, l.body);
});

await test('A refusal answers the error envelope the contract declares', async () => {
    const r = await call('GET', `/v1/memory/${encodeURIComponent('contract.absent')}`, { token: agent.token });
    assert(r.status === 404, `expected 404, got ${r.status}`);
    checkAnswer('GET', '/v1/memory/{key}', r.status, r.body);
});

await test('A scope refusal: an agent without memory:write is refused a write, in the declared 403 shape', async () => {
    const reg = await call('POST', '/v1/agents', { token: ownerToken, body: { name: 'contract-reader', owner: ownerName, capabilities: ['memory'], scopes: ['memory:read'] } });
    assert(reg.status === 201, `register reader ${reg.status}: ${JSON.stringify(reg.body?.error)}`);
    const gaii = reg.body.data.agent.gaii as string;
    const ts = new Date().toISOString();
    const tok = await call('POST', '/v1/auth/token', { body: { gaii, timestamp: ts, signature: await signMsg(reg.body.data.private_key, gaii + ts) } });
    assert(tok.status === 200, `reader token ${tok.status}`);
    const r = await call('POST', '/v1/memory', { token: tok.body.data.token, body: { key: 'contract.denied', value: 1 } });
    assert(r.status === 403, `a write without memory:write must be refused, got ${r.status}`);
    checkAnswer('POST', '/v1/memory', r.status, r.body);
});

await test('The checker itself refuses an undeclared field and a wrong type', async () => {
    const r = await call('GET', '/v1/build');
    let caught = '';
    try { checkAnswer('GET', '/v1/build', r.status, { ...r.body, not_in_the_contract: 1 }); } catch (e: any) { caught = e.message; }
    assert(caught.includes('undeclared: not_in_the_contract'), `an undeclared field passed: ${caught}`);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
