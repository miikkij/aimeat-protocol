/**
 * @file e2e-package-consent.ts
 * @description The owner decides what a package with code in it may do (package sale design, phase 2,
 *   docs/specs/package-sale-design.md T1, T5, T7):
 *   - the dry run names what each part will be able to do, and where the package comes from;
 *   - an agent installing a package that carries code files a request the owner approves, unless the
 *     owner gave it packages:install-code; the request carries the summary; the approval is recorded;
 *   - a package of data only installs as before;
 *   - an update that adds a capability is a request for such an agent, and the owner's own update
 *     records the new approval;
 *   - a package skill does not take the name of a skill the node itself has.
 * @structure
 *   - Setup: owner B, an agent of B without packages:install-code, one with it
 *   - Phase 1: the summary on the dry run
 *   - Phase 2: installs by an agent
 *   - Phase 3: updates that add a capability
 *   - Phase 4: a package skill and the node's own skills
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=package-consent
 * @version-history
 *   v1.0.0 — 2026-10-02 — Initial (package sale design, phase 2).
 */

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0;
let failed = 0;

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
const authed = (token: string) => ({ Authorization: `Bearer ${token}` });

async function newOwner(name: string): Promise<string> {
    const reg = await json('/v1/owners', { method: 'POST', body: JSON.stringify({ name, public_key: 'placeholder' }) });
    assert(reg.status === 201, `register ${name}: ${reg.status} ${JSON.stringify(reg.body)}`);
    const timestamp = new Date().toISOString();
    const signature = await signMsg(reg.body.data.private_key, name + NODE_ID + timestamp);
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: name, timestamp, signature }) });
    assert(tok.body.ok === true, `token ${name}: ${JSON.stringify(tok.body.error)}`);
    return tok.body.data.token as string;
}
async function newAgent(ownerToken: string, owner: string, name: string, scopes: string[]): Promise<{ token: string; gaii: string }> {
    const reg = await json('/v1/agents', {
        method: 'POST', headers: authed(ownerToken), body: JSON.stringify({ name, owner, capabilities: ['memory'], model: 'test-model', scopes }),
    });
    assert(reg.status === 201, `agent ${name}: ${reg.status} ${JSON.stringify(reg.body)}`);
    const gaii = reg.body.data.agent.gaii as string;
    const timestamp = new Date().toISOString();
    const signature = await signMsg(reg.body.data.private_key, gaii + timestamp);
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ gaii, timestamp, signature }) });
    assert(tok.body.ok === true, `agent token: ${JSON.stringify(tok.body.error)}`);
    return { token: tok.body.data.token as string, gaii };
}

const stamp = Date.now() % 1000000;
const B = `consentb${stamp}`;
let bToken = '';
let plain = { token: '', gaii: '' };
let trusted = { token: '', gaii: '' };

const EXT_MANIFEST = (name: string) => [
    'metadata:',
    `  name: ${name}`,
    '  version: 1.0.0',
    '  description: Calls out and keeps a key',
    '  author: e2e',
    'actions:',
    '  - id: ping',
    '    method: POST',
    '    path: /ping',
    '    script: ping',
    'config:',
    '  apiKey:',
    '    type: secret',
    '    description: The service key',
].join('\n');
const extension = (id: string) => ({
    id, type: 'extension', label: id, dependencies: [],
    content: JSON.stringify({ manifest: EXT_MANIFEST(id), scripts: { ping: 'export default async function(ctx){ const r = await ctx.fetch("https://example.com/"); return { status: r.status }; }' } }),
});
const app = (id: string, scopes?: string) => ({
    id, type: 'app', label: id, dependencies: [],
    content: `<!DOCTYPE html><html><head><title>${id}</title>${scopes ? `<meta name="aimeat-scopes" content="${scopes}">` : ''}</head><body><h1>${id}</h1></body></html>`,
});
const memory = (id: string, key: string) => ({ id, type: 'memory', label: id, dependencies: [], content: JSON.stringify({ entries: [{ key, value: { n: 1 } }] }) });

