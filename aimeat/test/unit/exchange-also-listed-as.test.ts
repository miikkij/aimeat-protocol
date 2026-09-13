/**
 * @file test/unit/exchange-also-listed-as.test.ts
 * @description An owner who flags an extension action for EXCHANGE AND flags an app-tool bound to that
 *   same action used to get two listings for one call. The two coordinates never collide (`kaiku/search`
 *   and `apptool:seller/shop.html/find`), so the key-based DUPLICATE_OF guard never saw it. The developer
 *   decided on 2026-09-13: LIST ONCE. When the tool sells the action as it is (no `lockedInput`), only the
 *   tool is listed and the extension action is skipped with `DUPLICATE_OF {app}/{tool}`; a listing it
 *   already had is delisted, and a contract signed against that listing keeps resolving at its agreed
 *   price. When the tool fixes part of the input it is a different product: both stay listed and each
 *   side carries an ALSO_LISTED_AS warning naming the other.
 * @usage cd aimeat && pnpm exec vitest run test/unit/exchange-also-listed-as.test.ts
 * @version-history
 *   v2.0.0 — 2026-09-13 — List once (the developer's decision): the extension action is skipped for a
 *     tool that does not narrow it, on the full, the app-scoped and the extension-scoped pass; its
 *     contracts survive the delisting; ALSO_LISTED_AS remains for a narrowing tool and a hand-made listing.
 *   v1.0.0 — 2026-09-13 — Initial (appdev pitfall exchange-flag-in-two-places-lists-twice).
 */
import { describe, it, expect } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage, ExtensionRecord } from '../../src/storage/interface.js';
import { reconcileOwnerOfferings, type ReconcileChange } from '../../src/services/exchange-projection.js';
import { getOffering, putOffering, newOfferingId, resolveOfferingPricing } from '../../src/services/exchange-market.js';
import { createEntitlement, readEntitlementForCall, computeCharge } from '../../src/services/metered-entitlements.js';

const NODE = 'node-x';
const OWNER = 'seller';
const GHII = `${OWNER}@${NODE}`;
const APP = 'shop.html';
const EXT = 'kaiku';
const IN = { type: 'object', properties: { q: { type: 'string' } } };
const OUT = { type: 'object', properties: { a: { type: 'string' } } };

function extension(exchange: boolean): ExtensionRecord {
  return {
    name: EXT, version: '1.0.0', description: 'signals', author: OWNER, status: 'active', requiredApis: [],
    actions: ['search', 'other'].map(id => ({
      id, method: 'POST', path: `/${id}`, inputSchema: IN, outputSchema: OUT, scriptContent: '',
      commercial: { payMorsels: 3, exchange },
    })),
    config: {}, limits: { memoryMb: 64, timeoutMs: 5000, maxApiCalls: 10 },
    federation: { advertise: false, capabilities: [] },
    installedBy: OWNER, installedAt: new Date().toISOString(),
  };
}

const boundTool = (over: Record<string, unknown> = {}) => ({
  name: 'find', action_id: `ext:${EXT}:search`, inputSchema: IN, outputSchema: OUT,
  price: { morsels: 5 }, exchange: true, ...over,
});

async function writeTools(storage: Storage, tools: unknown[], app = APP): Promise<void> {
  const now = new Date().toISOString();
  await storage.setMemory({
    key: `apps.${app}.tools`, ownerGaii: GHII, value: { version: 1, tools }, visibility: 'public',
    tags: ['app-tools'], ttlHours: null, version: 1, createdAt: now, updatedAt: now,
  });
}

async function store(extFlagged: boolean, tools: unknown[]): Promise<Storage> {
  const storage = new SqliteStorage(':memory:') as unknown as Storage;
  await storage.createExtension(extension(extFlagged));
  await writeTools(storage, tools);
  return storage;
}

const warnings = (rows: ReconcileChange[]) => rows.filter(c => c.action === 'warning' && String(c.reason).startsWith('ALSO_LISTED_AS'));
const row = (rows: ReconcileChange[], action: ReconcileChange['action'], label: string) => rows.filter(c => c.action === action && c.label === label);
const listedAction = async (storage: Storage) => (await reconcileOwnerOfferings(storage, GHII, { dryRun: true }))
  .changes.filter(c => c.label === `${EXT}/search` && ['created', 'updated', 'unchanged', 'adopted'].includes(c.action));

