/**
 * @file test/unit/knowledge-link-owner.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A knowledge link row belongs to the namespace that holds its source manifest (secaudit
 *   2026-10, v78), and owner erasure takes the person's rows (v79), on every provider:
 *   - two namespaces' rows with the same source and target are two rows; the outgoing listing, the
 *     delete and the upsert act on one namespace's row only; the incoming listing shows both; an
 *     outgoing listing without an owner shows none;
 *   - eraseOwner deletes the rows the person contributed (GHII and, for older rows, the bare name)
 *     and the rows of their packages, and names knowledge_links in its log; another owner's row stays;
 *   - the once-only start step (services/knowledge-link-owner-keep.ts) places an older row with the
 *     one record at its source in its contributor's account (an agent's included) and writes the GHII
 *     as linked_by; keeps a row whose package is gone; deletes an erased account's row whose package
 *     is gone; records the rest as one incident and leaves them unplaced; runs once.
 *   - SQLite: an older table keyed on (source, target) is rebuilt with every row carried over unplaced.
 *   Runs on SQLite, and on Postgres too when DATABASE_URL is set (names carry a run tag).
 * @usage cd aimeat && pnpm exec vitest run test/unit/knowledge-link-owner.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-22 — Initial (secaudit 2026-10, v78 and v79).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
import Database from 'better-sqlite3';
import { requirePostgresWhenAsked } from './postgres-arm.js';
import { createStorage } from '../../src/storage/storage-factory.js';
import type { Storage, MemoryLinkRecord } from '../../src/storage/interface.js';
import { eraseOwner } from '../../src/services/owner-erasure.js';
import { placeKnowledgeLinkOwnersOnce } from '../../src/services/knowledge-link-owner-keep.js';
import { listSecurityIncidents } from '../../src/services/security-incident.js';

requirePostgresWhenAsked('knowledge-link-owner');

type TestStorage = Storage & { close(): void | Promise<void> };
const names = ['sqlite', ...(process.env.DATABASE_URL ? ['postgres-kysely'] : [])];
const providers = new Map<string, TestStorage>();
const OLD_DB = `./test/.knowledge-link-owner-${process.pid}.db`;

beforeAll(async () => {
  for (const name of names) providers.set(name, await createStorage({
    provider: name === 'sqlite' ? 'sqlite' : 'postgres-kysely',
    sqlitePath: ':memory:', dbUrl: process.env.DATABASE_URL,
  }) as TestStorage);
}, 60_000);
afterAll(async () => {
  for (const s of providers.values()) await s.close();
  for (const suffix of ['', '-wal', '-shm']) if (existsSync(OLD_DB + suffix)) { try { rmSync(OLD_DB + suffix); } catch { /* the test's own scratch */ } }
});

const now = new Date().toISOString();
const row = (source: string, target: string, description: string, linkedBy: string): MemoryLinkRecord =>
  ({ source, target, relation: 'related-to', description, linked_at: now, linked_by: linkedBy });

async function owner(s: Storage, name: string, node: string): Promise<string> {
  await s.createOwner({ name, displayName: name, publicKey: 'pk', roles: ['owner'], createdAt: now });
  await s.createGHII({ ghii: `${name}@${node}`, username: name, nodeId: node, ownerName: name, displayName: name,
    verificationLevel: 0, totpEnabled: false, createdAt: now, updatedAt: now });
  return `${name}@${node}`;
}
async function manifest(s: Storage, ownerGaii: string, key: string): Promise<void> {
  await s.setMemory({ key, ownerGaii, value: { type: 'knowledge-package' }, visibility: 'private', tags: ['knowledge-package'],
    ttlHours: null, version: 1, createdAt: now, updatedAt: now });
}

