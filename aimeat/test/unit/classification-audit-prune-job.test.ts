/**
 * @file test/unit/classification-audit-prune-job.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The classification audit log and the exceptions list age on every node, whether or
 *   not consent is on. Until 2026-09-30 their prune ran inside core:consent-audit-prune, which is
 *   seeded and registered only when AIMEAT_CONSENT is on, so a node with consent off kept both for
 *   ever (TARGET-082).
 *
 * @version-history
 *   v1.0.0 — 2026-09-30 — Initial.
 */
import { describe, it, expect } from 'vitest';
import type { AimeatConfig } from '../../src/config.js';
import type { Storage } from '../../src/storage/interface.js';
import type { Scheduler } from '../../src/services/scheduler.js';
import { seedCoreScheduledJobs } from '../../src/services/job-seeding.js';
import { registerCoreHandlers } from '../../src/services/core-jobs.js';

const consentOff = { consentEnabled: false, personalNodesEnabled: false, emailEnabled: false } as unknown as AimeatConfig;

describe('the classification audit prune runs with consent off', () => {
  it('is seeded as its own core job', async () => {
    const created: string[] = [];
    const storage = {
      getScheduledJob: async () => null,
      createScheduledJob: async (job: { id: string }) => { created.push(job.id); },
    } as unknown as Storage;
    await seedCoreScheduledJobs(consentOff, storage);
    expect(created).toContain('core:classification-audit-prune');
    expect(created).not.toContain('core:consent-audit-prune');
  });

  it('has its handler registered', () => {
    const handlers: string[] = [];
    const scheduler = { registerCoreHandler: (name: string) => { handlers.push(name); } } as unknown as Scheduler;
    registerCoreHandlers(scheduler, consentOff, { getTableRowCounts: async () => ({}) } as unknown as Storage);
    expect(handlers).toContain('classification-audit-prune');
    expect(handlers).not.toContain('consent-audit-prune');
  });
});
