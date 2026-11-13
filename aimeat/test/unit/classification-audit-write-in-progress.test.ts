/**
 * @file test/unit/classification-audit-write-in-progress.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The classification audit buffer (services/classification/audit.ts) while one of its
 *   batches is being written. On PostgreSQL a write is a round trip, so for its length the batch has
 *   left the waiting queue and storage has not answered. Here the write of a real SqliteStorage is
 *   held open by the test, which gives that state on demand and without a clock.
 *
 *   What it proves, each through the code path the node runs:
 *     - an organism delete (deleteOrganismRecords, the whole of DELETE /v1/organisms/:id below HTTP)
 *       that runs during a write leaves no audit row of the organism, stored or waiting, and keeps
 *       another organism's row;
 *     - an account erasure (eraseOwner) that runs during a write leaves no audit row of the person's
 *       content, and no row that names the person as the reader of another person's content;
 *     - a read of the log (listClassificationAuditMerged) during a write returns the row once;
 *     - a flush asked for during a write answers when every row recorded so far is stored;
 *     - a row recorded while the organism's storage delete runs is not written afterwards.
 * @usage cd aimeat && pnpm exec vitest run test/unit/classification-audit-write-in-progress.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-13 — Initial.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { ClassificationAuditRow } from '../../src/storage/interface.js';
import { eraseOwner } from '../../src/services/owner-erasure.js';
import { deleteOrganismRecords } from '../../src/services/organism-lifecycle.js';
import {
  initClassificationAudit, recordClassificationAudit, flushClassificationAudit, shutdownClassificationAudit,
  listClassificationAuditMerged, pendingClassificationAudit, resetClassificationAudit, type ClassificationAuditEvent,
} from '../../src/services/classification/audit.js';

const N = 'test-node';
const ALICE = `alice@${N}`;
const BOB = `bob@${N}`;
const GONE = 'org-gone';
const KEPT = 'org-kept';
const stamp = '2026-11-13T08:00:00.000Z';

function ev(over: Partial<ClassificationAuditEvent>): ClassificationAuditEvent {
  return {
    scope: ALICE, ownerGaii: ALICE, kind: 'memory', key: 'notes.a', label: 'sisainen',
    reader: `claude#${ALICE}`, readerKind: 'ai', action: 'exception', purpose: 'made', ...over,
  };
}

/**
 * Hold the first audit write of `storage` open: `began` resolves when the write has started, and it
 * reaches the table only after `release()`. Later writes go straight through.
 */
function holdFirstWrite(storage: SqliteStorage): { began: Promise<void>; release: () => void } {
  const write = storage.addClassificationAudit.bind(storage);
  let started!: () => void;
  let release!: () => void;
  const began = new Promise<void>(r => { started = r; });
  const released = new Promise<void>(r => { release = r; });
  let first = true;
  storage.addClassificationAudit = async (rows: ClassificationAuditRow[]) => {
    if (first) { first = false; started(); await released; }
    return write(rows);
  };
  return { began, release };
}

/** Let `work` run until it has finished or has nothing left to do but wait. Answers whether it finished. */
async function settledOrWaiting(work: Promise<unknown>): Promise<boolean> {
  let done = false;
  void work.then(() => { done = true; }, () => { done = true; });
  for (let i = 0; i < 20 && !done; i++) await new Promise(r => setTimeout(r, 10));
  return done;
}

