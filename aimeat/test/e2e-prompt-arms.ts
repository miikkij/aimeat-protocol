/**
 * @file test/e2e-prompt-arms.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The arms of src/routes/prompts.ts nothing had fetched: the per-role surface
 *   handbook and the offerings page an agent reads, the module 404, the tier1 → handbook 301, the
 *   draft-offer prompt, the three `?format=txt` doors (agent-onboard, agent-connect, hello-mcp),
 *   the anonymous share prompt as text, the portal package 404, and the openclaw tier.
 *   e2e-prompt-modules.ts owns the tier-1 module content and build-extension; nothing here repeats
 *   it, and e2e-prompt-doors.ts owns build-cortex, organism-setup and ai-instructions.
 *
 * @structure
 *   - Phase 0: an owner, an agent, and a narrow agent carrying one unrelated scope
 *   - Phase 1: the handbook doors — surface/:role, offerings, the unknown module
 *   - Phase 2: the 301 from the old tier1 paths
 *   - Phase 3: draft-offer
 *   - Phase 4: the ?format=txt doors
 *   - Phase 5: the anonymous share prompt as text
 *   - Phase 6: the portal prompt package 404
 *   - Phase 7: the openclaw tier, and the tier the node does not know
 *   - Phase 8: the denials
 *
 * @usage
 *   cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx \
 *     test/run-e2e-ci.ts --test=prompt-arms
 *
 * @version-history
 *   v1.1.0 — 2026-09-08 — anonymous/share?format=text asserts nosniff, which the node sets globally.
 *   v1.0.0 — 2026-09-08 — Initial suite
 */