describe('list once: a tool that sells the extension action as it is', () => {
  it('a full reconcile lists the tool and skips the action with DUPLICATE_OF', async () => {
    const storage = await store(true, [boundTool()]);
    const report = await reconcileOwnerOfferings(storage, GHII);

    expect(row(report.changes, 'created', `${APP}/find`), 'the app-tool lists').toHaveLength(1);
    expect(row(report.changes, 'created', `${EXT}/search`), 'the extension action does not').toEqual([]);
    const skip = row(report.changes, 'skipped', `${EXT}/search`);
    expect(skip).toHaveLength(1);
    expect(skip[0]).toMatchObject({ kind: 'ext-action', reason: `DUPLICATE_OF ${APP}/find` });
    expect(skip[0].message).toContain(`${APP}/find`);
    expect(warnings(report.changes), 'nothing is listed twice, so nothing to warn about').toEqual([]);
    // The other action of the same extension is nobody's duplicate and lists as before.
    expect(row(report.changes, 'created', `${EXT}/other`)).toHaveLength(1);
  });

  it('publishing the tool (the app-scoped pass) delists the action it already had, and says both', async () => {
    const storage = await store(true, [boundTool({ exchange: false })]);
    const first = await reconcileOwnerOfferings(storage, GHII);
    const actId = row(first.changes, 'created', `${EXT}/search`)[0]?.offeringId;
    expect(actId, 'the action listed while the tool was not flagged').toBeTruthy();

    await writeTools(storage, [boundTool()]);
    const scoped = await reconcileOwnerOfferings(storage, GHII, { appId: APP });
    expect(row(scoped.changes, 'created', `${APP}/find`)).toHaveLength(1);
    expect(row(scoped.changes, 'skipped', `${EXT}/search`)[0]?.reason).toBe(`DUPLICATE_OF ${APP}/find`);
    expect(scoped.changes.filter(c => c.action === 'delisted').map(c => c.offeringId)).toEqual([actId]);
    expect((await getOffering(storage, actId!))?.state).toBe('delisted');
    // The unrelated action of the same extension is not this pass's business and says nothing.
    expect(scoped.changes.filter(c => c.label === `${EXT}/other`)).toEqual([]);
    expect(await listedAction(storage), 'a full pass agrees afterwards').toEqual([]);
  });

  it('installing the extension after the tool (the extension-scoped pass) never lists the action', async () => {
    const storage = await store(false, [boundTool()]);
    await reconcileOwnerOfferings(storage, GHII, { appId: APP });
    await storage.updateExtension(EXT, { actions: extension(true).actions });
    const scoped = await reconcileOwnerOfferings(storage, GHII, { extName: EXT });
    expect(row(scoped.changes, 'created', `${EXT}/search`)).toEqual([]);
    expect(row(scoped.changes, 'skipped', `${EXT}/search`)[0]?.reason).toBe(`DUPLICATE_OF ${APP}/find`);
    expect(row(scoped.changes, 'created', `${EXT}/other`)).toHaveLength(1);
  });

  it('turning the tool off brings the action back under the SAME offering id', async () => {
    const storage = await store(true, [boundTool({ exchange: false })]);
    const actId = row((await reconcileOwnerOfferings(storage, GHII)).changes, 'created', `${EXT}/search`)[0]!.offeringId;
    await writeTools(storage, [boundTool()]);
    await reconcileOwnerOfferings(storage, GHII, { appId: APP });
    await writeTools(storage, [boundTool({ exchange: false })]);
    const back = await reconcileOwnerOfferings(storage, GHII, { appId: APP });
    expect(row(back.changes, 'updated', `${EXT}/search`).map(c => c.offeringId)).toEqual([actId]);
    expect((await getOffering(storage, actId!))?.state).toBe('listed');
  });

  it('rebinding the tool to another action releases the first one in the same app pass', async () => {
    const storage = await store(true, [boundTool()]);
    await reconcileOwnerOfferings(storage, GHII);
    await writeTools(storage, [boundTool({ action_id: `ext:${EXT}:other` })]);
    const moved = await reconcileOwnerOfferings(storage, GHII, { appId: APP });
    expect(row(moved.changes, 'created', `${EXT}/search`), 'the released action lists').toHaveLength(1);
    expect(row(moved.changes, 'skipped', `${EXT}/other`)[0]?.reason).toBe(`DUPLICATE_OF ${APP}/find`);
    expect(moved.changes.filter(c => c.action === 'delisted' && c.label === `${EXT}/other`)).toHaveLength(1);
  });

  it('a tool that is flagged but cannot list (no output schema) takes nothing off the market', async () => {
    const storage = await store(true, [boundTool({ outputSchema: undefined })]);
    const report = await reconcileOwnerOfferings(storage, GHII);
    expect(row(report.changes, 'skipped', `${APP}/find`)[0]?.reason).toBe('SCHEMA_REQUIRED');
    expect(row(report.changes, 'created', `${EXT}/search`)).toHaveLength(1);
  });

  it('one skipped row per action, not one per currency row of it', async () => {
    const storage = new SqliteStorage(':memory:') as unknown as Storage;
    const ext = extension(true);
    ext.actions[0]!.commercial = { payMorsels: 0, payMoney: { amount: 10_000, currency: 'EUR' }, pricesMoney: [{ amount: 10_000, currency: 'EUR' }, { amount: 12_000, currency: 'USD' }], exchange: true };
    await storage.createExtension(ext);
    await writeTools(storage, [boundTool()]);
    const report = await reconcileOwnerOfferings(storage, GHII);
    expect(row(report.changes, 'skipped', `${EXT}/search`)).toHaveLength(1);
  });

  it('a contract signed against the delisted action keeps resolving, at its agreed price', async () => {
    const storage = await store(true, [boundTool({ exchange: false })]);
    const actId = row((await reconcileOwnerOfferings(storage, GHII)).changes, 'created', `${EXT}/search`)[0]!.offeringId!;
    const offering = (await getOffering(storage, actId))!;
    const priced = await resolveOfferingPricing(storage, offering, null);
    if (!priced.ok) throw new Error(priced.message);
    const signed = await createEntitlement(storage, {
      consumerGaii: `buyer@${NODE}`, providerGhii: GHII, ext: priced.ext, action: priced.action,
      unit: priced.unit, pricePerCall: priced.pricePerCall, currency: priced.currency, pricing: priced.pricing,
      contractRef: `offering:${actId}`, surface: priced.surface, createdBy: 'buyer',
    });

    await writeTools(storage, [boundTool()]);
    // The extension reprices after the delisting; the contract must not follow it.
    const ext = extension(true);
    ext.actions[0]!.commercial = { payMorsels: 9, exchange: true };
    await storage.updateExtension(EXT, { actions: ext.actions });
    await reconcileOwnerOfferings(storage, GHII);
    expect((await getOffering(storage, actId))?.state).toBe('delisted');

    const held = await readEntitlementForCall(storage, `buyer@${NODE}`, EXT, 'search');
    expect(held).toMatchObject({
      entitlementId: signed.entitlementId, state: 'active', pricePerCall: 3, unit: 'morsels', contractRef: `offering:${actId}`,
    });
    expect(computeCharge(held!, Date.now()).chargeUnits, 'the next call is charged the price signed').toBe(3);
  });

  it('a listing made by hand is never delisted by the projection; the owner is told how to retire it', async () => {
    const storage = await store(false, [boundTool()]);
    const now = new Date().toISOString();
    const hand = await putOffering(storage, {
      offeringId: newOfferingId(), providerGhii: GHII, providerOwner: OWNER, kind: 'ext-action', ext: EXT, action: 'search',
      surface: null, title: 'by hand', description: '', unit: 'morsels', basePrice: 3, currency: null, plans: [],
      provenance: null, odps: null, usageTerms: { derivatives: true, resale: false, attribution: true },
      tags: [], state: 'listed', createdAt: now, updatedAt: now,
    });
    await storage.updateExtension(EXT, { actions: extension(true).actions });
    const report = await reconcileOwnerOfferings(storage, GHII);
    expect(row(report.changes, 'skipped', `${EXT}/search`)[0]?.reason).toBe(`DUPLICATE_OF ${APP}/find`);
    expect(report.changes.filter(c => c.offeringId === hand.offeringId && c.action === 'delisted')).toEqual([]);
    const onTool = warnings(report.changes).find(r => r.label === `${APP}/find`);
    expect(onTool?.reason).toBe(`ALSO_LISTED_AS ${EXT}/search`);
    expect(onTool?.message).toContain(`DELETE /v1/exchange/offerings/${hand.offeringId}`);
  });
});

