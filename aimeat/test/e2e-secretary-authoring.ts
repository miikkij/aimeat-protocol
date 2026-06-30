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
 *   v1.2.0 — 2026-06-30 — Browser-found cases: a reply that does NOT parse as JSON still triggers
 *     retry-on-empty and authors a document (13, the gap that left a live workspace blank); a document
 *     whose space name is misspelled is still written when there is exactly one document space (14).
 *   v1.1.0 — 2026-06-30 — Never-empty + document-first coverage: a placeholder-echo title ("a clear title")
 *     is skipped not written (9); retry-on-empty re-prompts once and authors a real doc when the first reply
 *     was unusable (10); without retryOnEmpty (the tick) an unusable reply is not retried but IS surfaced
 *     (11); a doc-only reply publishes the document and leaves the records space empty — records are not
 *     invented (12).
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
/** Self-healing stub: first shot returns the bad record; on the correction prompt it returns a fixed one. */
const selfHealComplete = async ({ prompt }: { prompt: string }) => {
    if (/REJECTED by the schema/.test(prompt)) return { content: JSON.stringify({ records: [{ space: 'Tasks', record: { title: 'Recovered task', status: 'open' } }] }) };
    return { content: stubReply };
};
/** Stubborn stub: the correction round returns ONLY the still-broken record (the model can't fix it). */
const stubbornInvalidComplete = async ({ prompt }: { prompt: string }) => {
    if (/REJECTED by the schema/.test(prompt)) return { content: JSON.stringify({ records: [{ space: 'Tasks', record: { bogus: true } }] }) };
    return { content: stubReply };
};

/** Distinct keys present under a namespace with a given role suffix (e.g. '.latest', '.draft'). */
async function keysWithSuffix(storage: Storage, ns: string, suffix: string): Promise<string[]> {
    const { items } = await storage.listAllMemory({ prefix: `organism.${ORG}.w.${WS}.${ns}.`, limit: 1000 });
    return items.filter((r) => r.key.endsWith(suffix)).map((r) => r.key);
}

await test('1. agentic self-correction: a schema-rejected record is fixed on the feedback round and published', async () => {
    const storage = await seedWorkspace();
    const res = await authorWorkspaceContent(storage, config, OWNER, OWNER_NAME, ACTIVE, WSLIST, {
        openGoals: [{ title: 'Lock the message' }], band: 'act', aggressive: true, useGeneralKnowledge: true, budgetRemaining: null, appId: 'test:author', complete: selfHealComplete,
    });
    assert(res.morsels === 2, `initial call + one correction round, got ${res.morsels}`);
    const docLatest = await keysWithSuffix(storage, DOC_NS, '.latest');
    const recLatest = await keysWithSuffix(storage, REC_NS, '.latest');
    assert(docLatest.length === 1, `document published to .latest, got ${docLatest.length}`);
    assert(recLatest.length === 2, `the valid record + the corrected (recovered) record both published, got ${recLatest.length}`);
    assert((await keysWithSuffix(storage, REC_NS, '.draft')).length === 0, 'no record draft remains after publish');
    assert(res.writes.includes(docLatest[0]), 'writes report the published document key');
    assert(res.summaries.length === 1 && /Authored/.test(res.summaries[0]) && /published/.test(res.summaries[0]), `summary mentions published authoring: ${res.summaries[0]}`);
    storage.close();
});

