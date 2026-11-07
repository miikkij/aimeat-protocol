/**
 * @file test/e2e-chat-ai-settings.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The chat's AI end to end (Jouni, 2026-11-07): what GET /v1/chat/status says when the
 *   chat cannot answer and who can change it, and the model, region and key it answers with when it
 *   can; the chat's own model and key, which reach the chat and nothing else; and the operator's
 *   model rules (ai.allowed_models, ai.models_locked), which bind every call on the node.
 *
 *   Its own node, because the chat agent and the operator's rules are node-wide settings: the fake
 *   ACP agent as the chat agent (the status starts it once to know it works), a node OpenRouter
 *   key with an allowance and a default chat model, so a turn's plan has a payer and a model without
 *   any call leaving the machine. The operator is made through the admin setup route.
 *
 *   PASS CRITERION: a node without a chat agent answers `state: no_agent` with the developer's
 *   sentence only under `technical`; a node with one answers `ready` with the key, model and region;
 *   the chat's own model changes the chat's model and leaves the owner's text model as it was; the
 *   operator's allowed list narrows the chat's choices and its model, and the lock refuses a chat model
 *   (403 AI_MODELS_LOCKED) and sets the person's choice aside.
 * @structure
 *   - the node under test: the runner's backend, its own port, a chat agent path, a node key
 *   - 1-9: the cases, in order
 * @usage cd aimeat && pnpm exec node --import tsx test/e2e-chat-ai-settings.ts
 * @version-history
 *   v1.0.0 — 2026-11-07 — Initial (Jouni, 2026-11-07).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve as resolvePath } from 'node:path';
import { pathToFileURL } from 'node:url';
import { nodeEntryArgs } from './helpers/node-entry.js';
import { pinnedEnv } from './run-e2e-server.js';
import { waitForServer } from './helpers/wait-for-server.js';
import { ownerSignIn } from './helpers/owner-login.js';

// Its own port, outside the 40251-up range sessions claim.
const PORT = process.env.E2E_CHAT_AI_SETTINGS_PORT ?? '28501';
const BASE = `http://localhost:${PORT}`;
const ADMIN_PW = 'ChatAiSettingsAdmin1234';
const PASSWORD = 'ChatAiSettings1234';
const NODE_MODEL = 'stub/node-model';
const CHAT_MODEL = 'stub/chat-model';
const PEER = pathToFileURL(resolvePath(process.cwd(), 'test/helpers/fake-goose-acp.ts')).href;

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

// ── the node under test ───────────────────────────────────────────────────────

const dbDir = mkdtempSync(join(tmpdir(), 'aimeat-chat-ai-settings-'));
const DB_PATH = join(dbDir, 'chat-ai-settings.db');
const PG_URL = process.env.AIMEAT_DB === 'postgres-kysely' ? (process.env.DATABASE_URL ?? '') : '';

async function startServer(): Promise<ChildProcess> {
  const target = PG_URL
    ? { port: PORT, baseUrl: BASE, dbType: 'postgres-kysely', dbPath: '', dbUrl: PG_URL, external: false }
    : { port: PORT, baseUrl: BASE, dbType: 'sqlite', dbPath: DB_PATH, dbUrl: '', external: false };
  const env: Record<string, string | undefined> = {
    ...process.env,
    ...pinnedEnv(target),
    AIMEAT_DEV_MODE: 'true',
    AIMEAT_TEST_MODE: 'true',
    AIMEAT_ADMIN_PASSWORD: ADMIN_PW,
    AIMEAT_RL_GLOBAL: '10000', AIMEAT_RL_AUTH: '1000', AIMEAT_RL_MEMORY: '1000',
    AIMEAT_REGISTRATION_RATE_LIMIT_MAX: '1000',
    AIMEAT_DEFAULT_AGENT_SCOPES: '*',
    // A chat agent that starts: the fake ACP agent (test/helpers/fake-goose-acp.ts), carried into the
    // agent child by NODE_OPTIONS, as e2e-chat-agent.ts does. The status starts it once to find out.
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --import tsx --import ${PEER}`.trim(),
    FAKE_GOOSE_LOG: join(dbDir, 'peer.jsonl'),
    AIMEAT_GOOSE_ENV_PASSTHROUGH: 'FAKE_GOOSE_LOG',
    AIMEAT_GOOSE_PATH_ROOT: dbDir,
    AIMEAT_GOOSE_BIN: process.execPath,
    AIMEAT_GOOSE_PROVIDER_API_KEY: '',
    // A node key with an allowance and a default chat model: a turn's plan has a payer and a model.
    AIMEAT_OPENROUTER_INSTANCE_KEY: 'sk-node-e2e-never-sent',
    AIMEAT_CHAT_FREE_ALLOWANCE_USD: '5',
    AIMEAT_MODEL_DEFAULT_CHAT: NODE_MODEL,
    AIMEAT_AI_OPENROUTER_REGION: 'any', AIMEAT_AI_OPENROUTER_REGIONS: 'eu,us,any',
    AIMEAT_AI_ALLOWED_MODELS: '', AIMEAT_AI_MODELS_LOCKED: 'false',
  };
  const dbArgs = PG_URL ? ['--db', 'postgres-kysely', '--db-url', PG_URL] : ['--db', 'sqlite', '--db-path', DB_PATH];
  const child = spawn('node', [...nodeEntryArgs(), 'start', ...dbArgs],
    { env: env as NodeJS.ProcessEnv, stdio: ['ignore', 'pipe', 'pipe'], cwd: process.cwd() });
  return waitForServer(child, BASE, { label: 'the chat AI settings node' });
}

async function stopServer(child: ChildProcess): Promise<void> {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
    await once(child, 'exit');
    clearTimeout(timer);
  }
}

// ── principals ────────────────────────────────────────────────────────────────

async function operatorOwner(): Promise<string> {
  const name = `chatop${Date.now()}`.toLowerCase();
  const reg = await json('/v1/admin/setup/register', {
    method: 'POST', headers: { 'X-Admin-Password': ADMIN_PW }, body: JSON.stringify({ name, password: PASSWORD }),
  });
  assert(reg.status === 200, `admin register ${reg.status}: ${JSON.stringify(reg.body?.error)}`);
  const tok = await ownerSignIn(BASE, name, PASSWORD);
  assert(tok.status === 200, `sign-in ${tok.status}`);
  return tok.body.data.token as string;
}

async function plainOwner(label: string): Promise<string> {
  const name = `chat${label}${Date.now()}`.toLowerCase();
  const reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'Chat AI', password: PASSWORD }) });
  assert(reg.status === 201, `ghii ${reg.status}: ${JSON.stringify(reg.body?.error)}`);
  const tok = await ownerSignIn(BASE, name, PASSWORD);
  assert(tok.status === 200, `sign-in ${tok.status}`);
  return tok.body.data.token as string;
}

/** The account name inside an owner's session token. */
const nameOf = (token: string): string => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')).owner;

