/**
 * @file account-records-erasure.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description QA audit 2026-10-14, K3: the 28 identity columns an account erasure decides by one list
 *   (src/storage/erased-account-records.ts). For every table in the list, on every provider, a row
 *   naming the person and a row naming somebody else are written straight into the database, the
 *   account is deleted, and the person's row must be gone (action delete) or name the erasure's
 *   pseudonym (action pseudonymise), while the other person's row is untouched.
 *
 *   The rows are written generically: every NOT NULL column without a default gets a value of its
 *   type, so a table added to the list is covered without a seed written by hand for it.
 *
 *   A plain local run without DATABASE_URL checks SQLite only, as storage-conformance.test.ts does.
 * @usage cd aimeat && pnpm exec vitest run test/unit/account-records-erasure.test.ts
 * @version-history
 *   2026-10-16 — A run that asks for PostgreSQL and has no DATABASE_URL fails here instead of passing on SQLite alone (QA audit P4-02).
 *   v1.0.0 — 2026-10-14 — Initial (QA audit 2026-10-14, K3).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { requirePostgresWhenAsked } from './postgres-arm.js';
import { randomUUID } from 'node:crypto';
import { rmSync, existsSync } from 'node:fs';
import type pg from 'pg';
import { createStorage } from '../../src/storage/storage-factory.js';
import type { Storage } from '../../src/storage/interface.js';
import { ERASED_ACCOUNT_RECORDS, type ErasedAccountRecordRule } from '../../src/storage/erased-account-records.js';

requirePostgresWhenAsked('account-records-erasure');

const SQLITE_PATH = `./test/.account-erasure-${process.pid}.db`;
const PG_URL = process.env.DATABASE_URL ?? '';
const NODE = 'aimeat-unit-erasure-001';

interface Provider { name: string; storage: Storage }
const provs: Provider[] = [];

interface SqliteHandle { prepare(sql: string): { run(...a: unknown[]): unknown; all(...a: unknown[]): unknown[]; get(...a: unknown[]): unknown } }
const sqliteDb = (s: Storage): SqliteHandle => (s as unknown as { db: SqliteHandle }).db;
const pgPool = (s: Storage): pg.Pool => (s as unknown as { pool: pg.Pool }).pool;

beforeAll(async () => {
    provs.push({ name: 'sqlite', storage: await createStorage({ provider: 'sqlite', sqlitePath: SQLITE_PATH }) });
    if (PG_URL) provs.push({ name: 'postgres-kysely', storage: await createStorage({ provider: 'postgres-kysely', dbUrl: PG_URL }) });
}, 60_000);

afterAll(async () => {
    for (const { storage } of provs) await (storage as unknown as { close?: () => void | Promise<void> }).close?.();
    for (const suffix of ['', '-wal', '-shm']) {
        const p = SQLITE_PATH + suffix;
        if (existsSync(p)) { try { rmSync(p); } catch { /* the test's own scratch file */ } }
    }
});

/** Columns whose CHECK constraint names the values it takes: one allowed value each, by column name. */
const ALLOWED: Record<string, unknown> = { kind: 'app' };

/** A value of the column's type, unique enough for any unique index. */
function sqliteValue(type: string, name: string): unknown {
    const t = type.toUpperCase();
    if (t.includes('INT') || t.includes('REAL') || t.includes('NUM')) return 0;
    if (/at$/i.test(name)) return new Date().toISOString();
    return `x-${randomUUID()}`;
}

