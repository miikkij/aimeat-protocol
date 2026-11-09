/**
 * @file test/unit/storage-conformance-batch-reads.test.ts
 * @author Jouni Miikki
 * @description The batch reads that replaced one-query-per-agent loops (performance round 2,
 *   2026-11-09) answer as the single reads did, on both providers: getOnboardingMany as getOnboarding
 *   per agent, storageFileHolders as getStorageFile per identity, listConversationsForParticipants
 *   as listConversationsForParticipant per identity (exact membership: `alice@n` never matches
 *   `alice@n-2`), organismNames as getOrganism(id).name. Same pattern as
 *   storage-conformance-classification.test.ts: SQLite always; Postgres when DATABASE_URL is set.
 * @usage cd aimeat && pnpm exec vitest run test/unit/storage-conformance-batch-reads.test.ts
 *   (with DATABASE_URL=postgresql://… for the Postgres half)
 * @version-history
 *   v1.0.0 — 2026-11-09 — Initial.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { rmSync, existsSync } from 'node:fs';
import { createStorage } from '../../src/storage/storage-factory.js';
import type { Storage, OrganismRecord } from '../../src/storage/interface.js';

const SQLITE_PATH = `./test/.conformance-batch-reads-${process.pid}.db`;
const PG_URL = process.env.DATABASE_URL ?? '';
const REQUIRE_POSTGRES = process.env.AIMEAT_CONFORMANCE_REQUIRE_POSTGRES === 'true';
const NODE = 'batch-node';

interface Provider { name: string; storage: Storage }
const provs: Provider[] = [];
/** What this run wrote, removed at the end so a shared Postgres database keeps nothing. */
const made = { agents: [] as string[], files: [] as Array<[string, string]>, orgs: [] as string[], convs: [] as string[] };

beforeAll(async () => {
  if (REQUIRE_POSTGRES && !PG_URL) throw new Error('Postgres conformance requires DATABASE_URL.');
  provs.push({ name: 'sqlite', storage: await createStorage({ provider: 'sqlite', sqlitePath: SQLITE_PATH }) });
  if (PG_URL) provs.push({ name: 'postgres-kysely', storage: await createStorage({ provider: 'postgres-kysely', dbUrl: PG_URL }) });
  else console.warn('[conformance] DATABASE_URL not set — the Postgres half is skipped, sqlite still runs');
}, 60_000);

afterAll(async () => {
  for (const { name, storage } of provs) {
    for (const gaii of made.agents) await storage.deleteOnboarding(gaii).catch(() => false);
    for (const [owner, key] of made.files) await storage.deleteStorageFile(owner, key).catch(() => false);
    for (const id of made.orgs) await storage.deleteOrganism(id).catch(() => false);
    if (name === 'postgres-kysely' && made.convs.length) {
      // No delete door exists for a conversation; the rows are this run's own, removed by id.
      const db = (storage as unknown as { db: { deleteFrom: (t: string) => { where: (c: string, o: string, v: string[]) => { execute: () => Promise<unknown> } } } }).db;
      await db.deleteFrom('Conversation').where('id', 'in', made.convs).execute();
    }
    await (storage as unknown as { close?: () => void | Promise<void> }).close?.();
  }
  for (const suffix of ['', '-wal', '-shm']) {
    const p = SQLITE_PATH + suffix;
    if (existsSync(p)) { try { rmSync(p); } catch { /* the test's own scratch */ } }
  }
});

const tag = () => randomUUID().slice(0, 8);