import * as ed from '@noble/ed25519';
import { createHash } from 'node:crypto';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';
const NODE_ID = process.env.E2E_NODE_ID ?? 'aimeat-local-001-dev';

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ❌ ${name}: ${(err as Error).message}`);
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

ed.hashes.sha512 = (m: Uint8Array) => new Uint8Array(createHash('sha512').update(m).digest());
async function signMsg(privateKeyB64: string, message: string): Promise<string> {
  const sig = await ed.signAsync(new TextEncoder().encode(message), Buffer.from(privateKeyB64, 'base64'));
  return Buffer.from(sig).toString('base64');
}

// ─── State ───
const ownerName = `promptarms${Date.now()}`;
let ownerToken = '';
let agentGaii = '';
let agentToken = '';
let narrowToken = '';

const ownerAuth = () => ({ Authorization: `Bearer ${ownerToken}` });
const agentAuth = () => ({ Authorization: `Bearer ${agentToken}` });

// The v2 surface roles the node serves a handbook for. Held here rather than imported so the
// suite proves the HTTP contract rather than agreeing with the constant it is testing.
const SURFACE_ROLES = ['appdev', 'agent', 'service', 'admin', 'commerce', 'primitives', 'full'];

console.log('\n=== AIMEAT Prompt Arms E2E ===\n');

// ─── Phase 0 ───
console.log('Phase 0 — Principals');

await test('register owner + token', async () => {
  const reg = await json('/v1/owners', {
    method: 'POST', body: JSON.stringify({ name: ownerName, public_key: 'placeholder' }),
  });
  assert(reg.status === 201, `status ${reg.status}: ${JSON.stringify(reg.body)}`);
  const timestamp = new Date().toISOString();
  const signature = await signMsg(reg.body.data.private_key, ownerName + NODE_ID + timestamp);
  const { body } = await json('/v1/auth/token', {
    method: 'POST', body: JSON.stringify({ owner: ownerName, timestamp, signature }),
  });
  assert(body.ok === true, `token: ${JSON.stringify(body.error)}`);
  ownerToken = body.data.token;
});

await test('register an agent + token', async () => {
  const { status, body } = await json('/v1/agents', {
    method: 'POST', headers: ownerAuth(),
    body: JSON.stringify({ name: 'promptarmsbot', owner: ownerName, capabilities: ['memory'], model: 'test' }),
  });
  assert(status === 201, `status ${status}: ${JSON.stringify(body)}`);
  agentGaii = body.data.agent.gaii;
  const ts = new Date().toISOString();
  const tok = await json('/v1/auth/token', {
    method: 'POST',
    body: JSON.stringify({ gaii: agentGaii, timestamp: ts, signature: await signMsg(body.data.private_key, agentGaii + ts) }),
  });
  agentToken = tok.body.data?.token;
  assert(typeof agentToken === 'string', `agent token: ${JSON.stringify(tok.body?.error)}`);
});

await test('register a NARROW agent — one unrelated scope and nothing else', async () => {
  // The runner pins AIMEAT_DEFAULT_AGENT_SCOPES='*', so a narrow list has to be asked for by name.
  // This one exists to answer a question about the prompt doors rather than to be refused: see the
  // last test in this file.
  const reg = await json('/v1/agents', {
    method: 'POST', headers: ownerAuth(),
    body: JSON.stringify({
      name: 'promptarmsnarrow', owner: ownerName, capabilities: ['memory'], model: 'test',
      scopes: ['catalogue:read'],
    }),
  });
  assert(reg.status === 201, `status ${reg.status}: ${JSON.stringify(reg.body?.error)}`);
  const gaii = reg.body.data.agent.gaii as string;
  const ts = new Date().toISOString();
  const tok = await json('/v1/auth/token', {
    method: 'POST',
    body: JSON.stringify({ gaii, timestamp: ts, signature: await signMsg(reg.body.data.private_key, gaii + ts) }),
  });
  narrowToken = tok.body.data?.token;
  assert(typeof narrowToken === 'string', `narrow token: ${JSON.stringify(tok.body?.error)}`);
});

// ─── Phase 1: the handbook doors ───
console.log('Phase 1 — Handbook surfaces');

await test('GET handbook/surface/:role serves a handbook for every v2 role', async () => {
  for (const role of SURFACE_ROLES) {
    const { status, body } = await json(`/v1/agents/me/handbook/surface/${role}`, { headers: agentAuth() });
    assert(status === 200, `${role}: status ${status}: ${JSON.stringify(body?.error)}`);
    assert(body.data?.surface === role, `${role}: surface ${body.data?.surface}`);
    assert(typeof body.data?.content === 'string' && body.data.content.length > 100,
      `${role}: content is ${body.data?.content?.length} chars`);
    // Both fields carry the same text: `system_prompt` is what an agent runtime looks for and
    // `content` is what a reader looks for, and a caller reading one must not get less than the other.
    assert(body.data?.system_prompt === body.data?.content, `${role}: system_prompt and content disagree`);
  }
});

await test('GET handbook/surface/:role for a role that is not one → 404, naming the ones that are', async () => {
  const { status, body } = await json('/v1/agents/me/handbook/surface/warehouse', { headers: agentAuth() });
  assert(status === 404, `expected 404, got ${status}`);
  assert(body.error?.code === 'NOT_FOUND', `code ${body.error?.code}`);
  for (const role of SURFACE_ROLES) {
    assert((body.error?.message ?? '').includes(role), `the refusal names ${role}: ${body.error?.message}`);
  }
});

await test('GET handbook/offerings is a page, not a DB-backed module name', async () => {
  // Registered before /:module on purpose: read as a module it would 404, because there is no
  // tier-1-offerings prompt to find.
  const { status, body } = await json('/v1/agents/me/handbook/offerings', { headers: agentAuth() });
  assert(status === 200, `status ${status}: ${JSON.stringify(body?.error)}`);
  assert(body.data?.module === 'offerings', `module ${body.data?.module}`);
  assert(typeof body.data?.content === 'string' && body.data.content.length > 100, 'the page has content');
  assert(body.data?.system_prompt === body.data?.content, 'system_prompt and content agree');
  // The agent's own name is substituted from the caller's GAII, so the page speaks to whoever asked.
  const agentName = agentGaii.split('#')[0];
  assert(body.data.content.includes(agentName), `the agent's own name reaches the page: ${agentName}`);
  assert(!body.data.content.includes('{{agent_name}}'), 'no unresolved {{agent_name}}');
  assert(!body.data.content.includes('{{node_id}}'), 'no unresolved {{node_id}}');
});

