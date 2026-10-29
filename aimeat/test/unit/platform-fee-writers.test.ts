/**
 * @file test/unit/platform-fee-writers.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The once-only start step over the old `commerce.platform-fee.*` records
 *   (commerce/platform-fee-writers.ts): a record that an account or an agent wrote into its own memory
 *   (the write tally names the account, the value is not the node's, or the namespace is an agent's) is
 *   marked and leaves the dashboard's money fee total; a record in an operator's account counts as
 *   before without a question; a node-shaped record in another account whose writer nothing shows goes
 *   to the Security page as an entry, counted until the operator decides "uncount" or "keep". Nothing
 *   is deleted, and the step runs once. The node's own fee writes keep counting.
 * @usage cd aimeat && pnpm exec vitest run test/unit/platform-fee-writers.test.ts
 * @version-history
 *   2026-10-29 -- Initial (secaudit2026oct26 round 8c, routes/admin.ts:dashboard:any-namespace-platform-fee-records).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';
import { putRecord, sumPlatformFees, recordMoneyPlatformFee } from '../../src/commerce/platform-fee.js';
import { markPlatformFeeWritersOnce, PLATFORM_FEE_INCIDENT_TYPE } from '../../src/commerce/platform-fee-writers.js';
import { listSecurityIncidents } from '../../src/services/security-incident.js';
import { decideIncidentCase } from '../../src/services/incident-decisions.js';
import { listAllMemoryPages } from '../../src/storage/memory-pages.js';
import { resetOperatorFeeCache } from '../../src/services/marketplace-fee.js';

const NODE = 'fee-writers-node';
const config = { nodeId: NODE, baseUrl: 'https://node.test' } as unknown as AimeatConfig;
const g = (name: string) => `${name}@${NODE}`;

/** What recordMoneyPlatformFee writes for a sale. */
const nodeShaped = (tc: string, fee: number, seller: string) => ({
  fee, currency: 'EUR', mode: 'receivable', handler: 'test.money', sellerGhii: seller, buyerGhii: g('buyer'), trackingCode: tc, at: new Date().toISOString(),
});

async function total(storage: Storage): Promise<number> {
  const { items } = await listAllMemoryPages(storage, { prefix: 'commerce.platform-fee.' });
  return sumPlatformFees(items).EUR ?? 0;
}

describe('the old platform-fee records', () => {
  let storage: Storage;
  beforeEach(async () => {
    resetOperatorFeeCache();
    storage = new SqliteStorage(':memory:') as unknown as Storage;
    const at = new Date().toISOString();
    for (const [name, roles] of [['opr', ['owner', 'operator']], ['alice', ['owner']], ['bob', ['owner']], ['carol', ['owner']]] as const) {
      await storage.createOwner({ name, displayName: name, publicKey: 'pk', roles: [...roles], createdAt: at } as never);
    }
    // A sale's fee, under the operator.
    await putRecord(storage, g('opr'),'commerce.platform-fee.tc-real', nodeShaped('tc-real', 1_000_000, g('shop')));
    // Alice wrote a node-shaped record through a memory route: the tally names her.
    await putRecord(storage, g('alice'), 'commerce.platform-fee.tc-alice', nodeShaped('tc-alice', 50_000_000, g('alice')));
    await storage.upsertMemoryWriteTally([{ ownerGaii: g('alice'), key: 'commerce.platform-fee.tc-alice', writerPrincipal: g('alice'), writeCount: 1, deleteCount: 0, at: new Date().toISOString() }]);
    // Bob wrote one that is not the node's shape.
    await putRecord(storage, g('bob'), 'commerce.platform-fee.x', { fee: 20_000_000, currency: 'EUR' });
    // Carol's looks like a sale's fee under the seller, and nothing shows who wrote it.
    await putRecord(storage, g('carol'), 'commerce.platform-fee.tc-carol', nodeShaped('tc-carol', 3_000_000, g('carol')));
    // An agent's own namespace.
    await putRecord(storage, `bot#bob@${NODE}`, 'commerce.platform-fee.y', nodeShaped('y', 7_000_000, g('bob')));
  });

  it('marks what another writer wrote, leaves the operator\'s alone, and asks about the rest', async () => {
    // Before: the dashboard counts alice's and bob's records (the defect).
    expect(await total(storage)).toBe(1_000_000 + 50_000_000 + 20_000_000 + 3_000_000);

    const out = await markPlatformFeeWritersOnce(storage, config);
    expect(out?.marked.map(m => m.owner).sort()).toEqual([g('alice'), g('bob'), `bot#bob@${NODE}`].sort());
    expect(out?.operators).toBe(1);
    expect(out?.asked).toEqual([`${g('carol')}/commerce.platform-fee.tc-carol`]);
    expect(await total(storage)).toBe(1_000_000 + 3_000_000);
    // Nothing is deleted, and the mark keeps the record's metadata.
    const alice = await storage.getMemory(g('alice'), 'commerce.platform-fee.tc-alice');
    expect((alice?.value as { notCounted?: { reason: string } }).notCounted?.reason).toContain('memory route');
    expect(alice?.visibility).toBe('owner');

    const incidents = (await listSecurityIncidents(storage, config)).items.filter(i => i.type === PLATFORM_FEE_INCIDENT_TYPE);
    expect(incidents).toHaveLength(1);
    expect(incidents[0]!.entries?.map(e => [e.id, e.action, e.status])).toEqual([[`${g('carol')}/commerce.platform-fee.tc-carol`, 'uncount', 'open']]);

    const decided = await decideIncidentCase(config, storage, {
      incidentId: incidents[0]!.id, name: `${g('carol')}/commerce.platform-fee.tc-carol`, resolution: 'uncount', by: { principal: g('opr'), kind: 'human' },
    });
    expect(decided).toMatchObject({ ok: true, data: { incident_status: 'resolved' } });
    expect(await total(storage)).toBe(1_000_000);
    expect(await storage.getMemory(g('carol'), 'commerce.platform-fee.tc-carol')).not.toBeNull();

    expect(await markPlatformFeeWritersOnce(storage, config)).toBeNull();
  });

  it('"keep" counts the record, and the node\'s own fee after the step counts', async () => {
    await markPlatformFeeWritersOnce(storage, config);
    const incident = (await listSecurityIncidents(storage, config)).items.find(i => i.type === PLATFORM_FEE_INCIDENT_TYPE)!;
    await decideIncidentCase(config, storage, { incidentId: incident.id, name: `${g('carol')}/commerce.platform-fee.tc-carol`, resolution: 'keep', by: { principal: g('opr'), kind: 'human' } });
    expect(await total(storage)).toBe(1_000_000 + 3_000_000);
    await recordMoneyPlatformFee(storage, config, { fee: 500_000, currency: 'EUR', sellerGhii: g('shop'), buyerGhii: g('buyer'), trackingCode: 'tc-later', handler: 'test.money' });
    expect(await total(storage)).toBe(1_000_000 + 3_000_000 + 500_000);
  });
});
