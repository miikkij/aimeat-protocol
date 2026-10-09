/**
 * @file test/unit/nonce-cleanup-job.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Expired verification nonces are swept on every node. Until 2026-10-09 the sweep was
 *   seeded and registered only with FTN or EUDIW on, while connection rounds, MCP sign-in rounds,
 *   social and SSO sign-ins and the two-step sign-in ticket write the same table on every node, so
 *   an abandoned round stayed for ever (secrets audit 2026-10-09, chapter 2).
 *
 * @version-history
 *   v1.0.0 — 2026-10-09 — Initial.
 */
import { describe, it, expect } from 'vitest';
import type { AimeatConfig } from '../../src/config.js';
import type { Storage } from '../../src/storage/interface.js';
import type { Scheduler } from '../../src/services/scheduler.js';
import { seedCoreScheduledJobs } from '../../src/services/job-seeding.js';
import { registerCoreHandlers } from '../../src/services/core-jobs.js';

const plainNode = {
  eudiwEnabled: false, ftnEnabled: false, consentEnabled: false, personalNodesEnabled: false, emailEnabled: false,
} as unknown as AimeatConfig;

describe('the verification nonce sweep with FTN and EUDIW off', () => {
  it('is seeded', async () => {
    const created: string[] = [];
    const storage = {
      getScheduledJob: async () => null,
      createScheduledJob: async (job: { id: string }) => { created.push(job.id); },
    } as unknown as Storage;
    await seedCoreScheduledJobs(plainNode, storage);
    expect(created).toContain('core:nonce-cleanup');
  });

  it('has its handler registered', () => {
    const handlers: string[] = [];
    const scheduler = { registerCoreHandler: (name: string) => { handlers.push(name); } } as unknown as Scheduler;
    registerCoreHandlers(scheduler, plainNode, { getTableRowCounts: async () => ({}) } as unknown as Storage);
    expect(handlers).toContain('nonce-cleanup');
  });
});
