/**
 * @file test/unit/memory-history-lifecycle.test.ts
 * @description The kept versions of a key do not grow without end, and do not outlive the key:
 *   pruneMemoryHistory keeps the newest N, and purgeDeletedMemory takes a purged key's history with
 *   it, on every provider (SQLite always, PostgreSQL when DATABASE_URL is set).
 * @version-history
 *   v1.0.0 — 2026-11-09 — Initial (services/context/history-keys.ts).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { rmSync, existsSync } from 'node:fs';
import { createStorage } from '../../src/storage/storage-factory.js';
import type { Storage, MemoryRecord } from '../../src/storage/interface.js';

const SQLITE_PATH = `./test/.history-lifecycle-${process.pid}.db`;
const PG_URL = process.env.DATABASE_URL ?? '';
const provs: Array<{ name: string; storage: Storage }> = [];

beforeAll(async () => {
    provs.push({ name: 'sqlite', storage: await createStorage({ provider: 'sqlite', sqlitePath: SQLITE_PATH }) });
    if (PG_URL) provs.push({ name: 'postgres-kysely', storage: await createStorage({ provider: 'postgres-kysely', dbUrl: PG_URL }) });
}, 60_000);

afterAll(async () => {
    for (const { storage } of provs) await (storage as unknown as { close?: () => void | Promise<void> }).close?.();
    for (const suffix of ['', '-wal', '-shm']) {
        const p = SQLITE_PATH + suffix;
        if (existsSync(p)) { try { rmSync(p); } catch { /* the test's own scratch */ } }
    }
});

function rec(owner: string, key: string, n: number): MemoryRecord {
    const now = new Date().toISOString();
    return { key, ownerGaii: owner, value: { n }, visibility: 'owner', tags: [], ttlHours: null, version: n, createdAt: now, updatedAt: now, trackable: true };
}

describe('the history of a key that keeps it', () => {
    it('pruneMemoryHistory keeps the newest N versions and deletes the older ones', async () => {
        for (const { name, storage } of provs) {
            const owner = `hist${Date.now()}${Math.floor(Math.random() * 1e4)}@node`;
            const key = 'context.prune';
            for (let i = 1; i <= 8; i++) await storage.setMemory(rec(owner, key, i));
            expect((await storage.listMemoryHistory(owner, key)).map(v => v.version), `${name}: seeded`).toEqual([7, 6, 5, 4, 3, 2, 1]);
            expect(await storage.pruneMemoryHistory(owner, key, 3), `${name}: removed`).toBe(4);
            expect((await storage.listMemoryHistory(owner, key)).map(v => v.version), `${name}: kept`).toEqual([7, 6, 5]);
            expect(await storage.pruneMemoryHistory(owner, key, 3), `${name}: nothing more`).toBe(0);
            expect((await storage.getMemory(owner, key))?.value, `${name}: the record itself`).toEqual({ n: 8 });
        }
    });

    it('purging a deleted key takes its history with it, and leaves another key\'s history alone', async () => {
        for (const { name, storage } of provs) {
            const owner = `purge${Date.now()}${Math.floor(Math.random() * 1e4)}@node`;
            for (let i = 1; i <= 3; i++) {
                await storage.setMemory(rec(owner, 'context.gone', i));
                await storage.setMemory(rec(owner, 'context.kept', i));
            }
            await storage.deleteMemory(owner, 'context.gone');
            expect((await storage.listMemoryHistory(owner, 'context.gone')).length, `${name}: in the bin, history stays`).toBe(2);
            await storage.purgeDeletedMemory(new Date(Date.now() + 60_000).toISOString());
            expect((await storage.listMemoryHistory(owner, 'context.gone')).length, `${name}: purged`).toBe(0);
            expect((await storage.listMemoryHistory(owner, 'context.kept')).length, `${name}: the other key`).toBe(2);
        }
    });
});
