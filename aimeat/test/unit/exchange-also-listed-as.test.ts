/**
 * @file test/unit/exchange-also-listed-as.test.ts
 * @description An owner who flags an extension action for EXCHANGE AND flags an app-tool bound to that
 *   same action gets two listings for one call. The two coordinates never collide (`kaiku/search` and
 *   `apptool:seller/shop.html/find`), so the only duplicate guard, DUPLICATE_OF, never saw it, and
 *   nothing told the owner. Ruled 2026-09-13: both listings stay, and the reconcile report carries an
 *   ALSO_LISTED_AS row on each side naming the other. Whether they should list once is still open.
 * @usage cd aimeat && pnpm exec vitest run test/unit/exchange-also-listed-as.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-13 — Initial (appdev pitfall exchange-flag-in-two-places-lists-twice).
 */
import { describe, it, expect } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage, ExtensionRecord } from '../../src/storage/interface.js';
import { reconcileOwnerOfferings, type ReconcileChange } from '../../src/services/exchange-projection.js';

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
    actions: [{
      id: 'search', method: 'POST', path: '/search', inputSchema: IN, outputSchema: OUT, scriptContent: '',
      commercial: { payMorsels: 3, exchange },
    }],
    config: {}, limits: { memoryMb: 64, timeoutMs: 5000, maxApiCalls: 10 },
    federation: { advertise: false, capabilities: [] },
    installedBy: OWNER, installedAt: new Date().toISOString(),
  };
}

const boundTool = (over: Record<string, unknown> = {}) => ({
  name: 'find', action_id: `ext:${EXT}:search`, inputSchema: IN, outputSchema: OUT,
  price: { morsels: 5 }, exchange: true, ...over,
});

async function store(extFlagged: boolean, tools: unknown[]): Promise<Storage> {
  const storage = new SqliteStorage(':memory:') as unknown as Storage;
  await storage.createExtension(extension(extFlagged));
  const now = new Date().toISOString();
  await storage.setMemory({
    key: `apps.${APP}.tools`, ownerGaii: GHII, value: { version: 1, tools }, visibility: 'public',
    tags: ['app-tools'], ttlHours: null, version: 1, createdAt: now, updatedAt: now,
  });
  return storage;
}

const warnings = (rows: ReconcileChange[]) => rows.filter(c => c.action === 'warning' && String(c.reason).startsWith('ALSO_LISTED_AS'));

describe('a bound app-tool and the extension action it calls, both flagged', () => {
  it('keeps both listings and tells the owner on each side, on a full reconcile', async () => {
    const storage = await store(true, [boundTool()]);
    const report = await reconcileOwnerOfferings(storage, GHII);

    const tool = report.changes.find(c => c.action === 'created' && c.label === `${APP}/find`);
    const act = report.changes.find(c => c.action === 'created' && c.label === `${EXT}/search`);
    expect(tool, 'the app-tool still lists').toBeTruthy();
    expect(act, 'the extension action still lists').toBeTruthy();
    expect(report.delisted).toBe(0);

    const rows = warnings(report.changes);
    expect(rows).toHaveLength(2);
    const onTool = rows.find(r => r.label === `${APP}/find`);
    const onAct = rows.find(r => r.label === `${EXT}/search`);
    expect(onTool).toMatchObject({ reason: `ALSO_LISTED_AS ${EXT}/search`, offeringId: tool!.offeringId });
    expect(onTool!.otherListing).toEqual({ kind: 'ext-action', label: `${EXT}/search`, offeringId: act!.offeringId });
    expect(onAct).toMatchObject({ reason: `ALSO_LISTED_AS ${APP}/find`, offeringId: act!.offeringId });
    expect(onTool!.message).toContain(`${EXT}/search`);
    expect(report.warnings).toBe(2);
  });

  it('a reconcile scoped to the app still sees the extension listing it duplicates', async () => {
    const storage = await store(true, [boundTool()]);
    await reconcileOwnerOfferings(storage, GHII);
    const scoped = await reconcileOwnerOfferings(storage, GHII, { appId: APP });
    const rows = warnings(scoped.changes);
    // Only the listing this pass is about carries a row; the extension listing is named in it.
    expect(rows.map(r => [r.label, r.reason])).toEqual([[`${APP}/find`, `ALSO_LISTED_AS ${EXT}/search`]]);
    expect(scoped.delisted).toBe(0);
  });

  it('a reconcile scoped to the extension finds the app-tool through its pinned interface', async () => {
    const storage = await store(true, [boundTool()]);
    await reconcileOwnerOfferings(storage, GHII);
    const scoped = await reconcileOwnerOfferings(storage, GHII, { extName: EXT });
    expect(warnings(scoped.changes).map(r => [r.label, r.reason])).toEqual([[`${EXT}/search`, `ALSO_LISTED_AS ${APP}/find`]]);
  });

  it('one row per pair, not one per currency row of the same tool', async () => {
    const storage = await store(true, [boundTool({
      price: undefined, pricesMoney: [{ amount: 10_000, currency: 'EUR' }, { amount: 12_000, currency: 'USD' }],
    })]);
    const report = await reconcileOwnerOfferings(storage, GHII);
    expect(report.created).toBe(3);
    expect(warnings(report.changes)).toHaveLength(2);
  });

  it('a tool that fixes part of the input says so, since that can make it a different product', async () => {
    const storage = await store(true, [boundTool({ lockedInput: { category: 'budget' } })]);
    const report = await reconcileOwnerOfferings(storage, GHII);
    const onTool = warnings(report.changes).find(r => r.label === `${APP}/find`);
    expect(onTool?.message).toContain('lockedInput');
  });
});

describe('nothing to say', () => {
  it('when only the app-tool is flagged', async () => {
    const storage = await store(false, [boundTool()]);
    const report = await reconcileOwnerOfferings(storage, GHII);
    expect(warnings(report.changes)).toEqual([]);
  });

  it('when the tool calls a different action of the same extension', async () => {
    const storage = await store(true, [boundTool({ action_id: `ext:${EXT}:other` })]);
    const report = await reconcileOwnerOfferings(storage, GHII);
    expect(warnings(report.changes)).toEqual([]);
  });
});
