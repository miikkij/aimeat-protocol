/**
 * @file test/unit/sqlite-schedule-update.test.ts
 * @description SQLite updateScheduledJob writes only the columns it is given, so a change another
 *   connection committed in the meantime is kept. Two connections on one file stand for two node
 *   processes (or a request and the test that edits the database behind it). The update that used to
 *   read the whole row, await, and write the whole row back is started on one connection, the other
 *   connection gives the schedule its app grant before that write lands, and the grant must survive.
 *   That lost write is what the nightly SQLite sweep hit in e2e-scheduled-ext-files 23c/23d
 *   (2026-10-23): the schedule lost its createdByApp and fired as the owner.
 * @version-history
 *   v1.0.0 — 2026-10-24 — Initial.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import { scheduleMethods } from '../../src/storage/providers/sqlite/methods/schedules.js';
import type { ScheduledJobRecord } from '../../src/storage/interface.js';

const dir = mkdtempSync(join(tmpdir(), 'aimeat-sched-update-'));
const file = join(dir, 'node.db');
const a = new SqliteStorage(file);
const b = new SqliteStorage(file);

afterAll(() => {
  a.close();
  b.close();
  rmSync(dir, { recursive: true, force: true });
});

const at = '2026-10-24T08:00:00.000Z';
function job(id: string): ScheduledJobRecord {
  return {
    id, name: id, type: 'extension', cron: '0 0 1 1 *', enabled: true,
    createdBy: 'alice@node-a', createdAt: at, updatedAt: at, ownerScope: 'alice@node-a',
    extensionName: 'producer', actionId: 'produce',
  } as ScheduledJobRecord;
}

describe('SQLite updateScheduledJob', () => {
  it('keeps a column another connection wrote while the update was on its way', async () => {
    await a.createScheduledJob(job('j1'));
    // The method itself, without the write guard's queue in front, so its own read (if it makes one)
    // happens now, before the other connection writes.
    const pending = (scheduleMethods.updateScheduledJob as (this: SqliteStorage, id: string, u: Partial<ScheduledJobRecord>) => Promise<ScheduledJobRecord | null>)
      .call(a, 'j1', { nextRunAt: '2027-01-01T00:00:00.000Z', updatedAt: at });
    // The other process: the test (or a request) gives the schedule its app grant.
    b.db.prepare('UPDATE scheduled_jobs SET createdByApp = ?, createdByAgent = 1 WHERE id = ?').run('appgrant-1', 'j1');
    const written = await pending;

    expect(written?.nextRunAt).toBe('2027-01-01T00:00:00.000Z');
    const stored = await b.getScheduledJob('j1');
    expect(stored?.createdByApp).toBe('appgrant-1');
    expect(stored?.createdByAgent).toBe(true);
    expect(stored?.nextRunAt).toBe('2027-01-01T00:00:00.000Z');
  });

  it('clears a column given as undefined, and leaves the ones not named', async () => {
    await a.createScheduledJob({ ...job('j2'), lastRunError: 'boom', description: 'kept' } as ScheduledJobRecord);
    const out = await a.updateScheduledJob('j2', { lastRunResult: 'success', lastRunError: undefined });
    expect(out?.lastRunResult).toBe('success');
    expect(out?.lastRunError).toBeUndefined();
    expect(out?.description).toBe('kept');
  });

  it('answers null for a schedule that does not exist, and the row it read for no change', async () => {
    expect(await a.updateScheduledJob('missing', { enabled: false })).toBeNull();
    expect((await a.updateScheduledJob('j2', {}))?.id).toBe('j2');
  });
});
