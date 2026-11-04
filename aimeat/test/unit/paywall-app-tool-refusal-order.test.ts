/**
 * @file test/unit/paywall-app-tool-refusal-order.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The raw-invoke paywall (services/extension-access/paywall.ts) on an action that a priced
 *   app-tool sells. A call it refuses for a malformed or wrong product name, or for a money price with
 *   no contract held, is refused before the pacing is charged; a call settled on the caller's app-tool
 *   contract is paced once, by the contract at the metered chokepoint, and not again by the
 *   uncontracted pacing (secaudit 2026-10-31, f-secaudit2026oct31-extra-paywall-pacing-return).
 *   Usage kept: an uncontracted call to an action nothing sells is paced once and the provider is
 *   credited; an action only a free paced tool sells is paced at that tool's amount and runs.
 *   Real in-memory SQLite.
 * @usage cd aimeat && pnpm exec vitest run test/unit/paywall-app-tool-refusal-order.test.ts
 * @version-history
 *   v1.0.0 -- 2026-10-31 -- Initial (secaudit 2026-10-31, f-secaudit2026oct31-extra-paywall-pacing-return).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage, ExtensionRecord } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';
import { enforcePaywall } from '../../src/services/extension-access/paywall.js';
import { createRefusalRecorder } from '../../src/services/extension-access/metered-response.js';
import { persistEntitlement, type MeteredEntitlement } from '../../src/services/metered-entitlements.js';
import { clearCache } from '../../src/services/cache.js';

const NODE = 'paywall-tool-node';
const CALLER = `bob@${NODE}`;
const PROVIDER = `sally@${NODE}`;
const config = {
  nodeId: NODE, burnRate: 0, marketplaceFeeMode: 'burn', pacingTollDefault: 0, extensionMaxDebitPerCall: 1000,
  commerceFeePercent: 0,
} as unknown as AimeatConfig;

let storage: Storage;
async function person(ghii: string, balance: number): Promise<void> {
  const name = ghii.split('@')[0]!;
  await storage.createGHII({
    username: name, nodeId: NODE, ghii, displayName: name,
    verificationLevel: 0, ownerName: name, createdAt: '2026-10-31T00:00:00Z', updatedAt: '2026-10-31T00:00:00Z',
  } as never);
  if (balance > 0) await storage.creditBalance(ghii, balance);
}
const balanceOf = async (ghii: string): Promise<number> => Number((await storage.getGHII(ghii))?.morselBalance ?? 0);
const pacingRows = async (ghii: string, label: string) =>
  (await storage.getTransactions(ghii, 100))
    .filter(t => (t.type === 'pacing_charge' || t.type === 'pacing_burn') && (t.trackingCode ?? '').startsWith(`pacing:${label}:`));

/** An extension of sally's whose one action carries a pacing amount of 5 and no money price. */
const extNamed = (name: string) => ({
  name, installedBy: 'sally', status: 'active', config: {},
  actions: [{ id: 'run', method: 'POST', path: '/run', tollMorsels: 5 }],
} as unknown as ExtensionRecord);

async function manifest(appId: string, tools: Array<Record<string, unknown>>): Promise<void> {
  const now = new Date().toISOString();
  await storage.setMemory({
    key: `apps.${appId}.tools`, ownerGaii: PROVIDER, value: { tools },
    visibility: 'public', tags: [], ttlHours: null, version: 1, createdAt: now, updatedAt: now,
  } as never);
}

beforeEach(async () => {
  clearCache();
  storage = new SqliteStorage(':memory:') as unknown as Storage;
  await person(CALLER, 100);
  await person(PROVIDER, 0);
  // shop.html sells sally's `paidext/run` for money, with a pacing amount of 3.
  await manifest('shop.html', [
    { name: 'paid', action_id: 'ext:paidext:run', priceMoney: { amount: 20_000, currency: 'EUR' }, tollMorsels: 3 },
  ]);
});

const call = (ext: ExtensionRecord, extra: { namedAppTool?: string } = {}) => {
  const res = createRefusalRecorder();
  return enforcePaywall({ config, storage, ext, action: ext.actions[0]!, callerGaii: CALLER, res, ...extra })
    .then(out => ({ out, refusal: res.refusal }));
};
const codeOf = (refusal: { body?: unknown } | undefined) => (refusal?.body as { error?: { code?: string } })?.error?.code;

