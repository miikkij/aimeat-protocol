/**
 * @file test/unit/capability-aggregator-operator-disabled.test.ts
 * @description The capability scan's cleanup step leaves a row whose operatorOverride.disabled is set
 *   exactly as it is: the operator's switch, or the one the extension-ref boot step sets
 *   (services/capability-extension-ref.ts), is neither turned into the scan's own disable nor
 *   followed by a delete. An ordinary stale extension row is still disabled on one run and deleted
 *   on the next (secaudit2026oct22).
 * @usage cd aimeat && pnpm exec vitest run test/unit/capability-aggregator-operator-disabled.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-24 — Initial (secaudit2026oct22).
 */
import { describe, it, expect } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage, CapabilityRecord } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';
import { runCapabilityAggregation } from '../../src/services/capability-aggregator.js';

const NODE = 'node-1';
const config = { nodeId: NODE } as AimeatConfig;

function row(id: string, ref: string, status: 'active' | 'disabled', override: CapabilityRecord['operatorOverride']): CapabilityRecord {
  const now = new Date().toISOString();
  return {
    id, name: id, summary: '', ownerGhii: `alice@${NODE}`, visibility: 'owner', scope: 'local', status,
    rejectionReason: null, deprecationMessage: null, replacedBy: null,
    source: { type: 'extension', ref, version: '1' }, authRequired: 'registered', callable: true,
    inputSchema: null, outputSchema: null, exports: null, usage: '', whenToUse: '', whenNotToUse: '',
    examples: [], dependencies: [], schemaHash: '', webhookUrl: null, cost: null, trustRequired: null,
    trust: { operatorReviewed: false, reviewedAt: null, vouchCount: 0, publisherTrustScore: 0, codeAudited: false, auditNotes: null },
    redactedFields: [], operatorOverride: override,
    stats: { totalInvocations: 0, successCount: 0, errorCount: 0, lastInvokedAt: null, avgResponseMs: 0, lastError: null },
    tags: [], createdAt: now, updatedAt: now,
  } as CapabilityRecord;
}

const flag = { disabled: true, notes: 'Switched off at node start: its source ref names no extension action.' };

describe('runCapabilityAggregation: a row the operator switched off', () => {
  it('a flagged bad-ref row, active or already disabled, survives two runs unchanged', async () => {
    const storage = new SqliteStorage(':memory:') as unknown as Storage;
    await storage.createCapability(row('bad-active', 'ext:..:memory', 'active', flag));
    await storage.createCapability(row('bad-disabled', 'ext:x:y/z', 'disabled', flag));

    for (let i = 0; i < 2; i++) await runCapabilityAggregation(config, storage);

    const active = await storage.getCapability('bad-active');
    expect(active, 'the flagged active row is not deleted').not.toBeNull();
    expect(active?.status).toBe('active');
    expect(active?.operatorOverride).toMatchObject(flag);
    const disabled = await storage.getCapability('bad-disabled');
    expect(disabled, 'the flagged disabled row is not deleted').not.toBeNull();
    expect(disabled?.status).toBe('disabled');
    expect(disabled?.operatorOverride).toMatchObject(flag);
  });

  it('an ordinary stale extension row is disabled on the first run and deleted on the second', async () => {
    const storage = new SqliteStorage(':memory:') as unknown as Storage;
    await storage.createCapability(row('ext:gone-ext:act', 'ext:gone-ext:act', 'active', null));

    await runCapabilityAggregation(config, storage);
    expect((await storage.getCapability('ext:gone-ext:act'))?.status).toBe('disabled');
    await runCapabilityAggregation(config, storage);
    expect(await storage.getCapability('ext:gone-ext:act')).toBeNull();
  });
});
