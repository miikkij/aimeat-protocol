/**
 * @file e2e-signage-agent-faced.ts
 * @description E2E for the agent-faced digital signage contract (TARGET-029, documents edition).
 *   A signage SCREEN is one workspace DOCUMENT (space 'screen', doc id = human-readable slug) whose
 *   body is a ```json payload { config, views, announcement }. The app and any MCP agent edit the SAME
 *   document; the kiosk reads it via the NO-AUTH public-document endpoint. This test pins that contract:
 *   screen doc → publish → mark public → anon read returns the payload; an "agent" edit propagates to the
 *   anon read; a non-member cannot read the private workspace or flip its sharing (per-user isolation);
 *   a draft-only screen is never served publicly.
 * @version-history
 *   v1.0.0 — 2026-07-11 — Initial: agent-faced signage document flow + isolation + draft-not-served.
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-signage-agent-faced

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

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());
async function signMsg(privB64: string, message: string): Promise<string> {
    const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'));
    return Buffer.from(sig).toString('base64');
}

async function setupOwner(label: string) {
    const ownerName = `sig${label}${Date.now()}`;
    const reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: ownerName, display_name: 'Signage', password: 'Signage1234' }) });
    assert(reg.status === 201, `ghii ${reg.status}`);
    const ownerPriv = reg.body.data.private_key;
    const ts = new Date().toISOString();
    const tok = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ owner: ownerName, timestamp: ts, signature: await signMsg(ownerPriv, ownerName + NODE_ID + ts) }) });
    return { ownerName, ownerToken: tok.body.data.token as string };
}

/** Build the screen document body: a ```json fenced payload the kiosk/app both understand. */
function screenDoc(title: string, payload: unknown) {
    return { id: title.toLowerCase(), title, markdown: '```json\n' + JSON.stringify(payload) + '\n```' };
}
/** Parse the payload back out of a public-document markdown (mirrors the kiosk parser). */
function parsePayload(markdown: string) {
    const m = /```json\s*([\s\S]*?)```/i.exec(markdown || '');
    return JSON.parse((m ? m[1] : markdown).trim());
}

console.log('\n=== AIMEAT Agent-Faced Signage E2E Test ===\n');

let A!: Awaited<ReturnType<typeof setupOwner>>;
let B!: Awaited<ReturnType<typeof setupOwner>>;
await test('Setup owner A (signage owner) + owner B (outsider)', async () => { A = await setupOwner('a'); B = await setupOwner('b'); });

let orgId = '';
const WS = 'ws-screens';
const root = () => `organism.${orgId}.w.${WS}`;
const AH = () => ({ Authorization: `Bearer ${A.ownerToken}` });
const BH = () => ({ Authorization: `Bearer ${B.ownerToken}` });

await test('Seed PRIVATE signage organism + workspace (manifest: document space "screen", contract "signage")', async () => {
    const o = await json('/v1/organisms', { method: 'POST', headers: AH(), body: JSON.stringify({ name: 'My Signage', description: 'x', type: 'project', join_policy: 'invite_only', visibility: 'private' }) });
    assert(o.status === 201, `org ${o.status}`); orgId = o.body.data.organism.id;

    await json('/v1/memory', { method: 'POST', headers: AH(), body: JSON.stringify({ key: `organism.${orgId}.meta.workspaces`, value: { workspaces: [{ id: WS, name: 'Screens', createdAt: new Date().toISOString(), createdBy: A.ownerName }] }, visibility: 'private' }) });
    const manifest = {
        manifestVersion: '1.0', id: orgId, name: 'Screens', kind: 'signage', status: 'active',
        objectTypes: [
            { name: 'screen', schemaRef: 'shared.screen', namespace: 'shared.screen', backing: 'memory', writeRole: 'member', cardinality: 'many', mode: 'document', contract: 'signage' },
        ],
    };
    const mr = await json('/v1/memory', { method: 'POST', headers: AH(), body: JSON.stringify({ key: `${root()}.meta.manifest`, value: manifest, visibility: 'private' }) });
    assert(mr.status === 201 || mr.status === 200, `manifest ${mr.status}`);
});

