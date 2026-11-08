/**
 * @file test/unit/memory-ceilings-return-flips.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A restore from the bin and an organism unarchive return rows to a principal's kept
 *   totals, so they ask the key ceiling and the byte quota a write asks (secaudit2026nov08 round 14,
 *   services/memory-ceilings:count-returning-transitions-skip-ceiling). A flip that would take the
 *   principal past a limit is refused with 413 QUOTA_EXCEEDED naming the setting and leaves the rows
 *   where they were; below the limits both work as before.
 *
 *   The real services (restoreMemoryRecord, organismArchiveOp) over a real storage: SQLite in memory,
 *   and PostgreSQL too when DATABASE_URL is set. The byte case differs by provider by design
 *   (storage/memory-totals.ts): PostgreSQL counts no bytes for an archived row, SQLite counts every
 *   row, so an unarchive adds bytes on PostgreSQL only.
 * @usage cd aimeat && pnpm exec vitest run test/unit/memory-ceilings-return-flips.test.ts
 *   cd aimeat && node --env-file=.env.test.postgres-kysely --import tsx node_modules/vitest/vitest.mjs run test/unit/memory-ceilings-return-flips.test.ts
 * @version-history
 *   2026-11-08 — Initial (secaudit2026nov08 round 14).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { requirePostgresWhenAsked } from './postgres-arm.js';
import { createStorage } from '../../src/storage/storage-factory.js';
import type { Storage } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';
import { deleteMemoryRecord, restoreMemoryRecord } from '../../src/services/memory-bin.js';
import { organismArchiveOp } from '../../src/services/organism-archive-op.js';
import { archiveTarget } from '../../src/services/archive.js';

requirePostgresWhenAsked('memory-ceilings-return-flips');

type TestStorage = Storage & { close(): void | Promise<void> };
const names = ['sqlite', ...(process.env.DATABASE_URL ? ['postgres-kysely'] : [])] as const;
const RUN = randomUUID().slice(0, 8);
const NODE = `ceil-${RUN}`;

describe.each(names)('%s: restore and unarchive ask the memory limits', (provider) => {
  let storage: TestStorage;
  const tag = provider === 'sqlite' ? 's' : 'p';
  let n = 0;
  /** A fresh principal for each test, so the kept totals start at zero. */
  const fresh = () => { n++; const name = `al${RUN}${tag}${n}`; return { name, ghii: `${name}@${NODE}` }; };
  const cfg = (over: Partial<AimeatConfig> = {}) => ({
    nodeId: NODE, memoryDeleteGraceDays: 30, memoryMaxKeysPerAgent: 3, memoryMaxValueSizeKb: 1024,
    memoryQuotaMb: 1, memoryOverageMorselsPerMbMonth: 10, ...over,
  }) as AimeatConfig;
  const put = (owner: string, key: string, value: unknown) => storage.setMemory({
    key, ownerGaii: owner, value, visibility: 'private', tags: [], ttlHours: null, version: 1,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  });
  const binReq = (who: { name: string; ghii: string }, key: string) => ({ caller: who.ghii, ownerName: who.name, key, ownerScope: true, roles: ['owner'] });
  /** An organism this principal created, as the archive rule reads it. */
  const organism = (who: { name: string; ghii: string }) => {
    const orgId = `org${RUN}${tag}${n}`;
    const s = storage as unknown as Record<string, unknown>;
    const prevOrg = s.getOrganism as (id: string) => Promise<unknown>;
    const prevMember = s.getMembership as (id: string, o: string) => Promise<unknown>;
    s.getOrganism = async (id: string) => (id === orgId ? { id: orgId, agentGaiis: [] } : prevOrg.call(storage, id));
    s.getMembership = async (id: string, o: string) => (id === orgId && o === who.name ? { status: 'active', role: 'creator' } : prevMember.call(storage, id, o));
    return orgId;
  };
  const caller = (who: { name: string; ghii: string }) => ({ principal: who.ghii, ownerName: who.name, roles: ['owner'], scopes: ['*'] });

  beforeAll(async () => {
    storage = await createStorage({
      provider: provider === 'sqlite' ? 'sqlite' : 'postgres-kysely', sqlitePath: ':memory:', dbUrl: process.env.DATABASE_URL,
    }) as TestStorage;
  }, 60_000);

  afterAll(async () => { await storage.close(); });

  it('a restore that would pass the key ceiling stays in the bin and names the setting', async () => {
    const who = fresh();
    const config = cfg();
    for (const k of ['a', 'b', 'c']) await put(who.ghii, `notes.${k}`, { k });
    expect((await deleteMemoryRecord({ storage, config }, binReq(who, 'notes.a'))).ok).toBe(true);
    await put(who.ghii, 'notes.d', { k: 'd' });
    const back = await restoreMemoryRecord({ storage, config }, binReq(who, 'notes.a'));
    expect(back.ok).toBe(false);
    if (!back.ok) {
      expect(back.code).toBe('QUOTA_EXCEEDED');
      expect(back.status).toBe(413);
      expect(back.message).toContain('memoryMaxKeysPerAgent');
    }
    expect(await storage.getMemory(who.ghii, 'notes.a')).toBeNull();
    expect((await storage.listDeletedMemory(who.ghii)).map(r => r.key)).toContain('notes.a');
    expect((await storage.getMemoryTotals(who.ghii)).keys).toBe(3);
  });

  it('a restore below the key ceiling puts the record back', async () => {
    const who = fresh();
    const config = cfg();
    for (const k of ['a', 'b']) await put(who.ghii, `notes.${k}`, { k });
    await deleteMemoryRecord({ storage, config }, binReq(who, 'notes.a'));
    const back = await restoreMemoryRecord({ storage, config }, binReq(who, 'notes.a'));
    expect(back.ok).toBe(true);
    expect(await storage.getMemory(who.ghii, 'notes.a')).not.toBeNull();
    expect((await storage.getMemoryTotals(who.ghii)).keys).toBe(2);
  });

  it('an unarchive that would pass the key ceiling brings nothing back and names the setting', async () => {
    const who = fresh();
    const config = cfg();
    const orgId = organism(who);
    for (const k of ['a', 'b', 'c']) await put(who.ghii, `organism.${orgId}.w.w1.notes.${k}`, { k });
    await archiveTarget(storage, { level: 'space', orgId, ws: 'w1', namespace: 'notes' }, who.ghii);
    for (const k of ['x', 'y', 'z']) await put(who.ghii, `organism.${orgId}.w.w1.other.${k}`, { k });
    const out = await organismArchiveOp({ storage, config }, caller(who), orgId, 'unarchive', { level: 'space', ws: 'w1', namespace: 'notes' });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.code).toBe('QUOTA_EXCEEDED');
      expect(out.status).toBe(413);
      expect(out.message).toContain('memoryMaxKeysPerAgent');
    }
    expect((await storage.getMemory(who.ghii, `organism.${orgId}.w.w1.notes.a`))?.archived).toBe(true);
    expect((await storage.getMemoryTotals(who.ghii)).keys).toBe(3);
  });

  it('an unarchive below the limits brings the content back', async () => {
    const who = fresh();
    const config = cfg();
    const orgId = organism(who);
    for (const k of ['a', 'b']) await put(who.ghii, `organism.${orgId}.w.w1.notes.${k}`, { k });
    await archiveTarget(storage, { level: 'space', orgId, ws: 'w1', namespace: 'notes' }, who.ghii);
    const out = await organismArchiveOp({ storage, config }, caller(who), orgId, 'unarchive', { level: 'space', ws: 'w1', namespace: 'notes' });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.count).toBe(2);
    expect((await storage.getMemory(who.ghii, `organism.${orgId}.w.w1.notes.a`))?.archived).toBeFalsy();
    expect((await storage.getMemoryTotals(who.ghii)).keys).toBe(2);
  });

  it('an unarchive that returns bytes past the quota is refused where archived rows count no bytes', async () => {
    const who = fresh();
    const config = cfg({ memoryMaxKeysPerAgent: 100 });
    const orgId = organism(who);
    const big = 'x'.repeat(400 * 1024);
    for (const k of ['a', 'b']) await put(who.ghii, `organism.${orgId}.w.w1.notes.${k}`, { big });
    await archiveTarget(storage, { level: 'space', orgId, ws: 'w1', namespace: 'notes' }, who.ghii);
    for (const k of ['x', 'y']) await put(who.ghii, `organism.${orgId}.w.w1.other.${k}`, { big });
    const out = await organismArchiveOp({ storage, config }, caller(who), orgId, 'unarchive', { level: 'space', ws: 'w1', namespace: 'notes' });
    if (provider === 'postgres-kysely') {
      expect(out.ok).toBe(false);
      if (!out.ok) {
        expect(out.code).toBe('QUOTA_EXCEEDED');
        expect(out.message).toContain('memoryQuotaMb');
      }
      expect((await storage.getMemory(who.ghii, `organism.${orgId}.w.w1.notes.a`))?.archived).toBe(true);
    } else {
      // SQLite counts an archived row's bytes already, so the unarchive adds none.
      expect(out.ok).toBe(true);
    }
  });
});
