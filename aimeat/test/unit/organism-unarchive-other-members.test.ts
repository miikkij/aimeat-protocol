/**
 * @file test/unit/organism-unarchive-other-members.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An organism unarchive asks the memory limits of the account that brings the content
 *   back, and not of the other members whose rows it returns (secaudit2026nov08b round 15,
 *   services/organism-archive-op.ts:unarchive:other-principal-ceiling-refuses-and-charges).
 *
 *   The creator or an admin unarchives; a member whose rows were in the archived content cannot, and
 *   the creator cannot change that member's key count. So another member's count no longer refuses the
 *   unarchive, and that member is not charged overage for it. The rows of the unarchiving account
 *   itself, in person or through one of its agents, still answer to the key ceiling and the quota as
 *   round 14 made them (test/unit/memory-ceilings-return-flips.test.ts).
 *
 *   The real service (organismArchiveOp) over a real storage: SQLite in memory, and PostgreSQL too
 *   when DATABASE_URL is set. The byte case runs where an archived row counts no bytes (PostgreSQL).
 * @usage cd aimeat && pnpm exec vitest run test/unit/organism-unarchive-other-members.test.ts
 *   cd aimeat && node --env-file=.env.test.postgres-kysely --import tsx node_modules/vitest/vitest.mjs run test/unit/organism-unarchive-other-members.test.ts
 * @version-history
 *   2026-11-08 — Initial (secaudit2026nov08b round 15).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { requirePostgresWhenAsked } from './postgres-arm.js';
import { createStorage } from '../../src/storage/storage-factory.js';
import type { Storage } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';
import { organismArchiveOp } from '../../src/services/organism-archive-op.js';
import { archiveTarget } from '../../src/services/archive.js';

requirePostgresWhenAsked('organism-unarchive-other-members');

type TestStorage = Storage & { close(): void | Promise<void> };
const names = ['sqlite', ...(process.env.DATABASE_URL ? ['postgres-kysely'] : [])] as const;
const RUN = randomUUID().slice(0, 8);
const NODE = `unarc-${RUN}`;

describe.each(names)('%s: an unarchive and the other members\' limits', (provider) => {
  let storage: TestStorage;
  const tag = provider === 'sqlite' ? 's' : 'p';
  let n = 0;
  type Who = { name: string; ghii: string };
  /** A fresh account for each role in each test, so the kept totals start at zero. */
  const fresh = (role: string): Who => { const name = `${role}${RUN}${tag}${n}`; return { name, ghii: `${name}@${NODE}` }; };
  const cfg = (over: Partial<AimeatConfig> = {}) => ({
    nodeId: NODE, memoryDeleteGraceDays: 30, memoryMaxKeysPerAgent: 3, memoryMaxValueSizeKb: 1024,
    memoryQuotaMb: 1, memoryOverageMorselsPerMbMonth: 10, ...over,
  }) as AimeatConfig;
  const put = (owner: string, key: string, value: unknown) => storage.setMemory({
    key, ownerGaii: owner, value, visibility: 'private', tags: [], ttlHours: null, version: 1,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  });
  /** An organism `creator` created and `member` belongs to, as the archive rule reads it. */
  const organism = (creator: Who, member: Who) => {
    const orgId = `org${RUN}${tag}${n}`;
    const s = storage as unknown as Record<string, unknown>;
    const prevOrg = s.getOrganism as (id: string) => Promise<unknown>;
    const prevMember = s.getMembership as (id: string, o: string) => Promise<unknown>;
    s.getOrganism = async (id: string) => (id === orgId ? { id: orgId, agentGaiis: [] } : prevOrg.call(storage, id));
    s.getMembership = async (id: string, o: string) => {
      if (id === orgId && o === creator.name) return { status: 'active', role: 'creator' };
      if (id === orgId && o === member.name) return { status: 'active', role: 'member' };
      return prevMember.call(storage, id, o);
    };
    return orgId;
  };
  const caller = (who: Who) => ({ principal: who.ghii, ownerName: who.name, roles: ['owner'], scopes: ['*'] });
  /** The unarchive body for the space every test archives. */
  const SPACE = { level: 'space', ws: 'w1', namespace: 'notes' };

  beforeAll(async () => {
    storage = await createStorage({
      provider: provider === 'sqlite' ? 'sqlite' : 'postgres-kysely', sqlitePath: ':memory:', dbUrl: process.env.DATABASE_URL,
    }) as TestStorage;
  }, 60_000);

  afterAll(async () => { await storage.close(); });

  it('another member at the key ceiling does not keep the creator from bringing the space back', async () => {
    n++;
    const alice = fresh('al');
    const bob = fresh('bo');
    const config = cfg();
    const orgId = organism(alice, bob);
    await put(alice.ghii, `organism.${orgId}.w.w1.notes.a`, { k: 'a' });
    for (const k of ['b1', 'b2']) await put(bob.ghii, `organism.${orgId}.w.w1.notes.${k}`, { k });
    await archiveTarget(storage, { level: 'space', orgId, ws: 'w1', namespace: 'notes' }, alice.ghii);
    // Bob fills the keys the archive left free, in his own namespace.
    for (const k of ['x', 'y', 'z']) await put(bob.ghii, `notes.${k}`, { k });
    const out = await organismArchiveOp({ storage, config }, caller(alice), orgId, 'unarchive', SPACE);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.count).toBe(3);
    expect((await storage.getMemory(bob.ghii, `organism.${orgId}.w.w1.notes.b1`))?.archived).toBeFalsy();
    expect((await storage.getMemory(alice.ghii, `organism.${orgId}.w.w1.notes.a`))?.archived).toBeFalsy();
  });

  it('the unarchiving account\'s own agent past the key ceiling still keeps the content archived', async () => {
    n++;
    const alice = fresh('al');
    const bob = fresh('bo');
    const agent = `bot#${alice.name}@${NODE}`;
    const config = cfg();
    const orgId = organism(alice, bob);
    for (const k of ['a1', 'a2']) await put(agent, `organism.${orgId}.w.w1.notes.${k}`, { k });
    await archiveTarget(storage, { level: 'space', orgId, ws: 'w1', namespace: 'notes' }, alice.ghii);
    for (const k of ['x', 'y', 'z']) await put(agent, `notes.${k}`, { k });
    const out = await organismArchiveOp({ storage, config }, caller(alice), orgId, 'unarchive', SPACE);
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.code).toBe('QUOTA_EXCEEDED');
      expect(out.message).toContain('memoryMaxKeysPerAgent');
    }
    expect((await storage.getMemory(agent, `organism.${orgId}.w.w1.notes.a1`))?.archived).toBe(true);
  });

  it('another member is not charged overage, nor refused, for bytes the creator\'s unarchive returns to them', async () => {
    n++;
    const alice = fresh('al');
    const bob = fresh('bo');
    const config = cfg({ memoryMaxKeysPerAgent: 100 });
    const orgId = organism(alice, bob);
    await storage.createGHII({
      username: bob.name, nodeId: NODE, ghii: bob.ghii, displayName: 'Bob', verificationLevel: 0, ownerName: bob.name,
      morselBalance: 100, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    } as never);
    const big = 'x'.repeat(400 * 1024);
    for (const k of ['b1', 'b2']) await put(bob.ghii, `organism.${orgId}.w.w1.notes.${k}`, { big });
    await archiveTarget(storage, { level: 'space', orgId, ws: 'w1', namespace: 'notes' }, alice.ghii);
    for (const k of ['x', 'y']) await put(bob.ghii, `notes.${k}`, { big });
    const out = await organismArchiveOp({ storage, config }, caller(alice), orgId, 'unarchive', SPACE);
    expect(out.ok).toBe(true);
    expect((await storage.getGHIIByOwner(bob.name))?.morselBalance).toBe(100);
  });
});
