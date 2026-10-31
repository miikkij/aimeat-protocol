/**
 * @file test/unit/extension-purchase-seller-target.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description ctx.buy (services/extension-purchase.ts) runs an extension-backed capability only as
 *   the extension its ref names in the SELLER's namespace. A ref that names nothing there ran after
 *   the settle as written, and the run read the bare name in the BUYER's namespace, so the buyer's
 *   own extension of that name ran with the seller's locked input and the
 *   EXTENSION_CAPABILITY_NOT_YOURS check was passed by (secaudit 2026-10-31 inv-20). It is refused now,
 *   before anything is charged, as the capability invoke route refuses it (EXTENSION_NOT_FOUND).
 *   Usage kept: a ref that names the seller's own extension is bought and run as that extension.
 * @usage cd aimeat && pnpm exec vitest run test/unit/extension-purchase-seller-target.test.ts
 * @version-history
 *   v1.0.0 -- 2026-10-31 -- Initial (secaudit 2026-10-31 inv-20).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CapabilityRecord, ExtensionRecord } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';

vi.mock('../../src/services/metered-access.js', () => ({ authoriseMeteredCall: vi.fn() }));

const { SqliteStorage } = await import('../../src/storage/providers/sqlite/index.js');
const { buyForExtension } = await import('../../src/services/extension-purchase.js');
const { authoriseMeteredCall } = await import('../../src/services/metered-access.js');
const { resolveExtensionForCall } = await import('../../src/services/component-versions.js');

const NODE = 'buy-node';
const config = { nodeId: NODE } as unknown as AimeatConfig;

function cap(id: string, ref: string): CapabilityRecord {
  const now = new Date().toISOString();
  return {
    id, name: id, summary: '', ownerGhii: `sally@${NODE}`, visibility: 'public', scope: 'local', status: 'active',
    rejectionReason: null, deprecationMessage: null, replacedBy: null,
    source: { type: 'extension', ref, version: '1.0.0' }, authRequired: 'registered', callable: true,
    inputSchema: null, outputSchema: null, exports: null, usage: '', whenToUse: '', whenNotToUse: '',
    examples: [], dependencies: [], schemaHash: 'x', webhookUrl: null, cost: null, trustRequired: null,
    trust: { operatorReviewed: false, reviewedAt: null, vouchCount: 0, publisherTrustScore: 0, codeAudited: false, auditNotes: null },
    redactedFields: [], operatorOverride: null,
    stats: { totalInvocations: 0, successCount: 0, errorCount: 0, lastInvokedAt: null, avgResponseMs: 0, lastError: null },
    tags: [], createdAt: now, updatedAt: now,
  } as CapabilityRecord;
}

function ext(name: string, installedBy: string): ExtensionRecord {
  const now = new Date().toISOString();
  return {
    name, version: '1.0.0', description: 'buy test', author: 'test', status: 'active', requiredApis: [],
    actions: [{ id: 'act', method: 'POST', path: '/act', inputSchema: {}, outputSchema: {}, scriptContent: 'export default async () => 1;' }],
    config: {}, limits: { memoryMb: 16, timeoutMs: 5000, maxApiCalls: 10 }, federation: { advertise: false, capabilities: [] },
    installedBy, installedAt: now,
  } as unknown as ExtensionRecord;
}

describe('ctx.buy and the extension a capability ref names', () => {
  let storage: InstanceType<typeof SqliteStorage>;
  const runs: Array<{ extRef: string; actionId: string; owner: string }> = [];
  const runSellerAction = vi.fn(async (run: { extRef: string; actionId: string; caller: { owner: string } }) => {
    runs.push({ extRef: run.extRef, actionId: run.actionId, owner: run.caller.owner });
    return { kind: 'ok' as const, result: { ran: run.extRef } };
  });
  const refund = vi.fn(async () => {});

  beforeEach(async () => {
    vi.clearAllMocks();
    runs.length = 0;
    vi.mocked(authoriseMeteredCall).mockResolvedValue({ kind: 'settled', charged: 4, refund, accrue: vi.fn(async () => null) } as never);
    storage = new SqliteStorage(':memory:');
    // The buyer's own extension under their own name, and a bare name nobody holds any more.
    await storage.createExtension(ext('bob/weather', 'bob') as never);
    await storage.recordReleasedComponentName!({ kind: 'extension', name: 'weather', holder: 'carol', releasedAt: new Date().toISOString() });
    await storage.createExtension(ext('sally/forecast', 'sally') as never);
    await storage.createCapability(cap('cap-dangling', 'ext:weather:act'));
    await storage.createCapability(cap('cap-own', 'ext:sally/forecast:act'));
    const now = new Date().toISOString();
    await storage.setMemory({
      key: 'apps.shop.html.tools', ownerGaii: `sally@${NODE}`, visibility: 'public', tags: [], ttlHours: null, version: 1, createdAt: now, updatedAt: now,
      value: { version: 1, tools: [
        { name: 'dangling', description: 'a ref the seller holds nothing for', action_id: 'cap-dangling', lockedInput: { op: 'delete-all' } },
        { name: 'own', description: 'the seller\'s own extension', action_id: 'cap-own' },
      ] },
    });
  });
  const buy = (tool: string) => buyForExtension({
    config, storage: storage as never, extName: 'buyerbot', extOwner: 'bob', appRef: 'sally/shop.html', tool, input: {}, runSellerAction: runSellerAction as never,
  });

  it('refuses a ref that names no extension of the seller, before it is charged', async () => {
    // The name the run would read for the buyer is the buyer's own extension.
    const forBuyer = await resolveExtensionForCall(storage as never, 'weather', 'bob');
    expect(forBuyer.ok && forBuyer.ext.installedBy).toBe('bob');
    const r = await buy('dangling');
    expect(r).toMatchObject({ ok: false, code: 'EXTENSION_NOT_FOUND' });
    expect(authoriseMeteredCall).not.toHaveBeenCalled();
    expect(runSellerAction).not.toHaveBeenCalled();
  });

  it('usage kept: the seller\'s own extension is bought and run as that extension', async () => {
    const r = await buy('own');
    expect(r).toMatchObject({ ok: true, charged: 4, result: { ran: 'sally/forecast' } });
    expect(runs).toEqual([{ extRef: 'sally/forecast', actionId: 'act', owner: 'bob' }]);
    expect(refund).not.toHaveBeenCalled();
  });
});
