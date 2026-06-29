/**
 * @file e2e-secretary-authoring.ts
 * @description Suite for the Secretary's autonomous authoring phase (services/secretary-authoring.ts):
 *   the tick fills the active context's EMPTY workspaces — document spaces first, then records — toward
 *   the strategy. Runs the service in-process against a throwaway SQLite :memory: storage with a STUBBED
 *   completion (the real per-workspace AI call needs an owner key, which is browser-verified), so the
 *   write/publish convention + band gating + schema-skip + budget cap are deterministically asserted.
 *   Invariant: act → write + publish (.latest) · draft → draft only (no .latest) · off → no-op; a
 *   record that fails its locked schema is skipped, never fatal; the publish gate forces drafts even on act.
 * @version-history
 *   v1.0.0 — 2026-06-30 — Initial: happy path (doc + record published) + failure modes (schema-skip,
 *     band=off no-op, band=draft draft-only, publish-gate forces drafts, budget cap stops the fan-out).
 */
// Run: cd aimeat && pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=secretary-authoring

import { SqliteStorage } from '../src/storage/providers/sqlite/index.js';
import { authorWorkspaceContent, type AuthoringContext } from '../src/services/secretary-authoring.js';
import type { AimeatConfig } from '../src/config.js';
import type { Storage } from '../src/storage/interface.js';

const NODE_ID = 'test-node';
const config = { nodeId: NODE_ID } as unknown as AimeatConfig;
const OWNER = `tester@${NODE_ID}`;
const OWNER_NAME = 'tester';
const ORG = 'org-auth';
const WS = 'ws-auth';
const DOC_NS = 'doc.guides';
const REC_NS = 'rec.tasks';

let passed = 0, failed = 0;
async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); passed++; console.log(`  ✅ ${name}`); }
    catch (err: any) { failed++; console.error(`  ❌ ${name}: ${err.message}`); }
}
function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

/** A fresh storage seeded with one workspace: a document space + a schema-locked record space, both EMPTY. */
async function seedWorkspace(): Promise<Storage> {
    const storage = new SqliteStorage(':memory:');
    const now = new Date().toISOString();
    const root = `organism.${ORG}.w.${WS}`;
    const manifest = {
        manifestVersion: '1.0', id: ORG, name: 'Positioning', kind: 'project', status: 'active',
        objectTypes: [
            { name: 'Guides', namespace: DOC_NS, mode: 'document', purpose: 'free-form how-to docs' },
            { name: 'Tasks', namespace: REC_NS, mode: 'records', fields: [{ name: 'title', type: 'text' }, { name: 'status', type: 'select' }] },
        ],
    };
    await storage.setMemory({ key: `${root}.meta.manifest`, ownerGaii: OWNER, value: manifest, visibility: 'private', tags: [], ttlHours: null, version: 1, createdAt: now, updatedAt: now });
    await storage.setMemory({ key: `${root}.meta.readme`, ownerGaii: OWNER, value: '# Positioning\n\nLock the message.', visibility: 'private', tags: [], ttlHours: null, version: 1, createdAt: now, updatedAt: now });
    // Lock the record space's schema (strict) so a bad record is rejected; the doc space has no schema.
    await storage.setSchema({
        keyPattern: `${root}.${REC_NS}`, applyTo: 'prefix', schemaMode: 'strict', lockedBy: OWNER, setAt: now, updatedAt: now,
        schemaJson: { type: 'object', required: ['id', 'title'], properties: { id: { type: 'string' }, title: { type: 'string' }, status: { type: 'string' } } },
    });
    return storage;
}

const ACTIVE: AuthoringContext = {
    id: 'c1', name: 'Positioning', organismId: ORG, organismName: 'Positioning',
    brain: { purpose: 'Lock positioning.', rules: [] },
    strategy: { enabled: true, current: 'scattered', target: 'one sharp position', milestones: [{ title: 'Positioning locked', status: 'not-started' }] },
};
const WSLIST = [{ id: WS, name: 'Positioning' }];

/** A stub completion returning one document + one VALID record + one INVALID record (extra prop, no title). */
const stubReply = JSON.stringify({
    documents: [{ space: 'Guides', title: 'Messaging Guide', markdown: '# Messaging Guide\n\nOwn it, see its value.' }],
    records: [
        { space: 'Tasks', record: { title: 'Draft the one-liner', status: 'open' } },
        { space: 'Tasks', record: { bogus: true } },   // fails the strict schema (no title, extra prop) → skipped
    ],
});
const okComplete = async () => ({ content: stubReply });

/** Distinct keys present under a namespace with a given role suffix (e.g. '.latest', '.draft'). */
async function keysWithSuffix(storage: Storage, ns: string, suffix: string): Promise<string[]> {
    const { items } = await storage.listAllMemory({ prefix: `organism.${ORG}.w.${WS}.${ns}.`, limit: 1000 });
    return items.filter((r) => r.key.endsWith(suffix)).map((r) => r.key);
}

