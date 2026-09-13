/**
 * @file test/unit/exchange-source-write-report.test.ts
 * @description A write to an EXCHANGE source (an app-tool manifest or an agent's offers document)
 *   reconciles its listings, and until 2026-09-13 threw the report away. A tool that was flagged and
 *   priced but skipped for a missing outputSchema looked exactly like one that listed: the publish
 *   answered `priced: true` and the market stayed empty, with the reason sitting in a report nobody
 *   could read. These tests hold the report on its way out of `reconcileAfterSourceWrite` and the
 *   shape a door turns it into (`exchangeOutcome`), against a real in-memory store.
 * @usage cd aimeat && pnpm exec vitest run test/unit/exchange-source-write-report.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-13 — Initial (appdev pitfall exchange-skips-silently-ask-reconcile-why).
 */
import { describe, it, expect } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import { reconcileAfterSourceWrite, exchangeOutcome } from '../../src/services/exchange-projection.js';

const NODE = 'node-x';
const OWNER = 'seller';
const GHII = `${OWNER}@${NODE}`;
const APP = 'shop.html';
const KEY = `apps.${APP}.tools`;
const IN = { type: 'object', properties: { q: { type: 'string' } } };
const OUT = { type: 'object', properties: { a: { type: 'string' } } };

async function withManifest(tools: unknown[]): Promise<Storage> {
  const storage = new SqliteStorage(':memory:') as unknown as Storage;
  const now = new Date().toISOString();
  await storage.setMemory({
    key: KEY, ownerGaii: GHII, value: { version: 1, tools }, visibility: 'public', tags: ['app-tools'],
    ttlHours: null, version: 1, createdAt: now, updatedAt: now,
  });
  return storage;
}

const LISTED = { name: 'listed', action_id: 'ext:e:a', inputSchema: IN, outputSchema: OUT, price: { morsels: 3 }, exchange: true };
const NO_OUTPUT = { name: 'noout', action_id: 'ext:e:a', inputSchema: IN, price: { morsels: 3 }, exchange: true };

describe('a source write hands back what the projection did', () => {
  it('returns the scoped report, naming a flagged and priced tool that was skipped and why', async () => {
    const storage = await withManifest([LISTED, NO_OUTPUT]);
    const report = await reconcileAfterSourceWrite(storage, GHII, KEY);
    expect(report, 'the report must come back to the write that caused it').toBeTruthy();
    const rows = report!.changes;
    expect(rows.find(c => c.label === `${APP}/listed`)?.action).toBe('created');
    expect(rows.find(c => c.label === `${APP}/noout`)).toMatchObject({ action: 'skipped', reason: 'SCHEMA_REQUIRED' });
  });

  it('an agent writing its owner\'s manifest gets the owner\'s report', async () => {
    const storage = await withManifest([NO_OUTPUT]);
    const report = await reconcileAfterSourceWrite(storage, `bot#${OWNER}@${NODE}`, KEY);
    expect(report?.owner).toBe(OWNER);
    expect(report?.skipped).toBe(1);
  });

  it('answers null for a key that is not an EXCHANGE source, and does no work for it', async () => {
    const storage = await withManifest([LISTED]);
    expect(await reconcileAfterSourceWrite(storage, GHII, 'notes.today')).toBeNull();
  });

  it('still never throws into the write: a projection that fails answers null', async () => {
    const broken = {
      getMemory: async () => { throw new Error('disk on fire'); },
      listMemory: async () => { throw new Error('disk on fire'); },
    } as unknown as Storage;
    await expect(reconcileAfterSourceWrite(broken, GHII, KEY)).resolves.toBeNull();
  });
});

describe('exchangeOutcome: the report as a door answers it', () => {
  it('splits the rows into listed, skipped and warnings', async () => {
    const storage = await withManifest([LISTED, NO_OUTPUT]);
    const outcome = exchangeOutcome(await reconcileAfterSourceWrite(storage, GHII, KEY), 'retry');
    expect(outcome.known).toBe(true);
    if (!outcome.known) return;
    expect(outcome.listed.map(l => l.label)).toEqual([`${APP}/listed`]);
    expect(outcome.listed[0].offeringId).toMatch(/^off-/);
    expect(outcome.skipped).toEqual([{ label: `${APP}/noout`, kind: 'app-tool', reason: 'SCHEMA_REQUIRED' }]);
    expect(outcome.warnings).toEqual([]);
    expect(outcome.delisted).toEqual([]);
  });

  it('a lost report says the outcome is unknown and how to ask for it, rather than going quiet', () => {
    const outcome = exchangeOutcome(null, 'POST /v1/exchange/reconcile {"dry_run": true, "app_id": "shop.html"}');
    expect(outcome.known).toBe(false);
    expect(outcome.note).toContain('/v1/exchange/reconcile');
  });
});