await test('GET handbook/:module for a name nobody serves → 404 listing the valid ones', async () => {
  const { status, body } = await json('/v1/agents/me/handbook/warehousing', { headers: agentAuth() });
  assert(status === 404, `expected 404, got ${status}`);
  assert(/Unknown module: warehousing/.test(body.error?.message ?? ''), `message ${body.error?.message}`);
  assert(/Valid:/.test(body.error?.message ?? ''), 'the refusal says which names work');
});

await test('GET handbook/onboarding is an ALIAS, not a 404', async () => {
  // The most common guess after a freshly connected agent calls aimeat_onboarding_status. The alias
  // maps it to tasks rather than answering "unknown module" and leaving the agent to recover.
  const { status, body } = await json('/v1/agents/me/handbook/onboarding', { headers: agentAuth() });
  assert(status === 200, `status ${status}: ${JSON.stringify(body?.error)}`);
  assert(body.data?.module === 'tasks', `the alias resolves to tasks, got ${body.data?.module}`);
});

// ─── Phase 2: the 301 ───
console.log('Phase 2 — The old tier1 paths');

await test('GET /v1/prompts/tier1/:module → 301 to the handbook path', async () => {
  const res = await fetch(`${BASE}/v1/prompts/tier1/memory`, { redirect: 'manual', headers: agentAuth() });
  assert(res.status === 301, `expected 301, got ${res.status}`);
  assert(res.headers.get('location') === '/v1/agents/me/handbook/memory',
    `location ${res.headers.get('location')}`);
  // The redirect is not a courtesy: following it has to arrive somewhere real, or the old path is
  // a 301 into a 404.
  const followed = await json('/v1/agents/me/handbook/memory', { headers: agentAuth() });
  assert(followed.status === 200, `the target answers: ${followed.status}`);
});

await test('GET /v1/prompts/tier1 (no module) → 301 to the handbook root', async () => {
  const res = await fetch(`${BASE}/v1/prompts/tier1`, { redirect: 'manual', headers: agentAuth() });
  assert(res.status === 301, `expected 301, got ${res.status}`);
  assert(res.headers.get('location') === '/v1/agents/me/handbook', `location ${res.headers.get('location')}`);
});

// ─── Phase 3: draft-offer ───
console.log('Phase 3 — draft-offer');

await test('GET /v1/prompts/draft-offer names the AGENT when an agent asks', async () => {
  const { status, body } = await json('/v1/prompts/draft-offer', { headers: agentAuth() });
  assert(status === 200, `status ${status}: ${JSON.stringify(body?.error)}`);
  assert(body.data?.id === 'draft-offer', `id ${body.data?.id}`);
  assert(typeof body.data?.prompt === 'string' && body.data.prompt.length > 200, `prompt is ${body.data?.prompt?.length} chars`);
  assert(body.data?.system_prompt === body.data?.prompt, 'system_prompt and prompt agree');
  const agentName = agentGaii.split('#')[0];
  assert(body.data.prompt.includes(agentName), `the agent's own name reaches the prompt: ${agentName}`);
  assert(!body.data.prompt.includes('{{gaii}}') && !body.data.prompt.includes('{{agent_name}}'),
    'no unresolved variables');
});

