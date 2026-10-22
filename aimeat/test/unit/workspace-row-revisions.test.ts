/**
 * @file workspace-row-revisions.test.ts
 * @description Row revisions against real in-memory SQLite: which replacement keeps the old content,
 *   who stays the row's author, and how revisions age (secaudit 2026-10, v80; developer ruling
 *   2026-10-22).
 *
 *   The writer-family rule is what decides whether a use keeps working unchanged, so each designed
 *   use is one case here: an extension re-ingesting its own rows, the owner and the owner's agent and
 *   app, and the cross-family replacements that must keep a revision (another person's agent over the
 *   owner's row, an extension over a person's row, a person over an extension's row).
 * @usage cd aimeat && pnpm exec vitest run test/unit/workspace-row-revisions.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-22 — Initial (secaudit 2026-10, v80).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage, WorkspaceRowRecord } from '../../src/storage/interface.js';
import {
  writerFamily, settleReplacements, revisionKeepDays, REVISIONS_PER_ROW,
} from '../../src/services/workspace-rows/row-revisions.js';

const ORG = 'org-1';
const WS = 'ws-1';
const NS = 'soc.alerts';
const ALICE = 'alice@node-1';
const ALICE_AGENT = 'bot#alice@node-1';
const ALICE_APP = 'eco:queue-html#alice@node-1';
const BOB_AGENT = 'helper#bob@node-1';
const EXT = 'ext:soc-ingest';

let storage: Storage;
beforeEach(() => { storage = new SqliteStorage(':memory:') as unknown as Storage; });

function rec(rowId: string, by: string, body: Record<string, unknown>, at = '2026-10-22T08:00:00.000Z'): WorkspaceRowRecord {
  return {
    id: `sur-${rowId}-${Math.random().toString(36).slice(2)}`, organismId: ORG, wsId: WS, namespace: NS, rowId,
    k1: '', k2: '', k3: '', occurredAt: at, createdAt: at, updatedAt: at, createdBy: by,
    body, bytes: Buffer.byteLength(JSON.stringify(body), 'utf8'),
  };
}

/** One append as the row service makes it: settle, then write. */
async function append(by: string, rows: WorkspaceRowRecord[], at = new Date().toISOString()): Promise<string[]> {
  const kept = await settleReplacements(storage, by, rows, at);
  await storage.appendWorkspaceRows(rows);
  return kept;
}

describe('writerFamily', () => {
  it('puts a person, their agents and their apps in one family, and keeps an extension and a stranger apart', () => {
    expect(writerFamily(ALICE_AGENT)).toBe(ALICE);
    expect(writerFamily(ALICE_APP)).toBe(ALICE);
    expect(writerFamily(ALICE)).toBe(ALICE);
    expect(writerFamily(BOB_AGENT)).not.toBe(ALICE);
    expect(writerFamily(EXT)).toBe(EXT);
    // The node is half of who a person is: a namesake on another node is another family.
    expect(writerFamily('alice@other-node')).not.toBe(ALICE);
  });
});

describe('the uses that keep no revision', () => {
  it('an extension re-ingesting its own rows replaces them, keeps ext:<name> as the writer, and keeps nothing', async () => {
    await append(EXT, [rec('a1', EXT, { n: 1 }), rec('a2', EXT, { n: 2 })]);
    const kept = await append(EXT, [rec('a1', EXT, { n: 11 }), rec('a2', EXT, { n: 22 })]);
    expect(kept).toEqual([]);
    const got = await storage.getWorkspaceRow(ORG, WS, NS, 'a1');
    expect(got?.body).toEqual({ n: 11 });
    expect(got?.createdBy).toBe(EXT);
    expect(await storage.listWorkspaceRowRevisions(ORG, WS, NS, 'a1')).toEqual([]);
  });

  it('the owner\'s agent and app replacing the owner\'s row keep nothing, and the writer is createdBy as before', async () => {
    await append(ALICE, [rec('r', ALICE, { v: 1 })]);
    expect(await append(ALICE_AGENT, [rec('r', ALICE_AGENT, { v: 2 })])).toEqual([]);
    expect((await storage.getWorkspaceRow(ORG, WS, NS, 'r'))?.createdBy).toBe(ALICE_AGENT);
    expect(await append(ALICE_APP, [rec('r', ALICE_APP, { v: 3 })])).toEqual([]);
    expect(await storage.listWorkspaceRowRevisions(ORG, WS, NS, 'r')).toEqual([]);
  });

  it('a new row keeps nothing and names its writer twice', async () => {
    expect(await append(BOB_AGENT, [rec('new', BOB_AGENT, { v: 1 })])).toEqual([]);
    const got = await storage.getWorkspaceRow(ORG, WS, NS, 'new');
    expect(got?.createdBy).toBe(BOB_AGENT);
    expect(got?.updatedBy).toBe(BOB_AGENT);
  });
});

