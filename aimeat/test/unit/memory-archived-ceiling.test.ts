/**
 * @file test/unit/memory-archived-ceiling.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Archived memory keys have a ceiling of their own, memoryMaxArchivedKeysPerAgent
 *   (secaudit2026nov08b round 15b, storage/memory-totals:postgres-archived-rows-count-no-bytes).
 *   Archived rows are outside the key ceiling on both providers and outside the byte quota on
 *   PostgreSQL, so write, archive, write again stored past every limit. An archive that would take the
 *   archiving account past the archived-key ceiling is now refused with 413 QUOTA_EXCEEDED naming the
 *   setting, and nothing is archived; below it an archive frees live room exactly as before, and
 *   bringing content back and deleting it are never refused by it.
 *
 *   The real services (organismArchiveOp, archiveRecordsBatchOp, memoryCeilings, restoreMemoryRecord,
 *   deleteMemoryRecord) over a real storage: SQLite in memory, and PostgreSQL too when DATABASE_URL is set.
 * @usage cd aimeat && pnpm exec vitest run test/unit/memory-archived-ceiling.test.ts
 *   cd aimeat && node --env-file=.env.test.postgres-kysely --import tsx node_modules/vitest/vitest.mjs run test/unit/memory-archived-ceiling.test.ts
 * @version-history
 *   2026-11-08 — Initial (secaudit2026nov08b round 15b).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { requirePostgresWhenAsked } from './postgres-arm.js';
import { createStorage } from '../../src/storage/storage-factory.js';
import type { Storage } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';
import { organismArchiveOp } from '../../src/services/organism-archive-op.js';
import { archiveRecordsBatchOp, archiveTarget } from '../../src/services/archive.js';
import { memoryCeilings } from '../../src/services/memory-ceilings.js';
import { deleteMemoryRecord, restoreMemoryRecord } from '../../src/services/memory-bin.js';

requirePostgresWhenAsked('memory-archived-ceiling');

type TestStorage = Storage & { close(): void | Promise<void> };
const names = ['sqlite', ...(process.env.DATABASE_URL ? ['postgres-kysely'] : [])] as const;
const RUN = randomUUID().slice(0, 8);
const NODE = `arcc-${RUN}`;

describe.each(names)('%s: archived keys have a ceiling of their own', (provider) => {
  let storage: TestStorage;
  const tag = provider === 'sqlite' ? 's' : 'p';
  let n = 0;
  type Who = { name: string; ghii: string };
  const fresh = (role: string): Who => { const name = `${role}${RUN}${tag}${n}`; return { name, ghii: `${name}@${NODE}` }; };
  /** Three live keys and four archived keys per principal, so the loop reaches both in a few writes. */
  const cfg = (over: Partial<AimeatConfig> = {}) => ({
    nodeId: NODE, memoryDeleteGraceDays: 30, memoryMaxKeysPerAgent: 3, memoryMaxArchivedKeysPerAgent: 4,
    memoryMaxValueSizeKb: 1024, memoryQuotaMb: 1, memoryOverageMorselsPerMbMonth: 10, ...over,
  }) as AimeatConfig;
  const put = (owner: string, key: string, value: unknown) => storage.setMemory({
    key, ownerGaii: owner, value, visibility: 'private', tags: [], ttlHours: null, version: 1,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  });
  /** A write through the key ceiling a real write asks, then the row. */
  const write = async (config: AimeatConfig, owner: string, key: string) => {
    const r = await memoryCeilings({ storage, config }, owner, [{ key, value: { key } }]);
    if (r.ok) await put(owner, key, { key });
    return r.ok;
  };
  /** An organism `creator` created (and `member` belongs to), as the archive rule reads it. */
  const organism = (creator: Who, member?: Who) => {
    const orgId = `org${RUN}${tag}${n}`;
    const s = storage as unknown as Record<string, unknown>;
    const prevOrg = s.getOrganism as (id: string) => Promise<unknown>;
    const prevMember = s.getMembership as (id: string, o: string) => Promise<unknown>;
    s.getOrganism = async (id: string) => (id === orgId ? { id: orgId, agentGaiis: [] } : prevOrg.call(storage, id));
    s.getMembership = async (id: string, o: string) => {
      if (id === orgId && o === creator.name) return { status: 'active', role: 'creator' };
      if (id === orgId && member && o === member.name) return { status: 'active', role: 'member' };
      return prevMember.call(storage, id, o);
    };
    return orgId;
  };
  const caller = (who: Who) => ({ principal: who.ghii, ownerName: who.name, roles: ['owner'], scopes: ['*'] });
  /** The principal's archived keys, read from the rows (what memory-ceilings.ts archivedKeyCount counts). */
  const archivedKeyCount = (_s: Storage, owner: string) => storage.countMemory([owner], { archived: 'only' });
  /** The account record the bin's organism access check reads. */
  const account = (who: Who) => storage.createGHII({
    username: who.name, nodeId: NODE, ghii: who.ghii, displayName: who.name, verificationLevel: 0, ownerName: who.name,
    morselBalance: 100, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  } as never);
  const SPACE = { level: 'space', ws: 'w1', namespace: 'notes' };
  const binReq = (who: Who, key: string) => ({ caller: who.ghii, ownerName: who.name, key, ownerScope: true, roles: ['owner'] });

  beforeAll(async () => {
    storage = await createStorage({
      provider: provider === 'sqlite' ? 'sqlite' : 'postgres-kysely', sqlitePath: ':memory:', dbUrl: process.env.DATABASE_URL,
    }) as TestStorage;
  }, 60_000);

  afterAll(async () => { await storage.close(); });

  it('write, archive, write, archive is refused at the archived-key ceiling and archives nothing', async () => {
    n++;
    const alice = fresh('al');
    const config = cfg();
    const orgId = organism(alice);
    for (const k of ['a', 'b', 'c']) expect(await write(config, alice.ghii, `organism.${orgId}.w.w1.notes.${k}`)).toBe(true);
    expect(await write(config, alice.ghii, `organism.${orgId}.w.w1.notes.d`)).toBe(false);
    expect((await organismArchiveOp({ storage, config }, caller(alice), orgId, 'archive', SPACE)).ok).toBe(true);
    // The archive freed the live room, as before.
    for (const k of ['d', 'e', 'f']) expect(await write(config, alice.ghii, `organism.${orgId}.w.w1.notes.${k}`)).toBe(true);
    const out = await organismArchiveOp({ storage, config }, caller(alice), orgId, 'archive', SPACE);
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.status).toBe(413);
      expect(out.code).toBe('QUOTA_EXCEEDED');
      expect(out.message).toContain('memoryMaxArchivedKeysPerAgent');
      expect(out.message).toContain('Nothing was archived');
    }
    expect((await storage.getMemory(alice.ghii, `organism.${orgId}.w.w1.notes.d`))?.archived).toBeFalsy();
    expect(await archivedKeyCount(storage, alice.ghii)).toBe(3);
    expect((await storage.getMemoryTotals(alice.ghii)).keys).toBe(3);
  });

  it('an archive under the ceiling frees live room, and bringing it back works as before', async () => {
    n++;
    const alice = fresh('al');
    const config = cfg();
    const orgId = organism(alice);
    for (const k of ['a', 'b']) await put(alice.ghii, `organism.${orgId}.w.w1.notes.${k}`, { k });
    const out = await organismArchiveOp({ storage, config }, caller(alice), orgId, 'archive', SPACE);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.count).toBe(2);
    expect((await storage.getMemoryTotals(alice.ghii)).keys).toBe(0);
    expect(await archivedKeyCount(storage, alice.ghii)).toBe(2);
    const back = await organismArchiveOp({ storage, config }, caller(alice), orgId, 'unarchive', SPACE);
    expect(back.ok).toBe(true);
    if (back.ok) expect(back.count).toBe(2);
    expect((await storage.getMemoryTotals(alice.ghii)).keys).toBe(2);
    expect(await archivedKeyCount(storage, alice.ghii)).toBe(0);
  });

  it('a principal already past the ceiling brings content back and deletes it, and archives again once under it', async () => {
    n++;
    const alice = fresh('al');
    await account(alice);
    const orgId = organism(alice);
    // Archived before the ceiling existed: six archived keys, past the ceiling of four.
    for (const k of ['a', 'b', 'c', 'd', 'e', 'f']) await put(alice.ghii, `organism.${orgId}.w.w1.old.${k}`, { k });
    await archiveTarget(storage, { level: 'space', orgId, ws: 'w1', namespace: 'old' }, alice.ghii);
    const config = cfg({ memoryMaxKeysPerAgent: 100 });
    await put(alice.ghii, `organism.${orgId}.w.w1.notes.x`, { k: 'x' });
    const refused = await organismArchiveOp({ storage, config }, caller(alice), orgId, 'archive', SPACE);
    expect(refused.ok).toBe(false);
    // Deleting archived content is not refused.
    for (const k of ['a', 'b', 'c']) {
      expect((await deleteMemoryRecord({ storage, config }, binReq(alice, `organism.${orgId}.w.w1.old.${k}`))).ok).toBe(true);
    }
    expect(await archivedKeyCount(storage, alice.ghii)).toBe(3);
    // Bringing archived content back is not refused.
    const back = await organismArchiveOp({ storage, config }, caller(alice), orgId, 'unarchive', { level: 'record', ws: 'w1', key: `organism.${orgId}.w.w1.old.d` });
    expect(back.ok).toBe(true);
    expect(await archivedKeyCount(storage, alice.ghii)).toBe(2);
    expect((await organismArchiveOp({ storage, config }, caller(alice), orgId, 'archive', SPACE)).ok).toBe(true);
    expect(await archivedKeyCount(storage, alice.ghii)).toBe(3);
  });

  it('the batch archive of an extension is refused at the ceiling and archives none of the batch', async () => {
    n++;
    const alice = fresh('al');
    const config = cfg({ memoryMaxKeysPerAgent: 100 });
    const orgId = organism(alice);
    for (const k of ['a', 'b', 'c', 'd', 'e']) await put(alice.ghii, `organism.${orgId}.w.w1.claims.${k}`, { k });
    const ok = await archiveRecordsBatchOp({ storage, config }, { principal: alice.ghii, ownerName: alice.name },
      { organismId: orgId, ws: 'w1', namespace: 'claims', ids: ['a', 'b'] });
    expect(ok.ok).toBe(true);
    const out = await archiveRecordsBatchOp({ storage, config }, { principal: alice.ghii, ownerName: alice.name },
      { organismId: orgId, ws: 'w1', namespace: 'claims', ids: ['c', 'd', 'e'] });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.status).toBe(413);
      expect(out.code).toBe('QUOTA_EXCEEDED');
      expect(out.message).toContain('memoryMaxArchivedKeysPerAgent');
    }
    expect((await storage.getMemory(alice.ghii, `organism.${orgId}.w.w1.claims.c`))?.archived).toBeFalsy();
    expect(await archivedKeyCount(storage, alice.ghii)).toBe(2);
  });

  it('a restore from the bin of an archived record that would pass the ceiling stays in the bin', async () => {
    n++;
    const alice = fresh('al');
    await account(alice);
    const config = cfg({ memoryMaxKeysPerAgent: 100 });
    const orgId = organism(alice);
    for (const k of ['a', 'b', 'c', 'd', 'e']) await put(alice.ghii, `organism.${orgId}.w.w1.notes.${k}`, { k });
    await archiveTarget(storage, { level: 'record', orgId, ws: 'w1', key: `organism.${orgId}.w.w1.notes.a` }, alice.ghii);
    expect((await deleteMemoryRecord({ storage, config }, binReq(alice, `organism.${orgId}.w.w1.notes.a`))).ok).toBe(true);
    const batch = await archiveRecordsBatchOp({ storage, config }, { principal: alice.ghii, ownerName: alice.name },
      { organismId: orgId, ws: 'w1', namespace: 'notes', ids: ['b', 'c', 'd', 'e'] });
    expect(batch.ok).toBe(true);
    const back = await restoreMemoryRecord({ storage, config }, binReq(alice, `organism.${orgId}.w.w1.notes.a`));
    expect(back.ok).toBe(false);
    if (!back.ok) {
      expect(back.code).toBe('QUOTA_EXCEEDED');
      expect(back.message).toContain('memoryMaxArchivedKeysPerAgent');
    }
    expect(await archivedKeyCount(storage, alice.ghii)).toBe(4);
  });

  it('another member past the ceiling does not keep the creator from archiving the space', async () => {
    n++;
    const alice = fresh('al');
    const bob = fresh('bo');
    const config = cfg({ memoryMaxKeysPerAgent: 100 });
    const orgId = organism(alice, bob);
    for (const k of ['b1', 'b2', 'b3', 'b4', 'b5']) await put(bob.ghii, `organism.${orgId}.w.w1.notes.${k}`, { k });
    await put(alice.ghii, `organism.${orgId}.w.w1.notes.a`, { k: 'a' });
    const out = await organismArchiveOp({ storage, config }, caller(alice), orgId, 'archive', SPACE);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.count).toBe(6);
  });

  it('0 is no limit', async () => {
    n++;
    const alice = fresh('al');
    const config = cfg({ memoryMaxKeysPerAgent: 100, memoryMaxArchivedKeysPerAgent: 0 });
    const orgId = organism(alice);
    for (const k of ['a', 'b', 'c', 'd', 'e', 'f']) await put(alice.ghii, `organism.${orgId}.w.w1.notes.${k}`, { k });
    expect((await organismArchiveOp({ storage, config }, caller(alice), orgId, 'archive', SPACE)).ok).toBe(true);
    expect(await archivedKeyCount(storage, alice.ghii)).toBe(6);
  });
});