async function connectAgent(ownerToken: string, agentName: string): Promise<string> {
  const owner = nameOf(ownerToken);
  const da = await json('/v1/agents/device-authorize', { method: 'POST', body: JSON.stringify({ agent_name: agentName, owner }) });
  assert(da.status === 200, `device-authorize ${da.status}`);
  const v = await json('/v1/agents/verify', {
    method: 'POST', body: JSON.stringify({ user_code: da.body.data.user_code, action: 'approve', scopes: ['*'], owner_token: ownerToken }),
  });
  assert(v.status === 200, `verify ${v.status}: ${JSON.stringify(v.body?.error)}`);
  const t = await json('/v1/agents/device-token', {
    method: 'POST', body: JSON.stringify({ device_code: da.body.data.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }),
  });
  assert(t.status === 200, `device-token ${t.status}`);
  return t.body.token as string;
}

const status = async (token: string) => {
  const r = await json('/v1/chat/status?lang=fi', { headers: auth(token) });
  assert(r.status === 200, `chat status ${r.status}: ${JSON.stringify(r.body?.error)}`);
  return r.body.data;
};
const setConfig = (token: string, changes: Record<string, unknown>) => json('/v1/admin/config', {
  method: 'PUT', headers: auth(token), body: JSON.stringify({ changes: Object.entries(changes).map(([path, value]) => ({ path, value })) }),
});
const setChatModel = (token: string, model: string | null) => json('/v1/ai/routing', {
  method: 'PUT', headers: auth(token), body: JSON.stringify({ routing: { agent: 'chat', model } }),
});
const textModel = async (token: string) => {
  const r = await json('/v1/ai/capabilities', { headers: auth(token) });
  return r.body?.data?.capabilities?.text?.model as string | undefined;
};

