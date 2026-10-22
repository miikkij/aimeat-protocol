/**
 * @file e2e-ai-input-reach.ts
 * @description What a model may be handed of the owner's data, by whom. An AI job reads its
 *   prompt_key, input_keys and audio_key across the owner scope, and an extension's ctx.datapackage
 *   reads the owner's packages; this suite proves that each of those reads now follows the same
 *   boundary as every other same-owner read, and that every use that worked before still works.
 *
 *   THE REFUSALS (secaudit 2026-10):
 *     r49 — an agent holding ai:use but not memory:read-as-owner named its owner's or a sibling's
 *           private record in an AI job (REST and MCP), or the owner's private audio over MCP, and
 *           got the content back in the job's answer. Now 403 SCOPE_DENIED naming the permission,
 *           and the provider hears nothing.
 *     v75 — an extension's ctx.ai.start read with the installer's reach whatever the run's reader:
 *           the agent that wrote the code read its owner's private record through the job, on its
 *           own invoke and on an unattended on_done run the owner had set to read as its installer.
 *           Now the job reads as that agent in those two cases, and is refused.
 *     v74 — the same 'installer' setting did not reach ctx.datapackage.open and rows. Now it does.
 *
 *   THE USES KEPT, each asserted: the agent's own records and the owner's records at visibility
 *   owner; an agent holding memory:read-as-owner; the owner in person; an app grant; the owner in
 *   person invoking the agent-written extension; every extension on the default setting (unattended
 *   chain and data packages); an extension the owner wrote; an agent extension whose agent holds
 *   memory:read-as-owner or storage:read; a public package under the narrowing.
 *
 *   WHY THIS SUITE OWNS ITS SERVER. It points the owner at a loopback provider that echoes the prompt
 *   back as the answer, so what reached the model is observable in the answer; everything else is the
 *   node's default settings.
 * @usage cd aimeat && pnpm exec node --import tsx test/e2e-ai-input-reach.ts
 * @version-history
 *   v1.0.0 -- 2026-10-22 -- Initial (secaudit 2026-10, r49, v74, v75).
 */
import { nodeEntryArgs } from './helpers/node-entry.js';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { waitForServer } from './helpers/wait-for-server.js';
import { startFakeAiProvider, chatJson, transcriptionJson, type FakeAiProvider } from './helpers/fake-ai-provider.js';
import { ownerSignIn } from './helpers/owner-login.js';
import { makeAgent, openSession, callTool, type McpAgent } from './helpers/mcp-session.js';

const PORT = process.env.E2E_AI_INPUT_REACH_PORT ?? '40963';
const BASE = `http://localhost:${PORT}`;
const NODE_ID = process.env.AIMEAT_NODE_ID ?? 'aimeat-local-001-dev';
const RUNNER_STORAGE = process.env.AIMEAT_STORAGE ?? '';
const USE_POSTGRES = RUNNER_STORAGE === 'postgres-kysely' && !!process.env.DATABASE_URL;
const DB_PATH = resolve(process.cwd(), 'test/.test-ai-input-reach.db');
const dbArgs = USE_POSTGRES
    ? ['--db', 'postgres-kysely', '--db-url', process.env.DATABASE_URL as string]
    : ['--db', 'sqlite', '--db-path', DB_PATH];

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function json(path: string, opts: RequestInit = {}) {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...opts.headers } });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
    return { status: res.status, body };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const post = (path: string, token: string, body: unknown) => json(path, { method: 'POST', headers: auth(token), body: JSON.stringify(body) });

// ── the node ──────────────────────────────────────────────────────────────────