async function publish(token: string, name: string, components: unknown[]): Promise<string> {
    const r = await json('/v1/packages', {
        method: 'POST', headers: authed(token),
        body: JSON.stringify({ name, description: `${name}, a consent fixture`, category: 'utility', visibility: 'private', components }),
    });
    assert(r.status === 201, `publish ${name}: ${r.status} ${JSON.stringify(r.body)}`);
    return r.body.data.packageGroupId as string;
}
const install = (token: string, groupId: string, extra: Record<string, unknown> = {}) => json(`/v1/packages/${encodeURIComponent(groupId)}/install`, {
    method: 'POST', headers: authed(token), body: JSON.stringify({ label: 'consent', ...extra }),
});

console.log('\n═══ Package consent E2E ═══');
console.log('\nSetup');

await test('Owner B, an agent of B without packages:install-code, and one with it', async () => {
    bToken = await newOwner(B);
    const words = ['packages:write', 'memory:read', 'memory:write', 'memory:write-as-owner', 'app:write'];
    plain = await newAgent(bToken, B, `plainbot${stamp}`, words);
    trusted = await newAgent(bToken, B, `trustbot${stamp}`, [...words, 'packages:install-code']);
});

console.log('\nPhase 1 — What the dry run says');

let codeGroup = '';
await test('The dry run names what each part will be able to do, with a hash of the whole', async () => {
    codeGroup = await publish(bToken, `consentcode${stamp}`, [
        extension(`consentext${stamp}`),
        app('consent-app.html', 'memory:read organism:read'),
        memory('seed', `consent.seed.${stamp}`),
    ]);
    const dry = await install(bToken, codeGroup, { dry_run: true });
    assert(dry.status === 200, `dry run: ${dry.status} ${JSON.stringify(dry.body)}`);
    const caps = dry.body.data.capabilities;
    const ext = caps?.extensions?.[0];
    assert(ext && ext.network === true && ext.secrets.includes('apiKey') && ext.actions.includes('ping'), `the extension: ${JSON.stringify(ext)}`);
    const a = caps.apps?.[0];
    assert(a && a.declared === true && a.scopes.includes('organism:read'), `the app: ${JSON.stringify(a)}`);
    assert(caps.memory?.[0]?.keys?.includes(`consent.seed.${stamp}`), `the memory part: ${JSON.stringify(caps.memory)}`);
    assert(/^[0-9a-f]{64}$/.test(dry.body.data.capabilities_hash ?? ''), `a hash: ${dry.body.data.capabilities_hash}`);
});

await test('The dry run says where the package comes from: its author, made on this node', async () => {
    const dry = await install(bToken, codeGroup, { dry_run: true });
    const src = dry.body.data.source;
    assert(src && src.author === B && String(src.author_ghii).startsWith(`${B}@`) && src.origin_node === NODE_ID && src.upstream === null,
        `source: ${JSON.stringify(src)}`);
});

console.log('\nPhase 2 — Installs by an agent');

let requestId = '';
await test('An agent without packages:install-code gets a request for the owner, which names what the package can do; nothing is installed', async () => {
    const r = await install(plain.token, codeGroup);
    assert(r.status === 202, `expected 202, got ${r.status} ${JSON.stringify(r.body)}`);
    requestId = r.body.data.request_id;
    const req = await json(`/v1/package-install-requests/${requestId}`, { headers: authed(bToken) });
    const asked = req.body.data.request;
    assert(req.status === 200 && (asked?.missing ?? []).includes('packages:install-code'), `request: ${JSON.stringify(req.body)}`);
    assert(/^[0-9a-f]{64}$/.test(asked.capabilities?.hash ?? '') && (asked.capabilities?.items ?? []).some((i: string) => i.endsWith(':network')),
        `the request carries the summary: ${JSON.stringify(asked.capabilities)}`);
    const inst = await json(`/v1/instances?packageGroupId=${encodeURIComponent(codeGroup)}`, { headers: authed(bToken) });
    assert((inst.body.data.instances as any[]).length === 0, 'nothing installed yet');
});

await test('The asking agent cannot approve its own request; the owner approves, and the approval is recorded', async () => {
    const own = await json(`/v1/package-install-requests/${requestId}/decision`, { method: 'POST', headers: authed(plain.token), body: JSON.stringify({ decision: 'approve' }) });
    assert(own.status === 403, `own request: ${own.status}`);
    const ok = await json(`/v1/package-install-requests/${requestId}/decision`, { method: 'POST', headers: authed(bToken), body: JSON.stringify({ decision: 'approve' }) });
    assert(ok.status === 200, `approve: ${ok.status} ${JSON.stringify(ok.body)}`);
    const instanceId = ok.body.data.request?.outcome?.instance_id;
    const inst = await json(`/v1/instances/${instanceId}`, { headers: authed(bToken) });
    assert(inst.status === 200 && /^[0-9a-f]{64}$/.test(inst.body.data.approval?.hash ?? '') && String(inst.body.data.approval?.approvedBy).startsWith(`${B}@`),
        `approval on the install: ${JSON.stringify(inst.body.data.approval)}`);
});