describe.each(names)('%s: knowledge link rows', provider => {
  const tag = randomUUID().slice(0, 8);
  const NODE = `klo-${tag}`;

  it('acts on one namespace\'s rows: list, upsert and delete', async () => {
    const s = providers.get(provider)!;
    const a = `a${tag}@${NODE}`, b = `b${tag}@${NODE}`;
    const src = `packages/${tag}-1/manifest`, tgt = `packages/${tag}-t/manifest`;
    await s.createLink(row(src, tgt, 'A-private', a), a);
    await s.createLink(row(src, tgt, 'B-text', b), b);
    await s.createLink(row(src, tgt, 'A-again', a), a);       // the upsert replaces A's own row only

    const ofA = await s.listLinks(src, { direction: 'outgoing', sourceOwner: a });
    expect(ofA.map(l => l.description)).toEqual(['A-again']);
    expect(Object.keys(ofA[0]).sort()).toEqual(['description', 'linked_at', 'linked_by', 'relation', 'source', 'target']);
    expect((await s.listLinks(src, { direction: 'outgoing', sourceOwner: b })).map(l => l.description)).toEqual(['B-text']);
    expect(await s.listLinks(src, { direction: 'outgoing' })).toEqual([]);
    expect((await s.listLinks(src, { sourceOwner: b })).map(l => l.description)).toEqual(['B-text']);
    expect((await s.listLinks(tgt, { direction: 'incoming' })).map(l => l.description).sort()).toEqual(['A-again', 'B-text']);

    expect(await s.deleteLink(src, tgt, b)).toBe(true);
    expect((await s.listLinks(src, { direction: 'outgoing', sourceOwner: a })).map(l => l.description)).toEqual(['A-again']);
    expect(await s.deleteLink(src, tgt, b)).toBe(false);
  });

  it('broken links are one namespace\'s rows whose source or target is not there', async () => {
    const s = providers.get(provider)!;
    const a = await owner(s, `br${tag}`, NODE);
    const src = `packages/${tag}-br/manifest`, there = `packages/${tag}-there/manifest`, gone = `packages/${tag}-gone/manifest`;
    await manifest(s, a, src);
    await manifest(s, a, there);
    await s.createLink(row(src, there, 'there', a), a);
    await s.createLink(row(src, gone, 'gone', a), a);
    expect((await s.findBrokenLinks(a, src)).map(l => l.description)).toEqual(['gone']);
    expect(await s.findBrokenLinks(`other${tag}@${NODE}`, src)).toEqual([]);
  });

  it('eraseOwner takes the rows the person contributed, older bare-name rows included, and their packages\' rows', async () => {
    const s = providers.get(provider)!;
    const dName = `d${tag}`, keepName = `k${tag}`;
    const d = await owner(s, dName, NODE);
    const keep = await owner(s, keepName, NODE);
    const pub = `packages/${tag}-pub/manifest`;
    await s.createLink(row(`packages/${tag}-d1/manifest`, pub, 'D-ghii', d), d);
    await s.createLink(row(`packages/${tag}-d2/manifest`, pub, 'D-bare', dName), '');         // written before 2026-10-22
    await s.createLink(row(`packages/${tag}-k1/manifest`, pub, 'K-row', keep), keep);

    const { deletionLog } = await eraseOwner(s, NODE, dName);
    expect(deletionLog.some(l => l.startsWith('knowledge_links:'))).toBe(true);
    expect((await s.listLinks(pub, { direction: 'incoming' })).map(l => l.description)).toEqual(['K-row']);
  });

  it('the start step places older rows on evidence, records the rest, and runs once', async () => {
    const s = providers.get(provider)!;
    const node = `klp-${tag}`;
    const alice = `al${tag}`, bob = `bo${tag}`;
    const aliceGhii = await owner(s, alice, node);
    const bobGhii = await owner(s, bob, node);
    const agent = `bot#${alice}@${node}`;
    await s.createAgent({ name: 'bot', owner: alice, gaii: agent, publicKey: 'pk', trustScore: 50, morselBalance: 0,
      capabilities: [], createdAt: now, lastSeen: now });
    const k = (n: string) => `packages/${tag}-${n}/manifest`;
    const t = `packages/${tag}-target/manifest`;
    await manifest(s, aliceGhii, k('own'));
    await manifest(s, agent, k('agent'));
    await manifest(s, bobGhii, k('bob'));
    await manifest(s, aliceGhii, k('both'));
    await manifest(s, agent, k('both'));
    for (const [n, by] of [['own', alice], ['agent', alice], ['gone', alice], ['erased', `ghost${tag}`], ['bob', alice], ['both', alice]] as const) {
      await s.createLink(row(k(n), t, n, by), '');
    }

    const first = await placeKnowledgeLinkOwnersOnce(s, { nodeId: node });
    expect(first.ran).toBe(true);
    expect((await s.listLinks(k('own'), { direction: 'outgoing', sourceOwner: aliceGhii })).map(l => [l.description, l.linked_by]))
      .toEqual([['own', aliceGhii]]);
    expect((await s.listLinks(k('agent'), { direction: 'outgoing', sourceOwner: agent })).map(l => l.description)).toEqual(['agent']);
    // Another account's record at the key never owned the row.
    expect(await s.listLinks(k('bob'), { direction: 'outgoing', sourceOwner: bobGhii })).toEqual([]);
    const incoming = await s.listLinks(t, { direction: 'incoming' });
    expect(incoming.map(l => l.description).sort()).toEqual(['agent', 'bob', 'both', 'gone', 'own']);
    expect(incoming.find(l => l.description === 'gone')?.linked_by).toBe(aliceGhii);
    const unplaced = (await s.listUnplacedLinks()).filter(l => l.target === t).map(l => l.description).sort();
    expect(unplaced).toEqual(['bob', 'both', 'gone']);

    const { items } = await listSecurityIncidents(s, { nodeId: node } as never);
    const incident = items.find(i => i.code === 'KNOWLEDGE_LINK_OWNER_UNPLACED' && i.detail.includes(k('bob')));
    expect(incident?.detail).toContain(k('both'));

    const second = await placeKnowledgeLinkOwnersOnce(s, { nodeId: node });
    expect(second.ran).toBe(false);
  });
});

describe('sqlite: an older knowledge_links table', () => {
  it('is rebuilt keyed on the owner, with every row carried over unplaced', async () => {
    const old = new Database(OLD_DB);
    old.exec(`CREATE TABLE knowledge_links (
      source TEXT NOT NULL, target TEXT NOT NULL, relation TEXT NOT NULL, description TEXT NOT NULL,
      linked_at TEXT NOT NULL, linked_by TEXT NOT NULL, PRIMARY KEY (source, target));`);
    old.prepare('INSERT INTO knowledge_links VALUES (?, ?, ?, ?, ?, ?)').run('packages/old/manifest', 'packages/t/manifest', 'related-to', 'older', now, 'alice');
    old.close();

    const s = await createStorage({ provider: 'sqlite', sqlitePath: OLD_DB }) as TestStorage;
    try {
      expect((await s.listUnplacedLinks()).map(l => [l.source, l.description, l.linked_by])).toEqual([['packages/old/manifest', 'older', 'alice']]);
      await s.createLink(row('packages/old/manifest', 'packages/t/manifest', 'placed', 'alice@n'), 'alice@n');
      expect((await s.listLinks('packages/t/manifest', { direction: 'incoming' })).length).toBe(2);
    } finally {
      await s.close();
    }
  });
});