// ── the cases ─────────────────────────────────────────────────────────────────

(async () => {
  const server = await startServer();
  try {
    const op = await operatorOwner();
    const alice = await plainOwner('alice');
    const bob = await plainOwner('bob');

    await test('1. a ready chat says which key pays, which model answers and where, and what may change here', async () => {
      const d = await status(alice);
      assert(d.state === 'ready', `state ${d.state}`);
      assert(d.enabled === true, 'enabled stays for older pages');
      assert(d.operator_contact === 'support@operators', `operator_contact ${d.operator_contact}`);
      assert(!d.technical && !d.fix, `a ready chat carries no refusal: ${JSON.stringify({ t: d.technical, f: d.fix })}`);
      assert(d.ai.key.source === 'node' && d.pays === 'allowance', `the node key pays from the allowance: ${JSON.stringify(d.ai.key)} ${d.pays}`);
      assert(d.ai.key.can_set_chat_key === true && d.ai.key.chat_key_set === false, `a chat key may be set: ${JSON.stringify(d.ai.key)}`);
      assert(d.ai.model.current === NODE_MODEL && d.ai.model.chosen === null, `the node's model: ${JSON.stringify(d.ai.model.current)}`);
      assert(d.ai.model.can_choose === true && d.ai.model.locked === false, 'the person may choose');
      assert(Array.isArray(d.ai.model.choices) && d.ai.model.choices.some((m: any) => m.id === NODE_MODEL), 'the model in use is pickable');
      assert(d.ai.region && d.ai.region.current === 'any' && d.ai.region.can_choose === true && d.ai.region.eu_only === false,
        `region: ${JSON.stringify(d.ai.region)}`);
    });

    await test('2. without a chat agent: no_agent, the developer\'s sentence only under technical, nothing to set', async () => {
      const off = await setConfig(op, { 'ai.chat_agent_bin': '' });
      assert(off.status === 200, `config ${off.status}: ${JSON.stringify(off.body?.error)}`);
      try {
        const d = await status(alice);
        assert(d.state === 'no_agent' && d.enabled === false, `state ${d.state}`);
        assert(typeof d.technical === 'string' && d.technical.includes('AIMEAT_GOOSE_BIN'), `technical: ${d.technical}`);
        assert(d.ai.key.can_set_chat_key === false, 'no chat key without a chat');
        assert(d.ai.model.can_choose === false, 'no model choice without a chat');
      } finally {
        await setConfig(op, { 'ai.chat_agent_bin': process.execPath });
      }
    });

    await test('2b. a chat agent that does not start: agent_down before anybody types, and a turn says so in the person\'s language', async () => {
      const set = await setConfig(op, { 'ai.chat_agent_bin': join(dbDir, 'no-such-agent', 'goose') });
      assert(set.status === 200, `config ${set.status}`);
      try {
        const d = await status(alice);
        assert(d.state === 'agent_down', `a path that starts nothing is out of use: ${d.state}`);
        assert(typeof d.technical === 'string' && d.technical.startsWith('The chat agent did not start'), `technical: ${d.technical}`);
        assert(d.ai.key.can_set_chat_key === false && d.ai.model.can_choose === false, 'nothing to set while it is out of use');
        // A page that still had the box open: the turn is refused in Finnish, never the process's words.
        const th = await json('/v1/chat/threads', { method: 'POST', headers: auth(alice), body: JSON.stringify({ title: 'down' }) });
        assert(th.status === 201, `thread ${th.status}`);
        const res = await fetch(`${BASE}/v1/chat/threads/${th.body.data.thread.id}/turn`, {
          method: 'POST', headers: { ...auth(alice), 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'hei', lang: 'fi' }),
        });
        const stream = await res.text();
        assert(stream.includes('"code":"CHAT_AGENT_DOWN"'), `the turn names CHAT_AGENT_DOWN: ${stream.slice(-300)}`);
        assert(stream.includes('Chat-agentti ei käynnisty'), `in Finnish: ${stream.slice(-300)}`);
        assert(!stream.includes('goose exited') && !stream.includes('could not be started'), 'the process\'s own words stay out of the conversation');
      } finally {
        await setConfig(op, { 'ai.chat_agent_bin': process.execPath });
      }
      const back = await status(alice);
      assert(back.state === 'ready', `a working agent again: ${back.state}`);
    });

    await test('3. the chat\'s own model answers the chat and leaves the owner\'s text model as it was', async () => {
      const set = await setChatModel(alice, CHAT_MODEL);
      assert(set.status === 200, `routing ${set.status}: ${JSON.stringify(set.body?.error)}`);
      const d = await status(alice);
      assert(d.ai.model.chosen === CHAT_MODEL && d.ai.model.current === CHAT_MODEL, `chat model: ${JSON.stringify(d.ai.model)}`);
      assert(d.model === CHAT_MODEL, `the top-level model follows: ${d.model}`);
      const own = await textModel(alice);
      assert(own === `openrouter:${NODE_MODEL}`, `the owner's own text calls keep the node's model, got ${own}`);
      const other = await status(bob);
      assert(other.ai.model.current === NODE_MODEL && other.ai.model.chosen === null, `another owner is not touched: ${JSON.stringify(other.ai.model)}`);
    });

    await test('4. a model without an agent is refused, and so is a malformed one', async () => {
      const noAgent = await json('/v1/ai/routing', { method: 'PUT', headers: auth(alice), body: JSON.stringify({ routing: { model: CHAT_MODEL } }) });
      assert(noAgent.status === 400 && noAgent.body?.error?.code === 'AI_ROUTING_INVALID', `no agent: ${noAgent.status} ${noAgent.body?.error?.code}`);
      const bad = await setChatModel(alice, 'not a model id');
      assert(bad.status === 400 && bad.body?.error?.code === 'AI_ROUTING_INVALID', `malformed: ${bad.status} ${bad.body?.error?.code}`);
    });

    await test('5. the chat\'s own key pays for the chat alone, and only the owner in person sets it', async () => {
      await status(alice);   // opening the chat makes the chat agent
      const put = await json('/v1/agents/chat/ai-keys', { method: 'PUT', headers: auth(alice), body: JSON.stringify({ openrouter: { api_key: 'sk-or-e2e-chat-key-1234' } }) });
      assert(put.status === 200, `chat key ${put.status}: ${JSON.stringify(put.body?.error)}`);
      const d = await status(alice);
      assert(d.ai.key.source === 'chat' && d.ai.key.chat_key_set === true && d.pays === 'own', `the chat key pays: ${JSON.stringify(d.ai.key)} ${d.pays}`);
      const other = await status(bob);
      assert(other.ai.key.source === 'node' && other.ai.key.chat_key_set === false, `another owner keeps the node key: ${JSON.stringify(other.ai.key)}`);
      // An agent of the owner may not set it: the key is the owner's own decision.
      const agent = await connectAgent(alice, `keybot${Date.now() % 100000}`);
      const byAgent = await json('/v1/agents/chat/ai-keys', { method: 'PUT', headers: auth(agent), body: JSON.stringify({ openrouter: { api_key: 'sk-or-e2e-agent-1234' } }) });
      assert(byAgent.status === 403, `an agent sets the chat key: ${byAgent.status}`);
      const delByAgent = await json('/v1/agents/chat/ai-keys/openrouter', { method: 'DELETE', headers: auth(agent) });
      assert(delByAgent.status === 403, `an agent removes the chat key: ${delByAgent.status}`);
      const stillSet = await status(alice);
      assert(stillSet.ai.key.chat_key_set === true, 'the refused removal removed nothing');
      const capsAnon = await json('/v1/ai/capabilities');
      assert(capsAnon.status === 401, `the AI capabilities answer without a session: ${capsAnon.status}`);
      const del =await json('/v1/agents/chat/ai-keys/openrouter', { method: 'DELETE', headers: auth(alice) });
      assert(del.status === 200, `remove ${del.status}`);
      const after = await status(alice);
      assert(after.ai.key.source === 'node' && after.ai.key.chat_key_set === false, `back on the node key: ${JSON.stringify(after.ai.key)}`);
    });

    await test('6. the operator\'s allowed list narrows the chat\'s choices and its model, and nobody else sets it', async () => {
      const byOwner = await setConfig(alice, { 'ai.allowed_models': `openrouter:${CHAT_MODEL}` });
      assert(byOwner.status === 403, `a plain owner set the operator's list: ${byOwner.status}`);
      const set = await setConfig(op, { 'ai.allowed_models': `openrouter:${CHAT_MODEL}` });
      assert(set.status === 200, `config ${set.status}: ${JSON.stringify(set.body?.error)}`);
      const d = await status(bob);
      assert(JSON.stringify(d.ai.model.operator_allowed) === JSON.stringify([`openrouter:${CHAT_MODEL}`]), `operator_allowed ${JSON.stringify(d.ai.model.operator_allowed)}`);
      assert(d.ai.model.current === CHAT_MODEL, `bob's node model is not allowed, so the operator's model answers: ${d.ai.model.current}`);
      assert(d.ai.model.choices.every((m: any) => m.id === CHAT_MODEL), `only allowed models are offered: ${JSON.stringify(d.ai.model.choices)}`);
      const pol = await json('/v1/ai/policy', { headers: auth(bob) });
      assert(pol.body?.data?.operator?.allowed?.[0] === `openrouter:${CHAT_MODEL}`, `the policy names it: ${JSON.stringify(pol.body?.data?.operator)}`);
      // The owner's own text calls are bound too: the list is for every call on the node.
      assert(await textModel(bob) === `openrouter:${CHAT_MODEL}`, 'the owner\'s text calls follow the operator\'s list');
    });

    await test('7. the lock: a chat model is refused, the person\'s choice is set aside, and the operator\'s model answers', async () => {
      const set = await setConfig(op, { 'ai.models_locked': true });
      assert(set.status === 200, `config ${set.status}`);
      const refused = await setChatModel(alice, CHAT_MODEL);
      assert(refused.status === 403 && refused.body?.error?.code === 'AI_MODELS_LOCKED', `locked: ${refused.status} ${refused.body?.error?.code}`);
      const cleared = await setChatModel(alice, null);
      assert(cleared.status === 200, `clearing is allowed while locked: ${cleared.status}`);
      await setConfig(op, { 'ai.models_locked': false });
      await setChatModel(alice, 'stub/other-model');
      await setConfig(op, { 'ai.models_locked': true, 'ai.allowed_models': '' });
      const d = await status(alice);
      assert(d.ai.model.locked === true && d.ai.model.can_choose === false && d.ai.model.choices.length === 0, `locked view: ${JSON.stringify(d.ai.model)}`);
      assert(d.ai.model.chosen === 'stub/other-model', 'the stored choice stays, so unlocking gives it back');
      assert(d.ai.model.current === NODE_MODEL, `the node's default answers, not the person's choice: ${d.ai.model.current}`);
    });

    await test('8. unlocking gives the person\'s choice back', async () => {
      await setConfig(op, { 'ai.models_locked': false });
      const d = await status(alice);
      assert(d.ai.model.locked === false && d.ai.model.current === 'stub/other-model', `unlocked: ${JSON.stringify(d.ai.model)}`);
      await setChatModel(alice, null);
    });

    await test('9. EU only: the region shows it and offers no other', async () => {
      const set = await setConfig(op, { 'ai.openrouter_regions': 'eu', 'ai.openrouter_region': 'eu' });
      assert(set.status === 200, `config ${set.status}`);
      try {
        const d = await status(bob);
        assert(d.ai.region?.eu_only === true && d.ai.region.can_choose === false && d.ai.region.current === 'eu',
          `region: ${JSON.stringify(d.ai.region)}`);
      } finally {
        await setConfig(op, { 'ai.openrouter_regions': 'eu,us,any', 'ai.openrouter_region': 'any' });
      }
    });
  } finally {
    await stopServer(server);
    if (!PG_URL) rmSync(dbDir, { recursive: true, force: true });
  }

  console.log(`\n  ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