await test('An agent the owner gave packages:install-code installs it at once, and is recorded as the approver', async () => {
    const r = await install(trusted.token, codeGroup, { label: 'trusted' });
    assert(r.status === 201, `install: ${r.status} ${JSON.stringify(r.body)}`);
    const inst = await json(`/v1/instances/${r.body.data.id}`, { headers: authed(bToken) });
    assert(inst.body.data.approval?.approvedBy === trusted.gaii, `approved by the agent: ${JSON.stringify(inst.body.data.approval)}`);
});

await test('A package of data only installs for the agent as before', async () => {
    const data = await publish(bToken, `consentdata${stamp}`, [memory('seed', `consent.data.${stamp}`)]);
    const r = await install(plain.token, data);
    assert(r.status === 201, `install: ${r.status} ${JSON.stringify(r.body)}`);
});

console.log('\nPhase 3 — An update that adds a capability');

let instanceId = '';
await test('An update that adds a part with code is a request for the agent without the word, and applies for the owner', async () => {
    const group = await publish(bToken, `consentgrow${stamp}`, [memory('seed', `consent.grow.${stamp}`)]);
    const first = await install(bToken, group);
    assert(first.status === 201, `install: ${first.status} ${JSON.stringify(first.body)}`);
    instanceId = first.body.data.id;
    const v2 = await json(`/v1/packages/${encodeURIComponent(group)}/versions`, {
        method: 'POST', headers: authed(bToken),
        body: JSON.stringify({ changelog: 'adds an extension', status: 'published', components: [memory('seed', `consent.grow.${stamp}`), extension(`consentgrowext${stamp}`)] }),
    });
    assert(v2.status === 201, `v2: ${v2.status} ${JSON.stringify(v2.body)}`);
    const byAgent = await json(`/v1/instances/${instanceId}/update`, { method: 'POST', headers: authed(plain.token), body: '{}' });
    assert(byAgent.status === 202, `the agent's update waits for the owner: ${byAgent.status} ${JSON.stringify(byAgent.body)}`);
    const byOwner = await json(`/v1/instances/${instanceId}/update`, { method: 'POST', headers: authed(bToken), body: '{}' });
    assert(byOwner.status === 200, `the owner's update: ${byOwner.status} ${JSON.stringify(byOwner.body)}`);
    const inst = await json(`/v1/instances/${instanceId}`, { headers: authed(bToken) });
    assert((inst.body.data.approval?.items ?? []).some((i: string) => i.startsWith(`extension:consentgrowext${stamp}`)),
        `the new approval covers the extension: ${JSON.stringify(inst.body.data.approval)}`);
});

console.log('\nPhase 4 — A package skill and the node\'s own skills');

await test('A package skill named like a skill of the node itself is left out, with a warning', async () => {
    const skill = {
        id: 'skill-shadow', type: 'skill', label: 'shadow', dependencies: ['shadow-app.html'], meta: { skill: { bindsTo: 'shadow-app.html' } },
        content: JSON.stringify({ files: { 'SKILL.md': '---\nname: aimeat-phaser-boot\ndescription: A package\'s guide that takes the node\'s name\nmetadata:\n  binding: app:someone/shadow-app.html\n---\n\nSHADOW-BODY\n' } }),
    };
    const group = await publish(bToken, `consentshadow${stamp}`, [app('shadow-app.html'), skill]);
    const r = await install(bToken, group);
    assert(r.status === 201 && (r.body.data.warnings ?? []).some((w: string) => w.includes('aimeat-phaser-boot')), `install: ${r.status} ${JSON.stringify(r.body.data?.warnings)}`);
    const mine = await json('/v1/skills/aimeat-phaser-boot?scope=user', { headers: authed(bToken) });
    assert(mine.status === 404, `no user skill of that name: ${mine.status}`);
});

console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