await test('1. act band: document + valid record are PUBLISHED; invalid record is skipped; metered once', async () => {
    const storage = await seedWorkspace();
    const res = await authorWorkspaceContent(storage, config, OWNER, OWNER_NAME, ACTIVE, WSLIST, {
        openGoals: [{ title: 'Lock the message' }], band: 'act', aggressive: true, useGeneralKnowledge: true, budgetRemaining: null, appId: 'test:author', complete: okComplete,
    });
    assert(res.morsels === 1, `one paid call for one workspace, got ${res.morsels}`);
    const docLatest = await keysWithSuffix(storage, DOC_NS, '.latest');
    const recLatest = await keysWithSuffix(storage, REC_NS, '.latest');
    assert(docLatest.length === 1, `document published to .latest, got ${docLatest.length}`);
    assert(recLatest.length === 1, `exactly the VALID record published (invalid skipped), got ${recLatest.length}`);
    // A published item leaves no draft behind.
    assert((await keysWithSuffix(storage, DOC_NS, '.draft')).length === 0, 'no doc draft remains after publish');
    assert(res.writes.includes(docLatest[0]) && res.writes.includes(recLatest[0]), 'writes report the published keys');
    assert(res.summaries.length === 1 && /Authored/.test(res.summaries[0]) && /published/.test(res.summaries[0]), `summary mentions published authoring: ${res.summaries[0]}`);
    storage.close();
});

await test('2. draft band: content is written as DRAFTS only — nothing is published', async () => {
    const storage = await seedWorkspace();
    const res = await authorWorkspaceContent(storage, config, OWNER, OWNER_NAME, ACTIVE, WSLIST, {
        openGoals: [], band: 'draft', aggressive: true, useGeneralKnowledge: true, budgetRemaining: null, appId: 'test:author', complete: okComplete,
    });
    assert((await keysWithSuffix(storage, DOC_NS, '.draft')).length === 1, 'document left as a draft');
    assert((await keysWithSuffix(storage, DOC_NS, '.latest')).length === 0, 'no .latest on draft band');
    assert((await keysWithSuffix(storage, REC_NS, '.latest')).length === 0, 'no record published on draft band');
    assert(/drafts for review/.test(res.summaries[0] || ''), `summary marks it as drafts: ${res.summaries[0]}`);
    storage.close();
});

await test('3. off band: no-op — no AI call, no writes', async () => {
    const storage = await seedWorkspace();
    let called = false;
    const res = await authorWorkspaceContent(storage, config, OWNER, OWNER_NAME, ACTIVE, WSLIST, {
        openGoals: [], band: 'off', aggressive: true, useGeneralKnowledge: true, budgetRemaining: null, appId: 'test:author',
        complete: async () => { called = true; return { content: stubReply }; },
    });
    assert(!called, 'off band must not call the model');
    assert(res.morsels === 0 && res.writes.length === 0 && res.summaries.length === 0, 'off band is a clean no-op');
    storage.close();
});

await test('4. publish gate ON forces drafts even on act band', async () => {
    const storage = await seedWorkspace();
    const now = new Date().toISOString();
    await storage.setMemory({ key: `organism.${ORG}.meta.config`, ownerGaii: OWNER, value: { gates: { publish: { enabled: true } } }, visibility: 'private', tags: [], ttlHours: null, version: 1, createdAt: now, updatedAt: now });
    await authorWorkspaceContent(storage, config, OWNER, OWNER_NAME, ACTIVE, WSLIST, {
        openGoals: [], band: 'act', aggressive: true, useGeneralKnowledge: true, budgetRemaining: null, appId: 'test:author', complete: okComplete,
    });
    assert((await keysWithSuffix(storage, DOC_NS, '.latest')).length === 0, 'publish gate on → nothing published');
    assert((await keysWithSuffix(storage, DOC_NS, '.draft')).length === 1, 'publish gate on → left as a draft');
    storage.close();
});

await test('5. already-filled spaces are skipped (idempotent) — no second paid call', async () => {
    const storage = await seedWorkspace();
    // First pass fills both spaces.
    await authorWorkspaceContent(storage, config, OWNER, OWNER_NAME, ACTIVE, WSLIST, {
        openGoals: [], band: 'act', aggressive: true, useGeneralKnowledge: true, budgetRemaining: null, appId: 'test:author', complete: okComplete,
    });
    // Second pass: every memory-backed space now has content, so there's nothing to fill → no AI call.
    let called = false;
    const res2 = await authorWorkspaceContent(storage, config, OWNER, OWNER_NAME, ACTIVE, WSLIST, {
        openGoals: [], band: 'act', aggressive: true, useGeneralKnowledge: true, budgetRemaining: null, appId: 'test:author',
        complete: async () => { called = true; return { content: stubReply }; },
    });
    assert(!called && res2.morsels === 0, 'a fully-filled workspace makes no paid call');
    storage.close();
});

await test('6. budget cap halts the fan-out before the next workspace', async () => {
    const storage = await seedWorkspace();
    // A second empty workspace so there are two paid calls available.
    const now = new Date().toISOString();
    const root2 = `organism.${ORG}.w.ws-2`;
    await storage.setMemory({ key: `${root2}.meta.manifest`, ownerGaii: OWNER, value: { manifestVersion: '1.0', id: ORG, name: 'Two', kind: 'project', status: 'active', objectTypes: [{ name: 'Guides', namespace: DOC_NS, mode: 'document' }] }, visibility: 'private', tags: [], ttlHours: null, version: 1, createdAt: now, updatedAt: now });
    let calls = 0;
    const res = await authorWorkspaceContent(storage, config, OWNER, OWNER_NAME, ACTIVE, [{ id: WS, name: 'Positioning' }, { id: 'ws-2', name: 'Two' }], {
        openGoals: [], band: 'act', aggressive: true, useGeneralKnowledge: true, budgetRemaining: 1, appId: 'test:author',
        complete: async () => { calls++; return { content: stubReply }; },
    });
    assert(calls === 1 && res.morsels === 1, `budget of 1 morsel allows exactly one workspace, got ${calls} calls`);
    storage.close();
});

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed}`);
process.exit(failed > 0 ? 1 : 0);
