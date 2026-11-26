/**
 * @file compliance-draft-activity.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The register draft's evidence of who generated and who published
 *   (services/compliance/draft.ts readActivity), at the number of records a busy node has.
 *
 *   WHAT GROWS. Provenance records: 81 000 in thirty days on the node this was measured on
 *   (2026-11-26), 2 567 of them public. The draft read the newest 2 000 records and the newest 2 000
 *   public ones, 500 at a time, and took its evidence from those. So an agent whose public page was
 *   older than 2 000 newer public records was answered "does not publish publicly", marked as
 *   evidence, and the eight pages were most of the draft's three seconds. The evidence is one
 *   grouped statement over the whole window now.
 * @usage cd aimeat && pnpm exec vitest run test/unit/compliance-draft-activity.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-26 — Initial.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage, MemoryRecord } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';
import type { AiProvenance } from '../../src/models/ai-provenance-schemas.js';
import { draftRegisterFromActivity } from '../../src/services/compliance/draft.js';

const NODE = 'test-node';
const OWNER = `alice@${NODE}`;
const QUIET = `quiet#${OWNER}`;
const BUSY = `busy#${OWNER}`;
const CONFIG = { nodeId: NODE, consentAuditRetentionDays: 90, aiProvenance: true } as unknown as AimeatConfig;
/** More public records than the draft's sample held. */
const NEWER_PUBLIC = 2001;

let real: Storage;
let storage: Storage;
const calls = new Map<string, number>();

async function record(id: string, principal: string, generatedAt: string, opts: { public: boolean; involvement?: string; pipeline?: string; model?: string }): Promise<void> {
  const rec = {
    spec: 'aimeat.provenance/v1', level: 'ai-generated', humanInvolvement: opts.involvement ?? 'none', generatedAt,
    ...(opts.pipeline ? { generator: { pipeline: opts.pipeline, model: opts.model } } : {}),
  } as unknown as AiProvenance;
  await real.createAiProvenance({ id, ownerGhii: OWNER, principal, contentHash: null, generatedAt, createdAt: generatedAt, record: rec });
  await real.setMemory({
    key: `notes.${id}`, ownerGaii: OWNER, value: { id }, visibility: opts.public ? 'public' : 'private', tags: [], ttlHours: null,
    version: 1, createdAt: generatedAt, updatedAt: generatedAt, aiProvenanceId: id,
  } as MemoryRecord);
}

beforeAll(async () => {
  real = new SqliteStorage(':memory:') as unknown as Storage;
  const now = Date.now();
  // The quiet agent: a public page a person reviewed twenty days ago, and a private note today.
  await record('quiet-public', QUIET, new Date(now - 20 * 86_400_000).toISOString(), { public: true, involvement: 'editorial-control' });
  await record('quiet-private', QUIET, new Date(now - 1000).toISOString(), { public: false, pipeline: 'alice/notes.html', model: 'm/quiet' });
  // The busy agent: more public records since then than the sample read.
  for (let i = 0; i < NEWER_PUBLIC; i++) await record(`busy-${i}`, BUSY, new Date(now - (i + 2) * 1000).toISOString(), { public: true });
  const usage = [QUIET, BUSY].map(agentGaii => ({
    date: '2026-11-01', agentGaii, ownerGhii: OWNER, apiKeyScope: 'owner', model: 'm/one', provider: 'x', organismId: '', workspaceId: '',
    promptTokens: 1, completionTokens: 1, costUsd: 0, calls: 1, unpricedCalls: 0,
  }));
  const agents = [QUIET, BUSY].map(gaii => ({
    gaii, name: gaii.split('#')[0], owner: 'alice', publicKey: '', trustScore: 0, morselBalance: 0, createdAt: '', lastSeen: '', capabilities: [],
  }));
  storage = new Proxy(real, {
    get(target, prop) {
      // The usage roll-up and the agent list are given; every provenance read goes to the store.
      if (prop === 'queryUsageDailyAllOwners') return async () => usage;
      if (prop === 'listAgents') return async () => agents;
      const v = (target as unknown as Record<string | symbol, unknown>)[prop];
      if (typeof v !== 'function' || typeof prop !== 'string') return v;
      return (...args: unknown[]) => {
        calls.set(prop, (calls.get(prop) ?? 0) + 1);
        return (v as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  });
}, 120_000);

describe('the register draft, with more public records than a page of them', () => {
  it('answers that an agent publishes when its public page is older than 2 000 newer ones', async () => {
    calls.clear();
    const draft = await draftRegisterFromActivity(storage, CONFIG, { sinceDays: 30 });
    const quiet = draft.usecases.find(u => u.title === 'quiet');
    expect(quiet?.answers?.['q-publishes-publicly']).toBe(true);
    expect(quiet?.answerSources?.['q-publishes-publicly']).toBe('evidence');
    expect(quiet?.answers?.['q-human-reviews-before-publish']).toBe(true);
    const busy = draft.usecases.find(u => u.title === 'busy');
    expect(busy?.answers?.['q-publishes-publicly']).toBe(true);
    expect(busy?.answers?.['q-human-reviews-before-publish']).toBe(false);
  });

  it('reads the evidence in one statement and no page of records', async () => {
    calls.clear();
    await draftRegisterFromActivity(storage, CONFIG, { sinceDays: 30 });
    expect(calls.get('aiProvenanceActivity')).toBe(1);
    expect(calls.get('listAiProvenance') ?? 0).toBe(0);
  });
});