describe('a raw call to an action a priced app-tool sells, refused by the paywall', () => {
  const ext = extNamed('paidext');

  it('with a malformed product name, is refused before the pacing is charged', async () => {
    const { out, refusal } = await call(ext, { namedAppTool: 'no-slash' });
    expect(out.ok).toBe(false);
    expect(codeOf(refusal)).toBe('INVALID_APP_TOOL');
    expect(await balanceOf(CALLER)).toBe(100);
    expect(await pacingRows(CALLER, 'ext:paidext:run')).toHaveLength(0);
  });

  it('naming a product that does not sell it, is refused before the pacing is charged', async () => {
    const { out, refusal } = await call(ext, { namedAppTool: 'shop.html/other' });
    expect(out.ok).toBe(false);
    expect(codeOf(refusal)).toBe('APP_TOOL_MISMATCH');
    expect(await balanceOf(CALLER)).toBe(100);
    expect(await pacingRows(CALLER, 'ext:paidext:run')).toHaveLength(0);
  });

  it('with no contract for the money-priced tool, is refused before the pacing is charged', async () => {
    const { out, refusal } = await call(ext);
    expect(out.ok).toBe(false);
    expect(refusal?.status).toBe(402);
    expect(codeOf(refusal)).toBe('PAYMENT_REQUIRED');
    expect(await balanceOf(CALLER)).toBe(100);
    expect(await balanceOf(PROVIDER)).toBe(0);
    expect(await pacingRows(CALLER, 'ext:paidext:run')).toHaveLength(0);
  });
});

describe('a raw call settled on the caller\'s app-tool contract', () => {
  it('is paced once, by the contract, and not again as an uncontracted call', async () => {
    const now = new Date().toISOString();
    const ent: MeteredEntitlement = {
      entitlementId: randomUUID(), consumerGaii: CALLER, appId: null, providerGhii: PROVIDER,
      ext: 'apptool:sally/shop.html', action: 'paid', capabilityLabel: 'shop.html/paid', unit: 'morsels', pricePerCall: 4,
      currency: null, pricing: { model: 'per_call' }, budget: { capUnits: null, spentUnits: 0, calls: 0 }, rakePercent: 0,
      tollMorsels: 3, contractRef: 'test:shop.paid', escrowParty: null, state: 'active',
      createdAt: now, createdBy: CALLER, updatedAt: now,
    };
    await persistEntitlement(storage, ent);
    const { out } = await call(extNamed('paidext'));
    expect(out.ok).toBe(true);
    // The contract's pacing (3) and its per-call amount (4); the action's own 5 is not charged on top.
    expect(await balanceOf(CALLER)).toBe(93);
    expect(await balanceOf(PROVIDER)).toBe(7);
    expect(await pacingRows(CALLER, 'ext:paidext:run')).toHaveLength(0);
    expect(await pacingRows(CALLER, 'shop.html/paid')).toHaveLength(1);
  });
});

describe('usage kept', () => {
  it('an action nothing sells is paced once at its own amount, and the provider is credited', async () => {
    const { out } = await call(extNamed('plainext'));
    expect(out.ok).toBe(true);
    expect(await balanceOf(CALLER)).toBe(95);
    expect(await balanceOf(PROVIDER)).toBe(5);
    expect(await pacingRows(CALLER, 'ext:plainext:run')).toHaveLength(1);
  });

  it('an action only a free paced tool sells is paced at that tool\'s amount and runs', async () => {
    await manifest('free.html', [{ name: 'look', action_id: 'ext:pacedext:run', tollMorsels: 8 }]);
    const { out } = await call(extNamed('pacedext'));
    expect(out.ok).toBe(true);
    // 5 at the uncontracted pacing, 3 more to reach the tool's 8.
    expect(await balanceOf(CALLER)).toBe(92);
    expect(await balanceOf(PROVIDER)).toBe(8);
  });

  it('a malformed product name on an action nothing sells is not asked about', async () => {
    const { out } = await call(extNamed('plainext'), { namedAppTool: 'no-slash' });
    expect(out.ok).toBe(true);
    expect(await balanceOf(CALLER)).toBe(95);
  });
});