await test('GET /v1/prompts/draft-offer falls back to the OWNER name on an owner session', async () => {
  // An owner session has no agent half in its sub, so the substitution has nothing to take. It
  // keeps the owner name rather than printing "unknown", which is what a person pasting the prompt
  // into their chat would otherwise be told to publish under.
  const { status, body } = await json('/v1/prompts/draft-offer', { headers: ownerAuth() });
  assert(status === 200, `status ${status}`);
  assert(body.data.prompt.includes(ownerName), `the owner name reaches the prompt: ${ownerName}`);
});

// ─── Phase 4: the ?format=txt doors ───
console.log('Phase 4 — ?format=txt');

async function raw(path: string, opts: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, opts);
  return { status: res.status, ct: res.headers.get('content-type') ?? '', nosniff: res.headers.get('x-content-type-options') ?? '', text: await res.text() };
}

await test('agent-onboard: ?format=txt is the prompt itself, not the envelope', async () => {
  const envelope = await json('/v1/prompts/agent-onboard');
  assert(envelope.status === 200, `envelope ${envelope.status}`);
  const txt = await raw('/v1/prompts/agent-onboard?format=txt');
  assert(txt.status === 200, `txt status ${txt.status}`);
  assert(txt.ct.includes('text/plain'), `content-type ${txt.ct}`);
  // A body a browser may not talk itself into parsing as HTML cannot carry a script, and these
  // prompts fold in what the caller asked for verbatim.
  assert(txt.nosniff === 'nosniff', `x-content-type-options ${txt.nosniff}`);
  assert(!txt.text.trimStart().startsWith('{'), 'the text arm returned the JSON envelope');
  assert(txt.text === envelope.body.data.prompt, 'the two doors serve the same text');
});

await test('agent-connect: ?format=txt, and it is an owner door', async () => {
  const envelope = await json('/v1/prompts/agent-connect?agent_name=deskbot', { headers: ownerAuth() });
  assert(envelope.status === 200, `envelope ${envelope.status}: ${JSON.stringify(envelope.body?.error)}`);
  assert(envelope.body.data?.agent_name === 'deskbot', `agent_name ${envelope.body.data?.agent_name}`);
  assert(Array.isArray(envelope.body.data?.steps) && envelope.body.data.steps.length > 0,
    'the manual steps travel with the prompt, generated together so they cannot describe different things');

  const txt = await raw('/v1/prompts/agent-connect?agent_name=deskbot&format=txt', { headers: ownerAuth() });
  assert(txt.status === 200, `txt status ${txt.status}`);
  assert(txt.ct.includes('text/plain'), `content-type ${txt.ct}`);
  assert(txt.nosniff === 'nosniff', `x-content-type-options ${txt.nosniff}`);
  assert(txt.text === envelope.body.data.prompt, 'the two doors serve the same text');
  assert(txt.text.includes('deskbot'), 'the requested agent name reaches the text');
});

await test('hello-mcp: ?format=txt, and the envelope names the key the prompt writes', async () => {
  const envelope = await json('/v1/prompts/hello-mcp');
  assert(envelope.status === 200, `envelope ${envelope.status}`);
  const key = envelope.body.data?.key;
  assert(typeof key === 'string' && key.length > 0, `the proof key is named: ${key}`);
  // The text and the key come out of the same module for exactly this reason: a prompt that writes
  // a different key than the node checks is a silent failure, which is the thing Hello MCP exists
  // to prevent.
  assert(envelope.body.data.prompt.includes(key), 'the prompt names the key the node will look for');

  const txt = await raw('/v1/prompts/hello-mcp?format=txt&lang=fi');
  assert(txt.status === 200, `txt status ${txt.status}`);
  assert(txt.ct.includes('text/plain'), `content-type ${txt.ct}`);
  assert(txt.nosniff === 'nosniff', `x-content-type-options ${txt.nosniff}`);
  assert(txt.text.includes(key), 'the fi text names the same key');
  assert(!txt.text.trimStart().startsWith('{'), 'the text arm returned the JSON envelope');
});

