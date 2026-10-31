/**
 * @file test/unit/storage-overview-activity.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The two storage reads behind the overview's activity counts, on both providers:
 *   listKeyActivity (key, owner and updatedAt under a key prefix since a time, newest first, never
 *   the value, no archived row, no bin, no `.version.N` row, a literal prefix, a clamped limit) and
 *   the done24h / done30d fields of countTasksByOwner (rolling windows, done tasks only).
 *
 *   Postgres is optional, as in storage-file-range.test.ts: without DATABASE_URL the SQLite arm runs
 *   alone and says so; with AIMEAT_CONFORMANCE_REQUIRE_POSTGRES=true a missing URL fails the file.
 * @usage cd aimeat && pnpm exec vitest run test/unit/storage-overview-activity.test.ts
 * @version-history
 *   2026-10-31 — Initial (the overview feature's storage additions).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { rmSync, existsSync } from 'node:fs';
import { requirePostgresWhenAsked } from './postgres-arm.js';
import { createStorage } from '../../src/storage/storage-factory.js';
import type { Storage, AgentTaskRecord } from '../../src/storage/interface.js';

requirePostgresWhenAsked('storage-overview-activity');

const SQLITE_PATH = `./test/.overview-activity-${process.pid}.db`;
const PG_URL = process.env.DATABASE_URL ?? '';
const RUN = `ov${process.pid}x${Date.now().toString(36)}`;

interface Provider { name: string; storage: Storage }
const provs: Provider[] = [];

beforeAll(async () => {
  provs.push({ name: 'sqlite', storage: await createStorage({ provider: 'sqlite', sqlitePath: SQLITE_PATH }) });
  if (PG_URL) {
    try {
      provs.push({ name: 'postgres-kysely', storage: await createStorage({ provider: 'postgres-kysely', dbUrl: PG_URL }) });
    } catch (err) {
      console.warn(`[overview-activity] postgres unavailable, sqlite only: ${String(err)}`);
    }
  } else {
    console.warn('[overview-activity] DATABASE_URL not set: postgres arm skipped, sqlite still runs');
  }
}, 60_000);

afterAll(async () => {
  for (const { storage } of provs) {
    await (storage as unknown as { close?: () => void | Promise<void> }).close?.();
  }
  for (const suffix of ['', '-wal', '-shm']) {
    const p = SQLITE_PATH + suffix;
    if (existsSync(p)) { try { rmSync(p); } catch { /* the test's own scratch file */ } }
  }
});

const HOUR = 3_600_000;
const ago = (ms: number): string => new Date(Date.now() - ms).toISOString();

async function put(s: Storage, ownerGaii: string, key: string, updatedAt: string): Promise<void> {
  await s.setMemory({
    key, ownerGaii, value: { body: 'secret text' }, visibility: 'private', tags: [], ttlHours: null,
    version: 1, createdAt: updatedAt, updatedAt,
  });
}

function task(id: string, ownerGaii: string, agentGaii: string, status: AgentTaskRecord['status'], completedAt?: string): AgentTaskRecord {
  const now = new Date().toISOString();
  return {
    id, agentGaii, ownerGaii, title: id, description: '', scope: [], rules: [],
    verification: { userExpects: '', technicalChecks: [] }, todos: [], status,
    createdAt: now, updatedAt: now, ...(completedAt ? { completedAt } : {}),
  };
}

describe('listKeyActivity', () => {
  it('returns only live keys under the prefix changed since the time, newest first, without the value', async () => {
    for (const { name, storage } of provs) {
      const tag = `${RUN}${name.slice(0, 2)}`;
      const alice = `alice${tag}@test-node`;
      const bob = `bob${tag}@test-node`;
      const prefix = `ws.${tag}_a.`;
      await put(storage, alice, `${prefix}doc1`, ago(1 * HOUR));
      await put(storage, bob, `${prefix}doc2`, ago(2 * HOUR));            // another owner: included
      await put(storage, alice, `${prefix}old`, ago(48 * HOUR));          // older than since
      await put(storage, alice, `${prefix}doc1.version.3`, ago(1 * HOUR)); // history row
      await put(storage, alice, `${prefix}archived`, ago(1 * HOUR));
      await storage.archiveMemoryByKey(`${prefix}archived`, { archivedRoot: prefix, archivedBy: alice, archivedAt: ago(0), match: 'exact' });
      await put(storage, alice, `${prefix}binned`, ago(1 * HOUR));
      await storage.deleteMemory(alice, `${prefix}binned`, alice);
      await put(storage, alice, `ws.${tag}Xa.doc`, ago(1 * HOUR));          // `_` is literal, not a wildcard
      await put(storage, alice, `other.${tag}.doc`, ago(1 * HOUR));         // outside the prefix

      const rows = await storage.listKeyActivity(prefix, ago(24 * HOUR), 100);
      expect(rows.map(r => r.key), name).toEqual([`${prefix}doc1`, `${prefix}doc2`]);
      expect(rows.map(r => r.ownerGaii), name).toEqual([alice, bob]);
      for (const r of rows) {
        expect(Object.keys(r).sort(), name).toEqual(['key', 'ownerGaii', 'updatedAt']);
        expect(r.updatedAt, name).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      }

      // The limit is a ceiling and is clamped to at least one row.
      expect((await storage.listKeyActivity(prefix, ago(24 * HOUR), 1)).map(r => r.key), name).toEqual([`${prefix}doc1`]);
      expect(await storage.listKeyActivity(prefix, ago(24 * HOUR), 0), name).toHaveLength(1);

      await storage.deleteAllMemory(alice);
      await storage.deleteAllMemory(bob);
    }
  });
});

describe('countTasksByOwner done24h and done30d', () => {
  it('counts done tasks in rolling 24-hour and 30-day windows, beside the existing fields', async () => {
    for (const { name, storage } of provs) {
      const tag = `${RUN}${name.slice(0, 2)}t`;
      const owner = `owner${tag}@test-node`;
      const a1 = `a1#${owner}`;
      const a2 = `a2#${owner}`;
      const tasks = [
        task(`${tag}-1`, owner, a1, 'done', ago(1 * HOUR)),
        task(`${tag}-2`, owner, a1, 'done', ago(23 * HOUR)),
        task(`${tag}-3`, owner, a1, 'done', ago(25 * HOUR)),    // 30d only
        task(`${tag}-4`, owner, a1, 'done', ago(29 * 24 * HOUR)), // 30d only
        task(`${tag}-5`, owner, a1, 'done', ago(31 * 24 * HOUR)), // neither
        task(`${tag}-6`, owner, a1, 'failed', ago(1 * HOUR)),   // not done
        task(`${tag}-7`, owner, a2, 'queued'),
      ];
      for (const t of tasks) await storage.createAgentTask(t);

      const counts = await storage.countTasksByOwner(owner);
      expect(counts[a1], name).toMatchObject({ done: 5, failed: 1, done24h: 2, done30d: 4 });
      expect(typeof counts[a1].doneToday, name).toBe('number');
      expect(typeof counts[a1].doneWeek, name).toBe('number');
      expect(counts[a2], name).toMatchObject({ queued: 1, done: 0, done24h: 0, done30d: 0 });

      for (const t of tasks) await storage.deleteAgentTask(t.id);
    }
  });
});
