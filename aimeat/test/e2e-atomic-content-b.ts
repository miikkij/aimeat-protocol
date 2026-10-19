/**
 * @file test/e2e-atomic-content-b.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Two writers of one record at the same moment, on the workspace registry, the chat
 *   archive, the signing indexes, crew definitions, the AI job log, the journey record, the
 *   portfolio settings, a memory key's CORS list, a board, a provenance attach, the EXCHANGE
 *   migration, a package's tool list, a reviewed record and the visibility settings: each test
 *   asserts that both changes persist, or that the write which read a stale copy does not replace
 *   the newer one (check:atomic-writes, group G6 of
 *   wish-ei-atomisen-kirjoituksen-107-avointa-kohtaa-korjataan-raha-j).
 *
 *   HOW THE TWO WRITERS MEET. `afterRead(owner, key, between, run, nth)` runs `run`, and right after
 *   its nth read of `key` returns, runs `between` to its end, so `run` goes on with the copy it read
 *   before `between` wrote. That is the interleaving two requests or two node processes produce,
 *   written out, so a test fails on code that writes back a stale copy on both backends (a
 *   synchronous SQLite driver does not interleave two HTTP requests by itself, docs/pitfalls.md).
 *   The hook replaces `getMemory` on the storage instance the node uses, so it reaches a route as
 *   well as a service function. The technique is test/e2e-atomic-money.ts's (group G1).
 *
 *   The node is in this process (port 40563) on a database of its own on the run's backend
 *   (helpers/own-node-db.ts).
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=atomic-content-b
 * @version-history
 *   v1.0.0 — 2026-10-19 — Initial (wish-ei-atomisen-kirjoituksen-107-avointa-kohtaa-korjataan-raha-j, G6).
 */
import { randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import { createServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';
import type { MemoryRecord } from '../src/storage/interface.js';
import { provisionWorkspace } from '../src/services/workspace-provision.js';
import { restoreWorkspace } from '../src/services/workspace-import.js';
import { archiveOverflow } from '../src/services/chat-threads.js';
import { createRequest, deleteRequest } from '../src/services/docsign/records.js';
import { sha256Hex } from '../src/services/docsign/statement.js';
import { publishCrewDef, crewKeysFor } from '../src/services/crew-def-store.js';
import { foldIntoLog, logKeyFor } from '../src/services/ai-jobs/store.js';
import type { AiJobRecord } from '../src/services/ai-jobs/types.js';
import { mergeJourneyProfile, JOURNEY_KEY } from '../src/services/journey-state.js';
import { mergePortfolioConfig, PORTFOLIO_CONFIG_KEY, portfolioWriteGaii } from '../src/services/portfolio-config.js';
import { migrateLegacyOfferings } from '../src/services/exchange-projection.js';
import { putOffering } from '../src/services/exchange-market.js';
import { appToolsKey } from '../src/models/app-tool-schemas.js';
import { installPackageAppTools } from '../src/services/packages/install/package-app-tools.js';
import { applyHumanAnswer } from '../src/services/workflow/engine-human.js';
import type { WorkflowRun } from '../src/models/workflow-schemas.js';
import { setBehaviourSettings } from '../src/services/visibility/behaviour-settings.js';
import { BEHAVIOUR_SETTINGS_KEY } from '../src/models/behaviour-schemas.js';
import { setVisibilitySettings } from '../src/services/visibility/visibility-settings.js';
import { VISIBILITY_SETTINGS_KEY } from '../src/models/visibility-schemas.js';
import { callerFromAuth } from '../src/services/caller-context.js';
import { ownNodeDb } from './helpers/own-node-db.js';
import { registerOwner } from './helpers/owner-login.js';
import { makeAgent } from './helpers/mcp-session.js';

const PORT = parseInt(process.env.E2E_ATOMIC_CONTENT_B_PORT ?? '40563', 10);
const BASE = `http://127.0.0.1:${PORT}`;

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>): Promise<void> {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }
async function json(path: string, opts: RequestInit = {}): Promise<{ status: number; body: any }> {
    const res = await fetch(`${BASE}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers ?? {}) } });
    const text = await res.text();
    let body: any;
    try { body = JSON.parse(text); } catch { body = { _raw: text }; }
    return { status: res.status, body };
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

process.env.AIMEAT_PORT = String(PORT);
process.env.AIMEAT_DEV_MODE = 'true';
process.env.AIMEAT_TEST_MODE = 'true';
process.env.AIMEAT_BASE_URL = BASE;
const adminPw = randomBytes(16).toString('base64url');
process.env.AIMEAT_ADMIN_PASSWORD = adminPw;
const { config } = loadConfig({});
Object.assign(config, {
    port: PORT, baseUrl: BASE, devMode: true, testMode: true, adminPassword: adminPw, aiProvenance: true,
    encryptionKey: randomBytes(32).toString('hex'),
    ...(await ownNodeDb('atomic-content-b', { memory: true })).config,
});
const { app, storage } = await createServer(config);
const server = await new Promise<Server>((resolve) => { const s = app.listen(PORT, '127.0.0.1', () => resolve(s)); });

/**
 * Run `run`; right after its `nth` read of (owner, key) returns, run `between` to its end on the
 * real storage, then hand `run` the copy it read. Answers what `run` answers.
 */
async function afterRead<T>(owner: string, key: string, between: () => Promise<unknown>, run: () => Promise<T>, nth = 1): Promise<T> {
    const s = storage as unknown as Record<string, unknown>;
    const own = Object.getOwnPropertyDescriptor(s, 'getMemory');
    const original = storage.getMemory;
    const restore = () => { if (own) Object.defineProperty(s, 'getMemory', own); else delete s.getMemory; };
    let seen = 0;
    let fired = false;
    s.getMemory = async (o: string, k: string, ...rest: unknown[]) => {
        const read = await (original as (...a: unknown[]) => Promise<MemoryRecord | null>).call(storage, o, k, ...rest);
        if (!fired && o === owner && k === key && ++seen === nth) { fired = true; restore(); await between(); }
        return read;
    };
    try { return await run(); } finally { if (!fired) restore(); }
}

async function put(owner: string, key: string, value: unknown, visibility: MemoryRecord['visibility'] = 'owner'): Promise<void> {
    const now = new Date().toISOString();
    const prev = await storage.getMemory(owner, key);
    await storage.setMemory({ key, ownerGaii: owner, value: value as Record<string, unknown>, visibility, tags: [], ttlHours: null,
        version: (prev?.version ?? 0) + 1, createdAt: now, updatedAt: now });
}
const valueOf = async <T>(owner: string, key: string): Promise<T> => (await storage.getMemory(owner, key))?.value as T;

console.log('\n=== Two writers of one record at the same moment (workspaces, chat, signing, crews, settings, content) ===\n');

const stamp = Date.now().toString(36).slice(-6);
await registerOwner(BASE, `atomcbop${stamp}`);   // the first owner on a fresh node is its operator
const owner = await registerOwner(BASE, `atomcb${stamp}`);

// ── The workspace registry ────────────────────────────────────────────────────────────────────

const orgId = `org-atomic-${stamp}`;
const regKey = `organism.${orgId}.meta.workspaces`;
const manifest = () => ({ objectTypes: [{ name: 'notes', schemaRef: 'schema:notes@1', namespace: 'shared.notes', backing: 'memory', writeRole: 'member', mode: 'document' }] });
const provision = (name: string) => provisionWorkspace(storage, config, {
    orgId, ownerName: owner.name, ownerGhii: owner.ghii, name, manifest: manifest() as never,
});
const registered = async () => ((await valueOf<{ workspaces: Array<{ id: string; name: string }> }>(owner.ghii, regKey))?.workspaces ?? []);

await test('Two workspaces created in one organism at the same moment are both registered', async () => {
    let between = '';
    const run = await afterRead(owner.ghii, regKey, async () => { between = (await provision('Second')).ws; },
        async () => (await provision('First')).ws);
    const ids = (await registered()).map(w => w.id);
    assert(ids.includes(run) && ids.includes(between), `registry: ${JSON.stringify(ids)}, created ${run} and ${between}`);
});

await test('A workspace restored beside a workspace create in one organism: both are registered', async () => {
    let created = '';
    const data = {
        aimeatWorkspaceExport: '1.0', name: 'Restored', manifest: manifest(), source: { organismId: 'org-src', ws: 'ws-src' },
        schemas: {}, objects: [], images: [],
    };
    const restored = await afterRead(owner.ghii, regKey, async () => { created = (await provision('Created')).ws; },
        () => restoreWorkspace(storage, config, { orgId, importerGaii: owner.ghii, importerOwner: owner.name, data: data as never, images: new Map() }));
    const ids = (await registered()).map(w => w.id);
    assert(ids.includes(restored.ws) && ids.includes(created), `registry: ${JSON.stringify(ids)}, restored ${restored.ws}, created ${created}`);
});

// ── The chat archive ──────────────────────────────────────────────────────────────────────────

await test('Two archive roll-overs into one month at the same moment keep every archived conversation', async () => {
    const at = (d: string) => `2026-01-${d}T10:00:00.000Z`;
    const thread = (id: string, d: string) => ({ id, title: id, createdAt: at(d), updatedAt: at(d), turns: [] });
    for (const [id, d] of [['newone', '03'], ['newtwo', '02'], ['oldone', '01']] as const) {
        await put(owner.ghii, `chat.thread.${id}`, thread(id, d), 'private');
    }
    const archive = 'chat.archive.2026-01';
    await afterRead(owner.ghii, archive, () => archiveOverflow(storage, { ...config, chatMaxLiveThreads: 1 }, owner.ghii),
        () => archiveOverflow(storage, { ...config, chatMaxLiveThreads: 2 }, owner.ghii));
    const ids = ((await valueOf<{ threads: Array<{ id: string }> }>(owner.ghii, archive))?.threads ?? []).map(t => t.id);
    assert(ids.includes('newtwo') && ids.includes('oldone') && ids.length === 2, `archive: ${JSON.stringify(ids)}`);
});

// ── The signing indexes ───────────────────────────────────────────────────────────────────────

const DS = 'sys:docsign';
const partyIndex = `docsign.party.${sha256Hex(owner.ghii).slice(0, 40)}`;
const ownerCaller = callerFromAuth({ sub: owner.name, owner: owner.name, roles: ['owner'], scopes: [] }, config.nodeId, storage);
const signing = (title: string) => createRequest({ storage, config }, ownerCaller, {
    title, document: { sha256: sha256Hex(`${title}-${stamp}`), name: `${title}.pdf`, size: 10 }, parties: [owner.ghii],
});
const indexed = async () => (await valueOf<{ ids: string[] }>(DS, partyIndex))?.ids ?? [];

await test('Two signing requests for one party created at the same moment are both in its index', async () => {
    let second = '';
    const first = await afterRead(DS, partyIndex, async () => { second = (await signing('second')).id; }, () => signing('first'));
    const ids = await indexed();
    assert(ids.includes(first.id) && ids.includes(second), `index: ${JSON.stringify(ids)}`);
});

await test('A signing request deleted beside a create for the same party: the new one stays in the index', async () => {
    const doomed = await signing('doomed');
    let created = '';
    await afterRead(DS, partyIndex, async () => { created = (await signing('created')).id; },
        () => deleteRequest({ storage, config }, ownerCaller, doomed.id));
    const ids = await indexed();
    assert(ids.includes(created) && !ids.includes(doomed.id), `index: ${JSON.stringify(ids)}`);
});

// ── Crew definitions ──────────────────────────────────────────────────────────────────────────

await test('Two publishes of one crew definition at the same moment keep two history revisions', async () => {
    const made = await makeAgent(BASE, owner, ['memory:read', 'memory:write']);
    const agent = await storage.getAgent(made.gaii);
    assert(agent?.gaii === made.gaii, `the agent: ${agent?.gaii}`);
    const crewCaller = { principal: owner.ghii, scopes: [], roles: ['owner'], pipeline: 'e2e' };
    const keys = crewKeysFor(agent.name);
    let between: Awaited<ReturnType<typeof publishCrewDef>> | null = null;
    const run = await afterRead(agent.gaii, keys.base, async () => { between = await publishCrewDef({ storage, config }, crewCaller, agent, { crew: 'B' }); },
        () => publishCrewDef({ storage, config }, crewCaller, agent, { crew: 'A' }));
    assert(run.ok && between && (between as { ok: boolean }).ok, `published: ${JSON.stringify(run)} ${JSON.stringify(between)}`);
    const docs = await Promise.all([1, 2].map(n => valueOf<{ doc?: { crew?: string } }>(agent.gaii, `${keys.base}.version.${n}`)));
    const crews = docs.map(d => d?.doc?.crew).sort();
    assert(JSON.stringify(crews) === '["A","B"]', `history: ${JSON.stringify(crews)}`);
    const live = await valueOf<{ revision: number }>(agent.gaii, keys.base);
    assert(live.revision === 2, `live revision ${live.revision}`);
});

// ── The AI job log ────────────────────────────────────────────────────────────────────────────

await test('Two AI jobs of one owner finishing at the same moment are both in the day log', async () => {
    const job = (id: string) => ({ id, state: 'done', owner: owner.ghii, result_key: `ai.result.${id}`, finished_at: '2026-01-05T08:00:00.000Z' }) as unknown as AiJobRecord;
    const key = logKeyFor('2026-01-05');
    await afterRead(owner.ghii, key, () => foldIntoLog(storage, job('jobtwo')), () => foldIntoLog(storage, job('jobone')));
    const ids = ((await valueOf<Array<{ id: string }>>(owner.ghii, key)) ?? []).map(e => e.id).sort();
    assert(JSON.stringify(ids) === '["jobone","jobtwo"]', `log: ${JSON.stringify(ids)}`);
});

// ── The journey record and the portfolio settings ─────────────────────────────────────────────

await test('Interview answers merged beside a write of the road at the same moment: both persist', async () => {
    await put(owner.ghii, JOURNEY_KEY, { road: 'prompt' });
    const out = await afterRead(owner.ghii, JOURNEY_KEY, () => put(owner.ghii, JOURNEY_KEY, { road: 'mcp' }),
        () => mergeJourneyProfile({ storage, config }, owner.name, { work: 'I run a bakery' }, 'e2e'));
    const v = await valueOf<{ road?: string; work?: string }>(owner.ghii, JOURNEY_KEY);
    assert(out.updated.includes('work') && v.road === 'mcp' && v.work === 'I run a bakery', `journey: ${JSON.stringify(v)}`);
});

await test('A welcome mat accepted beside a portfolio settings save: both settings persist', async () => {
    const target = await portfolioWriteGaii(storage, owner.name, config.nodeId);
    await put(target, PORTFOLIO_CONFIG_KEY, { enabled: false });
    const html = '<!doctype html><html><head><title>Mat</title></head><body><h1>Hello</h1><p>Here.</p></body></html>';
    const res = await afterRead(target, PORTFOLIO_CONFIG_KEY, () => mergePortfolioConfig(storage, target, { description: 'kept' }),
        () => json('/v1/home/welcome-mat', { method: 'POST', headers: auth(owner.token), body: JSON.stringify({ paste: html }) }));
    const v = await valueOf<{ enabled?: boolean; description?: string }>(target, PORTFOLIO_CONFIG_KEY);
    assert(res.status === 200 && v.enabled === true && v.description === 'kept', `${res.status} ${JSON.stringify(v)}`);
});

// ── A memory key's CORS list, a board, a provenance attach ───────────────────────────────────

await test('A CORS change beside a value write to the same key: the new value and the origin list both persist', async () => {
    const key = `notes.cors${stamp}`;
    await put(owner.ghii, key, { text: 'old' });
    const res = await afterRead(owner.ghii, key, () => put(owner.ghii, key, { text: 'new' }),
        () => json(`/v1/memory/cors/${encodeURIComponent(key)}`, { method: 'PUT', headers: auth(owner.token), body: JSON.stringify({ allowed_origins: ['https://example.com'] }) }));
    const rec = await storage.getMemory(owner.ghii, key);
    assert(res.status === 200 && (rec?.value as { text?: string }).text === 'new' && rec?.allowedOrigins?.[0] === 'https://example.com',
        `${res.status} ${JSON.stringify({ value: rec?.value, origins: rec?.allowedOrigins })}`);
});

await test('Two posts to one board at the same moment both persist', async () => {
    const boardKey = `board.atomic${stamp}`;
    const post = (text: string) => json('/v1/portal/try-memory', { method: 'POST', headers: auth(owner.token), body: JSON.stringify({ text, boardKey }) });
    await afterRead(owner.ghii, boardKey, () => post('second'), () => post('first'));
    const msgs = ((await valueOf<{ messages: Array<{ msg: string }> }>(owner.ghii, boardKey))?.messages ?? []).map(m => m.msg).sort();
    assert(JSON.stringify(msgs) === '["first","second"]', `board: ${JSON.stringify(msgs)}`);
});

await test('A caller without memory:write cannot post to a board', async () => {
    const reader = await makeAgent(BASE, owner, ['memory:read']);
    const res = await json('/v1/portal/try-memory', { method: 'POST', headers: auth(reader.token), body: JSON.stringify({ text: 'no', boardKey: `board.atomic${stamp}` }) });
    assert(res.status === 403, `status ${res.status}`);
});

await test('A provenance record attached beside a value write to the same key: the new value persists with the record id', async () => {
    const key = `notes.prov${stamp}`;
    await put(owner.ghii, key, { text: 'old' });
    // The route reads the key twice: once to check it exists, once just before the attach.
    const res = await afterRead(owner.ghii, key, () => put(owner.ghii, key, { text: 'new' }),
        () => json('/v1/provenance', { method: 'POST', headers: auth(owner.token), body: JSON.stringify({ level: 'ai-generated', humanInvolvement: 'none', content: 'old', attachToMemoryKey: key }) }), 2);
    const rec = await storage.getMemory(owner.ghii, key);
    assert(res.status === 201 && (rec?.value as { text?: string }).text === 'new' && rec?.aiProvenanceId === res.body.data?.id,
        `${res.status} ${JSON.stringify({ value: rec?.value, prov: rec?.aiProvenanceId, id: res.body.data?.id, error: res.body.error })}`);
});

// ── The EXCHANGE migration and a package's tool list ──────────────────────────────────────────

await test('A migration of hand-made listings beside a tool list publish: the new tool and the flag both persist', async () => {
    const appId = `migapp${stamp}.html`;
    const key = appToolsKey(appId);
    await put(owner.ghii, key, { version: 1, tools: [{ name: 'legacy', description: 'old tool' }] }, 'public');
    const now = new Date().toISOString();
    await putOffering(storage, {
        offeringId: `off-mig-${stamp}`, providerOwner: owner.name, providerGhii: owner.ghii, state: 'listed', kind: 'app-tool',
        surface: { kind: 'app-tool', appId, tool: 'legacy' }, ext: `app:${appId}`, action: 'legacy', title: 'Legacy', description: 'Legacy',
        createdAt: now, updatedAt: now,
    } as never);
    await afterRead(owner.ghii, key,
        () => put(owner.ghii, key, { version: 1, tools: [{ name: 'legacy', description: 'old tool' }, { name: 'fresh', description: 'new tool' }] }, 'public'),
        () => migrateLegacyOfferings(storage, owner.ghii));
    const tools = (await valueOf<{ tools: Array<{ name: string; exchange?: boolean }> }>(owner.ghii, key)).tools;
    assert(tools.some(t => t.name === 'fresh') && tools.find(t => t.name === 'legacy')?.exchange === true, `tools: ${JSON.stringify(tools)}`);
});

await test('A package install beside the owner publishing the same app tool list: the owner\'s list stays', async () => {
    const filename = `pkgapp${stamp}.html`;
    const key = appToolsKey(filename);
    await afterRead(owner.ghii, key, () => put(owner.ghii, key, { version: 1, tools: [{ name: 'ownlist' }] }, 'public'),
        () => installPackageAppTools(storage, { ownerGhii: owner.ghii, filename, tools: [{ name: 'carried', description: 'carried' }], now: new Date().toISOString() }));
    const tools = (await valueOf<{ tools: Array<{ name: string }> }>(owner.ghii, key)).tools.map(t => t.name);
    assert(JSON.stringify(tools) === '["ownlist"]', `tools: ${JSON.stringify(tools)}`);
});

// ── A reviewed record ─────────────────────────────────────────────────────────────────────────

await test('A review stamp beside a write to the reviewed record: the newer value is not replaced', async () => {
    const reviewed = `notes.reviewed${stamp}`;
    await put(owner.ghii, reviewed, { text: 'draft' });
    const run = {
        runId: `run-${stamp}`, workflowId: 'wf', vars: {}, keyPrefix: '', mode: 'full-live', status: 'waiting-step', resolved: [],
        startedAt: new Date().toISOString(),
        defSnapshot: { id: 'wf', steps: [{ id: 'review', action: { kind: 'human-input', reviews_key: reviewed } }] },
        steps: { review: { state: 'waiting', writes: [], human: { askedAt: new Date().toISOString() } } },
    } as unknown as WorkflowRun;
    await afterRead(owner.ghii, reviewed, () => put(owner.ghii, reviewed, { text: 'edited' }),
        () => applyHumanAnswer(storage, config, owner.ghii, run, 'review', { picks: ['ok'], pick: 'ok', by: owner.ghii, byIsHuman: true }));
    const v = await valueOf<{ text?: string }>(owner.ghii, reviewed);
    assert(v.text === 'edited', `reviewed record: ${JSON.stringify(v)}`);
});

// ── The visibility settings ───────────────────────────────────────────────────────────────────

await test('Two visibility settings changes at the same moment both persist', async () => {
    await afterRead(owner.ghii, VISIBILITY_SETTINGS_KEY, () => setVisibilitySettings(storage, owner.ghii, { ga4MeasurementId: 'G-ABC123XYZ9' }),
        () => setVisibilitySettings(storage, owner.ghii, { clarityProjectId: 'abcdef1234' }));
    const v = await valueOf<{ clarityProjectId?: string; ga4MeasurementId?: string }>(owner.ghii, VISIBILITY_SETTINGS_KEY);
    assert(v.clarityProjectId === 'abcdef1234' && v.ga4MeasurementId === 'G-ABC123XYZ9', `settings: ${JSON.stringify(v)}`);
});

await test('Two behaviour settings changes at the same moment both persist', async () => {
    const filename = `behave${stamp}.html`;
    const pub = await json('/v1/apps', { method: 'POST', headers: auth(owner.token), body: JSON.stringify({
        filename, content: Buffer.from('<!doctype html><html><head><title>b</title></head><body>b</body></html>').toString('base64'),
        name: 'Behave', description: 'fixture', category: 'utility', tags: ['demo'],
    }) });
    assert(pub.status === 201, `publish ${pub.status}: ${JSON.stringify(pub.body?.error)}`);
    await afterRead(owner.ghii, BEHAVIOUR_SETTINGS_KEY, () => setBehaviourSettings(storage, owner.ghii, { fixer: true }),
        () => setBehaviourSettings(storage, owner.ghii, { app: filename, appEnabled: false }));
    const v = await valueOf<{ offApps?: string[]; fixer?: boolean }>(owner.ghii, BEHAVIOUR_SETTINGS_KEY);
    assert(v.fixer === true && v.offApps?.includes(filename), `settings: ${JSON.stringify(v)}`);
});

server.close();
console.log(`\n═══ ${passed} passed, ${failed} failed ═══`);
process.exit(failed > 0 ? 1 : 0);
