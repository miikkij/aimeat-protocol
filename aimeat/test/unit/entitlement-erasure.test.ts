/**
 * @file test/unit/entitlement-erasure.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Erasing an account revokes the exchange contracts and grants it is a party to, through
 *   eraseOwner (services/owner-erasure.ts), the whole of DELETE /v1/owners/:name below HTTP. Contracts
 *   and grants are keyed by a hash of the consumer's owner GHII, and an erased account name is released
 *   for reuse, so a record that stays active authorises the next person to register the name.
 *   - Revoked: bob's own contract and grant on one coordinate, his agent's contract, a contract stored
 *     under a caller-keyed key from before v1.7.0 of metered-entitlements.ts (revoked in place, no copy
 *     written to bob's owner key), carol's contract with bob as the provider, and the grant bob issued
 *     to carol.
 *   - Not touched: bobby's contract (a name that starts with `bob`), the contract of bob@other-node (a
 *     different person on another node), and a contract of bob's that was already revoked (its
 *     updatedAt stays).
 *   - A new bob@<node> on the same coordinates is not authorised by any read path.
 *   - The history namespace is not written.
 *   Runs on SQLite in memory, and on Postgres too when DATABASE_URL is set (names carry a run tag there).
 * @usage cd aimeat && pnpm exec vitest run test/unit/entitlement-erasure.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-01 — Initial: erasure left exchange contracts and grants active for a reused name.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { createStorage } from '../../src/storage/storage-factory.js';
import type { Storage } from '../../src/storage/interface.js';
import { eraseOwner } from '../../src/services/owner-erasure.js';
import {
  authorizeAndCharge, entitlementKey, grantKey, issueGrant, persistEntitlement, readContractForCall,
  readEntitlementForCall, readGrantForCall, NS_ENTITLEMENT, NS_GRANT_PUBLIC, type MeteredEntitlement,
} from '../../src/services/metered-entitlements.js';

type TestStorage = Storage & { close(): void | Promise<void> };
const names = ['sqlite', ...(process.env.DATABASE_URL ? ['postgres-kysely'] : [])];
const providers = new Map<string, TestStorage>();
beforeAll(async () => {
  for (const name of names) providers.set(name, await createStorage({
    provider: name === 'sqlite' ? 'sqlite' : 'postgres-kysely',
    sqlitePath: ':memory:', dbUrl: process.env.DATABASE_URL,
  }) as TestStorage);
}, 60_000);
afterAll(async () => { for (const s of providers.values()) await s.close(); });

const NODE = 'erasure-test';
const OTHER = 'other-node';
const now = new Date().toISOString();
const OLD = '2026-01-01T00:00:00.000Z';

/** A bought contract, written the way createEntitlement writes one, without its account events. */
function contract(consumerGaii: string, providerGhii: string, ext: string, action: string): MeteredEntitlement {
  return {
    entitlementId: randomUUID(), consumerGaii, appId: null, providerGhii, ext, action,
    capabilityLabel: `${ext}/${action}`, unit: 'morsels', pricePerCall: 1, currency: null,
    pricing: { model: 'per_call' }, budget: { capUnits: null, spentUnits: 3, calls: 3 }, rakePercent: null,
    contractRef: `test:${ext}.${action}`, escrowParty: null, state: 'active',
    createdAt: now, createdBy: consumerGaii, updatedAt: now,
  };
}

