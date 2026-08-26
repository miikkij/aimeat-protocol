/**
 * @file workspace-rows-storage.test.ts
 * @description The workspace row store, driven against real in-memory SQLite.
 *
 *   Four properties this file exists for, each one a thing that would be wrong in a way nobody
 *   notices until production:
 *
 *   1. THE PAGE BOUNDARY. Keyset pagination over (occurredAt, id) must neither skip nor repeat a
 *      row, including when several rows share one instant — which is the normal case for a bulk
 *      ingest, since they all arrive in the same millisecond.
 *   2. RETENTION KEYS ON createdAt, NOT occurredAt. A five-year-old mail ingested today must not be
 *      swept by a thirty-day retention: the promise is about how long WE keep a row.
 *   3. A REPEATED rowId REPLACES AND KEEPS createdAt. Re-running an ingest that already landed
 *      updates rather than duplicates, and does not rewrite when the row first arrived.
 *   4. SPACES ARE ISOLATED. Another workspace's rows are invisible, and so are another namespace's
 *      inside the same workspace.
 * @usage cd aimeat && pnpm exec vitest run test/unit/workspace-rows-storage.test.ts
 * @version-history
 *   v1.0.0 — 2026-08-26 — Initial.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage, WorkspaceRowRecord } from '../../src/storage/interface.js';
import { decodeRowCursor } from '../../src/storage/workspace-row-cursor.js';

const ORG = 'org-1';
const WS = 'ws-1';
const NS = 'crm.mail';

let storage: Storage;

beforeEach(() => {
  storage = new SqliteStorage(':memory:') as unknown as Storage;
});

/** Deterministic instants, so an ordering assertion is about the code and not about test speed. */
function at(n: number): string {
  return new Date(Date.UTC(2026, 0, 1, 0, 0, 0) + n * 1000).toISOString();
}

function mk(over: Partial<WorkspaceRowRecord> & { rowId: string }): WorkspaceRowRecord {
  const body = over.body ?? { subject: over.rowId };
  return {
    id: over.id ?? `sur-${over.rowId}`,
    organismId: over.organismId ?? ORG,
    wsId: over.wsId ?? WS,
    namespace: over.namespace ?? NS,
    rowId: over.rowId,
    k1: over.k1 ?? '',
    k2: over.k2 ?? '',
    k3: over.k3 ?? '',
    occurredAt: over.occurredAt ?? at(0),
    createdAt: over.createdAt ?? at(0),
    updatedAt: over.updatedAt ?? at(0),
    createdBy: over.createdBy ?? 'alice@node',
    body,
    bytes: over.bytes ?? Buffer.byteLength(JSON.stringify(body), 'utf8'),
  };
}

/** Walk every page and return the rowIds in order, so a skip or a repeat is visible as a list. */
async function readAll(limit: number): Promise<string[]> {
  const seen: string[] = [];
  let cursor: string | null | undefined;
  // Bounded so a cursor that never advances fails as a wrong list rather than as a hung test.
  for (let guard = 0; guard < 50; guard++) {
    const page = await storage.listWorkspaceRows({
      organismId: ORG, wsId: WS, namespace: NS, limit, cursor: cursor ?? undefined,
    });
    seen.push(...page.rows.map(r => r.rowId));
    if (!page.cursor) return seen;
    cursor = page.cursor;
  }
  throw new Error('pagination did not terminate');
}