describe.each([0, 1])('batch reads, provider %i', (i) => {
  const p = () => provs[i];

  it('getOnboardingMany returns what getOnboarding returns for each agent, and leaves out an agent without one', async () => {
    if (!p()) return;
    const { storage } = p();
    const t = tag();
    const a = `a-${t}#alice@${NODE}`, b = `b-${t}#alice@${NODE}`, none = `c-${t}#alice@${NODE}`;
    for (const gaii of [a, b]) {
      made.agents.push(gaii);
      await storage.createOnboarding({ agentGaii: gaii, status: 'in_progress', startedAt: new Date().toISOString(), steps: [{ id: 'accept_test_task', status: 'completed', details: { testTaskId: `t-${gaii}` } }] } as never);
    }
    const many = await storage.getOnboardingMany([a, b, none]);
    expect(many.map(r => r.agentGaii).sort()).toEqual([a, b].sort());
    for (const r of many) expect(r).toEqual(await storage.getOnboarding(r.agentGaii));
    expect(await storage.getOnboardingMany([])).toEqual([]);
  });

  it('storageFileHolders names exactly the identities that hold the key', async () => {
    if (!p()) return;
    const { storage } = p();
    const t = tag();
    const owner = `alice-${t}@${NODE}`, agent = `bot-${t}#alice-${t}@${NODE}`, other = `x-${t}#alice-${t}@${NODE}`;
    const key = `portfolio-${t}.html`;
    for (const [who, k] of [[agent, key], [other, `${key}.bak`]] as const) {
      made.files.push([who, k]);
      await storage.createStorageFile({ key: k, ownerGaii: who, visibility: 'private', mimeType: 'text/html', size: 2, data: Buffer.from('ok'), createdAt: new Date().toISOString() });
    }
    expect(await storage.storageFileHolders([owner, agent, other], key)).toEqual([agent]);
    for (const who of [owner, agent, other]) expect(!!(await storage.getStorageFile(who, key))).toBe(who === agent);
    expect(await storage.storageFileHolders([], key)).toEqual([]);
  });

  it('listConversationsForParticipants gives each identity what the single lookup gives, exact membership only', async () => {
    if (!p()) return;
    const { storage } = p();
    const t = tag();
    const me = `alice-${t}@${NODE}`, agent = `bot-${t}#alice-${t}@${NODE}`, near = `alice-${t}@${NODE}-2`;
    const at = (n: number) => new Date(Date.UTC(2026, 10, 9, 12, n)).toISOString();
    const conv = async (participants: string[], n: number) => {
      const id = randomUUID();
      made.convs.push(id);
      await storage.createConversation({ id, kind: 'group', participants, createdBy: participants[0], createdAt: at(n), updatedAt: at(n) });
      return id;
    };
    await conv([me, `peer-${t}@${NODE}`], 1);
    await conv([agent, me], 2);
    await conv([near], 3);
    const byId = await storage.listConversationsForParticipants([me, agent, near]);
    for (const who of [me, agent, near]) {
      expect(byId[who].map(c => c.id)).toEqual((await storage.listConversationsForParticipant(who)).map(c => c.id));
    }
    expect(byId[me].length).toBe(2);
    expect(byId[near].length).toBe(1);
    expect(await storage.listConversationsForParticipants([])).toEqual({});
  });

  it('organismNames gives each existing organism its name and leaves out an unknown id', async () => {
    if (!p()) return;
    const { storage } = p();
    const t = tag();
    const ids = [randomUUID(), randomUUID()];
    for (const [n, id] of ids.entries()) {
      made.orgs.push(id);
      const now = new Date().toISOString();
      await storage.createOrganism({
        id, name: `Org ${n} ${t}`, description: '', type: 'project', interests: [], creatorGhii: `alice@${NODE}`, createdBy: `alice@${NODE}`,
        owners: [`alice@${NODE}`], admins: [], members: [], agentGaiis: [], boardId: '', joinPolicy: 'invite_only', maxMembers: 10,
        visibility: 'private', moderationConfig: { flagsEnabled: false, autoHideThreshold: 3, appealsEnabled: false },
        memoryNamespace: `organism.${id}`, createdAt: now, updatedAt: now,
      } as OrganismRecord);
    }
    const names = await storage.organismNames([...ids, randomUUID()]);
    expect(names).toEqual({ [ids[0]]: `Org 0 ${t}`, [ids[1]]: `Org 1 ${t}` });
    for (const id of ids) expect(names[id]).toBe((await storage.getOrganism(id))?.name);
  });
});
