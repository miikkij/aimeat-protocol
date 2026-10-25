/**
 * @file test/unit/account-deactivated-skip.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A deactivated account's background work waits, and reactivation resumes it.
 *
 *   WHY. Deactivation ends every credential, and background work carries none: until 2026-10-25 a
 *   deactivated account's schedules, workflow triggers and unattended extension runs went on acting
 *   in its name (secaudit2026oct22, owner-deactivation:background-work-keeps-acting). Each of the three
 *   now asks the account first (services/account-deactivated.ts) and skips with a sentence that names
 *   the deactivation; nothing is deleted.
 *
 *   With the real SQLite store: a scheduled job of the account runs, is skipped after deactivation
 *   with the job kept, and runs again after reactivation; a trigger's start of an owner-saved workflow
 *   is skipped; an unattended extension run is refused before it looks for the extension, and a run
 *   somebody waits for (servesWaitingCaller) is not.
 * @usage cd aimeat && pnpm exec vitest run test/unit/account-deactivated-skip.test.ts
 * @version-history
 *   v1.0.0 -- 2026-10-25 -- Initial (secaudit2026oct22).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { rmSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

vi.mock('../../src/utils/logger.js', async (importOriginal) => {
    const real = await importOriginal<Record<string, unknown>>();
    const quiet: unknown = new Proxy({}, { get: () => () => quiet });
    return { ...real, logger: quiet };
});

import { createStorage } from '../../src/storage/storage-factory.js';
import { Scheduler } from '../../src/services/scheduler.js';
import { refuseTriggerStart } from '../../src/services/workflow/trigger-authority.js';
import { runExtensionActionAsSystem } from '../../src/services/extension-system-run.js';
import { deactivatedAccountSkip } from '../../src/services/account-deactivated.js';
import { setThisNodeId } from '../../src/utils/gaii.js';
import type { ScheduledJobRecord, Storage } from '../../src/storage/interface.js';
import type { WorkflowDef } from '../../src/models/workflow-schemas.js';

const SQLITE_PATH = `./test/.acctpause-${process.pid}.db`;
const NODE = 'aimeat-acct-pause';
const OWNER = 'pauser';
const GHII = `${OWNER}@${NODE}`;
let storage: Storage;

beforeAll(async () => {
    setThisNodeId(NODE);
    storage = await createStorage({ provider: 'sqlite', sqlitePath: SQLITE_PATH });
    await storage.createOwner({ name: OWNER, displayName: OWNER, publicKey: 'pk', roles: ['owner'], createdAt: new Date().toISOString() } as never);
}, 60_000);

afterAll(async () => {
    setThisNodeId(null);
    await (storage as unknown as { close?: () => void | Promise<void> }).close?.();
    for (const suffix of ['', '-wal', '-shm']) {
        const p = SQLITE_PATH + suffix;
        if (existsSync(p)) { try { rmSync(p); } catch { /* the test's own scratch */ } }
    }
});

const deactivate = () => storage.updateOwner(OWNER, { disabledAt: new Date().toISOString(), disabledBy: 'op' } as never);
const reactivate = () => storage.updateOwner(OWNER, { disabledAt: null, disabledBy: null } as never);

describe('deactivatedAccountSkip', () => {
    it('answers null for an active account, an unknown name and a system identity', async () => {
        expect(await deactivatedAccountSkip(storage, GHII)).toBeNull();
        expect(await deactivatedAccountSkip(storage, `nobody@${NODE}`)).toBeNull();
        expect(await deactivatedAccountSkip(storage, `system@${NODE}`)).toBeNull();
        expect(await deactivatedAccountSkip(storage, undefined)).toBeNull();
    });
});

describe('a scheduled job of a deactivated account', () => {
    it('is skipped with outcome stopped and kept, and runs again after reactivation', async () => {
        const now = new Date().toISOString();
        const job: ScheduledJobRecord = {
            id: `test:pause-${randomUUID()}`, name: 'the account\'s job', type: 'core', coreHandler: 'count',
            cron: '0 0 1 1 *', enabled: true, createdBy: GHII, ownerScope: GHII, createdAt: now, updatedAt: now,
        };
        await storage.createScheduledJob(job);
        let ran = 0;
        const s = new Scheduler({ nodeId: NODE } as never, storage);
        s.registerCoreHandler('count', async () => { ran++; });

        expect((await s.triggerNow(job.id)).code).toBe('ran');
        expect(ran).toBe(1);

        await deactivate();
        const skipped = await s.triggerNow(job.id);
        expect(skipped.code).toBe('stopped');
        expect(skipped.detail).toMatch(/account "pauser" was deactivated/);
        expect(ran).toBe(1);
        const kept = await storage.getScheduledJob(job.id);
        expect(kept?.enabled).toBe(true);
        const logs = await storage.listExecutionLogs({ jobId: job.id, limit: 5 });
        expect(logs.some(l => l.result === 'skipped' && /deactivated/.test(l.errorMessage ?? ''))).toBe(true);

        await reactivate();
        expect((await s.triggerNow(job.id)).code).toBe('ran');
        expect(ran).toBe(2);
    });
});

describe('a workflow trigger of a deactivated account', () => {
    it('starts nothing, whoever saved it, and starts again after reactivation', async () => {
        const def = { id: 'wf-pause', createdBy: GHII, savedBy: { kind: 'owner', id: GHII }, steps: [] } as unknown as WorkflowDef;
        const deps = { storage, config: { nodeId: NODE } as never };
        expect(await refuseTriggerStart(deps, GHII, def)).toBeNull();
        await deactivate();
        const refused = await refuseTriggerStart(deps, GHII, def);
        expect(refused?.runId).toBe('');
        expect(refused?.reason).toMatch(/deactivated/);
        await reactivate();
        expect(await refuseTriggerStart(deps, GHII, def)).toBeNull();
    });
});

describe('an unattended extension run of a deactivated account', () => {
    const args = {
        extensionName: 'no-such-ext', actionId: 'go', callerGaii: `scheduler@${NODE}`, ownerName: OWNER,
        storageOwnerGhii: GHII, logLabel: 'test', producerKind: 'extension' as const,
    };
    it('is refused with ACCOUNT_DEACTIVATED before the extension is looked up', async () => {
        await deactivate();
        try {
            await expect(runExtensionActionAsSystem({ storage, config: { nodeId: NODE } as never }, args))
                .rejects.toMatchObject({ code: 'ACCOUNT_DEACTIVATED', message: expect.stringMatching(/deactivated/) });
            // Somebody waits for this one (an app's markdown action): the account does not stop it.
            await expect(runExtensionActionAsSystem({ storage, config: { nodeId: NODE } as never }, { ...args, servesWaitingCaller: true }))
                .rejects.toThrow(/not found/);
        } finally { await reactivate(); }
    });
    it('an active account reaches the extension lookup as before', async () => {
        await expect(runExtensionActionAsSystem({ storage, config: { nodeId: NODE } as never }, args)).rejects.toThrow(/not found/);
    });
});