describe('a replacement across families', () => {
  it('another person\'s agent over the owner\'s row: the old content is kept, the first author stays', async () => {
    await append(ALICE, [rec('r-1', ALICE, { msg: 'original' })]);
    const kept = await append(BOB_AGENT, [rec('r-1', BOB_AGENT, { msg: 'replaced' })]);
    expect(kept).toEqual(['r-1']);
    const row = await storage.getWorkspaceRow(ORG, WS, NS, 'r-1');
    expect(row?.body).toEqual({ msg: 'replaced' });
    expect(row?.createdBy).toBe(ALICE);
    expect(row?.updatedBy).toBe(BOB_AGENT);
    const [rev] = await storage.listWorkspaceRowRevisions(ORG, WS, NS, 'r-1');
    expect(rev.body).toEqual({ msg: 'original' });
    expect(rev.updatedBy).toBe(ALICE);
    expect(rev.replacedBy).toBe(BOB_AGENT);
    expect(rev.id).toBe(row?.id);
    // The same writer again: the content now is its own, so nothing more is kept, and A stays the author.
    expect(await append(BOB_AGENT, [rec('r-1', BOB_AGENT, { msg: 'again' })])).toEqual([]);
    expect((await storage.getWorkspaceRow(ORG, WS, NS, 'r-1'))?.createdBy).toBe(ALICE);
  });

  it('an extension over a person\'s row, and a person over an extension\'s row, both keep the old content', async () => {
    await append(ALICE, [rec('p', ALICE, { v: 'alice' })]);
    await append(EXT, [rec('e', EXT, { v: 'ext' })]);
    expect(await append(EXT, [rec('p', EXT, { v: 'ext over alice' })])).toEqual(['p']);
    expect(await append(ALICE, [rec('e', ALICE, { v: 'alice over ext' })])).toEqual(['e']);
    expect((await storage.getWorkspaceRow(ORG, WS, NS, 'e'))?.createdBy).toBe(EXT);
  });

  it('a row written before updatedBy existed reads its createdBy as the last writer', async () => {
    await storage.appendWorkspaceRows([rec('old', ALICE, { v: 1 })]);
    (storage as unknown as { db: { prepare(s: string): { run(...a: unknown[]): unknown } } }).db
      .prepare('UPDATE workspace_rows SET updatedBy = NULL WHERE rowId = ?').run('old');
    expect((await storage.getWorkspaceRow(ORG, WS, NS, 'old'))?.updatedBy).toBe('');
    expect(await append(ALICE_AGENT, [rec('old', ALICE_AGENT, { v: 2 })])).toEqual([]);
    expect(await append(BOB_AGENT, [rec('old', BOB_AGENT, { v: 3 })])).toEqual(['old']);
  });
});

describe('how revisions age', () => {
  it('keeps the newest 20 of a row, drops what is past the window, and drops a gone row\'s', async () => {
    await append(ALICE, [rec('busy', ALICE, { n: 0 })]);
    for (let i = 1; i <= 25; i++) {
      const by = i % 2 ? BOB_AGENT : ALICE;
      await append(by, [rec('busy', by, { n: i })], new Date(Date.UTC(2026, 9, 22, 8, 0, i)).toISOString());
    }
    expect((await storage.listWorkspaceRowRevisions(ORG, WS, NS, 'busy')).length).toBe(25);
    await storage.pruneWorkspaceRowRevisions(ORG, WS, NS, '2026-01-01T00:00:00.000Z', REVISIONS_PER_ROW);
    const left = await storage.listWorkspaceRowRevisions(ORG, WS, NS, 'busy');
    expect(left.length).toBe(REVISIONS_PER_ROW);
    expect(left[0].body).toEqual({ n: 24 });

    await storage.pruneWorkspaceRowRevisions(ORG, WS, NS, '2026-10-22T08:00:10.000Z', REVISIONS_PER_ROW);
    expect((await storage.listWorkspaceRowRevisions(ORG, WS, NS, 'busy')).every(v => v.replacedAt >= '2026-10-22T08:00:10.000Z')).toBe(true);

    await storage.deleteWorkspaceRow(ORG, WS, NS, 'busy');
    await storage.pruneWorkspaceRowRevisions(ORG, WS, NS, '2026-01-01T00:00:00.000Z', REVISIONS_PER_ROW);
    expect(await storage.listWorkspaceRowRevisions(ORG, WS, NS, 'busy')).toEqual([]);
  });

  it('a revision is kept for the space\'s own window, or 30 days', () => {
    expect(revisionKeepDays(null)).toBe(30);
    expect(revisionKeepDays(7)).toBe(7);
  });
});