// ─── Phase 5: the anonymous share prompt ───
console.log('Phase 5 — anonymous/share');

await test('GET /v1/prompts/anonymous/share?format=text is plain text and matches the envelope', async () => {
  // Note the spelling: this door reads `format=text`, while the prompt doors above read
  // `format=txt`. Both are pinned here so neither can be "tidied" into the other without a test
  // saying so — a URL people have pasted into their own chats is not renamable.
  const envelope = await json('/v1/prompts/anonymous/share');
  assert(envelope.status === 200, `envelope ${envelope.status}: ${JSON.stringify(envelope.body?.error)}`);
  const share = envelope.body.data?.share_prompt;
  assert(typeof share === 'string' && share.length > 100, `share_prompt is ${share?.length} chars`);
  assert(typeof envelope.body.data?.gaii === 'string' && envelope.body.data.gaii.includes('#anonymous@'),
    `the shared identity: ${envelope.body.data?.gaii}`);

  const txt = await raw('/v1/prompts/anonymous/share?format=text');
  assert(txt.status === 200, `text status ${txt.status}`);
  assert(txt.ct.includes('text/plain'), `content-type ${txt.ct}`);
  // This door bypasses sendPlainText, and still carries nosniff: the header is set node-wide.
  assert(txt.nosniff === 'nosniff', `x-content-type-options ${txt.nosniff}`);
  assert(!txt.text.trimStart().startsWith('{'), 'the text arm returned the JSON envelope');
  assert(!txt.text.includes('{{anon_gaii}}') && !txt.text.includes('{{node_url}}'), 'no unresolved variables');
});

// ─── Phase 6: the portal prompt packages ───
console.log('Phase 6 — Portal prompt packages');

await test('GET /v1/portal/prompts/:promptId for a package nobody published → 404', async () => {
  const { status, body } = await json('/v1/portal/prompts/no-such-prompt-package');
  assert(status === 404, `expected 404, got ${status}`);
  assert(body.error?.code === 'NOT_FOUND', `code ${body.error?.code}`);
  assert(/no-such-prompt-package/.test(body.error?.message ?? ''), `the refusal names it: ${body.error?.message}`);
});

await test('GET /v1/portal/prompts lists what there is, and each id resolves', async () => {
  const list = await json('/v1/portal/prompts');
  assert(list.status === 200, `status ${list.status}`);
  const packages = list.body.data?.packages ?? [];
  assert(list.body.data?.total === packages.length, `total ${list.body.data?.total} vs ${packages.length}`);
  if (packages.length === 0) {
    console.log('    (the builders group is empty on this node — the 404 above is the whole arm)');
    return;
  }
  const one = await json(`/v1/portal/prompts/${encodeURIComponent(packages[0].id)}`);
  assert(one.status === 200, `${packages[0].id}: status ${one.status}`);
  assert(typeof one.body.data?.prompt === 'string', 'the package carries a prompt');
  assert(!one.body.data.prompt.includes('{{node_url}}'), 'no unresolved {{node_url}}');
});

// ─── Phase 7: the openclaw tier ───
console.log('Phase 7 — The openclaw tier');

await test('GET /v1/prompts/openclaw — seeded, so it answers 200 with the MCP connection block', async () => {
  // tier-openclaw ships as a prompt seed, so a fresh node has it and this is the 200 arm. If a node
  // has it deleted or deactivated the route answers 404 NOT_FOUND instead; the assertion below says
  // which of the two this node is, so a failure names the cause rather than the symptom.
  const { status, body } = await json('/v1/prompts/openclaw', { headers: agentAuth() });
  if (status === 404) {
    throw new Error('tier-openclaw is not seeded or not active on this node: the route took its 404 arm');
  }
  assert(status === 200, `status ${status}: ${JSON.stringify(body?.error)}`);
  assert(body.data?.tier === 'openclaw', `tier ${body.data?.tier}`);
  assert(typeof body.data?.system_prompt === 'string' && body.data.system_prompt.length > 200,
    `system_prompt is ${body.data?.system_prompt?.length} chars`);
  assert(!body.data.system_prompt.includes('{{node_url}}') && !body.data.system_prompt.includes('{{gaii}}'),
    'no unresolved variables');
  assert(body.data?.mcp_config?.transport === 'streamable-http', `transport ${body.data?.mcp_config?.transport}`);
  assert((body.data?.mcp_config?.url ?? '').endsWith('/v1/mcp'), `mcp url ${body.data?.mcp_config?.url}`);
  assert(Array.isArray(body.data?.tools?.user) && body.data.tools.user.length > 0, 'the user tool list is there');
  assert(Array.isArray(body.data?.tools?.admin) && body.data.tools.admin.length > 0, 'the admin tool list is there');
});