describe.each(names)('%s: erasing an account revokes its exchange contracts and grants', provider => {
  it('revokes what the account consumed and provided; leaves other people and other nodes', async () => {
    const s = providers.get(provider)!;
    const tag = provider === 'sqlite' ? '' : `-${randomUUID().slice(0, 8)}`;
    const bob = `bob${tag}`, alice = `alice${tag}`, carol = `carol${tag}`, bobby = `bobby${tag}`;
    const bobG = `${bob}@${NODE}`, aliceG = `${alice}@${NODE}`, carolG = `${carol}@${NODE}`;
    const bobbyG = `${bobby}@${NODE}`, bobAgent = `helper#${bob}@${NODE}`, bobRemote = `${bob}@${OTHER}`;
    const ext = `ext${tag}`;
    for (const name of [alice, bob, carol, bobby]) {
      await s.createOwner({ name, displayName: name, publicKey: 'pk', roles: ['owner'], createdAt: now });
      await s.createGHII({ ghii: `${name}@${NODE}`, username: name, nodeId: NODE, ownerName: name, displayName: name,
        verificationLevel: 0, totpEnabled: false, createdAt: now, updatedAt: now });
    }

    // Revoked by the erasure.
    await persistEntitlement(s, contract(bobG, aliceG, ext, 'a'));                       // bob consumes, paid
    await issueGrant(s, { consumerGaii: bobG, providerGhii: aliceG, ext, action: 'a', unit: 'morsels',
      listPricePerCall: 2, grantedBy: aliceG });                                           // bob consumes, granted
    await persistEntitlement(s, contract(bobAgent, aliceG, ext, 'b'));                   // bob's agent consumes
    const legacy = contract(bobAgent, aliceG, ext, 'd');                                 // pre-v1.7.0 caller key
    const legacyKey = `entitlement.${createHash('sha256').update(`${bobAgent}|${ext}|d`).digest('hex').slice(0, 32)}`;
    await s.setMemory({ key: legacyKey, ownerGaii: NS_ENTITLEMENT, value: legacy, visibility: 'private',
      tags: ['metered-entitlement'], ttlHours: null, version: 1, createdAt: now, updatedAt: now });
    await persistEntitlement(s, contract(carolG, bobG, ext, 'c'));                       // bob provides, paid
    await issueGrant(s, { consumerGaii: carolG, providerGhii: bobG, ext, action: 'g', unit: 'morsels',
      listPricePerCall: 2, grantedBy: bobG });                                             // bob provides, granted
    // Not touched.
    await persistEntitlement(s, contract(bobbyG, aliceG, ext, 'a'));
    await persistEntitlement(s, contract(bobRemote, aliceG, ext, 'a'));
    await persistEntitlement(s, { ...contract(bobG, aliceG, ext, 'e'), state: 'revoked', updatedAt: OLD });

    const history = async () => (await s.listAllMemory({ ownerPrefix: 'metered-entitlement-history', prefix: 'me-hist.' }))
      .items.filter(r => r.ownerGaii === 'metered-entitlement-history').length;
    const historyBefore = await history();

    // NEGATIVE CONTROL: before the erasure, bob is authorised on both of his coordinates.
    expect((await readEntitlementForCall(s, bobG, ext, 'a'))?.state).toBe('active');
    expect((await readEntitlementForCall(s, bobG, ext, 'b'))?.state).toBe('active');
    expect((await readEntitlementForCall(s, carolG, ext, 'c'))?.state).toBe('active');

    try {
      const { deletionLog } = await eraseOwner(s, NODE, bob);

      // (a) What bob consumed: the contract, the grant, the agent's contract, the caller-keyed row.
      expect((await readContractForCall(s, bobG, ext, 'a'))?.state).toBe('revoked');
      expect((await readGrantForCall(s, bobG, ext, 'a'))?.state).toBe('revoked');
      expect((await readContractForCall(s, bobAgent, ext, 'b'))?.state).toBe('revoked');
      expect(((await s.getMemory(NS_ENTITLEMENT, legacyKey))?.value as MeteredEntitlement).state).toBe('revoked');
      expect(await s.getMemory(NS_ENTITLEMENT, entitlementKey(bobG, ext, 'd'))).toBeNull();
      // (b) What bob provided: carol's contract with him and the grant he issued her.
      expect((await readContractForCall(s, carolG, ext, 'c'))?.state).toBe('revoked');
      expect((await readGrantForCall(s, carolG, ext, 'g'))?.state).toBe('revoked');
      // The records are kept for the other party: spend and carried cost survive.
      expect((await readContractForCall(s, carolG, ext, 'c'))?.budget.calls).toBe(3);
      // 4 as consumer + 2 as provider; the already-revoked row is not counted.
      expect(deletionLog).toContain('entitlements:6');

      // (c) A new person registering the name bob gets the same GHII and the same keys: nothing authorises.
      for (const action of ['a', 'b', 'd', 'e']) {
        const e = await readEntitlementForCall(s, bobG, ext, action);
        expect(e === null || e.state !== 'active').toBe(true);
        expect((await authorizeAndCharge(s, bobG, ext, action)).ok).toBe(false);
      }

      // POSITIVE CONTROL: other people, another node, and the already-revoked row.
      expect((await readContractForCall(s, bobbyG, ext, 'a'))?.state).toBe('active');
      expect((await readContractForCall(s, bobRemote, ext, 'a'))?.state).toBe('active');
      expect((await readContractForCall(s, bobG, ext, 'e'))?.updatedAt).toBe(OLD);
      expect(await history()).toBe(historyBefore);
    } finally {
      for (const name of [alice, carol, bobby, bob]) await eraseOwner(s, NODE, name);
      const refs = [
        ...[[bobG, 'a'], [bobG, 'b'], [bobG, 'e'], [carolG, 'c'], [bobbyG, 'a'], [bobRemote, 'a']]
          .map(([who, action]) => ({ ownerGaii: NS_ENTITLEMENT, key: entitlementKey(who, ext, action) })),
        { ownerGaii: NS_ENTITLEMENT, key: legacyKey },
        { ownerGaii: NS_GRANT_PUBLIC, key: grantKey(bobG, ext, 'a') },
        { ownerGaii: NS_GRANT_PUBLIC, key: grantKey(carolG, ext, 'g') },
      ];
      if (s.bulkDeleteMemory) await s.bulkDeleteMemory(refs);
      else for (const r of refs) await s.deleteMemory(r.ownerGaii, r.key);
    }
  }, 60_000);
});
