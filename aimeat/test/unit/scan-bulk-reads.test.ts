/**
 * @file test/unit/scan-bulk-reads.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The bulk reads the app-tool scan and the capability scan use (codebase analysis
 *   2026-11-03, item C7), against the per-item reads they replace, on every configured provider:
 *   - findOperatorHiddenApps names exactly the asked apps for which
 *     `getAppByOwnerName(owner, file)?.operatorHidden === true`, whichever version row is hidden;
 *   - getCapabilitiesBySourceRefs returns the rows getCapabilityBySourceRef returns, one read;
 *   - capabilityLookup answers as getCapabilityBySourceRef until the scan writes, then reads again;
 *   - listPublicAppTools: a manifest change is seen on the next call (the cache keys on what is
 *     stored), and a hidden app's tools leave at once.
 *   A run without DATABASE_URL checks SQLite only.
 * @structure provs · cases
 * @usage cd aimeat && DATABASE_URL=postgresql://… pnpm exec vitest run test/unit/scan-bulk-reads.test.ts
 * @version-history
 *   2026-11-04 — Initial (codebase analysis 2026-11-03, item C7).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { rmSync, existsSync } from 'node:fs';
import { createStorage } from '../../src/storage/storage-factory.js';
import type { Storage, CapabilityRecord, MemoryRecord } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';
import { capabilityLookup } from '../../src/services/capability-aggregator.js';
import { listPublicAppTools } from '../../src/commerce/app-tool-catalog.js';

const SQLITE_PATH = `./test/.scan-bulk-${process.pid}.db`;
const PG_URL = process.env.DATABASE_URL ?? '';

interface Provider { name: string; storage: Storage }
const provs: Provider[] = [];
const RUN = randomUUID().slice(0, 8);

beforeAll(async () => {
  provs.push({ name: 'sqlite', storage: await createStorage({ provider: 'sqlite', sqlitePath: SQLITE_PATH }) });
  if (PG_URL) provs.push({ name: 'postgres-kysely', storage: await createStorage({ provider: 'postgres-kysely', dbUrl: PG_URL }) });
  console.info(`[scan-bulk] providers checked: ${provs.map(p => p.name).join(', ')}`);
}, 60_000);

afterAll(async () => {
  for (const { storage } of provs) await (storage as unknown as { close?: () => void | Promise<void> }).close?.();
  for (const suffix of ['', '-wal', '-shm']) {
    const p = SQLITE_PATH + suffix;
    if (existsSync(p)) { try { rmSync(p); } catch { /* the test's own scratch file */ } }
  }
});

async function app(s: Storage, ownerName: string, filename: string, versionNumber: number, operatorHidden = false): Promise<void> {
  await s.createApp({
    ownerGaii: `${ownerName}@node`, ownerName, filename, versionNumber,
    manifest: { name: filename, description: 'x', version: String(versionNumber), category: 'tool', tags: [], authorDisplay: ownerName, usesCortex: [] },
    mimeType: 'text/html', size: 4, data: Buffer.from('test'), createdAt: new Date(Date.now() + versionNumber).toISOString(),
    ...(operatorHidden ? { operatorHidden: true, operatorHiddenBy: 'op', operatorHiddenAt: new Date().toISOString() } : {}),
  } as never);
}

function cap(ref: string, summary = ''): CapabilityRecord {
  const now = new Date().toISOString();
  return {
    id: ref, name: ref, summary, ownerGhii: 'o@node', visibility: 'public', scope: 'local', status: 'active',
    rejectionReason: null, deprecationMessage: null, replacedBy: null,
    source: { type: 'app-tool', ref, version: '1' }, authRequired: 'registered', callable: false,
    inputSchema: null, outputSchema: null, exports: null, usage: '', whenToUse: '', whenNotToUse: '',
    examples: [], dependencies: [], schemaHash: 'x', webhookUrl: null, cost: null, trustRequired: null,
    trust: { operatorReviewed: false, reviewedAt: null, vouchCount: 0, publisherTrustScore: 0, codeAudited: false, auditNotes: null },
    redactedFields: [], operatorOverride: null,
    stats: { totalInvocations: 0, successCount: 0, errorCount: 0, lastInvokedAt: null, avgResponseMs: 0, lastError: null },
    tags: [], createdAt: now, updatedAt: now,
  } as CapabilityRecord;
}