await test('GET /v1/prompts/:tier for a tier the node does not serve → 400 INVALID_TIER', async () => {
  const { status, body } = await json('/v1/prompts/tier-nine');
  assert(status === 400, `expected 400, got ${status}`);
  assert(body.error?.code === 'INVALID_TIER', `code ${body.error?.code}`);
  assert(/openclaw/.test(body.error?.message ?? ''), `the refusal lists the tiers: ${body.error?.message}`);
});

// ─── Phase 8: the denials ───
console.log('Phase 8 — Denials');

await test('the authed prompt doors refuse a caller with no token (401)', async () => {
  const doors = [
    '/v1/agents/me/handbook/surface/agent',
    '/v1/agents/me/handbook/offerings',
    '/v1/agents/me/handbook/memory',
    '/v1/prompts/draft-offer',
    '/v1/prompts/agent-connect',
  ];
  for (const path of doors) {
    const { status } = await json(path);
    assert(status === 401, `${path}: expected 401, got ${status}`);
  }
});

await test('and a token with the WRONG scope still gets through: no prompt door is scoped', async () => {
  // The brief asked for a 403 from an agent lacking the needed scope. There is none to have: every
  // door in routes/prompts.ts is requireAuth() or optionalAuth(), and not one calls requireScope.
  // So the second refusal is another 401, and this is the positive half that says why — an agent
  // holding only catalogue:read reads all five. Pinned deliberately: these are operating
  // instructions rather than data, and if a scope gate is ever added this line is where it shows up.
  const narrow = { Authorization: `Bearer ${narrowToken}` };
  for (const path of ['/v1/agents/me/handbook/surface/agent', '/v1/agents/me/handbook/offerings',
    '/v1/agents/me/handbook/memory', '/v1/prompts/draft-offer', '/v1/prompts/agent-connect']) {
    const { status } = await json(path, { headers: narrow });
    assert(status === 200, `${path}: a catalogue:read agent got ${status}`);
  }
  // The second 401, on the door the first list did not use: an invalid bearer is refused, not
  // waved through as anonymous.
  const { status } = await json('/v1/prompts/draft-offer', { headers: { Authorization: 'Bearer not-a-token' } });
  assert(status === 401, `a bad token: expected 401, got ${status}`);
});

await test('the public prompt doors need no token at all', async () => {
  for (const path of ['/v1/prompts/agent-onboard', '/v1/prompts/hello-mcp', '/v1/prompts/anonymous/share',
    '/v1/prompts/tier0', '/v1/portal/prompts']) {
    const { status } = await json(path);
    assert(status === 200, `${path}: expected 200 unauthenticated, got ${status}`);
  }
});

// ─── Cleanup ───
console.log('Cleanup');

await test('cascade-delete the owner', async () => {
  const { status } = await json(`/v1/owners/${encodeURIComponent(ownerName)}`, {
    method: 'DELETE', headers: ownerAuth(),
  });
  assert(status === 200, `delete owner: ${status}`);
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed out of ${passed + failed} ===\n`);
process.exit(failed > 0 ? 1 : 0);