await test('1b. bounded correction: a record the model never fixes is dropped after the round (no infinite loop)', async () => {
    const storage = await seedWorkspace();
    const res = await authorWorkspaceContent(storage, config, OWNER, OWNER_NAME, ACTIVE, WSLIST, {
        openGoals: [], band: 'act', aggressive: true, useGeneralKnowledge: true, budgetRemaining: null, appId: 'test:author', complete: stubbornInvalidComplete,
    });
    assert(res.morsels === 2, `initial + exactly one bounded correction attempt, got ${res.morsels}`);
    assert((await keysWithSuffix(storage, REC_NS, '.latest')).length === 1, 'only the originally-valid record published; the unfixable one dropped');
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

await test('7. transient provider error (owl-alpha flakiness) is retried → content still published', async () => {
    const storage = await seedWorkspace();
    let calls = 0;
    const flaky = async (_a: { prompt: string; systemPrompt: string; appId: string }) => {
        calls++;
        if (calls === 1) throw Object.assign(new Error('OpenRouter 400: Provider returned error'), { code: 'PROVIDER_ERROR' });
        return { content: stubReply };
    };
    await authorWorkspaceContent(storage, config, OWNER, OWNER_NAME, ACTIVE, WSLIST, {
        openGoals: [], band: 'act', aggressive: true, useGeneralKnowledge: true, budgetRemaining: null, maxRetries: 2, appId: 'test:author', complete: flaky,
    });
    assert(calls >= 2, `the flaky completion was retried, calls=${calls}`);
    assert((await keysWithSuffix(storage, DOC_NS, '.latest')).length === 1, 'document published after the retry');
    storage.close();
});

await test('8. permanent error (bad API key) is NOT retried — fails fast, nothing published', async () => {
    const storage = await seedWorkspace();
    let calls = 0;
    const badKey = async () => { calls++; throw Object.assign(new Error('API key rejected'), { code: 'INVALID_API_KEY' }); };
    await authorWorkspaceContent(storage, config, OWNER, OWNER_NAME, ACTIVE, WSLIST, {
        openGoals: [], band: 'act', aggressive: true, useGeneralKnowledge: true, budgetRemaining: null, maxRetries: 3, appId: 'test:author', complete: badKey,
    });
    assert(calls === 1, `a permanent error must not be retried, calls=${calls}`);
    assert((await keysWithSuffix(storage, DOC_NS, '.latest')).length === 0, 'nothing published on a permanent failure');
    storage.close();
});

await test('9. a placeholder-echo document title ("a clear title") is skipped, not written, and surfaced', async () => {
    const storage = await seedWorkspace();
    const placeholderReply = JSON.stringify({
        documents: [{ space: 'Guides', title: 'a clear title', markdown: '# Title\n\nGrounded, realistic content…' }],
        records: [],
    });
    const res = await authorWorkspaceContent(storage, config, OWNER, OWNER_NAME, ACTIVE, WSLIST, {
        openGoals: [], band: 'act', aggressive: true, useGeneralKnowledge: true, budgetRemaining: null, appId: 'test:author',
        complete: async () => ({ content: placeholderReply }),
    });
    assert((await keysWithSuffix(storage, DOC_NS, '.latest')).length === 0, 'a placeholder-titled document is not published');
    assert(res.summaries.some((s) => /nothing usable/.test(s)), `the empty result is surfaced, not silent: ${res.summaries[0]}`);
    storage.close();
});

await test('10. retry-on-empty re-prompts ONCE and authors a real document when the first reply was unusable', async () => {
    const storage = await seedWorkspace();
    let calls = 0;
    const emptyThenReal = async ({ prompt }: { prompt: string }) => {
        calls++;
        if (/produced no usable document/.test(prompt)) {
            return { content: JSON.stringify({ documents: [{ space: 'Guides', title: 'Messaging Guide', markdown: '# Messaging Guide\n\nReal content.' }], records: [] }) };
        }
        return { content: JSON.stringify({ documents: [{ space: 'Guides', title: 'a clear title', markdown: 'x' }], records: [] }) };
    };
    const res = await authorWorkspaceContent(storage, config, OWNER, OWNER_NAME, ACTIVE, WSLIST, {
        openGoals: [], band: 'act', aggressive: true, useGeneralKnowledge: true, budgetRemaining: null, retryOnEmpty: true, appId: 'test:author', complete: emptyThenReal,
    });
    assert(calls === 2, `retry-on-empty issues exactly one extra call, calls=${calls}`);
    assert(res.morsels === 2, `morsels counts the retry, got ${res.morsels}`);
    assert((await keysWithSuffix(storage, DOC_NS, '.latest')).length === 1, 'the retried real document is published');
    assert(res.summaries.some((s) => /Authored/.test(s)), `success summary after the retry: ${res.summaries[0]}`);
    storage.close();
});

await test('11. WITHOUT retry-on-empty (the autonomous tick), an unusable reply is not retried but IS surfaced', async () => {
    const storage = await seedWorkspace();
    let calls = 0;
    const alwaysEmpty = async () => { calls++; return { content: JSON.stringify({ documents: [{ space: 'Guides', title: 'a clear title', markdown: 'x' }], records: [] }) }; };
    const res = await authorWorkspaceContent(storage, config, OWNER, OWNER_NAME, ACTIVE, WSLIST, {
        openGoals: [], band: 'act', aggressive: true, useGeneralKnowledge: true, budgetRemaining: null, appId: 'test:author', complete: alwaysEmpty,
    });
    assert(calls === 1, `no retryOnEmpty → exactly one call (tick economics unchanged), calls=${calls}`);
    assert(res.summaries.some((s) => /nothing usable/.test(s)), 'the empty workspace is surfaced, not silent');
    storage.close();
});

await test('12. document-first: a doc-only reply publishes the document and leaves the records space empty (no invention)', async () => {
    const storage = await seedWorkspace();
    const docOnly = JSON.stringify({ documents: [{ space: 'Guides', title: 'Our approach', markdown: '# Our approach\n\nGrounded plan with an assumption flagged. Oletus: …' }], records: [] });
    const res = await authorWorkspaceContent(storage, config, OWNER, OWNER_NAME, ACTIVE, WSLIST, {
        openGoals: [], band: 'act', aggressive: true, useGeneralKnowledge: true, budgetRemaining: null, appId: 'test:author', complete: async () => ({ content: docOnly }),
    });
    assert((await keysWithSuffix(storage, DOC_NS, '.latest')).length === 1, 'the document is published');
    assert((await keysWithSuffix(storage, REC_NS, '.latest')).length === 0, 'the records space is left empty — records are not invented');
    assert(/document/.test(res.summaries[0] || '') && /Authored/.test(res.summaries[0] || ''), `summary reports the authored document: ${res.summaries[0]}`);
    storage.close();
});

await test('13. a reply that does NOT parse as JSON still triggers retry-on-empty and authors a document', async () => {
    const storage = await seedWorkspace();
    let calls = 0;
    const badJsonThenReal = async ({ prompt }: { prompt: string }) => {
        calls++;
        if (/was not valid JSON|produced no usable document/.test(prompt)) {
            return { content: JSON.stringify({ documents: [{ space: 'Guides', title: 'Recovered plan', markdown: '# Recovered plan\n\nReal content.' }], records: [] }) };
        }
        return { content: 'Here you go:\n```\n{ this is not valid json, ' };  // unparseable on the first shot
    };
    const res = await authorWorkspaceContent(storage, config, OWNER, OWNER_NAME, ACTIVE, WSLIST, {
        openGoals: [], band: 'act', aggressive: true, useGeneralKnowledge: true, budgetRemaining: null, retryOnEmpty: true, appId: 'test:author', complete: badJsonThenReal,
    });
    assert(calls === 2, `parse-fail then one retry = 2 calls, got ${calls}`);
    assert((await keysWithSuffix(storage, DOC_NS, '.latest')).length === 1, 'the retried document is published even though the first reply did not parse');
    assert(res.summaries.some((s) => /Authored/.test(s)), `success summary after the parse-fail retry: ${res.summaries[0]}`);
    storage.close();
});

await test('14. a document for a MISSPELLED space name is still written when there is exactly one document space', async () => {
    const storage = await seedWorkspace();
    const misspelled = JSON.stringify({ documents: [{ space: 'Guidez', title: 'Messaging Guide', markdown: '# Messaging Guide\n\nReal content.' }], records: [] });
    await authorWorkspaceContent(storage, config, OWNER, OWNER_NAME, ACTIVE, WSLIST, {
        openGoals: [], band: 'act', aggressive: true, useGeneralKnowledge: true, budgetRemaining: null, appId: 'test:author', complete: async () => ({ content: misspelled }),
    });
    assert((await keysWithSuffix(storage, DOC_NS, '.latest')).length === 1, 'the document lands in the single doc space despite the model mislabelling it');
    storage.close();
});

console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed}`);
process.exit(failed > 0 ? 1 : 0);
