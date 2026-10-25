/**
 * @file test/unit/storage-conformance-lifecycle.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description How rows that nobody uses any more go away, on both providers: an MCP client
 *   registration that no sign-in finished (secaudit2026oct22, dcr-unbounded-client-records). Each case
 *   runs on every configured provider and, where both run, requires the same answer.
 *
 *   A run without DATABASE_URL checks SQLite only, and a configured Postgres that does not connect
 *   fails the suite.
 * @structure provs · onEach / same · cases
 * @usage cd aimeat && DATABASE_URL=postgresql://… pnpm exec vitest run test/unit/storage-conformance-lifecycle.test.ts
 * @version-history
 *   2026-10-25 — Initial (secaudit2026oct22): deleteUnusedOAuthClients and the daily MCP client cleanup.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { rmSync, existsSync } from 'node:fs';
import { createStorage } from '../../src/storage/storage-factory.js';
import type { Storage } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';
import { runMcpClientCleanup } from '../../src/services/mcp-client-cleanup.js';

const SQLITE_PATH = `./test/.conformance-lifecycle-${process.pid}.db`;
const PG_URL = process.env.DATABASE_URL ?? '';
const REQUIRE_POSTGRES = process.env.AIMEAT_CONFORMANCE_REQUIRE_POSTGRES === 'true';

interface Provider { name: string; storage: Storage }
const provs: Provider[] = [];
const RUN = randomUUID().slice(0, 8);

beforeAll(async () => {
  if (REQUIRE_POSTGRES && !PG_URL) throw new Error('Postgres conformance requires DATABASE_URL.');
  provs.push({ name: 'sqlite', storage: await createStorage({ provider: 'sqlite', sqlitePath: SQLITE_PATH }) });
  if (PG_URL) provs.push({ name: 'postgres-kysely', storage: await createStorage({ provider: 'postgres-kysely', dbUrl: PG_URL }) });
  console.info(`[conformance-lifecycle] providers checked: ${provs.map(p => p.name).join(', ')}`);
}, 60_000);

afterAll(async () => {
  for (const { storage } of provs) await (storage as unknown as { close?: () => void | Promise<void> }).close?.();
  for (const suffix of ['', '-wal', '-shm']) {
    const p = SQLITE_PATH + suffix;
    if (existsSync(p)) { try { rmSync(p); } catch { /* the test's own scratch file */ } }
  }
});

/** Run `fn` on every provider and return the results keyed by provider name. */
async function onEach<T>(fn: (s: Storage, p: string) => Promise<T>): Promise<Record<string, T>> {
  const out: Record<string, T> = {};
  for (const { name, storage } of provs) out[name] = await fn(storage, `${RUN}${name.slice(0, 2)}`);
  return out;
}

/** Where both providers ran, they must agree. */
function same<T>(results: Record<string, T>): T {
  const values = Object.values(results);
  for (const v of values.slice(1)) expect(v).toEqual(values[0]);
  return values[0]!;
}

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();
const cfg = (mcpUnusedClientDays: number) => ({ mcpUnusedClientDays }) as unknown as AimeatConfig;

describe('MCP client registrations nobody uses (secaudit2026oct22, dcr-unbounded-client-records)', () => {
  it('the daily cleanup deletes an old registration with no refresh token and no approval, and keeps the rest', async () => {
    const r = await onEach(async (s, p) => {
      const id = (n: string) => `mcp_${p}_${n}`;
      const client = (n: string, createdAt: string) => s.createOAuthClient({
        clientId: id(n), clientSecret: '', clientName: `client ${n}`, redirectUris: ['http://127.0.0.1:1/cb'], createdAt,
      });
      await client('oldunused', ago(40));
      await client('oldtoken', ago(40));
      await client('oldapproved', ago(40));
      await client('newunused', ago(5));
      await s.createOAuthRefreshToken({ tokenHash: `h_${p}`, clientId: id('oldtoken'), gaii: `a@${p}`, owner: `a${p}`, roles: ['owner'], createdAt: ago(39) });
      await s.createOAuthApproval({ clientId: id('oldapproved'), gaii: `a@${p}`, owner: `a${p}`, scope: 'aimeat:full', approvedAt: ago(39) });

      const off = await runMcpClientCleanup(s, cfg(0));
      const afterOff = await Promise.all(['oldunused', 'oldtoken', 'oldapproved', 'newunused'].map(async n => !!(await s.getOAuthClient(id(n)))));
      const removed = await runMcpClientCleanup(s, cfg(30));
      const kept = await Promise.all(['oldunused', 'oldtoken', 'oldapproved', 'newunused'].map(async n => !!(await s.getOAuthClient(id(n)))));
      // The storage method on its own: a cutoff in the future reaches the new registration too.
      const direct = await s.deleteUnusedOAuthClients(new Date(Date.now() + DAY).toISOString());
      const left = await Promise.all(['oldtoken', 'oldapproved', 'newunused'].map(async n => !!(await s.getOAuthClient(id(n)))));
      await s.deleteOAuthRefreshToken(`h_${p}`);
      return { off, afterOff, removed: removed >= 1, kept, direct: direct >= 1, left };
    });
    const v = same(r);
    expect(v.off).toBe(0);
    expect(v.afterOff).toEqual([true, true, true, true]);
    expect(v.removed).toBe(true);
    expect(v.kept).toEqual([false, true, true, true]);
    expect(v.direct).toBe(true);
    expect(v.left).toEqual([true, true, false]);
  });
});
