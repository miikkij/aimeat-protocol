/**
 * @file test/unit/gate-expiry-job.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Gate approvals past their deadline (a member's suggested workspace change expires in
 *   30 days) are expired by the scheduled job core:gate-expiry. Until 2026-10-15 the sweep was a
 *   setInterval (startGateExpiryJob) that nothing started, so a proposal expired only when somebody
 *   opened the list or the decision (feature-list audit #59).
 * @usage cd aimeat && pnpm exec vitest run test/unit/gate-expiry-job.test.ts
 * @version-history
 *   2026-10-15 — Initial (feature-list audit #59).
 */
import { describe, it, expect } from 'vitest';
import type { AimeatConfig } from '../../src/config.js';
import type { Storage, PendingApprovalRecord } from '../../src/storage/interface.js';
import type { Scheduler } from '../../src/services/scheduler.js';
import { seedCoreScheduledJobs } from '../../src/services/job-seeding.js';
import { registerCoreHandlers } from '../../src/services/core-jobs.js';

const plainNode = { consentEnabled: false, personalNodesEnabled: false, emailEnabled: false, nodeId: 'test-node' } as unknown as AimeatConfig;

describe('the gate approval expiry', () => {
  it('is seeded as a scheduled job', async () => {
    const created: Array<{ id: string; coreHandler: string }> = [];
    const storage = {
      getScheduledJob: async () => null,
      createScheduledJob: async (job: { id: string; coreHandler: string }) => { created.push(job); },
    } as unknown as Storage;
    await seedCoreScheduledJobs(plainNode, storage);
    expect(created.find((j) => j.id === 'core:gate-expiry')?.coreHandler).toBe('gate-expiry');
  });

  it('has its handler registered, and the handler expires an overdue approval', async () => {
    const overdue = { id: 'pa-1', status: 'pending', deadline: '2026-01-01T00:00:00.000Z', action: 'publish' } as unknown as PendingApprovalRecord;
    const updates: Array<{ id: string; status: string }> = [];
    const storage = {
      getTableRowCounts: async () => ({}),
      listOverduePendingApprovals: async () => [overdue],
      updatePendingApproval: async (id: string, u: { status: string }) => { updates.push({ id, status: u.status }); },
    } as unknown as Storage;
    const handlers = new Map<string, () => Promise<void>>();
    const scheduler = { registerCoreHandler: (name: string, fn: () => Promise<void>) => { handlers.set(name, fn); } } as unknown as Scheduler;
    registerCoreHandlers(scheduler, plainNode, storage);
    expect(handlers.has('gate-expiry')).toBe(true);
    await handlers.get('gate-expiry')!();
    expect(updates).toEqual([{ id: 'pa-1', status: 'rejected' }]);
  });
});