describe('append and read back', () => {
  it('round-trips a row, body and all', async () => {
    await storage.appendWorkspaceRows([mk({ rowId: 'a', body: { from: 'x@y', n: 3, deep: { ok: true } } })]);
    const got = await storage.getWorkspaceRow(ORG, WS, NS, 'a');
    expect(got?.body).toEqual({ from: 'x@y', n: 3, deep: { ok: true } });
    expect(got?.createdBy).toBe('alice@node');
  });

  it('appends a batch in one call', async () => {
    await storage.appendWorkspaceRows(
      Array.from({ length: 25 }, (_, i) => mk({ rowId: `r${i}`, occurredAt: at(i) })),
    );
    const usage = await storage.workspaceRowUsage({ organismId: ORG });
    expect(usage.rows).toBe(25);
    expect(usage.bytes).toBeGreaterThan(0);
  });

  it('takes an empty batch without touching the database', async () => {
    await storage.appendWorkspaceRows([]);
    expect((await storage.workspaceRowUsage({ organismId: ORG })).rows).toBe(0);
  });
});

describe('a repeated rowId replaces', () => {
  it('updates the row instead of duplicating it, and keeps createdAt', async () => {
    await storage.appendWorkspaceRows([mk({
      rowId: 'dup', body: { v: 1 }, createdAt: at(0), updatedAt: at(0),
    })]);
    await storage.appendWorkspaceRows([mk({
      // A second ingest run: a fresh surrogate id and a fresh createdAt, both of which must lose.
      rowId: 'dup', id: 'sur-other', body: { v: 2 }, createdAt: at(99), updatedAt: at(99),
    })]);

    expect((await storage.workspaceRowUsage({ organismId: ORG })).rows).toBe(1);
    const got = await storage.getWorkspaceRow(ORG, WS, NS, 'dup');
    expect(got?.body).toEqual({ v: 2 });
    expect(got?.updatedAt).toBe(at(99));
    // When it first arrived is a fact the re-run does not get to rewrite.
    expect(got?.createdAt).toBe(at(0));
    expect(got?.id).toBe('sur-dup');
  });
});

describe('the page boundary', () => {
  it('neither skips nor repeats across pages', async () => {
    await storage.appendWorkspaceRows(
      Array.from({ length: 17 }, (_, i) => mk({ rowId: `r${i}`, occurredAt: at(i) })),
    );
    const all = await readAll(5);
    expect(all).toHaveLength(17);
    expect(new Set(all).size).toBe(17);
    // Newest first by default.
    expect(all[0]).toBe('r16');
    expect(all[16]).toBe('r0');
  });

  it('survives a page boundary inside one instant', async () => {
    // Every row at the SAME occurredAt: this is what a bulk ingest looks like, and it is where an
    // ORDER BY without the id tiebreak loses rows.
    await storage.appendWorkspaceRows(
      Array.from({ length: 12 }, (_, i) => mk({ rowId: `s${i}`, id: `sur-${i}`, occurredAt: at(5) })),
    );
    const all = await readAll(4);
    expect(all).toHaveLength(12);
    expect(new Set(all).size).toBe(12);
  });

  it('reports no cursor on the last page', async () => {
    await storage.appendWorkspaceRows([mk({ rowId: 'only' })]);
    const page = await storage.listWorkspaceRows({ organismId: ORG, wsId: WS, namespace: NS, limit: 10 });
    expect(page.cursor).toBeNull();
  });

  it('reads the first page again when the cursor is unreadable, rather than failing', async () => {
    await storage.appendWorkspaceRows(
      Array.from({ length: 3 }, (_, i) => mk({ rowId: `r${i}`, occurredAt: at(i) })),
    );
    expect(decodeRowCursor('not a cursor at all')).toBeNull();
    const page = await storage.listWorkspaceRows({
      organismId: ORG, wsId: WS, namespace: NS, cursor: 'not a cursor at all',
    });
    expect(page.rows).toHaveLength(3);
  });

  it('walks ascending when asked', async () => {
    await storage.appendWorkspaceRows(
      Array.from({ length: 6 }, (_, i) => mk({ rowId: `r${i}`, occurredAt: at(i) })),
    );
    const page = await storage.listWorkspaceRows({
      organismId: ORG, wsId: WS, namespace: NS, order: 'asc', limit: 3,
    });
    expect(page.rows.map(r => r.rowId)).toEqual(['r0', 'r1', 'r2']);
    const next = await storage.listWorkspaceRows({
      organismId: ORG, wsId: WS, namespace: NS, order: 'asc', limit: 3, cursor: page.cursor ?? undefined,
    });
    expect(next.rows.map(r => r.rowId)).toEqual(['r3', 'r4', 'r5']);
  });
});

