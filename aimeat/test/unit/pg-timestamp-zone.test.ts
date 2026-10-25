/**
 * @file test/unit/pg-timestamp-zone.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A time the node writes to PostgreSQL reads back as the same instant whatever the host's
 *   time zone. Most columns are `TIMESTAMP(3)` without a zone. node-pg used to write a Date in the
 *   host's local time and read a zoneless value as local time, so on a host east of UTC a time inside
 *   the autumn fold hour (the hour that occurs twice) read back one hour early: a fresh sign-in code
 *   read as expired from 01:00 to 02:00 UTC on 2026-10-25 on a Finnish-time machine.
 *
 *   The file runs in its own process (vitest forks), so the zone set below reaches nothing else.
 *   PostgreSQL only: SQLite stores ISO strings and has no zone to lose.
 *
 *   cd aimeat && node --env-file=.env.test.postgres-kysely --import tsx node_modules/vitest/vitest.mjs run test/unit/pg-timestamp-zone.test.ts
 * @version-history
 *   2026-10-25 — Initial (secaudit2026oct22, the DST fold hour on a non-UTC host).
 */
process.env.TZ = 'Europe/Helsinki';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { requirePostgresWhenAsked } from './postgres-arm.js';
import { createStorage } from '../../src/storage/storage-factory.js';
import type { Storage } from '../../src/storage/interface.js';
import type { PostgresKyselyStorage } from '../../src/storage/providers/postgres-kysely/index.js';
import { parseZonelessAsUtc } from '../../src/storage/providers/postgres-kysely/utc-timestamps.js';

requirePostgresWhenAsked('pg-timestamp-zone');

const PG = !!process.env.DATABASE_URL;
let storage: (Storage & { close(): void | Promise<void> }) | null = null;
const states: string[] = [];

beforeAll(async () => {
  if (!PG) return;
  storage = await createStorage({ provider: 'postgres-kysely', dbUrl: process.env.DATABASE_URL }) as Storage & { close(): void | Promise<void> };
}, 60_000);

afterAll(async () => {
  if (!storage) return;
  for (const s of states) await storage.deleteVerificationNonce(s).catch(() => undefined);
  await storage.close();
});

/** Write a verification nonce whose times are the given instants, and read it back. */
async function roundTrip(createdAt: string, expiresAt: string) {
  const state = `tz-${randomUUID()}`;
  states.push(state);
  await storage!.createVerificationNonce({
    id: randomUUID(), owner: '', type: 'google_login', state, nonce: 'n', redirectUri: '/', createdAt, expiresAt,
  });
  return storage!.getVerificationNonce(state);
}

describe('parseZonelessAsUtc', () => {
  it('reads the printed value as UTC, never as the host zone', () => {
    expect(parseZonelessAsUtc('2026-10-25 01:30:00.123').toISOString()).toBe('2026-10-25T01:30:00.123Z');
    expect(parseZonelessAsUtc('2026-10-25 03:30:00').toISOString()).toBe('2026-10-25T03:30:00.000Z');
  });
  it('hands a value that is not a plain date and time to the driver', () => {
    expect(parseZonelessAsUtc('infinity') as unknown).toBe(Infinity);
  });
});

describe.skipIf(!PG)('postgres-kysely: a zoneless timestamp on a host in Europe/Helsinki', () => {
  it('the host zone really is Europe/Helsinki in this process', () => {
    // 2026-10-25 00:30 UTC is 03:30 EEST (+03), 01:30 UTC is 03:30 EET (+02): the same wall time twice.
    expect(new Date('2026-10-25T00:30:00Z').getTimezoneOffset()).toBe(-180);
    expect(new Date('2026-10-25T01:30:00Z').getTimezoneOffset()).toBe(-120);
  });

  it('a time in the second pass of the autumn fold hour reads back as the same instant', async () => {
    const row = await roundTrip('2026-10-25T01:30:00.000Z', '2026-10-25T01:45:00.000Z');
    expect(row).not.toBeNull();
    expect(new Date(row!.createdAt).toISOString()).toBe('2026-10-25T01:30:00.000Z');
    expect(new Date(row!.expiresAt).toISOString()).toBe('2026-10-25T01:45:00.000Z');
  });

  it('a time outside any transition reads back as the same instant (the ordinary case keeps working)', async () => {
    const row = await roundTrip('2026-07-01T12:00:00.000Z', '2026-07-01T12:15:00.000Z');
    expect(new Date(row!.createdAt).toISOString()).toBe('2026-07-01T12:00:00.000Z');
    expect(new Date(row!.expiresAt).toISOString()).toBe('2026-07-01T12:15:00.000Z');
  });

  it('a column default written by the database (CURRENT_TIMESTAMP) reads back as now', async () => {
    const pool = (storage as unknown as PostgresKyselyStorage).pool;
    const r = await pool.query<{ t: Date }>('SELECT CURRENT_TIMESTAMP::timestamp(3) AS t');
    expect(Math.abs(r.rows[0].t.getTime() - Date.now())).toBeLessThan(60_000);
  });
});
