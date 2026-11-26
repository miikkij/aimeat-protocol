/**
 * @file transparency-unlabelled-list.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The unlabelled list and the report's population, at the size a busy node has.
 *
 *   WHAT GROWS. A node mints one provenance record per AI write: 81 000 in thirty days on the node
 *   this was measured on (2026-11-26), 2 500 of them public and unreviewed, 43 of those unlabelled.
 *   The list read the public unreviewed rows newest first, 500 at a time, and decided each in the
 *   process, so it read every page to find 43 rows, ran a count with every page, and stopped after
 *   5 000 rows whatever was left. The facets already say which fact combinations are unlabelled, so
 *   the rows are one statement.
 *
 *   The second half: a report and its detail list describe one population, so they read it once.
 *   The admin report read the facets and the share scan twice.
 * @usage cd aimeat && pnpm exec vitest run test/unit/transparency-unlabelled-list.test.ts
 * @version-history
 *   v1.0.1 — 2026-11-26 — The share scan is counted by its read of the share records.
 *   v1.0.0 — 2026-11-26 — Initial.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage, MemoryRecord } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';
import type { AiProvenance } from '../../src/models/ai-provenance-schemas.js';
import * as transparency from '../../src/services/ai/transparency-report.js';

const OWNER = 'alice@test-node';
/** More labelled rows than the old scan read (10 pages of 500) before it gave up. */
const LABELLED = 5100;
const UNLABELLED = 3;

const CONFIG = { nodeId: 'test-node', aiLabelPublic: 'light' } as unknown as AimeatConfig;

let real: Storage;
const calls = new Map<string, unknown[][]>();
let storage: Storage;

/** A public memory record an AI wrote and nobody reviewed, with its provenance record. */
async function publicAiRecord(id: string, generatedAt: string, unlabelled: boolean): Promise<void> {
  const record = {
    spec: 'aimeat.provenance/v1', level: 'ai-generated', humanInvolvement: 'none', generatedAt,
    // Under the `light` policy a public text record owes its label unless its minted reason is
    // `policy` (services/ai/disclosure.ts); that combination is the unlabelled one.
    ...(unlabelled ? { disclosure: { required: false, reason: 'policy', short: { en: '-' } } } : {}),
  } as unknown as AiProvenance;
  await real.createAiProvenance({ id, ownerGhii: OWNER, principal: `writer#${OWNER}`, contentHash: null, generatedAt, createdAt: generatedAt, record });
  await real.setMemory({
    key: `notes.${id}`, ownerGaii: OWNER, value: { id }, visibility: 'public', tags: [], ttlHours: null,
    version: 1, createdAt: generatedAt, updatedAt: generatedAt, aiProvenanceId: id,
  } as MemoryRecord);
}

beforeAll(async () => {
  real = new SqliteStorage(':memory:') as unknown as Storage;
  const now = Date.now();
  // The labelled rows are the newest, so a scan from the top meets all of them first.
  for (let i = 0; i < LABELLED; i++) await publicAiRecord(`labelled-${i}`, new Date(now - (i + 1) * 1000).toISOString(), false);
  for (let i = 0; i < UNLABELLED; i++) await publicAiRecord(`unlabelled-${i}`, new Date(now - (20 + i) * 86_400_000).toISOString(), true);
  storage = new Proxy(real, {
    get(target, prop) {
      const v = (target as unknown as Record<string | symbol, unknown>)[prop];
      if (typeof v !== 'function' || typeof prop !== 'string') return v;
      return (...args: unknown[]) => {
        calls.set(prop, [...(calls.get(prop) ?? []), args]);
        return (v as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  });
}, 120_000);

describe('the unlabelled list', () => {
  it('lists the unlabelled rows that are older than 5 000 labelled ones, in one read without a count', async () => {
    calls.clear();
    const found = await transparency.listUnlabelledPublic(storage, { sinceDays: 30, limit: 50, labelPolicy: 'light' });

    expect(found.total).toBe(UNLABELLED);
    expect(found.items.map(r => r.id).sort()).toEqual(['unlabelled-0', 'unlabelled-1', 'unlabelled-2']);

    const reads = calls.get('listAiProvenance') ?? [];
    expect(reads.length, 'one statement, however many labelled rows are newer').toBe(1);
    expect((reads[0]![0] as { noTotal?: boolean }).noTotal, 'the list never read the count').toBe(true);
  });

  it('reads nothing when the facets count no unlabelled record', async () => {
    calls.clear();
    // Under `strict` every public record a model took part in owes its label.
    const found = await transparency.listUnlabelledPublic(storage, { sinceDays: 30, limit: 50, labelPolicy: 'strict' });
    expect(found).toEqual({ items: [], total: 0 });
    expect(calls.get('listAiProvenance') ?? []).toEqual([]);
  });
});

describe('a report and its detail list', () => {
  it('read the population once: one facet query and one share scan', async () => {
    calls.clear();
    const populations = transparency.provenancePopulations(storage, CONFIG);
    const opts = { sinceDays: 30, labelPolicy: 'light' as const, config: CONFIG, populations };
    const report = await transparency.buildAiTransparencyReport(storage, opts);
    const detail = await transparency.listUnlabelledPublic(storage, { ...opts, limit: 50 });

    expect(report.total).toBe(LABELLED + UNLABELLED);
    expect(report.unlabelled).toBe(UNLABELLED);
    expect(detail.total).toBe(report.unlabelled);
    expect((calls.get('aiProvenanceFacets') ?? []).length).toBe(1);
    // The share scan starts by reading the share records (services/share/provenance.ts openShares);
    // this node has none, so it asks for no candidate.
    const shareReads = (calls.get('listAllMemoryByKeyShape') ?? []).filter(a => a[1] === '.meta.share');
    expect(shareReads.length).toBe(1);
    expect(calls.get('workspaceProvenanceLinks') ?? []).toEqual([]);
  });

  it('a different window is a different population', async () => {
    calls.clear();
    const populations = transparency.provenancePopulations(storage, CONFIG);
    const week = await transparency.buildAiTransparencyReport(storage, { sinceDays: 7, labelPolicy: 'light', config: CONFIG, populations });
    const month = await transparency.buildAiTransparencyReport(storage, { sinceDays: 30, labelPolicy: 'light', config: CONFIG, populations });
    expect(week.unlabelled).toBe(0);
    expect(month.unlabelled).toBe(UNLABELLED);
    expect((calls.get('aiProvenanceFacets') ?? []).length).toBe(2);
  });
});
