/**
 * @file test/e2e-catalogue-classification.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The public knowledge catalogue answers what the single read answers, with
 *   classification on. GET /v1/catalogue/knowledge is unauthenticated and lists every public
 *   knowledge-package manifest from a cached node-wide memory scan; GET /v1/knowledge/:id runs the
 *   same manifest through the caller's classification reader. The listing had no reader, so a
 *   manifest whose label hides it from AI answered 404 on the single read and was still named, with
 *   its author, synthesis and tags, in the listing an anonymous caller could ask for (secaudit
 *   2026-10, catalogue.ts:GET-v1-catalogue-knowledge:no-classification-reader).
 *
 *   WHY IT OWNS ITS NODE. The divergence needs the node-wide classification switch ON and a label
 *   that hides content from AI. No default label does (defaults.ts, decided 2026-09-30), and the
 *   shared E2E node runs with classification off, which is the code default. So this suite starts a
 *   node with AIMEAT_CLASSIFICATION=all, and the operator writes one node policy that takes the
 *   default audience caps off (so a public write of an unlabelled record is allowed at all) and adds
 *   one label with aiVisibility `hidden`.
 *
 *   WHAT IS PROVEN. Alice publishes two public manifests and labels one of them with that label.
 *   An anonymous reader is read as an AI (reader.ts, decided 2026-09-30), so for the labelled one
 *   the single read is 404 AND the listing does not carry it; for the unlabelled one, the positive
 *   control, both doors answer with it. Alice herself is a person, so both doors still show her the
 *   labelled package: the label hides it from AI, not from its owner.
 * @structure
 *   - Phase 1 the node, the operator's policy (which a member is refused, 403), the owner
 *   - Phase 2 two public manifests, one labelled hidden-from-AI
 *   - Phase 3 the anonymous reader: 404 on the single read, absent from the listing, control listed
 *   - Phase 4 the owner in person: both doors still show her both packages
 * @usage cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=e2e-catalogue-classification
 *   cd aimeat && pnpm exec node --env-file=.env.test.postgres-kysely --import tsx test/run-e2e-ci.ts --test=e2e-catalogue-classification
 * @version-history
 *   2026-10-20 — Initial (secaudit 2026-10, catalogue.ts:GET-v1-catalogue-knowledge:no-classification-reader).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { nodeEntryArgs } from './helpers/node-entry.js';
import { ownNodeDb } from './helpers/own-node-db.js';
import { waitForServer } from './helpers/wait-for-server.js';
import { registerOwner, type RegisteredOwner } from './helpers/owner-login.js';

const PORT = Number(process.env.E2E_CATALOGUE_CLASSIFICATION_PORT ?? 40495);
const BASE = `http://127.0.0.1:${PORT}`;
const STAMP = Date.now().toString(36).slice(-6);
const NODE_ID = `aimeat-test-001-catcl${STAMP}`;
/** The label this suite adds to the node policy: no AI may read content carrying it. */
const NO_AI = 'catcl-no-ai';

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => Promise<void>): Promise<void> {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err) { failed++; console.error(`  ❌ ${name}: ${(err as Error).message}`); }
}
function assert(cond: unknown, msg: string): asserts cond { if (!cond) throw new Error(msg); }
const short = (v: unknown): string => String(JSON.stringify(v)).slice(0, 400);

// Runtime assertions below check the HTTP contract at this untyped JSON boundary.
type Body = Record<string, any>;
async function call(method: 'GET' | 'POST' | 'PUT', path: string, token?: string, body?: unknown): Promise<{ status: number; body: Body }> {
    const res = await fetch(BASE + path, {
        method,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(60_000),
    });
    const text = await res.text();
    return { status: res.status, body: (res.headers.get('content-type') ?? '').includes('json') ? JSON.parse(text) as Body : { _raw: text } };
}

const db = await ownNodeDb(`catalogue-classification-${PORT}`);
let node: ChildProcess | null = null;

