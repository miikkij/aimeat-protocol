/**
 * @file compliance-report-reads.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The node-wide compliance report and the register draft read the records of every app
 *   in batches (services/compliance/report-reads.ts), and say what they said before.
 *
 *   WHAT GROWS. Apps. The report walked them four times and read each app's records one at a time:
 *   3 376 single-record reads and 373 counts for 373 apps, measured on 2026-11-26. The first test
 *   holds the number of single reads to a figure that does not follow the number of apps. The second
 *   compares every per-app part of the report with the same part computed straight from the store,
 *   one read at a time, so reading ahead is shown to change no answer.
 * @usage cd aimeat && pnpm exec vitest run test/unit/compliance-report-reads.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-26 — Initial.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage, MemoryRecord } from '../../src/storage/interface.js';
import { loadConfig } from '../../src/config.js';
import type { AimeatConfig } from '../../src/config.js';
import { setThisNodeId } from '../../src/utils/gaii.js';
import { generateKeyPair } from '../../src/auth/keypair.js';
import { appDataMapKey } from '../../src/services/data-map/data-map-types.js';
import type { DataMap, DataMapRow } from '../../src/services/data-map/data-map-types.js';
import { buildComplianceReport } from '../../src/services/compliance/report.js';
import { draftRegisterFromActivity } from '../../src/services/compliance/draft.js';
import { appsOverview } from '../../src/services/compliance/apps-overview.js';
import { appAiGaps } from '../../src/services/compliance/app-ai-gaps.js';
import { nodeWideScopeGaps } from '../../src/services/compliance/scope-gaps.js';
import { registerDrafts } from '../../src/services/compliance/register-drafts.js';
import { listDocs, writeDoc } from '../../src/services/compliance/docs.js';
import { readAllPlacesOp } from '../../src/services/compliance/docs-places.js';
import type { ComplianceDocs } from '../../src/services/compliance/docs-schemas.js';

const NODE = 'test-node';
const OWNERS = 4;
const AT = new Date().toISOString();
let config: AimeatConfig;
let real: Storage;
let watched: Storage;
const calls = new Map<string, number>();

const personalRow = (what: string): DataMapRow => ({
  what, holds: what, kind: 'user-written', usedFor: 'user-returns-to-read', where: 'owner-memory-private', owner: 'person',
  readers: 'owner-and-their-agents', writers: ['the-app-for-the-person'], shape: 'one-record', keptFor: 'until-deleted',
  lossRisk: 'only-copy', personalData: 'yes', why: '',
} as unknown as DataMapRow);

let seeded = 0;
/** Apps `seeded .. seeded + n - 1`: two in three with a data map, one in three saying it uses AI. */
async function seedApps(n: number): Promise<void> {
  for (let i = seeded; i < seeded + n; i++) {
    const owner = `owner${i % OWNERS}`;
    const ghii = `${owner}@${NODE}`;
    const filename = `app-${i}.html`;
    const usesAi = i % 3 === 0;
    const data = Buffer.from(`<!doctype html><title>app ${i}</title>`);
    await real.createApp({
      ownerGaii: ghii, ownerName: owner, filename, versionNumber: 1,
      manifest: {
        name: `App ${i}`, description: 'd', version: '1.0.0', author: owner, category: 'tool', tags: [],
        ...(usesAi ? { aiPosture: { usesAi: true, generates: ['text'] } } : {}),
      } as never,
      mimeType: 'text/html', size: data.length, data, createdAt: AT,
    });
    if (i % 3 !== 1) {
      const map = {
        spec: 'aimeat.datamap/2', what: 'an app', usedFor: 'things', form: 'one-person', arrangement: '', machinery: [], leaves: [],
        held: [personalRow(`notes${i}.v1`)], elsewhere: [], source: 'declared', at: AT,
      } as unknown as DataMap;
      await real.setMemory({
        key: appDataMapKey(`app-${i}`), ownerGaii: ghii, value: map, visibility: 'public', tags: ['datamap'], ttlHours: null,
        version: 1, createdAt: AT, updatedAt: AT,
      } as MemoryRecord);
    }
  }
  seeded += n;
}

/** The report's single-record reads: what followed the number of apps before. */
const singles = (): number => (calls.get('getMemory') ?? 0) + (calls.get('countAppParties') ?? 0);

