/**
 * @file test/unit/storage-conformance-classification.test.ts
 * @author Jouni Miikki
 * @description The two storage providers agree on the classification tables (TARGET-082): the
 *   classification audit log's upsert and the content labels' prefix read. Same pattern as
 *   storage-conformance.test.ts: SQLite always; Postgres when DATABASE_URL is set, where a connection
 *   error fails the suite, and AIMEAT_CONFORMANCE_REQUIRE_POSTGRES=true refuses a missing URL.
 *
 *   - addClassificationAudit merges rows with the same address (minute, reader, action, scope, kind,
 *     key) across calls and inside one batch: counts add, firstAt is the earliest, lastAt the latest;
 *   - a row older than the stored one never overwrites its label or reader kind (a retried flush);
 *     a newer one does;
 *   - getContentLabelsUnder returns the rows of one kind and scope whose key starts with a prefix,
 *     taking the prefix literally ('_' and '%' are characters, not wildcards), and nothing else.
 * @usage cd aimeat && pnpm exec vitest run test/unit/storage-conformance-classification.test.ts
 *   (with DATABASE_URL=postgresql://… for the Postgres half)
 * @version-history
 *   v1.0.0 — 2026-09-30 — Initial (TARGET-082 test gaps).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { rmSync, existsSync } from 'node:fs';
import { createStorage } from '../../src/storage/storage-factory.js';
import type { Storage, ClassificationAuditRow, ContentLabelRow } from '../../src/storage/interface.js';

const SQLITE_PATH = `./test/.conformance-classification-${process.pid}.db`;
const PG_URL = process.env.DATABASE_URL ?? '';
const REQUIRE_POSTGRES = process.env.AIMEAT_CONFORMANCE_REQUIRE_POSTGRES === 'true';

interface Provider { name: string; storage: Storage }
const provs: Provider[] = [];
/** Scopes this run wrote under, removed at the end so a shared Postgres database keeps nothing. */
const scopes = new Set<string>();

beforeAll(async () => {
  if (REQUIRE_POSTGRES && !PG_URL) {
    throw new Error('Postgres conformance requires DATABASE_URL; a SQLite-only run cannot satisfy this check.');
  }
  provs.push({ name: 'sqlite', storage: await createStorage({ provider: 'sqlite', sqlitePath: SQLITE_PATH }) });
  if (PG_URL) {
    provs.push({ name: 'postgres-kysely', storage: await createStorage({ provider: 'postgres-kysely', dbUrl: PG_URL }) });
  } else {
    console.warn('[conformance] DATABASE_URL not set — the Postgres half is skipped, sqlite still runs');
  }
  console.info(`[conformance] providers checked: ${provs.map(p => p.name).join(', ')}`);
}, 60_000);

afterAll(async () => {
  for (const { storage } of provs) {
    for (const scope of scopes) {
      await storage.deleteClassificationAuditByScope(scope);
      await storage.deleteContentLabelsByScope(scope);
    }
    await (storage as unknown as { close?: () => void | Promise<void> }).close?.();
  }
  for (const suffix of ['', '-wal', '-shm']) {
    const p = SQLITE_PATH + suffix;
    if (existsSync(p)) { try { rmSync(p); } catch { /* the test's own scratch */ } }
  }
});

function newScope(): string {
  const scope = `conf-${randomUUID()}@test-node`;
  scopes.add(scope);
  return scope;
}

const MINUTE = '2026-09-30T12:00:00.000Z';

function auditRow(scope: string, over: Partial<ClassificationAuditRow> = {}): ClassificationAuditRow {
  return {
    id: randomUUID(), minute: MINUTE, scope, ownerGaii: scope, kind: 'memory', key: 'notes.a', label: 'sisainen',
    reader: `claude#${scope}`, readerKind: 'ai', action: 'shown', purpose: null, count: 1,
    firstAt: '2026-09-30T12:00:10.000Z', lastAt: '2026-09-30T12:00:10.000Z', ...over,
  };
}

