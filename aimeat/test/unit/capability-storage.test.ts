import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { CapabilityRecord } from '../../src/storage/interface.js';

function makeCap(overrides: Partial<CapabilityRecord> = {}): CapabilityRecord {
  const id = 'cap-' + Math.random().toString(36).slice(2, 8);
  return {
    id,
    name: 'Test Cap',
    summary: 'A test capability',
    ownerGhii: 'testuser@test-node',
    visibility: 'public',
    scope: 'local',
    status: 'active',
    rejectionReason: null,
    deprecationMessage: null,
    replacedBy: null,
    source: { type: 'manual', ref: 'manual', version: '1.0.0' },
    authRequired: 'registered',
    callable: true,
    inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
    outputSchema: { type: 'object', properties: { r: { type: 'string' } } },
    exports: null,
    usage: 'AIMEAT.capabilities.invoke("' + id + '", { q: "hi" })',
    whenToUse: 'When testing',
    whenNotToUse: 'In production',
    examples: [{ description: 'Basic', input: { q: 'hi' }, output: { r: 'hello' } }],
    dependencies: [],
    schemaHash: 'abc123',
    webhookUrl: null,
    cost: null,
    trustRequired: null,
    trust: { operatorReviewed: false, reviewedAt: null, vouchCount: 0, publisherTrustScore: 0, codeAudited: false, auditNotes: null },
    redactedFields: [],
    operatorOverride: null,
    stats: { totalInvocations: 0, successCount: 0, errorCount: 0, lastInvokedAt: null, avgResponseMs: 0, lastError: null },
    tags: ['test'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('CapabilityRepository (SQLite)', () => {
  let s: SqliteStorage;
  beforeEach(() => { s = new SqliteStorage(':memory:'); });

  it('create and retrieve', async () => {
    const cap = makeCap();
    const created = await s.createCapability(cap);
    expect(created.id).toBe(cap.id);
    const got = await s.getCapability(cap.id);
    expect(got).not.toBeNull();
    expect(got!.name).toBe('Test Cap');
    expect(got!.source.type).toBe('manual');
    expect(got!.source.ref).toBe('manual');
    expect(got!.inputSchema).toEqual(cap.inputSchema);
    expect(got!.callable).toBe(true);
    expect(got!.tags).toEqual(['test']);
    expect(got!.trust.vouchCount).toBe(0);
  });

  it('get returns null for non-existent', async () => {
    expect(await s.getCapability('nope')).toBeNull();
  });

  it('list with visibility filter', async () => {
    await s.createCapability(makeCap({ visibility: 'public' }));
    await s.createCapability(makeCap({ visibility: 'private' }));
    const { capabilities: pub, total } = await s.listCapabilities({ visibility: 'public' });
    expect(pub).toHaveLength(1);
    expect(total).toBe(1);
  });

  it('list with callable filter', async () => {
    await s.createCapability(makeCap({ callable: true }));
    await s.createCapability(makeCap({ callable: false }));
    const { capabilities } = await s.listCapabilities({ callable: true });
    expect(capabilities).toHaveLength(1);
    expect(capabilities[0].callable).toBe(true);
  });

  it('list with tags filter', async () => {
    await s.createCapability(makeCap({ tags: ['weather', 'finland'] }));
    await s.createCapability(makeCap({ tags: ['internal'] }));
    const { capabilities } = await s.listCapabilities({ tags: ['weather'] });
    expect(capabilities).toHaveLength(1);
  });

  it('list with search', async () => {
    await s.createCapability(makeCap({ name: 'Weather Finland' }));
    await s.createCapability(makeCap({ name: 'Recipe Manager' }));
    const { capabilities } = await s.listCapabilities({ search: 'weather' });
    expect(capabilities).toHaveLength(1);
    expect(capabilities[0].name).toBe('Weather Finland');
  });

  it('list with pagination', async () => {
    for (let i = 0; i < 5; i++) await s.createCapability(makeCap());
    const { capabilities, total } = await s.listCapabilities({ page: 2, perPage: 2 });
    expect(capabilities).toHaveLength(2);
    expect(total).toBe(5);
  });

  it('list by owner', async () => {
    await s.createCapability(makeCap({ ownerGhii: 'alice@node' }));
    await s.createCapability(makeCap({ ownerGhii: 'bob@node' }));
    const caps = await s.listCapabilitiesByOwner('alice@node');
    expect(caps).toHaveLength(1);
    expect(caps[0].ownerGhii).toBe('alice@node');
  });

  it('getBySourceRef', async () => {
    await s.createCapability(makeCap({ source: { type: 'extension', ref: 'ext:weather:get', version: '1.0' } }));
    const found = await s.getCapabilityBySourceRef('ext:weather:get');
    expect(found).not.toBeNull();
    expect(found!.source.ref).toBe('ext:weather:get');
    expect(await s.getCapabilityBySourceRef('nope')).toBeNull();
  });

  it('listBySourceType', async () => {
    await s.createCapability(makeCap({ source: { type: 'extension', ref: 'ext:a', version: '1' } }));
    await s.createCapability(makeCap({ source: { type: 'action', ref: 'act:b', version: '1' } }));
    const exts = await s.listCapabilitiesBySourceType('extension');
    expect(exts).toHaveLength(1);
  });

  it('update', async () => {
    const cap = makeCap();
    await s.createCapability(cap);
    const updated = await s.updateCapability(cap.id, { summary: 'Updated summary', tags: ['updated'] });
    expect(updated).not.toBeNull();
    expect(updated!.summary).toBe('Updated summary');
    expect(updated!.tags).toEqual(['updated']);
    const got = await s.getCapability(cap.id);
    expect(got!.summary).toBe('Updated summary');
  });

  it('update non-existent returns null', async () => {
    expect(await s.updateCapability('nope', { summary: 'x' })).toBeNull();
  });

  it('delete', async () => {
    const cap = makeCap();
    await s.createCapability(cap);
    expect(await s.deleteCapability(cap.id)).toBe(true);
    expect(await s.getCapability(cap.id)).toBeNull();
  });

  it('delete non-existent returns false', async () => {
    expect(await s.deleteCapability('nope')).toBe(false);
  });

  it('incrementStats', async () => {
    const cap = makeCap();
    await s.createCapability(cap);
    await s.incrementCapabilityStats(cap.id, { success: 3, error: 1, totalMs: 600, lastError: 'timeout' });
    const got = await s.getCapability(cap.id);
    expect(got!.stats.successCount).toBe(3);
    expect(got!.stats.errorCount).toBe(1);
    expect(got!.stats.totalInvocations).toBe(4);
    expect(got!.stats.lastError).toBe('timeout');
    expect(got!.stats.avgResponseMs).toBe(150);

    await s.incrementCapabilityStats(cap.id, { success: 1, error: 0, totalMs: 200 });
    const got2 = await s.getCapability(cap.id);
    expect(got2!.stats.totalInvocations).toBe(5);
    expect(got2!.stats.successCount).toBe(4);
  });

  it('addLog and listLogs', async () => {
    const cap = makeCap();
    await s.createCapability(cap);
    await s.addCapabilityLog({
      id: 'log-1', capabilityId: cap.id, callerGhii: 'alice@node',
      input: { q: 'test' }, status: 'success', durationMs: 50, error: null,
      timestamp: new Date().toISOString(),
    });
    await s.addCapabilityLog({
      id: 'log-2', capabilityId: cap.id, callerGhii: 'alice@node',
      input: { q: 'fail' }, status: 'error', durationMs: 100, error: 'boom',
      timestamp: new Date().toISOString(),
    });
    const { logs, total } = await s.listCapabilityLogs(cap.id, {});
    expect(total).toBe(2);
    expect(logs).toHaveLength(2);

    const { logs: errors } = await s.listCapabilityLogs(cap.id, { status: 'error' });
    expect(errors).toHaveLength(1);
    expect(errors[0].error).toBe('boom');
  });

  it('deleteLogsBefore', async () => {
    const cap = makeCap();
    await s.createCapability(cap);
    await s.addCapabilityLog({ id: 'old', capabilityId: cap.id, callerGhii: 'a@n', input: {}, status: 'success', durationMs: 1, error: null, timestamp: '2020-01-01T00:00:00Z' });
    await s.addCapabilityLog({ id: 'new', capabilityId: cap.id, callerGhii: 'a@n', input: {}, status: 'success', durationMs: 1, error: null, timestamp: new Date().toISOString() });
    const deleted = await s.deleteCapabilityLogsBefore('2025-01-01T00:00:00Z');
    expect(deleted).toBe(1);
    const { total } = await s.listCapabilityLogs(cap.id, {});
    expect(total).toBe(1);
  });

  it('setOverride', async () => {
    const cap = makeCap();
    await s.createCapability(cap);
    await s.setCapabilityOverride(cap.id, { disabled: true, notes: 'Testing' });
    const got = await s.getCapability(cap.id);
    expect(got!.operatorOverride).toEqual({ disabled: true, notes: 'Testing' });

    await s.setCapabilityOverride(cap.id, null);
    const got2 = await s.getCapability(cap.id);
    expect(got2!.operatorOverride).toBeNull();
  });

  it('setTrust and vouchCount', async () => {
    const cap = makeCap();
    await s.createCapability(cap);
    await s.setCapabilityTrust(cap.id, { operatorReviewed: true, reviewedAt: new Date().toISOString() });
    await s.incrementVouchCount(cap.id);
    await s.incrementVouchCount(cap.id);
    const got = await s.getCapability(cap.id);
    expect(got!.trust.operatorReviewed).toBe(true);
    expect(got!.trust.vouchCount).toBe(2);

    await s.decrementVouchCount(cap.id);
    const got2 = await s.getCapability(cap.id);
    expect(got2!.trust.vouchCount).toBe(1);
  });
});