beforeAll(async () => {
  setThisNodeId(null);
  config = { ...loadConfig().config, nodeId: NODE, baseUrl: 'https://node.test' } as AimeatConfig;
  real = new SqliteStorage(':memory:') as unknown as Storage;
  for (let o = 0; o < OWNERS; o++) {
    const k = await generateKeyPair();
    await real.createOwner({ name: `owner${o}`, displayName: `Owner ${o}`, publicKey: k.publicKey, roles: o === 0 ? ['owner', 'operator'] : ['owner'], createdAt: AT } as never);
  }
  await seedApps(40);
  // One app keeps a register of its own, and one has a person registered to it.
  await writeDoc(real, NODE, 'registers', { kind: 'app', ownerName: 'owner1', app: 'app-5.html' }, {
    items: [{
      id: 'own-register', title: 'Notes people keep', type: 'personal', purpose: 'member', role: 'controller', subjects: ['users'],
      dataCategories: ['notes'], retentionText: 'Until removed.', containers: [{ kind: 'app', app: 'app-5.html' }], reviewEveryMonths: 12,
    }],
  } as unknown as ComplianceDocs['registers'], `owner0@${NODE}`);
  await real.insertAppPartyCapped({
    uid: 'u-1', ownerGhii: `owner3@${NODE}`, appId: 'owner3/app-7.html', name: 'ap-one', emailHash: 'h-1', status: 'active',
    linkHash: null, linkExpiresAt: null, verifiedAt: AT, pendingSince: AT, epoch: 0, record: { uid: 'u-1' },
    createdAt: AT, updatedAt: AT, version: 1,
  } as never, 10, { now: AT, staleBefore: null });
  watched = new Proxy(real, {
    get(target, prop) {
      const v = (target as unknown as Record<string | symbol, unknown>)[prop];
      if (typeof v !== 'function' || typeof prop !== 'string') return v;
      return (...args: unknown[]) => {
        calls.set(prop, (calls.get(prop) ?? 0) + 1);
        return (v as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  });
}, 120_000);

describe('the node-wide compliance report', () => {
  it('says of every app what the store answers one read at a time', async () => {
    const report = await buildComplianceReport(watched, config, { sinceDays: 30 });
    const deps = { storage: real, config };
    const overview = await appsOverview(deps);
    expect(report.processing?.apps).toEqual(overview.apps);
    expect(report.processing?.apps_by_reach).toEqual(overview.by_reach);
    expect(report.processing?.gaps).toEqual(await nodeWideScopeGaps(deps));
    expect(report.gaps.filter(g => g.kind === 'app-uses-ai-not-in-register')).toEqual(await appAiGaps(real, config, [], undefined));
    const drafts = await registerDrafts(deps, await listDocs(real, NODE, 'registers'));
    const appDrafts = drafts.filter(d => d.scope.kind === 'app');
    expect(report.processing?.registers.drafts.apps).toBe(appDrafts.length);
    // The fixture reaches each kind of read: an app with its own register drafts none, and the app
    // somebody registered to drafts the register of those people.
    expect(appDrafts.some(d => d.scope.kind === 'app' && d.scope.app === 'app-5.html')).toBe(false);
    expect(appDrafts.find(d => d.scope.kind === 'app' && d.scope.app === 'app-7.html')?.items.map(r => r.id)).toContain('app-app-7-parties');
    expect(overview.apps.filter(a => a.has_map).length).toBe(27);
  });

  it('reads no record one app at a time, however many apps there are', async () => {
    calls.clear();
    await buildComplianceReport(watched, config, { sinceDays: 30 });
    const at40 = singles();
    expect(at40, 'single reads at 40 apps').toBeLessThan(40);

    await seedApps(20);
    calls.clear();
    await buildComplianceReport(watched, config, { sinceDays: 30 });
    expect(singles(), 'twenty more apps add no single read').toBe(at40);
  });
});

describe('the list of every place that keeps registers', () => {
  it('drafts the apps\' registers without a read for each app, and drafts what the store drafts', async () => {
    const operator = { sub: `owner0@${NODE}`, owner: 'owner0', roles: ['owner', 'operator'] };
    calls.clear();
    const listed = await readAllPlacesOp({ storage: watched, config }, operator, 'registers') as { places: Array<{ draft?: boolean; place: { scope: string; app?: string } }> };
    expect(singles(), 'single reads for the whole list').toBeLessThan(40);
    const drafted = listed.places.filter(p => p.draft && p.place.scope === 'app').map(p => p.place.app).sort();
    const direct = (await registerDrafts({ storage: real, config }, await listDocs(real, NODE, 'registers')))
      .flatMap(d => (d.scope.kind === 'app' ? [d.scope.app] : [])).sort();
    expect(drafted).toEqual(direct);
    expect(drafted.length).toBeGreaterThan(0);
  });
});

describe('the register draft', () => {
  it('reads every data map in one batch', async () => {
    calls.clear();
    await draftRegisterFromActivity(watched, config, { sinceDays: 30 });
    expect(calls.get('getMemory') ?? 0).toBeLessThan(10);
  });
});
