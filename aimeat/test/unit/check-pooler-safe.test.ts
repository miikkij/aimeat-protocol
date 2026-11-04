/**
 * @file test/unit/check-pooler-safe.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description scripts/check-pooler-safe.ts finds a session advisory lock and a LISTEN statement,
 *   passes the transaction-scoped forms and comment lines, and the tree as it is has no session lock
 *   and LISTENs only in the listed file.
 * @version-history
 *   v1.0.0 — 2026-11-04 — Initial (codebase analysis 2026-11-03, item HA stage 3).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LISTEN_ALLOWED, poolerFindings } from '../../scripts/check-pooler-safe.js';

const kinds = (text: string) => poolerFindings([{ path: 'src/x.ts', text }]).map(f => f.kind);

describe('check:pooler-safe', () => {
  it('finds the session lock forms the boot lock used until 2026-11-04', () => {
    expect(kinds("await client.query('SELECT pg_advisory_lock($1)', [KEY]);")).toEqual(['session-lock']);
    expect(kinds("await client.query('SELECT pg_advisory_unlock($1)', [KEY]);")).toEqual(['session-lock']);
    expect(kinds('sql`SELECT pg_try_advisory_lock(${k})`')).toEqual(['session-lock']);
    expect(kinds("q('select pg_advisory_lock_shared(1)')")).toEqual(['session-lock']);
    expect(kinds("q('SELECT pg_advisory_unlock_all()')")).toEqual(['session-lock']);
  });

  it('passes the transaction-scoped forms and comment lines', () => {
    expect(kinds("await client.query('SELECT pg_advisory_xact_lock($1)', [KEY]);")).toEqual([]);
    expect(kinds('sql`SELECT pg_try_advisory_xact_lock(hashtext(${k}))`')).toEqual([]);
    expect(kinds(' * the boot lock (pg_advisory_lock($1)) was a session lock')).toEqual([]);
    expect(kinds('  // pg_advisory_lock( is refused')).toEqual([]);
  });

  it('finds a LISTEN statement, not the word in prose', () => {
    expect(kinds('await next.query(`LISTEN ${BUS_CHANNEL}`);')).toEqual(['listen']);
    expect(kinds("await c.query('listen my_channel')")).toEqual(['listen']);
    expect(kinds("logger.info('the client LISTENs to receive')")).toEqual([]);
  });

  it('the tree: no session lock anywhere in src/, LISTEN only in the listed file', () => {
    const aimeat = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
    const files: { path: string; text: string }[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(?:ts|js|mjs|sql)$/.test(name)) files.push({ path: relative(aimeat, full).replace(/\\/g, '/'), text: readFileSync(full, 'utf8') });
      }
    };
    walk(join(aimeat, 'src'));
    const found = poolerFindings(files);
    expect(found.filter(f => f.kind === 'session-lock')).toEqual([]);
    expect([...new Set(found.filter(f => f.kind === 'listen').map(f => f.file))]).toEqual(Object.keys(LISTEN_ALLOWED));
  });
});