async function startNode(): Promise<void> {
    const env: Record<string, string | undefined> = { ...process.env };
    for (const k of Object.keys(env)) if (k.startsWith('AIMEAT_') || k === 'DATABASE_URL') delete env[k];
    Object.assign(env, db.env, {
        AIMEAT_PORT: String(PORT),
        AIMEAT_NODE_ID: NODE_ID,
        AIMEAT_ADMIN_PASSWORD: `CatCl-Admin-${STAMP}-Pw!`,
        AIMEAT_LOG_LEVEL: 'warn',
        AIMEAT_SMTP_HOST: '',
        // The switch this suite needs: classification on for every scope, which is what makes the
        // reader decide anything at all. Off (the code default) is covered by every other suite.
        AIMEAT_CLASSIFICATION: 'all',
        AIMEAT_RL_GLOBAL: '10000', AIMEAT_RL_AUTH: '1000', AIMEAT_RL_MEMORY: '1000',
        AIMEAT_REGISTRATION_RATE_LIMIT_MAX: '1000',
    });
    node = spawn('node', [...nodeEntryArgs(), 'start', ...db.args], { env: env as NodeJS.ProcessEnv, stdio: ['ignore', 'pipe', 'pipe'], cwd: process.cwd() });
    await waitForServer(node, BASE, { label: 'the catalogue classification node' });
}

async function stopNode(): Promise<void> {
    const running = (n: ChildProcess) => n.exitCode === null && n.signalCode === null;
    if (!node || !running(node)) return;
    const exited = once(node, 'exit');
    node.kill('SIGTERM');
    await Promise.race([exited, new Promise(r => setTimeout(r, 10_000))]);
    if (running(node)) { node.kill('SIGKILL'); await exited; }
}

/** The package ids this suite publishes: one labelled hidden from AI, one left alone. */
const HIDDEN_ID = `catcl-hidden-${STAMP}`;
const OPEN_ID = `catcl-open-${STAMP}`;
const manifestKey = (id: string) => `packages/${id}/manifest`;
const SYNTHESIS_MARKER = `catcl-synthesis-${STAMP}`;

/** The package ids an answer to GET /v1/catalogue/knowledge carries. */
async function cataloguePackageIds(token?: string): Promise<{ ids: string[]; raw: string }> {
    const r = await call('GET', '/v1/catalogue/knowledge?limit=50', token);
    assert(r.status === 200, `catalogue: ${r.status} ${short(r.body)}`);
    const packages = (r.body.data?.packages ?? []) as Body[];
    return { ids: packages.map(p => String(p.package_id)), raw: JSON.stringify(packages) };
}

console.log('\n=== The knowledge catalogue and the single read answer the same, with classification on ===\n');
console.log('Phase 1 — the node, the operator policy and the owner');

let op!: RegisteredOwner, alice!: RegisteredOwner;

