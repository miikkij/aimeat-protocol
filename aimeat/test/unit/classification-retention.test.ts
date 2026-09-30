/**
 * @file test/unit/classification-retention.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description How classification records (TARGET-082) leave the node, against
 *   SqliteStorage(':memory:'), through the real code paths rather than the helpers they call:
 *   - eraseOwner (services/owner-erasure.ts), the whole of DELETE /v1/owners/:name below HTTP, takes
 *     the person's exceptions and the audit rows of theirs still waiting in memory, and leaves
 *     another person's;
 *   - the core job `classification-audit-prune` (services/core-jobs.ts), driven through
 *     registerCoreHandlers with a scheduler that keeps the handler, prunes the audit log and the
 *     exceptions' month records past the retention in the node policy: 365 days by default, the
 *     operator's number when set, nothing when it is null; a month that still holds a person's
 *     exception in force stays.
 * @usage cd aimeat && pnpm exec vitest run test/unit/classification-retention.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-30 — Initial (TARGET-082 test gaps).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { AimeatConfig } from '../../src/config.js';
import type { ClassificationAuditRow } from '../../src/storage/interface.js';
import type { Scheduler } from '../../src/services/scheduler.js';
import { eraseOwner } from '../../src/services/owner-erasure.js';
import { registerCoreHandlers } from '../../src/services/core-jobs.js';
import { addException, listExceptions } from '../../src/services/classification/exceptions.js';
import {
  pendingClassificationAudit, recordClassificationAudit, resetClassificationAudit,
} from '../../src/services/classification/audit.js';
import { DEFAULT_LABELS } from '../../src/services/classification/defaults.js';
import { NODE_POLICY_KEY } from '../../src/services/classification/policy.js';

const N = 'test-node';
const ALICE = `alice@${N}`;
const BOB = `bob@${N}`;
const stamp = '2026-09-30T12:00:00.000Z';

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();

function auditRow(id: string, lastAt: string): ClassificationAuditRow {
  return {
    id, minute: lastAt, scope: ALICE, ownerGaii: ALICE, kind: 'memory', key: `notes.${id}`, label: 'sisainen',
    reader: `claude#${ALICE}`, readerKind: 'ai', action: 'shown', purpose: null, count: 1, firstAt: lastAt, lastAt,
  };
}

describe('classification records leave the node (TARGET-082)', () => {
  let storage: SqliteStorage;
  const deps = (now?: string) => ({ storage, config: { nodeId: N }, ...(now ? { now: () => now } : {}) });

  beforeEach(async () => {
    storage = new SqliteStorage(':memory:');
    resetClassificationAudit();
    for (const name of ['alice', 'bob']) {
      await storage.createOwner({ name, displayName: name, publicKey: 'pk', roles: ['owner'], createdAt: stamp });
      await storage.createGHII({ username: name, nodeId: N, ghii: `${name}@${N}`, displayName: name, ownerName: name, verificationLevel: 0, totpEnabled: false, createdAt: stamp, updatedAt: stamp } as never);
    }
  });
  afterEach(() => { storage.close(); resetClassificationAudit(); });

  describe('eraseOwner', () => {
    it("takes the person's exceptions and their audit rows still waiting in memory; another person's stay", async () => {
      for (const [who, key] of [[ALICE, 'a'], [BOB, 'b']] as const) {
        await addException(deps(), { by: who, byKind: 'human', scope: who, target: { kind: 'memory', key }, label: 'sisainen', action: 'leave', reason: `${key} may leave`, auto: false });
        recordClassificationAudit({ scope: who, ownerGaii: who, kind: 'memory', key, label: 'sisainen', reader: `claude#${who}`, readerKind: 'ai', action: 'shown' });
      }
      expect(pendingClassificationAudit({ ownerGaii: ALICE }).length).toBeGreaterThan(0);
      expect((await listExceptions(deps(), { level: 'owner', subject: ALICE })).length).toBe(1);

      const { deletionLog } = await eraseOwner(storage, N, 'alice');

      expect(await listExceptions(deps(), { level: 'owner', subject: ALICE })).toEqual([]);
      expect(pendingClassificationAudit({ ownerGaii: ALICE })).toEqual([]);
      expect(deletionLog).toContain('classification_exceptions');
      // POSITIVE CONTROL: bob's exception and waiting rows are untouched.
      expect((await listExceptions(deps(), { level: 'owner', subject: BOB })).map(e => e.reason)).toEqual(['b may leave']);
      expect(pendingClassificationAudit({ ownerGaii: BOB }).length).toBeGreaterThan(0);
    });
  });

  describe('the classification-audit-prune core job', () => {
    /** The job's handler, as the scheduler would run it. */
    function pruneJob(): () => Promise<void> {
      const handlers = new Map<string, () => Promise<void>>();
      const scheduler = { registerCoreHandler: (name: string, fn: () => Promise<void>) => { handlers.set(name, fn); } } as unknown as Scheduler;
      const config = { nodeId: N, consentEnabled: false, personalNodesEnabled: false, emailEnabled: false } as unknown as AimeatConfig;
      registerCoreHandlers(scheduler, config, storage);
      const job = handlers.get('classification-audit-prune');
      expect(job).toBeTypeOf('function');
      return job!;
    }

    /** The operator's node policy with this retention; `undefined` stores none at all. */
    async function retention(days: number | null | undefined): Promise<void> {
      if (days === undefined) return;
      const labels = DEFAULT_LABELS.map(l => ({ ...l, name: { ...l.name } }));
      await storage.setMemory({
        key: NODE_POLICY_KEY, ownerGaii: `system@${N}`, value: { policy: { labels, auditRetentionDays: days }, history: [], proposal: null },
        visibility: 'private', tags: ['classification-policy'], ttlHours: null, version: 1, createdAt: stamp, updatedAt: stamp,
      });
    }

    /** Two old months: one with an exception in force, one whose only exception was withdrawn. And a new one. */
    async function seed(): Promise<void> {
      await storage.addClassificationAudit([auditRow('old', ago(400)), auditRow('mid', ago(60)), auditRow('new', ago(1))]);
      const inForce = new Date(Date.now() - 500 * DAY).toISOString();
      const lapsed = new Date(Date.now() - 450 * DAY).toISOString();
      await addException(deps(inForce), { by: ALICE, byKind: 'human', scope: ALICE, target: { kind: 'memory', key: 'standing' }, label: 'sisainen', action: 'leave', reason: 'standing', auto: false });
      await addException(deps(lapsed), { by: ALICE, byKind: 'human', scope: ALICE, target: { kind: 'memory', key: 'gone' }, label: 'sisainen', action: 'leave', reason: 'expired', auto: false, until: new Date(Date.now() - 440 * DAY).toISOString() });
      await addException(deps(), { by: ALICE, byKind: 'human', scope: ALICE, target: { kind: 'memory', key: 'fresh' }, label: 'sisainen', action: 'leave', reason: 'fresh', auto: false });
    }

    const auditKeys = async () => (await storage.listClassificationAudit({ limit: 100 })).map(r => r.key).sort();
    const reasons = async () => (await listExceptions(deps(), { level: 'all', limit: 100 })).map(e => e.reason).sort();

    it('with no retention stored, keeps 365 days: the 400-day row and the old lapsed month go', async () => {
      await retention(undefined);
      await seed();
      await pruneJob()();
      expect(await auditKeys()).toEqual(['notes.mid', 'notes.new']);
      expect(await reasons()).toEqual(['fresh', 'standing']);
    });

    it("with the operator's 30 days, the 60-day row goes too", async () => {
      await retention(30);
      await seed();
      await pruneJob()();
      expect(await auditKeys()).toEqual(['notes.new']);
      expect(await reasons()).toEqual(['fresh', 'standing']);
    });

    it('with null, keeps every row and every month', async () => {
      await retention(null);
      await seed();
      await pruneJob()();
      expect(await auditKeys()).toEqual(['notes.mid', 'notes.new', 'notes.old']);
      expect(await reasons()).toEqual(['expired', 'fresh', 'standing']);
    });
  });
});