function labelRow(scope: string, key: string, kind: ContentLabelRow['kind'] = 'memory'): ContentLabelRow {
  return {
    id: randomUUID(), kind, scope, key, ownerGaii: scope, label: 'luottamuksellinen', source: 'human', locked: true,
    suggestion: null, justification: null, humanSaid: null, history: [], setBy: scope, updatedAt: MINUTE,
  };
}

describe('the storage providers agree on the classification tables (TARGET-082)', () => {
  it('the audit upsert merges one address into one row, across calls and inside a batch', async () => {
    for (const { name, storage } of provs) {
      const scope = newScope();
      await storage.addClassificationAudit([auditRow(scope, { count: 2 })]);
      await storage.addClassificationAudit([
        auditRow(scope, { firstAt: '2026-09-30T12:00:05.000Z', lastAt: '2026-09-30T12:00:20.000Z' }),
        auditRow(scope, { count: 3, firstAt: '2026-09-30T12:00:30.000Z', lastAt: '2026-09-30T12:00:40.000Z', purpose: 'chat' }),
      ]);
      const rows = await storage.listClassificationAudit({ scope });
      expect(rows.length, name).toBe(1);
      expect(rows[0], name).toMatchObject({
        count: 6, firstAt: '2026-09-30T12:00:05.000Z', lastAt: '2026-09-30T12:00:40.000Z', purpose: 'chat',
      });
    }
  });

  it('an older row never overwrites a newer label; a newer row does', async () => {
    for (const { name, storage } of provs) {
      const scope = newScope();
      const at = (s: number) => `2026-09-30T12:00:${String(s).padStart(2, '0')}.000Z`;
      await storage.addClassificationAudit([auditRow(scope, { label: 'luottamuksellinen', readerKind: 'human', firstAt: at(30), lastAt: at(30) })]);
      // A retried flush of an older row, in a call of its own.
      await storage.addClassificationAudit([auditRow(scope, { label: 'sisainen', readerKind: 'ai', firstAt: at(10), lastAt: at(10) })]);
      let [row] = await storage.listClassificationAudit({ scope });
      expect(row, name).toMatchObject({ label: 'luottamuksellinen', readerKind: 'human', count: 2, firstAt: at(10), lastAt: at(30) });

      await storage.addClassificationAudit([auditRow(scope, { label: 'erittain-luottamuksellinen', readerKind: 'ai', firstAt: at(50), lastAt: at(50) })]);
      [row] = await storage.listClassificationAudit({ scope });
      expect(row, name).toMatchObject({ label: 'erittain-luottamuksellinen', readerKind: 'ai', count: 3, lastAt: at(50) });
    }
  });

  it('getContentLabelsUnder reads exactly the keys under each prefix, of one kind and one scope', async () => {
    for (const { name, storage } of provs) {
      const scope = newScope();
      const other = newScope();
      const keys = ['doc.a', 'doc.b.c', 'doc', 'docx.a', 'do.c', 'a_b.x', 'axb.y', 'p%q.z', 'pxq.z'];
      for (const k of keys) await storage.putContentLabel(labelRow(scope, k));
      await storage.putContentLabel(labelRow(other, 'doc.other'));
      await storage.putContentLabel(labelRow(scope, 'doc.file', 'file'));

      const got = (await storage.getContentLabelsUnder('memory', scope, ['doc.', 'a_b.', 'p%q.', 'doc.'])).map(r => r.key).sort();
      expect(got, name).toEqual(['a_b.x', 'doc.a', 'doc.b.c', 'p%q.z']);
      const row = (await storage.getContentLabelsUnder('memory', scope, ['doc.a'])).find(r => r.key === 'doc.a');
      expect(row, name).toMatchObject({ scope, kind: 'memory', label: 'luottamuksellinen', locked: true });
      expect(await storage.getContentLabelsUnder('memory', scope, []), name).toEqual([]);
      expect((await storage.getContentLabelsUnder('file', scope, ['doc.'])).map(r => r.key), name).toEqual(['doc.file']);
    }
  });
});
