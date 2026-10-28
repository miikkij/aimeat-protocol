/**
 * @file test/e2e-mcp-ai-tools.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The AI tools of the node MCP surface that no test had called through /v1/mcp, each
 *   called once to succeed and once to be refused: the background jobs (aimeat_ai_job_start, _get,
 *   _list, _cancel), the roles (aimeat_ai_roles, aimeat_ai_role_set), the catalogue
 *   (aimeat_ai_models), transcription (aimeat_ai_transcribe), pictures (aimeat_image_generate) and
 *   the decision model (aimeat_decide, aimeat_decision_list, aimeat_decide_run,
 *   aimeat_decide_settings, aimeat_decide_rules, aimeat_decide_rule_propose).
 *
 *   WHY THIS SUITE EXISTS. The services behind these tools are tested over REST, and the tool
 *   handlers were not (QA audit F09a-03). Each handler derives the owner from the session's agent,
 *   maps its arguments onto the service call and turns a refusal into text, so a wrong owner, a
 *   dropped argument or a swallowed refusal would reach an agent in production with every suite
 *   green. For background jobs the tools are the only way an agent reaches the feature.
 *
 *   WHY IT OWNS ITS SERVER. The decision provider's address and the node's decision key are boot-time
 *   settings, and so are the catalogue sources and the fixed base address of the openai provider type,
 *   which point at the fake provider here (test/helpers/fake-ai-provider.ts). It follows the runner's
 *   backend: the runner's Postgres database, or a SQLite file of its own. Nothing inside the node is
 *   mocked; the stand-ins answer the provider's HTTP calls and nothing else.
 * @structure
 *   - the decision stand-in · the node · helpers
 *   - Phase 0: owners, the owner's provider, agents, sessions
 *   - Phase 1: background jobs
 *   - Phase 2: roles and the catalogue
 *   - Phase 3: transcription and pictures
 *   - Phase 4: the decision model
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=mcp-ai-tools
 * @version-history
 *   2026-10-27 — Its own node is on suitePort block 30100, out of the range the claims board hands out.
 *   v1.0.0 — 2026-10-16 — Initial (QA audit F09a-03 and W27: the AI tools called and refused).
 */
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nodeEntryArgs } from './helpers/node-entry.js';
import { pinnedEnv } from './run-e2e-server.js';
import { waitForServer } from './helpers/wait-for-server.js';
import { registerOwner } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool, type McpSession } from './helpers/mcp-session.js';
import { startFakeAiProvider, chatJson, imageJson, transcriptionJson, type FakeAiProvider } from './helpers/fake-ai-provider.js';
import { suitePort } from './helpers/free-port.js';

// Its own port, below the lane's E2E port so it meets neither another lane nor the sandbox range.
// A suitePort block, not the base port minus 200: that landed in the range the claims board hands out.
const PORT = process.env.E2E_MCP_AI_TOOLS_PORT
    ?? String(suitePort(30100, process.env.E2E_BASE ?? `http://localhost:${process.env.AIMEAT_TEST_PORT ?? '40251'}`));
const BASE = `http://localhost:${PORT}`;
const NODE_KEY = 'ts-node-key-mcp-ai-0001';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 9, 8, 7, 6]);
const TRANSCRIPT = 'The harbour extension was approved seven to two.';

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>): Promise<void> {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function json(path: string, token: string, opts: RequestInit = {}): Promise<{ status: number; body: any }> {
    const res = await fetch(`${BASE}${path}`, {
        ...opts, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(opts.headers ?? {}) },
    });
    const text = await res.text();
    let body: any;
    try { body = JSON.parse(text); } catch { body = { _raw: text }; }
    return { status: res.status, body };
}

