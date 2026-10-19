/**
 * @file test/e2e-agent-avatar.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An agent's own picture (services/agent-avatar.ts, routes/agents/avatar.ts). The picture
 *   is one memory record, `agent.avatar`, in the agent's own namespace, written with the ordinary
 *   memory write (wish-agenteille-oma-avatar-jonka-agentti-asettaa-itse). This suite holds:
 *     1. the agent writes an emoji, then an SVG, with POST /v1/memory, and the agent list and the
 *        public profile carry `avatar` (the list never the SVG itself);
 *     2. the picture address serves image/svg+xml under a sandboxing CSP, caches for good on the
 *        current version, answers 304, and draws an emoji as an SVG;
 *     3. what is refused: an SVG over 256 kB, markup that is not one <svg>, a DOCTYPE; the profile
 *        says why, the picture address answers 404, the list carries null;
 *     4. who may use PUT/DELETE .../avatar: the owner in person and the agent itself; never a sibling
 *        agent, another account or an anonymous caller;
 *     5. the optional set_avatar onboarding step ticks once the picture can be shown;
 *     6. the Design Book's avatar templates are published, readable and pass the reader, an avatar
 *        part that does not is refused, and adopting one answers the SVG and writes nothing;
 *     7. the Hello Integration prompt and the built-in skill agent-avatar name the key.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=agent-avatar
 * @version-history
 *   v1.0.0 — 2026-10-19 — Initial.
 */
import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';
import { registerOwner } from './helpers/owner-login.js';

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

async function json(path: string, opts: RequestInit = {}): Promise<{ status: number; body: any; headers: Headers }> {
  const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
  const ct = res.headers.get('content-type') ?? '';
  return { status: res.status, headers: res.headers, body: ct.includes('json') ? await res.json() : { _raw: await res.text() } };
}
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
async function signMsg(privB64: string, message: string): Promise<string> {
  return Buffer.from(await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privB64, 'base64'))).toString('base64');
}
async function agentToken(gaii: string, priv: string): Promise<string> {
  const ts = new Date().toISOString();
  const { body } = await json('/v1/auth/token', { method: 'POST', body: JSON.stringify({ gaii, timestamp: ts, signature: await signMsg(priv, gaii + ts) }) });
  assert(body.ok === true, `agent token: ${JSON.stringify(body.error)}`);
  return body.data.token;
}
interface Agent { name: string; gaii: string; token: string }
async function newOwner(prefix: string): Promise<{ name: string; token: string }> {
  const name = `${prefix}${Date.now()}`;
  return { name, token: (await registerOwner(BASE, name)).token };
}
async function newAgent(owner: { name: string; token: string }, name: string, scopes: string[], mode?: string): Promise<Agent> {
  const { status, body } = await json('/v1/agents', {
    method: 'POST', headers: auth(owner.token),
    body: JSON.stringify({ name, owner: owner.name, capabilities: ['tasks'], scopes, ...(mode ? { mode } : {}) }),
  });
  assert(status === 201, `agent ${name} ${status}: ${JSON.stringify(body)}`);
  const gaii = body.data.agent.gaii as string;
  return { name, gaii, token: await agentToken(gaii, body.data.private_key) };
}
const writeAvatar = (token: string, value: unknown) =>
  json('/v1/memory', { method: 'POST', headers: auth(token), body: JSON.stringify({ key: 'agent.avatar', value }) });
