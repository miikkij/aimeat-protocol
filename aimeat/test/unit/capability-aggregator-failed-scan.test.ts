/**
 * @file test/unit/capability-aggregator-failed-scan.test.ts
 * @description The capability scan's cleanup step (QA audit F2-01): a source type whose scan threw
 *   keeps every row exactly as it was (none disabled, none deleted), the result names the failed
 *   scan, an action row switches on again like the other kinds, and an insert of an id that
 *   already exists does not stop the scan.
 * @usage cd aimeat && pnpm exec vitest run test/unit/capability-aggregator-failed-scan.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-16 — Initial (QA audit F2-01).
 */
import { describe, it, expect } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage, CapabilityRecord } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';
import { runCapabilityAggregation } from '../../src/services/capability-aggregator.js';

const NODE = 'node-1';
const config = { nodeId: NODE } as AimeatConfig;

function row(id: string, type: string, status: 'active' | 'disabled' = 'active'): CapabilityRecord {
  const now = new Date().toISOString();
  return {
    id, name: id, summary: '', ownerGhii: `alice@${NODE}`, visibility: 'public', scope: 'local', status,
    rejectionReason: null, deprecationMessage: null, replacedBy: null,
    source: { type, ref: id, version: '1' }, authRequired: 'registered', callable: true,
    inputSchema: null, outputSchema: null, exports: null, usage: '', whenToUse: '', whenNotToUse: '',
    examples: [], dependencies: [], schemaHash: '', webhookUrl: null, cost: null, trustRequired: null,
    trust: { operatorReviewed: false, reviewedAt: null, vouchCount: 0, publisherTrustScore: 0, codeAudited: false, auditNotes: null },
    redactedFields: [], operatorOverride: null,
    stats: { totalInvocations: 0, successCount: 0, errorCount: 0, lastInvokedAt: null, avgResponseMs: 0, lastError: null },
    tags: [], createdAt: now, updatedAt: now,
  } as CapabilityRecord;
}

function fresh(): Storage {
  return new SqliteStorage(':memory:') as unknown as Storage;
}

describe('runCapabilityAggregation: a failed scan changes no row of its type', () => {
  it('an extension scan that throws leaves the extension rows active, twice over, and names the failure', async () => {
    const storage = fresh();
    await storage.createCapability(row('ext:weather:forecast', 'extension'));
    await storage.createCapability(row('ext:weather:alerts', 'extension', 'disabled'));
    (storage as unknown as { listExtensions: () => Promise<never> }).listExtensions = async () => { throw new Error('connection reset'); };

    const first = await runCapabilityAggregation(config, storage);
    expect(first.failedScans).toContain('extension');
    expect((await storage.getCapability('ext:weather:forecast'))?.status).toBe('active');
    expect((await storage.getCapability('ext:weather:alerts'))?.status).toBe('disabled');

    await runCapabilityAggregation(config, storage);
    expect((await storage.getCapability('ext:weather:forecast'))?.status).toBe('active');
    expect(await storage.getCapability('ext:weather:alerts')).not.toBeNull();
  });

  it('an action scan that throws leaves the action rows alone', async () => {
    const storage = fresh();
    await storage.createCapability(row('action:bot#alice@node-1:translate', 'action'));
    (storage as unknown as { listActions: () => Promise<never> }).listActions = async () => { throw new Error('timeout'); };
    for (let i = 0; i < 2; i++) await runCapabilityAggregation(config, storage);
    expect((await storage.getCapability('action:bot#alice@node-1:translate'))?.status).toBe('active');
  });

  it('a scan that completes still disables a row whose source is gone (the cleanup itself still works)', async () => {
    const storage = fresh();
    await storage.createCapability(row('ext:gone:act', 'extension'));
    const result = await runCapabilityAggregation(config, storage);
    expect(result.failedScans).toEqual([]);
    expect((await storage.getCapability('ext:gone:act'))?.status).toBe('disabled');
  });

  it('two good runs with live sources delete nothing', async () => {
    const storage = fresh();
    await storage.createCapability(row('cortex:keep', 'cortex'));
    (storage as unknown as { listCortexExtensions: () => Promise<unknown[]> }).listCortexExtensions = async () => [
      { name: 'keep', version: '1', description: '', installedBy: 'alice', visibility: 'public', components: [], tags: [] },
    ];
    await runCapabilityAggregation(config, storage);
    await runCapabilityAggregation(config, storage);
    expect((await storage.getCapability('cortex:keep'))?.status).toBe('active');
  });

  it('an app-tool manifest that cannot be read keeps that type\'s rows as they were', async () => {
    const storage = fresh();
    await storage.createCapability(row('app-tool:alice/notes:search', 'app-tool'));
    (storage as unknown as { listOwners: () => Promise<unknown[]> }).listOwners = async () => [{ name: 'alice' }];
    (storage as unknown as { listMemory: () => Promise<never> }).listMemory = async () => { throw new Error('disk'); };
    const result = await runCapabilityAggregation(config, storage);
    expect(result.failedScans).toContain('app-tool');
    expect((await storage.getCapability('app-tool:alice/notes:search'))?.status).toBe('active');
  });
});

describe('runCapabilityAggregation: rows switch on again and a duplicate id does not stop the scan', () => {
  it('a disabled action row whose action is published again becomes active', async () => {
    const storage = fresh();
    const ref = 'action:bot#alice@node-1:translate';
    await storage.createCapability(row(ref, 'action', 'disabled'));
    (storage as unknown as { listActions: () => Promise<unknown[]> }).listActions = async () => [
      { id: 'translate', providerGaii: 'bot#alice@node-1', displayName: 'Translate', description: '', updatedAt: '2', tags: [] },
    ];
    await runCapabilityAggregation(config, storage);
    expect((await storage.getCapability(ref))?.status).toBe('active');
  });

  it('a row whose id exists under another source ref is taken as existing, and the scan goes on to the next extension', async () => {
    const storage = fresh();
    const tampered = row('ext:first:go', 'extension');
    tampered.source = { type: 'extension', ref: 'ext:elsewhere:go', version: '1' };
    await storage.createCapability(tampered);
    (storage as unknown as { listExtensions: () => Promise<unknown[]> }).listExtensions = async () => [
      { name: 'first', status: 'active', version: '1', installedBy: 'alice', actions: [{ id: 'go' }] },
      { name: 'second', status: 'active', version: '1', installedBy: 'alice', actions: [{ id: 'go' }] },
    ];
    const result = await runCapabilityAggregation(config, storage);
    expect(result.failedScans).toEqual([]);
    expect(await storage.getCapability('ext:second:go')).not.toBeNull();
    const first = await storage.getCapability('ext:first:go');
    expect(first?.status).toBe('active');
    expect(first?.source.ref).toBe('ext:first:go');
  });
});