describe('filtering', () => {
  beforeEach(async () => {
    await storage.appendWorkspaceRows([
      mk({ rowId: 'a', k1: 'c-1', k2: 'thread-x', occurredAt: at(10), updatedAt: at(10) }),
      mk({ rowId: 'b', k1: 'c-1', k2: 'thread-y', occurredAt: at(20), updatedAt: at(20) }),
      mk({ rowId: 'c', k1: 'c-2', k2: 'thread-x', occurredAt: at(30), updatedAt: at(30) }),
    ]);
  });

  it('filters on a declared column', async () => {
    const page = await storage.listWorkspaceRows({ organismId: ORG, wsId: WS, namespace: NS, k1: 'c-1' });
    expect(page.rows.map(r => r.rowId).sort()).toEqual(['a', 'b']);
  });

  it('combines two declared columns', async () => {
    const page = await storage.listWorkspaceRows({
      organismId: ORG, wsId: WS, namespace: NS, k1: 'c-1', k2: 'thread-x',
    });
    expect(page.rows.map(r => r.rowId)).toEqual(['a']);
  });

  it('bounds on occurredAt inclusively', async () => {
    const page = await storage.listWorkspaceRows({
      organismId: ORG, wsId: WS, namespace: NS, since: at(20), until: at(30),
    });
    expect(page.rows.map(r => r.rowId).sort()).toEqual(['b', 'c']);
  });

  it('answers what changed since I last looked', async () => {
    const page = await storage.listWorkspaceRows({
      organismId: ORG, wsId: WS, namespace: NS, changedSince: at(20),
    });
    // Exclusive: at(20) itself is what the caller already saw.
    expect(page.rows.map(r => r.rowId)).toEqual(['c']);
  });
});

describe('retention', () => {
  it('keys on createdAt, not on occurredAt', async () => {
    await storage.appendWorkspaceRows([
      // An old message ingested today. Retention must NOT sweep it: the promise is about how long
      // we keep a row, not about how old the event was.
      mk({ rowId: 'old-mail-new-row', occurredAt: at(0), createdAt: at(500) }),
      // A recent message ingested long ago. This one IS past the window.
      mk({ rowId: 'new-mail-old-row', occurredAt: at(900), createdAt: at(100) }),
    ]);

    const removed = await storage.deleteWorkspaceRowsBefore(ORG, WS, NS, at(200));
    expect(removed).toBe(1);
    expect(await storage.getWorkspaceRow(ORG, WS, NS, 'old-mail-new-row')).not.toBeNull();
    expect(await storage.getWorkspaceRow(ORG, WS, NS, 'new-mail-old-row')).toBeNull();
  });

  it('trims to a row count, keeping the newest', async () => {
    await storage.appendWorkspaceRows(
      Array.from({ length: 10 }, (_, i) => mk({ rowId: `r${i}`, occurredAt: at(i) })),
    );
    const removed = await storage.trimWorkspaceRows(ORG, WS, NS, 4);
    expect(removed).toBe(6);
    const left = (await storage.listWorkspaceRows({ organismId: ORG, wsId: WS, namespace: NS })).rows;
    expect(left.map(r => r.rowId)).toEqual(['r9', 'r8', 'r7', 'r6']);
  });

  it('trims nothing when the space is already under the cap', async () => {
    await storage.appendWorkspaceRows([mk({ rowId: 'a' })]);
    expect(await storage.trimWorkspaceRows(ORG, WS, NS, 100)).toBe(0);
  });

  it('deletes one row and says whether there was one', async () => {
    await storage.appendWorkspaceRows([mk({ rowId: 'a' })]);
    expect(await storage.deleteWorkspaceRow(ORG, WS, NS, 'a')).toBe(true);
    expect(await storage.deleteWorkspaceRow(ORG, WS, NS, 'a')).toBe(false);
  });
});

