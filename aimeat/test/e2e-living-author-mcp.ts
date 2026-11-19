/**
 * @file test/e2e-living-author-mcp.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A document template designed from the chat: aimeat_living_author and POST
 *   /v1/living/author over one service (services/living/author.ts), which takes the caller. The
 *   provider is a loopback stand-in (helpers/fake-ai-provider.ts) the owner's settings point at; the
 *   node plans, meters and sends its own call. Holds:
 *     1. the owner's agent holding ai:use gets a template over MCP and over REST, from the owner's AI;
 *     2. the agent's own limit applies: the owner's AI policy names the models this one agent may
 *        use, and the agent's call is refused before it reaches the provider, while the owner's own
 *        call with the same settings goes through. Planned as the owner in person, the agent's call
 *        would have gone through as well;
 *     3. an agent without ai:use is not offered the tool and REST refuses it.
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=living-author-mcp
 * @version-history
 *   v1.0.0 — 2026-11-19 — Initial (feature audit 2026-11-19, 4.4 item 5).
 */
import { registerOwner, type RegisteredOwner } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool, toolNames, type McpAgent } from './helpers/mcp-session.js';
import { startFakeAiProvider, chatJson, type FakeAiProvider } from './helpers/fake-ai-provider.js';

const BASE = process.env.E2E_BASE ?? 'http://localhost:40251';

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }

async function json(path: string, opts: RequestInit & { token?: string } = {}): Promise<{ status: number; body: any }> {
  const { token, ...rest } = opts;
  const res = await fetch(`${BASE}${path}`, {
    ...rest,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(rest.headers ?? {}) },
  });
  const text = await res.text();
  try { return { status: res.status, body: JSON.parse(text) }; } catch { return { status: res.status, body: { _raw: text } }; }
}
const short = (v: unknown) => String(JSON.stringify(v)).slice(0, 240);
const stamp = Date.now().toString(36).slice(-5);

const TEMPLATE = {
  title: `Harbour weekly ${stamp}`,
  description: 'What changed in the harbour project this week.',
  charter: { scope: 'the harbour project', tracks: ['decisions'], include: [], exclude: [], cadence: 'weekly', trust: { derive: 'gated' } },
  template: [{ section: 'Decisions', desc: 'Who decided what.', slot: 'decisions', kind: 'derived', rules: { max_words: 120 }, agent: null }],
  charterReadable: 'Once a week, the decisions of the harbour project.',
};

console.log('\n=== A document template from the chat ===\n');

let provider!: FakeAiProvider;
let owner!: RegisteredOwner;
let writer!: McpAgent, limited!: McpAgent, plain!: McpAgent;

await test('Setup: an owner whose AI is the loopback provider, and three agents', async () => {
  provider = await startFakeAiProvider(0);
  provider.setDefault('chat', chatJson(JSON.stringify(TEMPLATE), { model: 'stub/owner-model' }));
  owner = await registerOwner(BASE, `liv${stamp}`);
  const s = await json('/v1/memory', {
    method: 'POST', token: owner.token,
    body: JSON.stringify({ key: 'openrouter.settings', visibility: 'private', value: { provider: 'custom', baseUrl: provider.baseUrl, model: 'stub/owner-model', daily_budget_usd: 5 } }),
  });
  assert(s.status === 201, `settings ${s.status} ${short(s.body?.error)}`);
  writer = await makeAgent(BASE, owner, ['ai:use']);
  limited = await makeAgent(BASE, owner, ['ai:use']);
  plain = await makeAgent(BASE, owner, ['memory:read']);
});

console.log('\n1. The owner\'s agent designs a template');
await test('1a. Over MCP: the template comes back from the owner\'s AI, and nothing is stored', async () => {
  const before = provider.requestsFor('chat').length;
  const s = await openSession(BASE, writer.token, 'e2e-living-author');
  const r = await callTool(s, 'aimeat_living_author', { need: 'A weekly page of what the harbour project decided.' });
  assert(!r.isError, `author: ${r.text.slice(0, 300)}`);
  assert(r.data.template?.title === TEMPLATE.title && r.data.template.template[0].section === 'Decisions', `template: ${short(r.data)}`);
  assert(provider.requestsFor('chat').length === before + 1, 'one call reached the provider');
  assert(String(provider.lastRequest('chat')?.body).includes('harbour project decided'), 'the need was in the prompt');
});

await test('1b. Over REST, which the CLI dispatch calls, the agent gets the same', async () => {
  const r = await json('/v1/living/author', { method: 'POST', token: writer.token, body: JSON.stringify({ need: 'A weekly page of the harbour.' }) });
  assert(r.status === 200 && r.body.data.template.title === TEMPLATE.title, `REST: ${r.status} ${short(r.body?.error ?? r.body?.data)}`);
});

console.log('\n2. The agent\'s own limit applies');
await test('2a. The owner allows this agent one other model: its call is refused before the provider, the owner\'s is not', async () => {
  const p = await json('/v1/ai/policy', {
    method: 'PUT', token: owner.token,
    body: JSON.stringify({ policy: { mode: 'open', agents: { [limited.name]: { allow: ['openai-compatible:stub/other-model'] } } } }),
  });
  assert(p.status === 200, `policy ${p.status} ${short(p.body?.error)}`);
  const before = provider.requestsFor('chat').length;
  const s = await openSession(BASE, limited.token, 'e2e-living-author-limited');
  const r = await callTool(s, 'aimeat_living_author', { need: 'A weekly page of the harbour.' });
  assert(r.isError && /^AI_MODEL_NOT_ALLOWED: /.test(r.text), `the agent's call: ${r.text.slice(0, 300)}`);
  const rest = await json('/v1/living/author', { method: 'POST', token: limited.token, body: JSON.stringify({ need: 'A weekly page of the harbour.' }) });
  assert(rest.status === 403 && rest.body.error?.code === 'AI_MODEL_NOT_ALLOWED', `the agent over REST: ${rest.status} ${short(rest.body?.error)}`);
  assert(provider.requestsFor('chat').length === before, 'a refused call never reaches the provider');
  const own = await json('/v1/living/author', { method: 'POST', token: owner.token, body: JSON.stringify({ need: 'A weekly page of the harbour.' }) });
  assert(own.status === 200 && own.body.data.template.title === TEMPLATE.title, `the owner in person: ${own.status} ${short(own.body?.error)}`);
  const other = await callTool(await openSession(BASE, writer.token, 'e2e-living-author-other'), 'aimeat_living_author', { need: 'x' });
  assert(!other.isError, `the other agent has no such list: ${other.text.slice(0, 200)}`);
});

console.log('\n3. Without permission to use AI');
await test('3a. An agent without ai:use is not offered the tool, and REST refuses it', async () => {
  const s = await openSession(BASE, plain.token, 'e2e-living-author-plain');
  assert(!(await toolNames(s)).includes('aimeat_living_author'), 'not offered');
  const r = await callTool(s, 'aimeat_living_author', { need: 'x' });
  assert(r.isError, `refused: ${r.text.slice(0, 200)}`);
  const rest = await json('/v1/living/author', { method: 'POST', token: plain.token, body: JSON.stringify({ need: 'x' }) });
  assert(rest.status === 403, `REST: ${rest.status} ${short(rest.body?.error)}`);
});

await provider?.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