describe('a tool that fixes part of the input is a different product: both stay listed', () => {
  const narrowing = () => boundTool({ lockedInput: { category: 'budget' } });

  it('keeps both listings and tells the owner on each side, on a full reconcile', async () => {
    const storage = await store(true, [narrowing()]);
    const report = await reconcileOwnerOfferings(storage, GHII);

    const tool = row(report.changes, 'created', `${APP}/find`)[0];
    const act = row(report.changes, 'created', `${EXT}/search`)[0];
    expect(tool, 'the app-tool lists').toBeTruthy();
    expect(act, 'the extension action lists').toBeTruthy();
    expect(report.delisted).toBe(0);

    const rows = warnings(report.changes);
    expect(rows).toHaveLength(2);
    const onTool = rows.find(r => r.label === `${APP}/find`);
    const onAct = rows.find(r => r.label === `${EXT}/search`);
    expect(onTool).toMatchObject({ reason: `ALSO_LISTED_AS ${EXT}/search`, offeringId: tool!.offeringId });
    expect(onTool!.otherListing).toEqual({ kind: 'ext-action', label: `${EXT}/search`, offeringId: act!.offeringId });
    expect(onAct).toMatchObject({ reason: `ALSO_LISTED_AS ${APP}/find`, offeringId: act!.offeringId });
    expect(onTool!.message).toContain('lockedInput');
    expect(report.warnings).toBe(2);
  });

  it('a reconcile scoped to the app still sees the extension listing', async () => {
    const storage = await store(true, [narrowing()]);
    await reconcileOwnerOfferings(storage, GHII);
    const scoped = await reconcileOwnerOfferings(storage, GHII, { appId: APP });
    expect(warnings(scoped.changes).map(r => [r.label, r.reason])).toEqual([[`${APP}/find`, `ALSO_LISTED_AS ${EXT}/search`]]);
    expect(scoped.delisted).toBe(0);
  });

  it('a reconcile scoped to the extension finds the tool, and knows it narrows the action', async () => {
    const storage = await store(true, [narrowing()]);
    await reconcileOwnerOfferings(storage, GHII);
    const scoped = await reconcileOwnerOfferings(storage, GHII, { extName: EXT });
    const rows = warnings(scoped.changes);
    expect(rows.map(r => [r.label, r.reason])).toEqual([[`${EXT}/search`, `ALSO_LISTED_AS ${APP}/find`]]);
    expect(rows[0]!.message).toContain('lockedInput');
    expect(scoped.delisted).toBe(0);
  });

  it('one row per pair, not one per currency row of the same tool', async () => {
    const storage = await store(true, [boundTool({
      lockedInput: { category: 'budget' },
      price: undefined, pricesMoney: [{ amount: 10_000, currency: 'EUR' }, { amount: 12_000, currency: 'USD' }],
    })]);
    const report = await reconcileOwnerOfferings(storage, GHII);
    expect(row(report.changes, 'created', `${APP}/find`)).toHaveLength(2);
    expect(warnings(report.changes)).toHaveLength(2);
  });
});

describe('nothing to say', () => {
  it('when only the app-tool is flagged', async () => {
    const storage = await store(false, [boundTool()]);
    const report = await reconcileOwnerOfferings(storage, GHII);
    expect(warnings(report.changes)).toEqual([]);
    expect(report.changes.filter(c => c.kind === 'ext-action')).toEqual([]);
  });

  it('when the tool calls a different action of the same extension', async () => {
    const storage = new SqliteStorage(':memory:') as unknown as Storage;
    const ext = extension(true);
    ext.actions = ext.actions.filter(a => a.id === 'search');
    await storage.createExtension(ext);
    await writeTools(storage, [boundTool({ action_id: `ext:${EXT}:missing` })]);
    const report = await reconcileOwnerOfferings(storage, GHII);
    expect(warnings(report.changes)).toEqual([]);
    expect(row(report.changes, 'created', `${EXT}/search`)).toHaveLength(1);
  });
});