try {
    await startNode();
    // The first account registered on a fresh node is its operator.
    op = await registerOwner(BASE, `catclop${STAMP}`);
    alice = await registerOwner(BASE, `catclalice${STAMP}`);

    await test('the operator takes the audience caps off and adds a label no AI may read', async () => {
        const read = await call('GET', '/v1/classification/policy?level=node', op.token);
        assert(read.status === 200 && read.body.data?.effective?.labels, `node policy: ${read.status} ${short(read.body)}`);
        const effective = read.body.data.effective as Body;
        // Caps off: the default Internal cap is `signed-in`, so with classification on an unlabelled
        // public write would be refused (LABEL_CAPS_AUDIENCE) and there would be no listing to test.
        const labels = (effective.labels as Body[]).map(l => ({ ...l, maxAudience: null }));
        labels.push({
            id: NO_AI, name: { fi: 'Ei tekoälylle', en: 'No AI', es: 'Sin IA' }, rank: 40, color: '#5a5a5a',
            status: 'active', description: 'Suite label: no AI reader may see this content.',
            aiVisibility: 'hidden', audit: false, mayLeaveOrganism: true, lowerNeedsJustification: false,
            audience: null, maxAudience: null,
        });
        const put = await call('PUT', '/v1/classification/policy', op.token, { level: 'node', policy: { ...effective, labels } });
        assert(put.status === 200, `policy write: ${put.status} ${short(put.body)}`);
        const back = await call('GET', '/v1/classification/policy?level=node', op.token);
        const stored = (back.body.data.effective.labels as Body[]).find(l => l.id === NO_AI);
        assert(stored?.aiVisibility === 'hidden', `the label is not stored hidden: ${short(stored)}`);
    });

    await test('DENIED: an account that is not the operator cannot change the node policy (403)', async () => {
        // The whole setup rests on the node policy being the operator's alone, so the suite asks a
        // second signed-in principal for it. alice is a member of this node and nothing more.
        const put = await call('PUT', '/v1/classification/policy', alice.token, { level: 'node', policy: { labels: [], defaultLabel: 'julkinen' } });
        assert(put.status === 403, `a member rewrote the node policy: ${put.status} ${short(put.body)}`);
    });

    console.log('\nPhase 2 — two public manifests, one labelled hidden from AI');

    await test('alice publishes two public knowledge-package manifests', async () => {
        for (const id of [HIDDEN_ID, OPEN_ID]) {
            const w = await call('POST', '/v1/memory', alice.token, {
                key: manifestKey(id),
                value: {
                    type: 'knowledge-package', name: `Package ${id}`, author: alice.ghii,
                    content_type: 'notes', language: 'en', maturity: 'draft',
                    synthesis: { description: SYNTHESIS_MARKER }, tags: ['catcl'], entries: [], references: [],
                },
                visibility: 'public',
                tags: ['knowledge-package'],
            });
            // 201, not 200: POST /v1/memory answers 200 only when it overwrote a key that existed.
            assert(w.status === 201, `publish ${id}: ${w.status} ${short(w.body?.error ?? w.body)}`);
        }
    });

    await test('alice labels one of them with the label no AI may read', async () => {
        const put = await call('PUT', '/v1/classification/label', alice.token, {
            kind: 'memory', key: manifestKey(HIDDEN_ID), label: NO_AI,
        });
        assert(put.status === 200, `label: ${put.status} ${short(put.body)}`);
        const read = await call('GET', `/v1/classification/label?kind=memory&key=${encodeURIComponent(manifestKey(HIDDEN_ID))}`, alice.token);
        assert(read.body.data?.effective?.label === NO_AI, `effective label: ${short(read.body.data?.effective)}`);
        // The record itself is still public: the divergence is only real while it is.
        const rec = await call('GET', `/v1/memory/${encodeURIComponent(alice.ghii)}/${encodeURIComponent(manifestKey(HIDDEN_ID))}`, alice.token);
        assert(rec.status === 200 && rec.body.data?.visibility === 'public', `visibility: ${rec.status} ${short(rec.body.data?.visibility)}`);
    });

    console.log('\nPhase 3 — the anonymous reader, who is read as an AI');

    await test('the single read of the labelled package is 404 to an anonymous reader', async () => {
        const r = await call('GET', `/v1/knowledge/${HIDDEN_ID}`);
        assert(r.status === 404, `single read: ${r.status} ${short(r.body?.data ?? r.body)}`);
    });

    await test('POSITIVE CONTROL: the single read of the unlabelled package answers it', async () => {
        const r = await call('GET', `/v1/knowledge/${OPEN_ID}`);
        assert(r.status === 200, `single read: ${r.status} ${short(r.body)}`);
        assert(r.body.data?.package_id === OPEN_ID, `package: ${short(r.body.data)}`);
    });

    await test('THE DEFECT: the anonymous catalogue listing does not carry the labelled package', async () => {
        const { ids, raw } = await cataloguePackageIds();
        assert(!ids.includes(HIDDEN_ID), `the listing named a package the single read answers 404 for: ${short(ids)}`);
        assert(!raw.includes(HIDDEN_ID), `the hidden package id appears in the listing: ${raw.slice(0, 400)}`);
    });

    await test('POSITIVE CONTROL: the anonymous catalogue listing does carry the unlabelled package', async () => {
        const { ids, raw } = await cataloguePackageIds();
        assert(ids.includes(OPEN_ID), `the unlabelled package is missing: ${short(ids)}`);
        assert(raw.includes(SYNTHESIS_MARKER), 'and its synthesis is still listed');
    });

    console.log('\nPhase 4 — the owner in person, whom the label does not hide it from');

    await test('alice reads both packages, on the single read and in the listing', async () => {
        const single = await call('GET', `/v1/knowledge/${HIDDEN_ID}`, alice.token);
        assert(single.status === 200, `her own single read: ${single.status} ${short(single.body)}`);
        const { ids } = await cataloguePackageIds(alice.token);
        assert(ids.includes(HIDDEN_ID) && ids.includes(OPEN_ID), `her listing: ${short(ids)}`);
    });
} finally {
    await stopNode();
}

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