function cleanDbFile(): void {
    if (USE_POSTGRES) return;
    for (const f of [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`]) {
        try { if (existsSync(f)) unlinkSync(f); } catch { /* ignore */ }
    }
}

async function startServer(): Promise<ChildProcess> {
    const env: Record<string, string | undefined> = {
        ...process.env,
        AIMEAT_PORT: PORT,
        AIMEAT_BASE_URL: BASE,
        AIMEAT_NODE_ID: NODE_ID,
        AIMEAT_STORAGE: USE_POSTGRES ? 'postgres-kysely' : 'sqlite',
        AIMEAT_SQLITE_PATH: USE_POSTGRES ? '' : DB_PATH,
        AIMEAT_DEV_MODE: 'true',
        AIMEAT_TEST_MODE: 'true',
        AIMEAT_RL_AUTH: '1000', AIMEAT_RL_WORK: '1000', AIMEAT_RL_MEMORY: '1000',
        AIMEAT_RL_OPENROUTER: '1000',
        AIMEAT_REGISTRATION_RATE_LIMIT_MAX: '1000',
    };
    const child = spawn('node', [...nodeEntryArgs(), 'start', ...dbArgs],
        { env: env as NodeJS.ProcessEnv, stdio: ['ignore', 'pipe', 'pipe'], cwd: process.cwd() });
    return waitForServer(child, BASE, { label: 'the AI input reach node' });
}

async function stopServer(child: ChildProcess): Promise<void> {
    child.kill('SIGTERM');
    const began = Date.now();
    while (Date.now() - began < 20_000) {
        if (child.exitCode !== null || child.signalCode !== null) return;
        await sleep(100);
    }
    child.kill('SIGKILL');
}

// ── owners, agents, apps ──────────────────────────────────────────────────────

interface Owner { name: string; gaii: string; token: string }

async function setupOwner(label: string): Promise<Owner> {
    const name = `aireach${label}${Date.now()}`.toLowerCase();
    const reg = await json('/v1/ghii', { method: 'POST', body: JSON.stringify({ username: name, display_name: 'AI reach', password: 'AiReachTest1234' }) });
    assert(reg.status === 201, `ghii ${reg.status}: ${JSON.stringify(reg.body?.error)}`);
    const tok = await ownerSignIn(BASE, name, 'AiReachTest1234');
    assert(tok.status === 200 && tok.body?.data?.token, `sign-in ${tok.status}`);
    return { name, gaii: `${name}@${NODE_ID}`, token: tok.body.data.token as string };
}

const REDIRECT = 'http://localhost:9912/callback';

async function appGrantToken(owner: Owner, filename: string, scope: string): Promise<string> {
    const html = `<!DOCTYPE html><html><head><meta name="aimeat-scopes" content="${scope}"></head><body><script>1</script></body></html>`;
    const pub = await post('/v1/apps', owner.token, { filename, content: Buffer.from(html).toString('base64'), name: `Reach ${filename}`, description: 'ai input reach probe', category: 'utility' });
    assert(pub.status === 201, `publish ${filename} ${pub.status}: ${JSON.stringify(pub.body?.error)}`);
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const q = new URLSearchParams({ app: `${owner.name}/${filename}`, response_type: 'code', scope,
        redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256' });
    const res = await fetch(`${BASE}/v1/app-grants/authorize?${q}`, { redirect: 'manual' });
    const m = /req=([^&]+)/.exec(res.headers.get('location') ?? '');
    assert(!!m, `consent redirect expected, got ${res.status}`);
    const con = await post('/v1/app-grants/authorize-consent', owner.token, { request_id: decodeURIComponent(m![1]) });
    const code = new URL(con.body.data.redirect_url).searchParams.get('code') ?? '';
    const tok = await json('/v1/app-grants/token', { method: 'POST', body: JSON.stringify({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: REDIRECT }) });
    assert(tok.body.ok === true, `app token: ${JSON.stringify(tok.body.error)}`);
    return tok.body.data.access_token as string;
}

const startJob = (token: string, body: Record<string, unknown>) => post('/v1/ai/jobs', token, body);

async function waitDone(token: string, id: string): Promise<any> {
    const began = Date.now();
    for (;;) {
        const r = await json(`/v1/ai/jobs/${id}`, { headers: auth(token) });
        if (r.status === 200 && ['done', 'failed', 'cancelled'].includes(r.body.data.state)) return r.body.data;
        if (Date.now() - began > 20_000) throw new Error(`job ${id} never finished (last ${r.status} ${JSON.stringify(r.body?.data?.state ?? r.body?.error)})`);
        await sleep(120);
    }
}

/** A job that must finish with an answer, and the answer as text. */
async function answerOf(token: string, body: Record<string, unknown>, readToken = token): Promise<string> {
    const r = await startJob(token, body);
    assert(r.status === 202, `expected 202, got ${r.status}: ${JSON.stringify(r.body?.error)}`);
    const done = await waitDone(token, r.body.data.job_id);
    assert(done.state === 'done', `state ${done.state}: ${JSON.stringify(done.error)}`);
    const rec = await json(`/v1/memory/${encodeURIComponent(String(body.result_key))}`, { headers: auth(readToken) });
    assert(rec.status === 200, `the answer at ${body.result_key}: ${rec.status}`);
    return JSON.stringify(rec.body.data.value);
}

// ── the extension every case installs ─────────────────────────────────────────

const SCRIPTS: Record<string, string> = {
    // Attended: start a job as told, after leaving the plan the on_done callback reads.
    'actions/start.js': `export default async function(ctx, input) {
        if (input.plan) await ctx.memory.set('plan', input.plan);
        const opts = input.op === 'transcribe'
            ? { op: 'transcribe', audio_key: input.audio_key, result_key: input.result_key }
            : { prompt: 'Repeat the input data verbatim', input_keys: input.input_keys, result_key: input.result_key };
        return await ctx.ai.start(opts);
    }`,
    // The on_done target, unattended: start the job the plan names, and keep what came of it.
    'actions/collect.js': `export default async function(ctx, input) {
        const plan = await ctx.memory.get('plan');
        const next = await ctx.ai.start({ prompt: 'Repeat the input data verbatim', input_keys: [plan.key], result_key: plan.result_key });
        await ctx.memory.set('collected-' + plan.tag, { next: next });
        return { ok: true };
    }`,
    // Attended: what a run kept, and the answer of a job through ctx.ai.result.
    'actions/peek.js': `export default async function(ctx, input) {
        return { kept: await ctx.memory.get(input.name), viaResult: input.job_id ? await ctx.ai.result(input.job_id) : null };
    }`,
    // Unattended, through a schedule: read a data package both ways and keep the outcome.
    'actions/pkg.js': `export default async function(ctx, input) {
        var out = {};
        try { var r = await ctx.datapackage.rows(input.ref, 'rows'); out.rows = r ? { ok: true, total: r.total, rows: r.rows } : { ok: true, rows: null }; }
        catch (e) { out.rows = { ok: false, message: String(e && e.message || e) }; }
        try { var d = await ctx.datapackage.open(input.ref); out.open = d ? { ok: true, name: d.name } : { ok: true, open: null }; }
        catch (e) { out.open = { ok: false, message: String(e && e.message || e) }; }
        await ctx.memory.set('pkg-' + input.tag, out);
        return out;
    }`,
};

function manifestFor(name: string): string {
    const action = (id: string) => `  - id: ${id}\n    method: POST\n    path: "/v1/ext/${name}/${id}"\n    script: "actions/${id}.js"\n`;
    return `extension: "1.0"
metadata:
  name: "${name}"
  version: "1.0.0"
  description: "AI input reach probe"
  author: "e2e"
capabilities: [ai]
actions:
${['start', 'collect', 'peek', 'pkg'].map(action).join('')}limits:
  memory_mb: 16
  timeout_ms: 8000
  max_api_calls: 20
`;
}

async function install(token: string, name: string): Promise<void> {
    const r = await post('/v1/extensions', token, { manifest: manifestFor(name), scripts: SCRIPTS });
    assert(r.status === 201, `install ${name}: ${r.status} ${JSON.stringify(r.body?.error)}`);
    const act = await post(`/v1/extensions/${name}/activate`, token, {});
    assert(act.status === 200, `activate ${name}: ${act.status} ${JSON.stringify(act.body?.error)}`);
}

const invoke = async (ext: string, action: string, token: string, input: Record<string, unknown>) => {
    const r = await post(`/v1/ext/${ext}/${action}`, token, input);
    assert(r.status === 200, `${ext}/${action} ${r.status}: ${JSON.stringify(r.body?.error)}`);
    return r.body.data?.result ?? r.body.data;
};

/** Wait for a job an extension started to have an answer, read through ctx.ai.result. */
async function resultThroughExtension(ext: string, token: string, jobId: string): Promise<any> {
    for (let i = 0; i < 80; i++) {
        const p = await invoke(ext, 'peek', token, { name: 'none', job_id: jobId });
        if (p.viaResult?.value !== undefined || p.viaResult?.state === 'failed') return p.viaResult;
        await sleep(150);
    }
    throw new Error(`job ${jobId} gave no answer through ctx.ai.result`);
}

/** An unattended on_done run of `collect`: the owner starts a job naming it, and the callback starts the next. */
async function unattendedChain(owner: Owner, ext: string, extToken: string, key: string): Promise<any> {
    const tag = `t${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
    await invoke(ext, 'start', extToken, { plan: { key, tag, result_key: `reach.chain.${tag}` }, input_keys: [], result_key: `reach.parent.${tag}` });
    const parent = await startJob(owner.token, { prompt: 'parent', result_key: `reach.parent2.${tag}`, on_done: { extension: ext, action: 'collect' } });
    assert(parent.status === 202, `parent ${parent.status}: ${JSON.stringify(parent.body?.error)}`);
    for (let i = 0; i < 80; i++) {
        const p = await invoke(ext, 'peek', extToken, { name: `collected-${tag}` });
        if (p.kept) return p.kept.next;
        await sleep(150);
    }
    throw new Error('the on_done run left nothing behind');
}

async function runPkgUnattended(owner: Owner, ext: string, extToken: string, ref: string): Promise<any> {
    const tag = `p${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
    const mk = await post('/v1/schedules', owner.token, { name: `reach-${tag}`, kind: 'extension', cron: '0 5 * * *', extension_name: ext, action_id: 'pkg', input: { ref, tag } });
    assert(mk.status === 201, `schedule ${mk.status}: ${JSON.stringify(mk.body?.error)}`);
    const id = mk.body.data.schedule?.id ?? mk.body.data.id;
    const t = await post(`/v1/schedules/${id}/trigger`, owner.token, {});
    assert(t.status === 200, `trigger ${t.status}: ${JSON.stringify(t.body?.error)}`);
    assert(t.body.data.schedule.lastRunResult === 'success', `the run completes: ${t.body.data.schedule.lastRunError ?? ''}`);
    await json(`/v1/schedules/${id}`, { method: 'DELETE', headers: auth(owner.token) });
    const p = await invoke(ext, 'peek', extToken, { name: `pkg-${tag}` });
    assert(!!p.kept, 'the unattended run left its outcome');
    return p.kept;
}

const setAuthority = (ext: string, owner: Owner, authority: string) =>
    json(`/v1/extensions/${ext}/unattended-reader`, { method: 'PATCH', headers: auth(owner.token), body: JSON.stringify({ authority }) });

// ── the run ───────────────────────────────────────────────────────────────────

(async () => {
    console.log('\n── What a model may be handed of the owner\'s data ──');
    cleanDbFile();
    const fake: FakeAiProvider = await startFakeAiProvider(0);
    // The answer is the prompt: whatever reached the model is in the answer.
    fake.setDefault('chat', (req) => chatJson(((req.json?.messages as Array<{ content: unknown }>) ?? [])
        .map(m => typeof m.content === 'string' ? m.content : JSON.stringify(m.content)).join('\n')));
    fake.setDefault('transcriptions', (req) => transcriptionJson({ text: `heard ${/AUDIO-PRIVATE-[0-9]+/.exec(req.body)?.[0] ?? 'nothing'}` }));
    const server = await startServer();
    const n = Date.now() % 100000;
    const SECRET = `OWNER-PRIVATE-${n}`, SHARED = `OWNER-SHARED-${n}`, SIB = `SIBLING-PRIVATE-${n}`;
    const OWN = `AGENT-OWN-${n}`, DUP_OWNER = `DUP-OWNER-${n}`, DUP_AGENT = `DUP-AGENT-${n}`, AUDIO = `AUDIO-PRIVATE-${n}`;
    const ROW = `PKG-PRIVATE-ROW-${n}`, PUBROW = `PKG-PUBLIC-ROW-${n}`;

    let o!: Owner, a!: McpAgent, r!: McpAgent, s!: McpAgent, p!: McpAgent;
    const AGENT_SCOPES = ['ai:use', 'memory:read', 'memory:write', 'ext:write', 'ext:invoke'];
    const EA = `reacha${n}`, EO = `reacho${n}`, ER = `reachr${n}`, EP = `reachp${n}`;
    let privRef = '', pubRef = '';
    const chatsBefore = () => fake.requestsFor('chat').length;

    try {
        await test('0. Setup: an owner with private and owner-visible records, private audio and packages; agents with and without memory:read-as-owner', async () => {
            o = await setupOwner('o');
            const settings = await post('/v1/memory', o.token, { key: 'openrouter.settings', visibility: 'private',
                value: { provider: 'custom', baseUrl: fake.baseUrl, model: 'stub/reach-model', sttModel: 'stub/reach-stt', daily_budget_usd: 50 } });
            assert(settings.status === 201, `settings ${settings.status}`);
            for (const [key, value, visibility] of [['reach.secret', SECRET, 'private'], ['reach.shared', SHARED, 'owner'], ['reach.dup', DUP_OWNER, 'private']]) {
                const w = await post('/v1/memory', o.token, { key, value, visibility });
                assert(w.status === 201, `owner write ${key}: ${w.status}`);
            }
            const up = await post('/v1/storage', o.token, { key: 'reach/voice.mp3', mime_type: 'audio/mpeg', visibility: 'private', data: Buffer.from(`ID3 ${AUDIO} pad`).toString('base64') });
            assert(up.status === 201, `audio ${up.status}: ${JSON.stringify(up.body?.error)}`);
            const pk = await post('/v1/datapackages', o.token, { name: `reachpriv${n}`, changes: 'probe', visibility: 'private', resources: [{ name: 'rows', rows: [{ id: 1, v: ROW }] }] });
            assert(pk.status === 201, `private package ${pk.status}: ${JSON.stringify(pk.body?.error)}`);
            privRef = `pkg:${o.name}/reachpriv${n}`;
            const pub = await post('/v1/datapackages', o.token, { name: `reachpub${n}`, changes: 'probe', visibility: 'public', resources: [{ name: 'rows', rows: [{ id: 1, v: PUBROW }] }] });
            assert(pub.status === 201, `public package ${pub.status}: ${JSON.stringify(pub.body?.error)}`);
            pubRef = `pkg:${o.name}/reachpub${n}`;

            a = await makeAgent(BASE, o, AGENT_SCOPES, `reacha${n}`);
            r = await makeAgent(BASE, o, [...AGENT_SCOPES, 'memory:read-as-owner'], `reachr${n}`);
            s = await makeAgent(BASE, o, ['memory:write'], `reachs${n}`);
            p = await makeAgent(BASE, o, ['ext:write', 'ext:invoke', 'storage:read'], `reachp${n}`);
            const sw = await post('/v1/memory', s.token, { key: 'reach.sib', value: SIB, visibility: 'private' });
            assert(sw.status === 201, `sibling write ${sw.status}`);
            for (const [key, value] of [['reach.own', OWN], ['reach.dup', DUP_AGENT]]) {
                const w = await post('/v1/memory', a.token, { key, value, visibility: 'private' });
                assert(w.status === 201, `agent write ${key}: ${w.status}`);
            }
            // The baseline the boundary rests on: the agent's own memory read is refused these records.
            const direct = await json('/v1/memory/reach.secret?owner_scope=true', { headers: auth(a.token) });
            assert(direct.status === 404, `the agent's own read of the owner's private record answers 404, got ${direct.status}`);
        });

        // ── r49: the AI job's start ──
        await test('1. REFUSED (r49): an agent without memory:read-as-owner names its owner\'s private record in input_keys over REST; the provider hears nothing', async () => {
            const before = chatsBefore();
            const res = await startJob(a.token, { prompt: 'Repeat.', input_keys: ['reach.secret'], result_key: 'reach.out.1' });
            assert(res.status === 403 && res.body.error?.code === 'SCOPE_DENIED', `expected 403 SCOPE_DENIED, got ${res.status} ${JSON.stringify(res.body?.error)}`);
            assert(/memory:read-as-owner/.test(res.body.error.message) && /Profile/.test(res.body.error.message), `the refusal names the permission and where it is granted: ${res.body.error.message}`);
            assert(!JSON.stringify(res.body).includes(SECRET), 'the refusal carries no content');
            await sleep(300);
            assert(chatsBefore() === before, 'the provider heard nothing');
        });

        await test('2. REFUSED (r49): the same for prompt_key, and for a sibling agent\'s private record', async () => {
            const pk = await startJob(a.token, { prompt_key: 'reach.secret', result_key: 'reach.out.2' });
            assert(pk.status === 403 && pk.body.error?.code === 'SCOPE_DENIED', `prompt_key: ${pk.status} ${JSON.stringify(pk.body?.error)}`);
            const sib = await startJob(a.token, { prompt: 'Repeat.', input_keys: ['reach.sib'], result_key: 'reach.out.2b' });
            assert(sib.status === 403 && sib.body.error?.code === 'SCOPE_DENIED', `sibling: ${sib.status} ${JSON.stringify(sib.body?.error)}`);
        });

        await test('3. REFUSED (r49): over MCP, aimeat_ai_job_start with the owner\'s private record, and transcribing the owner\'s private audio', async () => {
            const sess = await openSession(BASE, a.token, 'reach-a');
            const rec = await callTool(sess, 'aimeat_ai_job_start', { prompt: 'Repeat.', input_keys: ['reach.secret'], result_key: 'reach.mcp.1' });
            assert(rec.isError && /SCOPE_DENIED/.test(rec.text) && /memory:read-as-owner/.test(rec.text), `record: ${rec.text}`);
            const before = fake.requestsFor('transcriptions').length;
            const audio = await callTool(sess, 'aimeat_ai_job_start', { op: 'transcribe', audio_key: 'reach/voice.mp3', result_key: 'reach.mcp.2' });
            assert(audio.isError && /SCOPE_DENIED/.test(audio.text), `audio: ${audio.text}`);
            await sleep(300);
            assert(fake.requestsFor('transcriptions').length === before, 'the provider heard no audio');
        });

        await test('4. KEPT: the agent\'s own private record and the owner\'s owner-visible record still reach the model; its own copy wins over a hidden owner copy', async () => {
            const text = await answerOf(a.token, { prompt: 'Repeat.', input_keys: ['reach.own', 'reach.shared', 'reach.dup'], result_key: 'reach.out.4' });
            assert(text.includes(OWN) && text.includes(SHARED), `both reached the model: ${text.slice(0, 300)}`);
            assert(text.includes(DUP_AGENT) && !text.includes(DUP_OWNER), `the agent's own copy, not the owner's private one: ${text.slice(0, 300)}`);
        });

        await test('5. KEPT: an agent holding memory:read-as-owner reads the owner\'s and the sibling\'s private records (REST) and the owner\'s audio (MCP)', async () => {
            const text = await answerOf(r.token, { prompt: 'Repeat.', input_keys: ['reach.secret', 'reach.sib'], result_key: 'reach.out.5' });
            assert(text.includes(SECRET) && text.includes(SIB), `read: ${text.slice(0, 300)}`);
            const sess = await openSession(BASE, r.token, 'reach-r');
            const started = await callTool(sess, 'aimeat_ai_job_start', { op: 'transcribe', audio_key: 'reach/voice.mp3', result_key: 'reach.mcp.5' });
            assert(!started.isError, `transcribe starts: ${started.text}`);
            const id = JSON.parse(started.text).job_id as string;
            const done = await waitDone(o.token, id);
            assert(done.state === 'done', `transcription ${done.state}: ${JSON.stringify(done.error)}`);
            const heard = await json('/v1/memory/reach.mcp.5', { headers: auth(o.token) });
            assert(JSON.stringify(heard.body?.data?.value ?? '').includes(AUDIO), `the audio reached the model: ${JSON.stringify(heard.body?.data?.value)}`);
        });

        await test('6. KEPT: the owner in person reads every record of their scope, a sibling\'s private one too', async () => {
            const text = await answerOf(o.token, { prompt: 'Repeat.', input_keys: ['reach.secret', 'reach.sib'], result_key: 'reach.out.6' });
            assert(text.includes(SECRET) && text.includes(SIB), `read: ${text.slice(0, 300)}`);
        });

        await test('7. KEPT: an app grant of the owner reads the owner\'s private record', async () => {
            const tok = await appGrantToken(o, `reach${n}.html`, 'ai:use');
            // The app holds ai:use only, so the owner reads the answer it landed in their namespace.
            const text = await answerOf(tok, { prompt: 'Repeat.', input_keys: ['reach.secret'], result_key: 'reach.out.7' }, o.token);
            assert(text.includes(SECRET), `read: ${text.slice(0, 300)}`);
        });

        // ── v75: ctx.ai.start in an extension the agent wrote ──
        await test('8. Setup: the agent installs its extension; the owner installs one of their own; the read-as-owner agent installs one', async () => {
            await install(a.token, EA);
            await install(o.token, EO);
            await install(r.token, ER);
            await install(p.token, EP);
            const list = await json(`/v1/extensions/${EA}/unattended-reader`, { headers: auth(o.token) });
            assert(list.status === 200 && list.body.data.installed_by_principal === a.gaii, `the agent is the code's writer: ${JSON.stringify(list.body?.data ?? list.body?.error)}`);
        });

        await test('9. REFUSED (v75): the agent invoking its own extension cannot read the owner\'s private record or audio through ctx.ai.start', async () => {
            const rec = await invoke(EA, 'start', a.token, { input_keys: ['reach.secret'], result_key: 'reach.ext.9' });
            assert(rec.ok === false && rec.code === 'SCOPE_DENIED', `record: ${JSON.stringify(rec)}`);
            assert(/memory:read-as-owner/.test(rec.message) && /profile\?tab=extensions/.test(rec.message), `names the permission and the extension's page: ${rec.message}`);
            const audio = await invoke(EA, 'start', a.token, { op: 'transcribe', audio_key: 'reach/voice.mp3', result_key: 'reach.ext.9b' });
            assert(audio.ok === false && audio.code === 'SCOPE_DENIED', `audio: ${JSON.stringify(audio)}`);
        });

        await test('10. KEPT: the same extension, invoked by the agent, still reads what the agent may read', async () => {
            const started = await invoke(EA, 'start', a.token, { input_keys: ['reach.shared', 'reach.own'], result_key: 'reach.ext.10' });
            assert(started.ok === true, `starts: ${JSON.stringify(started)}`);
            const got = await resultThroughExtension(EA, a.token, started.job_id);
            assert(JSON.stringify(got.value).includes(SHARED) && JSON.stringify(got.value).includes(OWN), `answer: ${JSON.stringify(got).slice(0, 300)}`);
        });

        await test('11. KEPT: the owner in person invoking the agent-written extension reads their private record', async () => {
            const started = await invoke(EA, 'start', o.token, { input_keys: ['reach.secret'], result_key: 'reach.ext.11' });
            assert(started.ok === true, `starts: ${JSON.stringify(started)}`);
            const got = await resultThroughExtension(EA, o.token, started.job_id);
            assert(JSON.stringify(got.value).includes(SECRET), `answer: ${JSON.stringify(got).slice(0, 300)}`);
        });

        await test('12. KEPT: on the default setting, the agent-written extension\'s unattended on_done run reads the owner\'s private record', async () => {
            const next = await unattendedChain(o, EA, a.token, 'reach.secret');
            assert(next.ok === true, `the callback's job starts: ${JSON.stringify(next)}`);
            const got = await resultThroughExtension(EA, a.token, next.job_id);
            assert(JSON.stringify(got.value).includes(SECRET), `answer: ${JSON.stringify(got).slice(0, 300)}`);
        });

        await test('13. REFUSED (v75): set to read as its installer, the same unattended run cannot', async () => {
            const set = await setAuthority(EA, o, 'installer');
            assert(set.status === 200 && set.body.data.authority === 'installer', `setting ${set.status}`);
            const next = await unattendedChain(o, EA, a.token, 'reach.secret');
            assert(next.ok === false && next.code === 'SCOPE_DENIED', `refused: ${JSON.stringify(next)}`);
            assert(/memory:read-as-owner/.test(next.message), `names the permission: ${next.message}`);
        });

        await test('14. KEPT: under the same setting, an owner-written extension and an extension of an agent holding memory:read-as-owner still read it', async () => {
            for (const [ext, token] of [[EO, o.token], [ER, r.token]] as const) {
                const set = await setAuthority(ext, o, 'installer');
                assert(set.status === 200, `setting ${ext} ${set.status}`);
                const next = await unattendedChain(o, ext, token, 'reach.secret');
                assert(next.ok === true, `${ext} starts: ${JSON.stringify(next)}`);
                const got = await resultThroughExtension(ext, token, next.job_id);
                assert(JSON.stringify(got.value).includes(SECRET), `${ext} answer: ${JSON.stringify(got).slice(0, 300)}`);
            }
        });

        // ── v74: ctx.datapackage under the 'installer' setting ──
        await test('15. KEPT: on the default setting, an agent-written extension\'s unattended run reads the owner\'s private package', async () => {
            await setAuthority(EA, o, 'owner');
            const out = await runPkgUnattended(o, EA, a.token, privRef);
            assert(out.rows?.ok === true && JSON.stringify(out.rows.rows).includes(ROW), `rows: ${JSON.stringify(out.rows)}`);
            assert(out.open?.ok === true && out.open.name === `reachpriv${n}`, `open: ${JSON.stringify(out.open)}`);
        });

        await test('16. REFUSED (v74): set to read as its installer, rows and open are refused with the setting and where to change it', async () => {
            await setAuthority(EA, o, 'installer');
            const out = await runPkgUnattended(o, EA, a.token, privRef);
            assert(out.rows?.ok === false && !JSON.stringify(out).includes(ROW), `rows refused, no row: ${JSON.stringify(out.rows)}`);
            assert(/installer/.test(out.rows.message) && /profile\?tab=extensions/.test(out.rows.message), `rows message: ${out.rows.message}`);
            assert(out.open?.ok === false && /installer/.test(out.open.message), `open refused: ${JSON.stringify(out.open)}`);
        });

        await test('17. KEPT: under the setting, a public package still opens, and an agent holding storage:read still reads the private one', async () => {
            const pub = await runPkgUnattended(o, EA, a.token, pubRef);
            assert(pub.rows?.ok === true && JSON.stringify(pub.rows.rows).includes(PUBROW), `public rows: ${JSON.stringify(pub.rows)}`);
            await setAuthority(EP, o, 'installer');
            const out = await runPkgUnattended(o, EP, p.token, privRef);
            assert(out.rows?.ok === true && JSON.stringify(out.rows.rows).includes(ROW), `storage:read rows: ${JSON.stringify(out.rows)}`);
        });
    } finally {
        await stopServer(server);
        await fake.close();
        cleanDbFile();
    }

    console.log(`\n  ${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