async function listed(token: string, name: string): Promise<any> {
  const { body } = await json('/v1/agents', { headers: auth(token) });
  return (body?.data?.agents ?? []).find((a: any) => a.name === name);
}
const profile = (gaii: string) => json(`/v1/agents/${encodeURIComponent(gaii)}`);
const picture = (gaii: string, q = '', headers: Record<string, string> = {}) =>
  fetch(`${BASE}/v1/agents/${encodeURIComponent(gaii)}/avatar.svg${q}`, { headers });

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><style>.a{fill:#E8564A}</style><rect class="a" width="128" height="128" rx="28"/><circle cx="64" cy="64" r="20" fill="#fff"/></svg>';

console.log('\n=== AIMEAT Agent Avatar E2E ===\n');

const owner = await newOwner('avat');
const other = await newOwner('avstr');
let me!: Agent, sibling!: Agent, stranger!: Agent;

console.log('Setup');
await test('An agent, a sibling of the same owner, and an agent of another account', async () => {
  me = await newAgent(owner, 'painter', ['memory:read', 'memory:write', 'agent:read', 'agent:write'], 'workstation');
  sibling = await newAgent(owner, 'sibling', ['memory:read', 'memory:write', 'agent:read', 'agent:write']);
  stranger = await newAgent(other, 'stranger', ['memory:read', 'memory:write', 'agent:read', 'agent:write']);
  const row = await listed(owner.token, 'painter');
  assert(row && row.avatar === null, `no avatar yet: ${JSON.stringify(row?.avatar)}`);
});

console.log('\n1. The agent writes its own picture with the ordinary memory write');
await test('An emoji: the list and the public profile carry it', async () => {
  const w = await writeAvatar(me.token, { emoji: '🦊' });
  // Whether the write answers 201 (created) or 200 (replaced) is not this suite's subject; that it
  // was written is.
  assert(w.body?.ok === true, `write ${w.status}: ${JSON.stringify(w.body)}`);
  const row = await listed(owner.token, 'painter');
  assert(row.avatar?.kind === 'emoji' && row.avatar.emoji === '🦊', `list: ${JSON.stringify(row.avatar)}`);
  assert(typeof row.avatar.url === 'string' && row.avatar.url.includes('/avatar.svg?v='), `url: ${row.avatar.url}`);
  const p = await profile(me.gaii);
  assert(p.status === 200 && p.body.data.avatar?.kind === 'emoji', `profile: ${JSON.stringify(p.body.data?.avatar)}`);
  assert(!('avatar_problem' in p.body.data), 'a showable avatar has no problem');
});

let svgVersion = 0;
await test('An SVG replaces it; the list carries the address and never the SVG', async () => {
  const w = await writeAvatar(me.token, { svg: SVG });
  assert(w.body?.ok === true, `write ${w.status}`);
  const row = await listed(owner.token, 'painter');
  assert(row.avatar?.kind === 'svg' && row.avatar.bytes === Buffer.byteLength(SVG), `list: ${JSON.stringify(row.avatar)}`);
  assert(!JSON.stringify(row).includes('<svg'), 'the list row holds no SVG text');
  svgVersion = row.avatar.version;
  assert(row.avatar.url.endsWith(`?v=${svgVersion}`), `the version is in the address: ${row.avatar.url}`);
});

console.log('\n2. The picture address');
await test('Serves the SVG as image/svg+xml under a sandboxing CSP, cacheable for good on its version', async () => {
  const r = await picture(me.gaii, `?v=${svgVersion}`);
  assert(r.status === 200, `status ${r.status}`);
  assert((r.headers.get('content-type') ?? '').startsWith('image/svg+xml'), `type ${r.headers.get('content-type')}`);
  const csp = r.headers.get('content-security-policy') ?? '';
  assert(csp.includes("default-src 'none'") && csp.includes('sandbox'), `csp: ${csp}`);
  assert(r.headers.get('x-content-type-options') === 'nosniff', 'nosniff');
  assert((r.headers.get('cache-control') ?? '').includes('immutable'), `cache: ${r.headers.get('cache-control')}`);
  assert((await r.text()) === SVG, 'the body is the SVG as written');
});
await test('Without the version it revalidates, and a matching ETag answers 304', async () => {
  const r = await picture(me.gaii);
  assert(!(r.headers.get('cache-control') ?? '').includes('immutable'), `cache: ${r.headers.get('cache-control')}`);
  const etag = r.headers.get('etag') ?? '';
  await r.text();
  assert(etag.length > 0, 'an ETag');
  const again = await picture(me.gaii, '', { 'If-None-Match': etag });
  assert(again.status === 304, `conditional ${again.status}`);
});
await test('An emoji avatar is drawn as an SVG at the same address', async () => {
  await writeAvatar(sibling.token, { emoji: '🐙' });
  const r = await picture(sibling.gaii);
  const text = await r.text();
  assert(r.status === 200 && text.startsWith('<svg') && text.includes('🐙'), `emoji svg: ${r.status} ${text.slice(0, 80)}`);
});
await test('An agent with no avatar answers 404 AVATAR_NOT_FOUND', async () => {
  const r = await picture(stranger.gaii);
  const body = await r.json();
  assert(r.status === 404 && body.error?.code === 'AVATAR_NOT_FOUND', `${r.status} ${JSON.stringify(body.error)}`);
});

console.log('\n3. What cannot be shown');
await test('An SVG over 256 kB is stored as memory but not shown: profile says why, address 404, list null', async () => {
  const big = `<svg xmlns="http://www.w3.org/2000/svg"><!--${'x'.repeat(256 * 1024)}--></svg>`;
  const w = await writeAvatar(stranger.token, { svg: big });
  assert(w.body?.ok === true, `the memory write itself is ordinary: ${w.status}`);
  const p = await profile(stranger.gaii);
  assert(p.body.data.avatar === null && /256 kB/.test(p.body.data.avatar_problem ?? ''), `profile: ${JSON.stringify({ a: p.body.data.avatar, p: p.body.data.avatar_problem })}`);
  assert((await picture(stranger.gaii)).status === 404, 'no picture');
  assert((await listed(other.token, 'stranger')).avatar === null, 'list null');
});
await test('Markup that is not one <svg>, and a DOCTYPE, are refused by the owner route with the reason', async () => {
  const notSvg = await json(`/v1/agents/painter/avatar`, { method: 'PUT', headers: auth(owner.token), body: JSON.stringify({ svg: '<div>hi</div>' }) });
  assert(notSvg.status === 400 && /one <svg>/.test(notSvg.body.error?.message ?? ''), `not svg: ${notSvg.status} ${notSvg.body.error?.message}`);
  const doctype = await json(`/v1/agents/painter/avatar`, { method: 'PUT', headers: auth(owner.token), body: JSON.stringify({ svg: '<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY a "x">]><svg xmlns="http://www.w3.org/2000/svg"></svg>' }) });
  assert(doctype.status === 400, `doctype: ${doctype.status} ${doctype.body.error?.message}`);
  const empty = await json(`/v1/agents/painter/avatar`, { method: 'PUT', headers: auth(owner.token), body: JSON.stringify({}) });
  assert(empty.status === 400, `empty: ${empty.status}`);
});

console.log('\n4. Who may set it through PUT and DELETE .../avatar');
await test('The owner in person sets an agent\'s picture', async () => {
  const r = await json(`/v1/agents/sibling/avatar`, { method: 'PUT', headers: auth(owner.token), body: JSON.stringify({ emoji: '🦉' }) });
  assert(r.status === 200 && r.body.data.avatar?.emoji === '🦉', `${r.status} ${JSON.stringify(r.body)}`);
});
await test('The agent sets its own', async () => {
  const r = await json(`/v1/agents/${encodeURIComponent(me.gaii)}/avatar`, { method: 'PUT', headers: auth(me.token), body: JSON.stringify({ svg: SVG }) });
  assert(r.status === 200 && r.body.data.avatar?.kind === 'svg', `${r.status} ${JSON.stringify(r.body.error)}`);
});
await test('A sibling agent, another account and an anonymous caller are refused', async () => {
  const bySibling = await json(`/v1/agents/${encodeURIComponent(me.gaii)}/avatar`, { method: 'PUT', headers: auth(sibling.token), body: JSON.stringify({ emoji: '💀' }) });
  assert(bySibling.status === 403, `sibling ${bySibling.status}`);
  const byStranger = await json(`/v1/agents/${encodeURIComponent(me.gaii)}/avatar`, { method: 'PUT', headers: auth(stranger.token), body: JSON.stringify({ emoji: '💀' }) });
  assert(byStranger.status === 403, `stranger ${byStranger.status}`);
  const byOtherOwner = await json(`/v1/agents/${encodeURIComponent(me.gaii)}/avatar`, { method: 'DELETE', headers: auth(other.token) });
  assert(byOtherOwner.status === 403, `other owner ${byOtherOwner.status}`);
  const anon = await json(`/v1/agents/${encodeURIComponent(me.gaii)}/avatar`, { method: 'PUT', body: JSON.stringify({ emoji: '💀' }) });
  assert(anon.status === 401, `anonymous ${anon.status}`);
  const row = await listed(owner.token, 'painter');
  assert(row.avatar?.kind === 'svg', `unchanged: ${JSON.stringify(row.avatar)}`);
});
await test('The owner removes it, and the list says null', async () => {
  const r = await json(`/v1/agents/sibling/avatar`, { method: 'DELETE', headers: auth(owner.token) });
  assert(r.status === 200 && r.body.data.removed === true, `${r.status} ${JSON.stringify(r.body)}`);
  assert((await listed(owner.token, 'sibling')).avatar === null, 'gone from the list');
  const again = await json(`/v1/agents/sibling/avatar`, { method: 'DELETE', headers: auth(owner.token) });
  assert(again.status === 200 && again.body.data.removed === false, 'a second delete removes nothing');
});

console.log('\n5. The optional onboarding step');
await test('set_avatar is optional in the workstation flow and has passed for an agent with a picture', async () => {
  await json(`/v1/agents/painter/onboarding/start`, { method: 'POST', headers: auth(owner.token) });
  const r = await json(`/v1/agents/painter/onboarding`, { headers: auth(owner.token) });
  const steps = r.body.data?.onboarding?.steps ?? r.body.data?.steps ?? [];
  const step = steps.find((s: any) => s.id === 'set_avatar');
  assert(!!step, `the step is in the flow: ${steps.map((s: any) => s.id).join(',')}`);
  assert(step.required === false, 'optional');
  assert(step.status === 'passed', `passed: ${step.status} ${step.failureReason ?? ''}`);
});

console.log('\n6. The Design Book\'s avatar templates');
let templateId = '';
await test('Nine published avatar templates, each of which passes the reader as agent.avatar', async () => {
  const r = await json('/v1/designbook?kind=avatar');
  const parts = r.body.data?.parts ?? [];
  assert(parts.length >= 9, `nine templates: ${parts.length}`);
  templateId = parts[0].id;
  const one = await json(`/v1/designbook/${templateId}`);
  const svg = one.body.data?.part?.body?.svg;
  assert(typeof svg === 'string' && svg.startsWith('<svg'), 'the template is an SVG');
  const w = await writeAvatar(sibling.token, { svg });
  assert(w.body?.ok === true, `write ${w.status}`);
  assert((await listed(owner.token, 'sibling')).avatar?.kind === 'svg', 'a template is a valid avatar as it is');
});
await test('Its preview page shows the picture as an <img>', async () => {
  const r = await fetch(`${BASE}/v1/designbook/${templateId}/preview`);
  const text = await r.text();
  assert(r.status === 200 && text.includes('<img src="data:image/svg+xml;base64,'), `preview ${r.status}`);
});
await test('An avatar part that is not one SVG is refused by the bench', async () => {
  const r = await json('/v1/designbook', {
    method: 'POST', headers: auth(me.token),
    body: JSON.stringify({ part: { id: `avatar-bad-${Date.now()}`, kind: 'avatar', title: 'Bad', summary: 'Not an SVG at all, so the bench refuses it.', body: { svg: '<div></div>' }, tags: ['avatar'] } }),
  });
  assert(r.status === 422, `refused: ${r.status} ${JSON.stringify(r.body.error)}`);
});
await test('Adopting an avatar part answers the SVG and how to use it, and writes nothing', async () => {
  const before = (await listed(owner.token, 'painter')).avatar?.version;
  const r = await json(`/v1/designbook/${templateId}/adopt`, { method: 'POST', headers: auth(me.token), body: JSON.stringify({ filename: 'none.html' }) });
  assert(r.status === 200 && typeof r.body.data?.avatar?.svg === 'string' && /agent\.avatar/.test(r.body.data.avatar.use), `adopt ${r.status} ${JSON.stringify(r.body.error)}`);
  assert((await listed(owner.token, 'painter')).avatar?.version === before, 'nothing was written');
});

console.log('\n7. The words that send an agent here');
await test('The Hello Integration prompt and the built-in skill name agent.avatar', async () => {
  const p = await json('/v1/prompts/hello-integration');
  assert((p.body.data?.prompt ?? '').includes('agent.avatar'), 'the prompt names the key');
  const s = await json('/v1/skills/agent-avatar?scope=node');
  const text = JSON.stringify(s.body);
  assert(s.status === 200 && text.includes('agent.avatar'), `the skill: ${s.status}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