describe('stats and usage', () => {
  it('reports count, bytes and the span without reading a row', async () => {
    await storage.appendWorkspaceRows([
      mk({ rowId: 'a', occurredAt: at(10), createdAt: at(50) }),
      mk({ rowId: 'b', occurredAt: at(30), createdAt: at(60) }),
    ]);
    const [s] = await storage.workspaceRowStats(ORG, WS, NS);
    expect(s.rows).toBe(2);
    expect(s.bytes).toBeGreaterThan(0);
    expect(s.oldest).toBe(at(10));
    expect(s.newest).toBe(at(30));
    expect(s.lastWriteAt).toBe(at(60));
  });

  it('reports every space in the workspace when no namespace is named', async () => {
    await storage.appendWorkspaceRows([
      mk({ rowId: 'a', namespace: 'crm.mail' }),
      mk({ rowId: 'b', namespace: 'crm.bounces', id: 'sur-b2' }),
    ]);
    const all = await storage.workspaceRowStats(ORG, WS);
    expect(all.map(s => s.namespace).sort()).toEqual(['crm.bounces', 'crm.mail']);
  });

  it('counts usage for the organism and for one workspace inside it', async () => {
    await storage.appendWorkspaceRows([
      mk({ rowId: 'a', wsId: 'ws-1' }),
      mk({ rowId: 'b', wsId: 'ws-2', id: 'sur-b2' }),
    ]);
    expect((await storage.workspaceRowUsage({ organismId: ORG })).rows).toBe(2);
    expect((await storage.workspaceRowUsage({ organismId: ORG, wsId: 'ws-1' })).rows).toBe(1);
  });
});

describe('spaces are isolated', () => {
  it('does not show another workspace or another namespace', async () => {
    await storage.appendWorkspaceRows([
      mk({ rowId: 'mine' }),
      mk({ rowId: 'other-ws', wsId: 'ws-2', id: 'sur-ws2' }),
      mk({ rowId: 'other-ns', namespace: 'crm.other', id: 'sur-ns2' }),
      mk({ rowId: 'other-org', organismId: 'org-2', id: 'sur-org2' }),
    ]);
    const page = await storage.listWorkspaceRows({ organismId: ORG, wsId: WS, namespace: NS });
    expect(page.rows.map(r => r.rowId)).toEqual(['mine']);
    expect(await storage.getWorkspaceRow(ORG, WS, NS, 'other-ws')).toBeNull();
    expect(await storage.getWorkspaceRow(ORG, WS, NS, 'other-org')).toBeNull();
  });

  it('lets the same rowId exist in two spaces', async () => {
    await storage.appendWorkspaceRows([
      mk({ rowId: 'same', body: { where: 'mail' } }),
      mk({ rowId: 'same', namespace: 'crm.other', id: 'sur-same-2', body: { where: 'other' } }),
    ]);
    expect((await storage.getWorkspaceRow(ORG, WS, NS, 'same'))?.body).toEqual({ where: 'mail' });
    expect((await storage.getWorkspaceRow(ORG, WS, 'crm.other', 'same'))?.body).toEqual({ where: 'other' });
  });

  it('drops a whole space without touching its neighbour', async () => {
    await storage.appendWorkspaceRows([
      mk({ rowId: 'a', namespace: 'crm.mail' }),
      mk({ rowId: 'b', namespace: 'crm.other', id: 'sur-b2' }),
    ]);
    expect(await storage.deleteWorkspaceRowSpace(ORG, WS, 'crm.mail')).toBe(1);
    expect(await storage.getWorkspaceRow(ORG, WS, 'crm.other', 'b')).not.toBeNull();
  });
});