const V1 = { config: { rotationEnabled: true, rotationIntervalSec: 8, theme: 'dark' }, views: [{ name: 'Welcome', type: 'html', content: '<h1>Welcome</h1>', weight: 1 }], announcement: { body: 'Lift service Thu', priority: 'normal' } };

await test('Owner (the app/agent face) writes screen document "aula" (.latest) + a draft-only "sauna"', async () => {
    const aula = screenDoc('Aula', V1);
    const w = await json('/v1/memory', { method: 'POST', headers: AH(), body: JSON.stringify({ key: `${root()}.shared.screen.aula.latest`, value: { ...aula, id: 'aula' }, visibility: 'private' }) });
    assert(w.status === 201 || w.status === 200, `write ${w.status}`);
    // A draft-only screen must never be served publicly.
    await json('/v1/memory', { method: 'POST', headers: AH(), body: JSON.stringify({ key: `${root()}.shared.screen.sauna.draft`, value: { id: 'sauna', title: 'Sauna', markdown: '```json\n{}\n```' }, visibility: 'private' }) });
});

await test('Isolation: outsider B cannot read the PRIVATE workspace (403)', async () => {
    const r = await json(`/v1/organisms/${orgId}/workspace?ws=${WS}`, { headers: BH() });
    assert(r.status === 403 || r.status === 404, `expected 403/404, got ${r.status}`);
});

await test('Isolation: outsider B cannot flip sharing (403)', async () => {
    const r = await json(`/v1/organisms/${orgId}/workspace/share?ws=${WS}`, { method: 'PUT', headers: BH(), body: JSON.stringify({ spaces: { screen: true } }) });
    assert(r.status === 403, `expected 403, got ${r.status}`);
});

await test('Before sharing: anon public read 404 (no disclosure)', async () => {
    const r = await json(`/v1/organisms/${orgId}/workspace/public/document?ws=${WS}&type=screen&id=aula`);
    assert(r.status === 404, `expected 404, got ${r.status}`);
});

await test('Owner marks the "screen" space public (PUT share)', async () => {
    const r = await json(`/v1/organisms/${orgId}/workspace/share?ws=${WS}`, { method: 'PUT', headers: AH(), body: JSON.stringify({ spaces: { screen: true } }) });
    assert(r.status === 200, `status ${r.status}: ${JSON.stringify(r.body.error || r.body)}`);
});

await test('Kiosk: anon (NO AUTH) reads the screen document + payload parses to the expected views', async () => {
    const r = await json(`/v1/organisms/${orgId}/workspace/public/document?ws=${WS}&type=screen&id=aula`);
    assert(r.status === 200, `status ${r.status}`);
    const payload = parsePayload(r.body.data.document.markdown);
    assert(payload.views.length === 1 && payload.views[0].name === 'Welcome', 'views parsed');
    assert(payload.announcement.body === 'Lift service Thu', 'announcement parsed');
});

await test('Draft-only screen "sauna" is never served publicly (404)', async () => {
    const r = await json(`/v1/organisms/${orgId}/workspace/public/document?ws=${WS}&type=screen&id=sauna`);
    assert(r.status === 404, `expected 404, got ${r.status}`);
});

await test('Agent update propagates: rewrite "aula" .latest → anon read shows the new content', async () => {
    const updated = { ...V1, announcement: { body: 'AGENT UPDATE: sauna heated Fri', priority: 'urgent' } };
    const w = await json('/v1/memory', { method: 'POST', headers: AH(), body: JSON.stringify({ key: `${root()}.shared.screen.aula.latest`, value: { id: 'aula', title: 'Aula', markdown: '```json\n' + JSON.stringify(updated) + '\n```' }, visibility: 'private' }) });
    assert(w.status === 200 || w.status === 201, `update ${w.status}`);
    const r = await json(`/v1/organisms/${orgId}/workspace/public/document?ws=${WS}&type=screen&id=aula`);
    const payload = parsePayload(r.body.data.document.markdown);
    assert(payload.announcement.body === 'AGENT UPDATE: sauna heated Fri', `expected updated announcement, got: ${payload.announcement.body}`);
});

console.log(`\n=== Signage Agent-Faced: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