describe('findOperatorHiddenApps (C7)', () => {
  it('names exactly the apps whose newest version row getAppByOwnerName reads as hidden', async () => {
    for (const { name, storage: s } of provs) {
      const o = `hid${RUN}${name.slice(0, 2)}`;
      await app(s, o, 'old-hidden.html', 1, true); await app(s, o, 'old-hidden.html', 2, false);
      await app(s, o, 'new-hidden.html', 1, false); await app(s, o, 'new-hidden.html', 2, true);
      await app(s, o, 'all-hidden.html', 1); await app(s, o, 'all-hidden.html', 2);
      await s.setAppOperatorHidden(`${o}@node`, 'all-hidden.html', true, { by: 'op', at: new Date().toISOString() });
      await app(s, o, 'plain.html', 1);
      const names = ['old-hidden.html', 'new-hidden.html', 'all-hidden.html', 'plain.html'];
      const want = [];
      for (const f of names) if ((await s.getAppByOwnerName(o, f))?.operatorHidden === true) want.push(f);
      const asked = [...names, 'not-hosted.html'].map(filename => ({ ownerName: o, filename }));
      const got = (await s.findOperatorHiddenApps(asked)).map(a => a.filename).sort();
      expect({ provider: name, hidden: got }).toEqual({ provider: name, hidden: want.sort() });
      expect(got).toEqual(['all-hidden.html', 'new-hidden.html']);
      // Only the apps asked about, and nothing for an empty question.
      expect(await s.findOperatorHiddenApps([{ ownerName: o, filename: 'plain.html' }])).toEqual([]);
      expect(await s.findOperatorHiddenApps([])).toEqual([]);
    }
  });
});

describe('getCapabilitiesBySourceRefs and capabilityLookup (C7)', () => {
  it('returns the rows the point read returns, and the lookup reads again after a write', async () => {
    for (const { name, storage: s } of provs) {
      const p = `app-tool:cap${RUN}${name.slice(0, 2)}/`;
      for (const r of ['a', 'b', 'c']) await s.createCapability(cap(`${p}${r}`));
      const asked = [`${p}a`, `${p}c`, `${p}missing`];
      const bulk = await s.getCapabilitiesBySourceRefs(asked);
      expect(bulk.map(c => c.source.ref).sort()).toEqual([`${p}a`, `${p}c`]);
      for (const ref of asked) expect(bulk.find(c => c.source.ref === ref) ?? null).toEqual(await s.getCapabilityBySourceRef(ref));
      expect(await s.getCapabilitiesBySourceRefs([])).toEqual([]);

      const lookup = await capabilityLookup(s, asked);
      for (const ref of [...asked, `${p}b`]) expect(await lookup.get(ref)).toEqual(await s.getCapabilityBySourceRef(ref));
      await s.updateCapability(`${p}a`, { summary: 'changed' });
      lookup.wrote();
      expect((await lookup.get(`${p}a`))?.summary).toBe('changed');
    }
  });
});

describe('listPublicAppTools (C7)', () => {
  const config = { nodeId: 'node', baseUrl: 'http://node.test' } as AimeatConfig;
  const tools = (names: string[]) => ({ tools: names.map(n => ({ name: n, description: n, inputSchema: { type: 'object', properties: {} }, action_id: 'x' })) });
  const manifest = (owner: string, appId: string, value: unknown, visibility: MemoryRecord['visibility'] = 'public'): MemoryRecord => {
    const now = new Date().toISOString();
    return { key: `apps.${appId}.tools`, ownerGaii: `${owner}@node`, value, visibility, tags: [], ttlHours: null, version: 1, createdAt: now, updatedAt: now };
  };

  it('sees a manifest change and a hide on the next call', async () => {
    for (const { name, storage: s } of provs) {
      const o = `tl${RUN}${name.slice(0, 2)}`;
      const mine = async () => (await listPublicAppTools(s, config, { pricedOnly: false, cap: 100_000 })).filter(t => t.ownerName === o).map(t => t.sku);
      await app(s, o, 'one.html', 1);
      await s.setMemory(manifest(o, 'one.html', tools(['t1'])));
      await s.setMemory(manifest(o, 'two.html', tools(['t2']), 'private'));
      await s.setMemory({ ...manifest(o, 'one.html', { config: true }), key: 'apps.one.html.config' });
      expect(await mine()).toEqual([`app-tool:${o}/one.html:t1`]);
      expect(await mine()).toEqual([`app-tool:${o}/one.html:t1`]);
      await s.setMemory(manifest(o, 'one.html', tools(['t1', 't1b'])));
      expect(await mine()).toEqual([`app-tool:${o}/one.html:t1`, `app-tool:${o}/one.html:t1b`]);
      await s.setMemory(manifest(o, 'two.html', tools(['t2']), 'public'));
      expect(await mine()).toEqual([`app-tool:${o}/one.html:t1`, `app-tool:${o}/one.html:t1b`, `app-tool:${o}/two.html:t2`]);
      await s.setAppOperatorHidden(`${o}@node`, 'one.html', true, { by: 'op', at: new Date().toISOString() });
      expect(await mine()).toEqual([`app-tool:${o}/two.html:t2`]);
      await s.deleteMemory(`${o}@node`, 'apps.two.html.tools');
      expect(await mine()).toEqual([]);
    }
  });
});