/** Write one row into `rule`'s table naming `identity`, every other required column given a value. */
async function seedRow(provider: string, s: Storage, rule: ErasedAccountRecordRule, identity: string): Promise<string> {
    const marker = `row-${randomUUID()}`;
    if (provider === 'sqlite') {
        const cols = sqliteDb(s).prepare(`PRAGMA table_info(${rule.sqlite})`).all() as Array<{ name: string; type: string; notnull: number; dflt_value: unknown; pk: number }>;
        const values: Record<string, unknown> = {};
        for (const c of cols) {
            if (c.name === rule.column) continue;
            if (c.notnull || c.pk) values[c.name] = c.dflt_value !== null && !c.pk ? undefined : (c.name in ALLOWED ? ALLOWED[c.name] : sqliteValue(c.type, c.name));
        }
        for (const k of Object.keys(values)) if (values[k] === undefined) delete values[k];
        values[rule.column] = identity;
        const names = Object.keys(values);
        const r = sqliteDb(s).prepare(`INSERT INTO ${rule.sqlite} (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`)
            .run(...names.map(n => values[n])) as { lastInsertRowid: number | bigint };
        // _rowid_ names the row whatever its key is, including a key that holds the identity column itself.
        // Not 'rowid': workspace_rows has a column rowId, and SQLite names are not case-sensitive.
        return `_rowid_=${String(r.lastInsertRowid)}`;
    }
    const pool = pgPool(s);
    const cols = (await pool.query(
        `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name = $1`, [rule.pg],
    )).rows as Array<{ column_name: string; data_type: string; is_nullable: string; column_default: string | null }>;
    const pk = (await pool.query(
        `SELECT a.attname FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
          WHERE i.indrelid = $1::regclass AND i.indisprimary`, [`"${rule.pg}"`],
    )).rows.map((r: { attname: string }) => r.attname);
    const values: Record<string, unknown> = {};
    for (const c of cols) {
        if (c.column_name === rule.column) continue;
        if (c.is_nullable === 'YES' || (c.column_default !== null && !pk.includes(c.column_name))) continue;
        const t = c.data_type;
        values[c.column_name] = c.column_name in ALLOWED ? ALLOWED[c.column_name] : /int|numeric|double|real/.test(t) ? 0
            : t === 'boolean' ? false
            : t.startsWith('timestamp') || t === 'date' ? new Date()
            : t === 'jsonb' || t === 'json' ? '{}'
            : t === 'ARRAY' ? '{}'
            : t === 'uuid' ? randomUUID()
            : `x-${randomUUID()}`;
    }
    // A column the erasure does not change names the row: a key column other than the identity
    // column, or else a text column this seed filled with a unique value.
    const idCol = pk.find(c => c !== rule.column)
        ?? Object.keys(values).find(k => typeof values[k] === 'string' && String(values[k]).startsWith('x-'))
        ?? 'id';
    values[idCol] = cols.find(c => c.column_name === idCol)?.data_type === 'uuid' ? randomUUID() : marker;
    values[rule.column] = identity;
    const names = Object.keys(values);
    await pool.query(
        `INSERT INTO "${rule.pg}" (${names.map(n => `"${n}"`).join(', ')}) VALUES (${names.map((_, i) => `$${i + 1}`).join(', ')})`,
        names.map(n => values[n]),
    );
    return `${idCol}=${String(values[idCol])}`;
}

/** The identity column of the row seeded under `ref`, or undefined when the row is gone. */
async function columnOf(provider: string, s: Storage, rule: ErasedAccountRecordRule, ref: string): Promise<string | undefined> {
    const [idCol, id] = [ref.slice(0, ref.indexOf('=')), ref.slice(ref.indexOf('=') + 1)];
    if (provider === 'sqlite') {
        const row = sqliteDb(s).prepare(`SELECT ${rule.column} AS v FROM ${rule.sqlite} WHERE ${idCol} = ?`).get(id) as { v: string } | undefined;
        return row?.v;
    }
    const r = await pgPool(s).query(`SELECT "${rule.column}" AS v FROM "${rule.pg}" WHERE "${idCol}"::text = $1`, [id]);
    return r.rows[0]?.v;
}

describe('account erasure decides the 28 identity columns (QA audit 2026-10-14, K3)', () => {
    it('each row naming the person is deleted or names the pseudonym, and another person\'s row is untouched', async () => {
        for (const { name, storage } of provs) {
            const owner = `erase${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
            const ghii = `${owner}@${NODE}`;
            const stranger = `stranger${Date.now().toString(36)}@${NODE}`;
            const at = new Date().toISOString();
            await storage.createOwner({ name: owner, displayName: owner, publicKey: 'pk', roles: ['owner'], createdAt: at } as never);
            await storage.createGHII({
                username: owner, nodeId: NODE, ghii, displayName: owner, verificationLevel: 0,
                ownerName: owner, totpEnabled: false, morselBalance: 0, loginCount: 0, createdAt: at, updatedAt: at,
            } as never);

            const seeded: Array<{ rule: ErasedAccountRecordRule; mine: string; theirs: string }> = [];
            for (const rule of ERASED_ACCOUNT_RECORDS) {
                seeded.push({ rule, mine: await seedRow(name, storage, rule, ghii), theirs: await seedRow(name, storage, rule, stranger) });
            }

            await storage.deleteOwner(owner);

            for (const { rule, mine, theirs } of seeded) {
                const after = await columnOf(name, storage, rule, mine);
                if (rule.action === 'delete') expect.soft(after, `${name}: ${rule.pg}.${rule.column} survived the erasure`).toBeUndefined();
                else expect.soft(after, `${name}: ${rule.pg}.${rule.column} still names the person`).toMatch(/^erased:[0-9a-f]{24}(\.\d+)?$/);
                expect.soft(await columnOf(name, storage, rule, theirs), `${name}: ${rule.pg} row of another person changed`).toBe(stranger);
            }
        }
    }, 120_000);
});