describe('the classification audit while a batch is being written', () => {
  let storage: SqliteStorage;

  beforeEach(async () => {
    resetClassificationAudit();
    storage = new SqliteStorage(':memory:');
    for (const name of ['alice', 'bob']) {
      await storage.createOwner({ name, displayName: name, publicKey: 'pk', roles: ['owner'], createdAt: stamp });
      await storage.createGHII({ username: name, nodeId: N, ghii: `${name}@${N}`, displayName: name, ownerName: name, verificationLevel: 0, totpEnabled: false, createdAt: stamp, updatedAt: stamp } as never);
    }
    initClassificationAudit(storage);
  });
  afterEach(async () => {
    await shutdownClassificationAudit();
    resetClassificationAudit();
    storage.close();
  });

  const stored = () => storage.listClassificationAudit({ limit: 1000 });

  it('an organism delete during a write leaves no audit row of the organism, and keeps another organism\'s', async () => {
    recordClassificationAudit(ev({ scope: `organism:${GONE}`, ownerGaii: null, key: `organism.${GONE}.notes.leaving` }));
    recordClassificationAudit(ev({ scope: `organism:${KEPT}`, ownerGaii: null, key: `organism.${KEPT}.notes.staying` }));
    const hold = holdFirstWrite(storage);
    const flush = flushClassificationAudit();
    await hold.began;

    const deleted = deleteOrganismRecords(storage, N, GONE);
    await settledOrWaiting(deleted);
    hold.release();
    await Promise.all([flush, deleted]);
    await flushClassificationAudit();

    const rows = [...await stored(), ...pendingClassificationAudit()];
    expect(rows.filter(r => r.scope === `organism:${GONE}`)).toEqual([]);
    // POSITIVE CONTROL: the other organism's row was written.
    expect((await stored()).map(r => r.scope)).toEqual([`organism:${KEPT}`]);
  });

  it('an account erasure during a write leaves no audit row of the person, as content owner or as reader', async () => {
    recordClassificationAudit(ev({ key: 'notes.own' }));
    recordClassificationAudit(ev({ scope: BOB, ownerGaii: BOB, key: 'notes.bob', reader: ALICE, readerKind: 'human', action: 'refused' }));
    const hold = holdFirstWrite(storage);
    const flush = flushClassificationAudit();
    await hold.began;

    const erased = eraseOwner(storage, N, 'alice');
    await settledOrWaiting(erased);
    hold.release();
    await Promise.all([flush, erased]);
    await flushClassificationAudit();

    const rows = [...await stored(), ...pendingClassificationAudit()];
    expect(rows.filter(r => r.ownerGaii === ALICE || r.scope === ALICE)).toEqual([]);
    expect(rows.filter(r => r.reader.includes('alice'))).toEqual([]);
    // POSITIVE CONTROL: bob's record of the refused read stays, under another reader name.
    expect(rows.filter(r => r.ownerGaii === BOB).map(r => r.key)).toEqual(['notes.bob']);
  });

  it('a read of the log during a write returns the row, once', async () => {
    recordClassificationAudit(ev({ action: 'shown', key: 'notes.read' }));
    const hold = holdFirstWrite(storage);
    const flush = flushClassificationAudit();
    await hold.began;

    const read = listClassificationAuditMerged(storage, { ownerGaii: ALICE });
    await settledOrWaiting(read);
    hold.release();
    await flush;

    expect((await read).map(r => [r.key, r.count])).toEqual([['notes.read', 1]]);
  });

  it('a flush asked for during a write answers when every row recorded so far is stored', async () => {
    recordClassificationAudit(ev({ key: 'notes.first' }));
    const hold = holdFirstWrite(storage);
    const flush = flushClassificationAudit();
    await hold.began;
    recordClassificationAudit(ev({ key: 'notes.second' }));

    const second = flushClassificationAudit();
    await settledOrWaiting(second);
    hold.release();
    await second;

    expect((await stored()).map(r => r.key).sort()).toEqual(['notes.first', 'notes.second']);
    await flush;
  });

  it('a row recorded while the storage delete of an organism runs is not written afterwards', async () => {
    const remove = storage.deleteOrganism.bind(storage);
    storage.deleteOrganism = async (id: string) => {
      recordClassificationAudit(ev({ scope: `organism:${id}`, ownerGaii: null, key: `organism.${id}.notes.late`, action: 'shown' }));
      return remove(id);
    };

    await deleteOrganismRecords(storage, N, GONE);
    await flushClassificationAudit();

    expect([...await stored(), ...pendingClassificationAudit()]).toEqual([]);
  });
});