// ── the decision stand-in ─────────────────────────────────────────────────────
// Answers every question by its type, the shape the real service answers in (e2e-ai-decide holds
// the full contract; this suite needs only an answer to read back).
const decideSeen: unknown[] = [];
function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve) => { let s = ''; req.on('data', c => { s += c; }); req.on('end', () => resolve(s)); });
}
function answerFor(q: any): any {
    if (q.type === 'noul') return { type: 'noul', noul: 0.91 };
    if (q.type === 'choice') {
        const opts = Object.keys(q.criteria);
        return { type: 'choice', choice: opts[0], probabilities: Object.fromEntries(opts.map((o, i) => [o, i === 0 ? 0.9 : 0.1 / (opts.length - 1)])), confidence: 0.88 };
    }
    const levels = q.criteria as unknown[];
    return {
        type: 'score', score: 1, confidence: 0.7,
        legend: Object.fromEntries(levels.map((l, i) => [String(i), l])),
        probabilities: Object.fromEntries(levels.map((_, i) => [String(i), i === 1 ? 1 : 0])),
    };
}
async function startDecideStub(): Promise<{ server: Server; url: string }> {
    const server = createServer(async (req, res) => {
        const body = JSON.parse((await readBody(req)) || '{}');
        decideSeen.push(body);
        const answers = Object.fromEntries(Object.entries(body.questions ?? {}).map(([id, q]) => [id, answerFor(q)]));
        res.writeHead(200, { 'content-type': 'application/json', 'x-typesafe-request-id': `req-${decideSeen.length}` });
        res.end(JSON.stringify({ model: body.model, answers, usage: { input_tokens: 900, output_tokens: 30 } }));
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    return { server, url: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1/systemone` };
}

// ── the node ──────────────────────────────────────────────────────────────────
const dbDir = mkdtempSync(join(tmpdir(), 'aimeat-mcp-ai-'));
const DB_PATH = join(dbDir, 'mcp-ai.db');
const PG_URL = process.env.AIMEAT_DB === 'postgres-kysely' ? (process.env.DATABASE_URL ?? '') : '';

async function startNode(stub: FakeAiProvider, decideUrl: string): Promise<ChildProcess> {
    const target = PG_URL
        ? { port: PORT, baseUrl: BASE, dbType: 'postgres-kysely', dbPath: '', dbUrl: PG_URL, external: false }
        : { port: PORT, baseUrl: BASE, dbType: 'sqlite', dbPath: DB_PATH, dbUrl: '', external: false };
    const closed = 'http://127.0.0.1:9/none';
    const env: Record<string, string | undefined> = {
        ...process.env,
        ...pinnedEnv(target),
        AIMEAT_DEV_MODE: 'true', AIMEAT_TEST_MODE: 'true', AIMEAT_ALLOW_PRIVATE_EGRESS: 'true',
        AIMEAT_RL_OPENROUTER: '1000', AIMEAT_RL_GLOBAL: '10000', AIMEAT_RL_AUTH: '1000', AIMEAT_RL_MEMORY: '1000',
        AIMEAT_REGISTRATION_RATE_LIMIT_MAX: '1000', AIMEAT_DEFAULT_AGENT_SCOPES: '*',
        AIMEAT_OPENROUTER_INSTANCE_KEY: '',
        AIMEAT_AI_CATALOG_SOURCES: JSON.stringify({ modelsDev: closed, openRouter: closed, liteLlm: closed }),
        AIMEAT_AI_FIXED_BASEURL_OVERRIDES: JSON.stringify({ openai: `${stub.baseUrl}/openai`, openrouter: `${stub.baseUrl}/or` }),
        AIMEAT_DECIDE_ENABLED: 'true',
        AIMEAT_DECIDE_BASE_URL: decideUrl,
        AIMEAT_TYPESAFE_INSTANCE_KEY: NODE_KEY,
        // The node key pays a decision out of the owner's free allowance, which is 0 by default.
        AIMEAT_CHAT_FREE_ALLOWANCE_USD: '5',
    };
    const dbArgs = PG_URL ? ['--db', 'postgres-kysely', '--db-url', PG_URL] : ['--db', 'sqlite', '--db-path', DB_PATH];
    const child = spawn('node', [...nodeEntryArgs(), 'start', ...dbArgs], { env: env as NodeJS.ProcessEnv, stdio: ['ignore', 'pipe', 'pipe'], cwd: process.cwd() });
    return waitForServer(child, BASE, { label: 'the MCP AI tools node' });
}

async function stopNode(child: ChildProcess): Promise<void> {
    if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM');
        const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
        await once(child, 'exit');
        clearTimeout(timer);
    }
}

/** Poll a job through the tool until it reaches one of `states`. */
async function jobUntil(s: McpSession, jobId: string, states: string[], ms = 20_000): Promise<any> {
    const began = Date.now();
    for (;;) {
        const r = await callTool(s, 'aimeat_ai_job_get', { job_id: jobId });
        if (!r.isError && states.includes(r.data.state)) return r.data;
        if (Date.now() - began > ms) throw new Error(`job ${jobId} never reached ${states.join('|')}: ${r.text.slice(0, 200)}`);
        await sleep(150);
    }
}

const RULE = {
    title: 'Send the reply without a person reading it',
    decides: 'whether the drafted reply goes out on its own',
    sends: ['draft', 'question'],
    questions: { good: { type: 'noul', instructions: 'The draft answers the question fully and politely.' } },
    thresholds: { good: 0.5 },
    bands: { act: 0.85, ask: 0.5 },
    use: 'agent',
    gate: false,
    sample: { draft: 'Thank you, the invoice is attached.', question: 'Where is my invoice?' },
};
const NOUL = { type: 'noul', instructions: 'The sender needs an answer today.' };

(async () => {
    console.log('\n── AI tools over /v1/mcp (QA audit F09a-03, W27) ──');
    const stub = await startFakeAiProvider(0);
    stub.setDefault('chat', (r) => chatJson(`answered by ${String(r.json?.model)}`, { model: String(r.json?.model) }));
    stub.setDefault('images', imageJson({ b64: PNG.toString('base64'), cost: 0.04 }));
    stub.setDefault('transcriptions', transcriptionJson({ text: TRANSCRIPT, language: 'en', usage: { seconds: 9, cost: 0.0006 } }));
    const decide = await startDecideStub();
    const node = await startNode(stub, decide.url);

    try {
        // ── Phase 0 ──
        const stamp = Date.now().toString(36).slice(-6);
        await registerOwner(BASE, `maiop${stamp}`);               // the first account is the operator
        const alice = await registerOwner(BASE, `maialice${stamp}`);
        const bob = await registerOwner(BASE, `maibob${stamp}`);
        const prov = await json('/v1/ai/providers/my-openai', alice.token, {
            method: 'PUT', body: JSON.stringify({
                title: 'My OpenAI', type: 'openai', capabilities: {
                    text: { enabled: true, model: 'gpt-4.1', pool: true },
                    image: { enabled: true, model: 'gpt-image-1', pool: true },
                    transcription: { enabled: true, model: 'whisper-1', pool: true },
                },
            }),
        });
        assert(prov.status === 200, `provider ${prov.status}: ${JSON.stringify(prov.body?.error)}`);
        assert((await json('/v1/ai/providers/my-openai/key', alice.token, { method: 'PUT', body: JSON.stringify({ api_key: 'sk-alice' }) })).status === 200, 'key');
        assert((await json('/v1/ai/routing', alice.token, { method: 'PUT', body: JSON.stringify({ routing: { rules: { onlyTested: false } } }) })).status === 200, 'routing');

        const aiAgent = await makeAgent(BASE, alice, ['ai:use', 'memory:read', 'memory:write', 'storage:read', 'storage:write']);
        const roleAgent = await makeAgent(BASE, alice, ['ai:use', 'memory:write-reserved']);
        const noAi = await makeAgent(BASE, alice, ['memory:read']);
        const bobAi = await makeAgent(BASE, bob, ['ai:use', 'storage:read', 'storage:write']);
        const sAi = await openSession(BASE, aiAgent.token, 'ai-tools-agent');
        const sRole = await openSession(BASE, roleAgent.token, 'ai-tools-role');
        const sNoAi = await openSession(BASE, noAi.token, 'ai-tools-noai');
        const sBob = await openSession(BASE, bobAi.token, 'ai-tools-bob');

        // ── Phase 1: background jobs ──
        console.log('\nPhase 1: aimeat_ai_job_start, _get, _list, _cancel');
        let jobId = '';
        await test('1a. aimeat_ai_job_start starts a job for the owner, and it lands its answer where REST reads it', async () => {
            const r = await callTool(sAi, 'aimeat_ai_job_start', { prompt: 'Summarise the council meeting.', result_key: `mcpjob.one.${stamp}`, app_id: 'mcp-ai-tools' });
            assert(!r.isError, `start refused: ${r.text}`);
            jobId = r.data.job_id as string;
            assert(typeof jobId === 'string' && jobId.length > 0 && r.data.state === 'queued', `answer: ${r.text}`);
            const done = await jobUntil(sAi, jobId, ['done', 'failed']);
            assert(done.state === 'done', `state ${done.state}: ${JSON.stringify(done.error)}`);
            const rest = await json(`/v1/ai/jobs/${jobId}`, alice.token);
            assert(rest.status === 200 && rest.body.data.state === 'done', `REST ${rest.status}: ${JSON.stringify(rest.body?.data?.state ?? rest.body?.error)}`);
            const rec = await json(`/v1/memory/${encodeURIComponent(`mcpjob.one.${stamp}`)}`, alice.token);
            assert(rec.status === 200 && String(rec.body.data.value).startsWith('answered by'), `the answer at result_key: ${rec.status} ${JSON.stringify(rec.body?.data?.value)}`);
            assert(String((stub.lastRequest('chat')?.json as any)?.messages?.at(-1)?.content ?? '').includes('council meeting'), 'the prompt did not reach the provider');
        });
        await test('1b. aimeat_ai_job_start is not offered to an agent without ai:use, and nothing starts', async () => {
            const before = (await json('/v1/ai/jobs?state=all', alice.token)).body.data.count;
            const r = await callTool(sNoAi, 'aimeat_ai_job_start', { prompt: 'x', result_key: 'mcpjob.no' });
            assert(r.isError && r.offered === false, `the agent without ai:use started a job: ${r.text}`);
            const after = (await json('/v1/ai/jobs?state=all', alice.token)).body.data.count;
            assert(after === before, `a job was written: ${before} -> ${after}`);
        });
        await test('1c. aimeat_ai_job_get answers the owner\'s job, and another owner\'s agent the same as for no job', async () => {
            const r = await callTool(sAi, 'aimeat_ai_job_get', { job_id: jobId });
            assert(!r.isError && r.data.id === jobId, `get: ${r.text.slice(0, 300)}`);
            const other = await callTool(sBob, 'aimeat_ai_job_get', { job_id: jobId });
            assert(other.isError && other.text.includes('No such job.'), `bob's agent read alice's job: ${other.text}`);
        });
        await test('1d. aimeat_ai_job_list lists the owner\'s job; another owner\'s agent sees none of it, and an agent without ai:use is not offered it', async () => {
            const r = await callTool(sAi, 'aimeat_ai_job_list', { state: 'all' });
            assert(!r.isError && (r.data.jobs ?? []).some((j: any) => j.id === jobId), `list: ${r.text.slice(0, 300)}`);
            const other = await callTool(sBob, 'aimeat_ai_job_list', { state: 'all' });
            assert(!other.isError && !(other.data.jobs ?? []).some((j: any) => j.id === jobId), `bob's agent lists alice's job: ${other.text.slice(0, 300)}`);
            const no = await callTool(sNoAi, 'aimeat_ai_job_list', {});
            assert(no.isError && no.offered === false, `the agent without ai:use listed: ${no.text}`);
        });
        await test('1e. aimeat_ai_job_cancel stops a running job; REST reads it cancelled', async () => {
            stub.queue('chat', { kind: 'hold' });
            const r = await callTool(sAi, 'aimeat_ai_job_start', { prompt: 'A long one.', result_key: `mcpjob.held.${stamp}` });
            assert(!r.isError, `start: ${r.text}`);
            const held = r.data.job_id as string;
            await jobUntil(sAi, held, ['running']);
            const c = await callTool(sAi, 'aimeat_ai_job_cancel', { job_id: held });
            stub.releaseHeld();
            assert(!c.isError && c.data.state === 'cancelled', `cancel: ${c.text.slice(0, 300)}`);
            const rest = await json(`/v1/ai/jobs/${held}`, alice.token);
            assert(rest.body.data?.state === 'cancelled', `REST state: ${JSON.stringify(rest.body?.data?.state)}`);
        });
        await test('1f. aimeat_ai_job_cancel refuses another owner\'s agent, and a job that already finished', async () => {
            const other = await callTool(sBob, 'aimeat_ai_job_cancel', { job_id: jobId });
            assert(other.isError && /NOT_FOUND/.test(other.text), `bob's agent cancelled alice's job: ${other.text}`);
            const done = await callTool(sAi, 'aimeat_ai_job_cancel', { job_id: jobId });
            assert(done.isError && /AI_JOB_ALREADY_TERMINAL/.test(done.text), `a finished job: ${done.text}`);
        });

        // ── Phase 2: roles and the catalogue ──
        console.log('\nPhase 2: aimeat_ai_roles, aimeat_ai_role_set, aimeat_ai_models');
        await test('2a. aimeat_ai_roles answers the owner\'s roles, the two built-in ones always among them', async () => {
            const r = await callTool(sAi, 'aimeat_ai_roles', {});
            assert(!r.isError, `roles refused: ${r.text}`);
            const ids = (r.data.roles ?? []).map((x: any) => x.id);
            assert(ids.includes('reasoning') && ids.includes('execution'), `roles: ${ids}`);
            const no = await callTool(sNoAi, 'aimeat_ai_roles', {});
            assert(no.isError && no.offered === false, `the agent without ai:use read the roles: ${no.text}`);
        });
        await test('2b. aimeat_ai_role_set proposes first and applies on the confirmation; REST reads the new role', async () => {
            const roles = { writer: { title: 'Writer', purpose: 'Drafts', capabilities: { text: [{ provider: 'my-openai', model: 'gpt-4.1-mini' }] } } };
            const p = await callTool(sRole, 'aimeat_ai_role_set', { roles });
            assert(!p.isError && p.data.mode === 'proposal' && typeof p.data.confirm_token === 'string', `proposal: ${p.text.slice(0, 300)}`);
            const before = await json('/v1/ai/roles', alice.token);
            assert(!before.body.data.roles.some((x: any) => x.id === 'writer'), 'a proposal changed the roles');
            const ok = await callTool(sRole, 'aimeat_ai_role_set', { roles, confirm_token: p.data.confirm_token });
            assert(!ok.isError && ok.data.mode === 'applied', `confirm: ${ok.text.slice(0, 300)}`);
            const after = await json('/v1/ai/roles', alice.token);
            assert(after.body.data.roles.some((x: any) => x.id === 'writer'), `REST does not show the role: ${JSON.stringify(after.body.data.roles).slice(0, 300)}`);
        });
        await test('2c. aimeat_ai_role_set refuses a confirmation token it did not issue, and is not offered without memory:write-reserved', async () => {
            const roles = { editor: { title: 'Editor', capabilities: { text: [{ provider: 'my-openai' }] } } };
            const bad = await callTool(sRole, 'aimeat_ai_role_set', { roles, confirm_token: 'not-a-token' });
            assert(bad.isError && bad.offered, `a made-up token applied: ${bad.text}`);
            const after = await json('/v1/ai/roles', alice.token);
            assert(!after.body.data.roles.some((x: any) => x.id === 'editor'), 'the role was written anyway');
            const no = await callTool(sAi, 'aimeat_ai_role_set', { roles });
            assert(no.isError && no.offered === false, `an agent without memory:write-reserved was offered aimeat_ai_role_set: ${no.text}`);
        });
        await test('2d. aimeat_ai_models answers the catalogue filtered by capability, and refuses a capability that does not exist', async () => {
            const r = await callTool(sAi, 'aimeat_ai_models', { capability: 'text' });
            assert(!r.isError && Array.isArray(r.data.models) && typeof r.data.total === 'number', `models: ${r.text.slice(0, 300)}`);
            const rest = await json('/v1/ai/models?capability=text', alice.token);
            assert(rest.status === 200 && rest.body.data.total === r.data.total, `REST total ${rest.body?.data?.total} vs tool ${r.data.total}`);
            const bad = await callTool(sAi, 'aimeat_ai_models', { capability: 'teleport' });
            assert(bad.isError && bad.offered, `an unknown capability was answered: ${bad.text}`);
        });

        // ── Phase 3: transcription and pictures ──
        console.log('\nPhase 3: aimeat_ai_transcribe and aimeat_image_generate');
        const AUDIO_KEY = `mcp-ai/council-${stamp}.webm`;
        const AUDIO = Buffer.from('RIFF-mcp-ai-tools-audio-bytes');
        await test('3a. aimeat_ai_transcribe reads the audio from the agent\'s own storage and answers the transcript', async () => {
            const up = await json('/v1/storage', aiAgent.token, {
                method: 'POST', body: JSON.stringify({ key: AUDIO_KEY, mime_type: 'audio/webm', visibility: 'private', data: AUDIO.toString('base64') }),
            });
            assert(up.status === 201, `upload ${up.status}: ${JSON.stringify(up.body?.error)}`);
            const r = await callTool(sAi, 'aimeat_ai_transcribe', { storage_key: AUDIO_KEY, language: 'en' });
            assert(!r.isError, `transcribe refused: ${r.text}`);
            assert(r.data.text === TRANSCRIPT, `transcript: ${r.text.slice(0, 300)}`);
            const form = stub.lastRequest('transcriptions')!;
            assert(form.bytes.includes(AUDIO), 'the stored audio is not what the provider received');
            assert(form.headers.authorization === 'Bearer sk-alice', 'the owner\'s key did not pay');
        });
        await test('3b. aimeat_ai_transcribe refuses a key in another principal\'s storage, and the provider hears nothing', async () => {
            const heard = stub.requestsFor('transcriptions').length;
            const r = await callTool(sBob, 'aimeat_ai_transcribe', { storage_key: AUDIO_KEY });
            assert(r.isError && /NOT_FOUND/.test(r.text), `bob's agent transcribed alice's agent's file: ${r.text}`);
            assert(stub.requestsFor('transcriptions').length === heard, 'the provider heard the refused call');
        });
        await test('3c. aimeat_image_generate makes a picture the owner stores and REST reads back', async () => {
            const r = await callTool(sAi, 'aimeat_image_generate', { prompt: 'A harbour at dawn.', size: '1024x1024' });
            assert(!r.isError, `image refused: ${r.text}`);
            assert(typeof r.data.storage_key === 'string' && r.data.mime_type === 'image/png' && r.data.visibility === 'private', `answer: ${r.text.slice(0, 300)}`);
            assert(String((stub.lastRequest('images')?.json as any)?.prompt ?? '').includes('A harbour at dawn.'), 'the prompt did not reach the provider');
            const file = await fetch(r.data.url as string, { headers: { Authorization: `Bearer ${alice.token}` } });
            assert(file.status === 200, `the picture does not read back: ${file.status}`);
            assert(Buffer.from(await file.arrayBuffer()).equals(PNG), 'the stored bytes are not the provider\'s picture');
        });
        await test('3d. aimeat_image_generate refuses an agent whose owner has no picture provider, and nothing is sent', async () => {
            const heard = stub.requestsFor('images').length;
            const r = await callTool(sBob, 'aimeat_image_generate', { prompt: 'A blue square.' });
            assert(r.isError && r.offered, `bob's agent made a picture: ${r.text}`);
            assert(stub.requestsFor('images').length === heard, 'the provider heard the refused call');
        });

        // ── Phase 4: the decision model ──
        console.log('\nPhase 4: aimeat_decide, aimeat_decision_list, aimeat_decide_run, aimeat_decide_settings, aimeat_decide_rules, aimeat_decide_rule_propose');
        let decisionId = '';
        await test('4a. aimeat_decide answers the questions and records the decision under the owner', async () => {
            const r = await callTool(sAi, 'aimeat_decide', { state: 'Please pay the invoice today.', questions: { urgent: NOUL }, subject: `mcp.decide.${stamp}`, cache: false });
            assert(!r.isError, `decide refused: ${r.text}`);
            decisionId = r.data.decision_id as string;
            assert(typeof decisionId === 'string' && r.data.answers?.urgent?.value === 0.91, `answer: ${r.text.slice(0, 300)}`);
            const rest = await json(`/v1/ai/decisions/${decisionId}`, alice.token);
            assert(rest.status === 200, `REST does not read the decision: ${rest.status}`);
        });
        await test('4b. aimeat_decide refuses eleven score levels before anything is sent', async () => {
            const before = decideSeen.length;
            const r = await callTool(sAi, 'aimeat_decide', {
                state: 'x', questions: { s: { type: 'score', instructions: 'Rate it.', criteria: Array.from({ length: 11 }, (_, i) => `level ${i}`) } },
            });
            assert(r.isError && /INVALID_REQUEST/.test(r.text), `eleven levels: ${r.text.slice(0, 300)}`);
            assert(decideSeen.length === before, 'the refused question reached the provider');
        });
        await test('4c. aimeat_decision_list lists and reads the owner\'s decision; another owner\'s agent is told there is none', async () => {
            const l = await callTool(sAi, 'aimeat_decision_list', { subject: `mcp.decide.${stamp}` });
            assert(!l.isError && l.data.total === 1 && l.data.decisions?.[0]?.id === decisionId, `list: ${l.text.slice(0, 300)}`);
            const one = await callTool(sAi, 'aimeat_decision_list', { decision_id: decisionId });
            assert(!one.isError && one.data.id === decisionId, `one: ${one.text.slice(0, 300)}`);
            const other = await callTool(sBob, 'aimeat_decision_list', { decision_id: decisionId });
            assert(other.isError && other.text.includes('No such decision.'), `bob's agent read alice's decision: ${other.text}`);
        });
        await test('4d. aimeat_decide_run runs over three records and records each one', async () => {
            const r = await callTool(sAi, 'aimeat_decide_run', {
                action: 'start', questions: { q: NOUL },
                items: [{ subject: `mcp.run.1.${stamp}`, state: 'Pay now.' }, { subject: `mcp.run.2.${stamp}`, state: 'No hurry.' }, { subject: `mcp.run.3.${stamp}`, state: 'Today please.' }],
            });
            assert(!r.isError, `run refused: ${r.text}`);
            const runId = (r.data.id ?? r.data.run_id) as string;
            assert(typeof runId === 'string', `run id: ${r.text.slice(0, 300)}`);
            let run: any;
            for (let i = 0; i < 80; i++) {
                run = (await callTool(sAi, 'aimeat_decide_run', { action: 'get', run_id: runId })).data;
                if (run.state !== 'running') break;
                await sleep(250);
            }
            assert(run.state === 'done' && run.counts?.done === 3, `run: ${JSON.stringify(run).slice(0, 300)}`);
            const rest = await json(`/v1/ai/decisions?subject=${encodeURIComponent(`mcp.run.2.${stamp}`)}`, alice.token);
            assert(rest.body.data?.total === 1, `the item's decision is not on the register: ${JSON.stringify(rest.body?.data?.total)}`);
            const other = await callTool(sBob, 'aimeat_decide_run', { action: 'get', run_id: runId });
            assert(other.isError && other.text.includes('No such run.'), `bob's agent read alice's run: ${other.text}`);
        });
        await test('4e. aimeat_decide_run refuses a get without a run id', async () => {
            const r = await callTool(sAi, 'aimeat_decide_run', { action: 'get' });
            assert(r.isError && /INVALID_BODY/.test(r.text), `a get without run_id: ${r.text}`);
        });
        await test('4f. aimeat_decide_settings answers the owner\'s settings and says no tool changes them', async () => {
            const r = await callTool(sAi, 'aimeat_decide_settings', {});
            assert(!r.isError && typeof r.data.change_them === 'string', `settings: ${r.text.slice(0, 300)}`);
            assert(!r.text.includes(NODE_KEY), 'the node key is in the answer');
            const no = await callTool(sNoAi, 'aimeat_decide_settings', {});
            assert(no.isError && no.offered === false, `the agent without ai:use read the settings: ${no.text}`);
        });
        await test('4g. aimeat_decide_rules lists the rule the owner wrote, reads it by id, and refuses an id it does not have', async () => {
            const put = await json('/v1/ai/decide/rules/send-reply', alice.token, { method: 'PUT', body: JSON.stringify(RULE) });
            assert(put.status === 201 || put.status === 200, `PUT rule ${put.status}: ${JSON.stringify(put.body?.error)}`);
            const l = await callTool(sAi, 'aimeat_decide_rules', {});
            assert(!l.isError && (l.data.rules ?? []).some((x: any) => x.id === 'send-reply'), `rules: ${l.text.slice(0, 300)}`);
            const one = await callTool(sAi, 'aimeat_decide_rules', { rule_id: 'send-reply' });
            assert(!one.isError && one.data.rule?.id === 'send-reply', `one: ${one.text.slice(0, 300)}`);
            const missing = await callTool(sAi, 'aimeat_decide_rules', { rule_id: 'no-such-rule' });
            assert(missing.isError && /NOT_FOUND/.test(missing.text), `a missing rule: ${missing.text}`);
            const other = await callTool(sBob, 'aimeat_decide_rules', { rule_id: 'send-reply' });
            assert(other.isError && /NOT_FOUND/.test(other.text), `bob's agent read alice's rule: ${other.text}`);
        });
        await test('4h. aimeat_decide_rule_propose creates nothing and waits for the owner', async () => {
            const r = await callTool(sAi, 'aimeat_decide_rule_propose', { rule: { ...RULE, id: 'refund-ok', title: 'Refund without asking' }, reason: 'Small refunds wait a day for a person today.' });
            assert(!r.isError && typeof r.data.proposal_id === 'string' && r.data.rule_id === 'refund-ok', `propose: ${r.text.slice(0, 300)}`);
            const rule = await json('/v1/ai/decide/rules/refund-ok', alice.token);
            assert(rule.status === 404, `a proposal created the rule: ${rule.status}`);
            const listed = await callTool(sAi, 'aimeat_decide_rules', {});
            assert((listed.data.proposals ?? []).some((p: any) => p.proposal_id === r.data.proposal_id), `the agent's own proposal is not listed: ${listed.text.slice(0, 300)}`);
        });
        await test('4i. aimeat_decide_rule_propose refuses a rule the node would refuse, and the owner is not asked', async () => {
            const r = await callTool(sAi, 'aimeat_decide_rule_propose', { rule: { ...RULE, id: 'bad-bands', bands: { act: 0.1, ask: 0.9 } }, reason: 'A rule the node would refuse.' });
            assert(r.isError && /INVALID_RULE/.test(r.text), `an invalid proposal: ${r.text.slice(0, 300)}`);
            const items = await json('/v1/open-items', alice.token);
            assert(!JSON.stringify(items.body).includes('bad-bands'), 'the invalid proposal reached the owner');
        });
    } finally {
        await stopNode(node);
        await stub.close();
        decide.server.close();
        try { rmSync(dbDir, { recursive: true, force: true }); } catch { /* Windows holds the file a moment */ }
    }

    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
