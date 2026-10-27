/**
 * @file test/unit/goals-sweep-deactivated.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The goal sweep leaves a deactivated account's goals as they are, and moves them on
 *   after reactivation (secaudit2026oct26, goals-sweep.ts:deactivated-account-goals-keep-running).
 *
 *   With the real SQLite store: a clock-round goal whose round is due starts no round while the
 *   account is deactivated; a goal past its end date is not expired then either, and is after
 *   reactivation. The usage case: an active account's goal is swept as before.
 * @usage cd aimeat && pnpm exec vitest run test/unit/goals-sweep-deactivated.test.ts
 * @version-history
 *   v1.0.0 -- 2026-10-27 -- Initial (secaudit2026oct26).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { rmSync, existsSync } from 'node:fs';

vi.mock('../../src/utils/logger.js', async (importOriginal) => {
    const real = await importOriginal<Record<string, unknown>>();
    const quiet: unknown = new Proxy({}, { get: () => () => quiet });
    return { ...real, logger: quiet };
});

import { createStorage } from '../../src/storage/storage-factory.js';
import { setThisNodeId } from '../../src/utils/gaii.js';
import { buildGoal } from '../../src/services/goals/goals-create.js';
import { createGoalRecord, readGoal, type GoalAccess } from '../../src/services/goals/goals-store.js';
import { sweepOne } from '../../src/services/goals/goals-sweep.js';
import type { Storage } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';

const SQLITE_PATH = `./test/.goalpause-${process.pid}.db`;
const NODE = 'aimeat-goal-pause';
const OWNER = 'goalpauser';
const GHII = `${OWNER}@${NODE}`;
let storage: Storage;
let deps: { storage: Storage; config: AimeatConfig };

beforeAll(async () => {
    setThisNodeId(NODE);
    storage = await createStorage({ provider: 'sqlite', sqlitePath: SQLITE_PATH });
    await storage.createOwner({ name: OWNER, displayName: OWNER, publicKey: 'pk', roles: ['owner'], createdAt: new Date().toISOString() } as never);
    deps = { storage, config: { nodeId: NODE, baseUrl: 'http://localhost' } as AimeatConfig };
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
const person: GoalAccess = { ownerGhii: GHII, ownerName: OWNER, person: true, agent: null, who: 'owner' };

/** A goal the owner made in person whose end date has passed. */
async function endedGoal(): Promise<string> {
    const goal = buildGoal(person, { statement: 'Collect the notes.', ends_at: '2026-01-01T00:00:00.000Z' });
    await createGoalRecord(deps, GHII, goal);
    return goal.id;
}

describe('the goal sweep and the account', () => {
    it('usage: an active account\'s goal past its end date expires', async () => {
        const id = await endedGoal();
        await sweepOne(deps, GHII, (await readGoal(deps, GHII, id))!);
        expect((await readGoal(deps, GHII, id))?.status).toBe('expired');
    });

    it('a deactivated account\'s goal is left as it is, and moves on after reactivation', async () => {
        const id = await endedGoal();
        await deactivate();
        try {
            await sweepOne(deps, GHII, (await readGoal(deps, GHII, id))!);
            expect((await readGoal(deps, GHII, id))?.status).toBe('active');
        } finally {
            await reactivate();
        }
        await sweepOne(deps, GHII, (await readGoal(deps, GHII, id))!);
        expect((await readGoal(deps, GHII, id))?.status).toBe('expired');
    });

    it('a deactivated account\'s clock round that is due does not start', async () => {
        const goal = buildGoal(person, { statement: 'A note every morning.', rounds: { trigger: 'clock', cron: '0 7 * * *', works: [{ title: 'Write the note' }] } } as never);
        goal.rounds!.nextAt = '2026-01-01T07:00:00.000Z';
        await createGoalRecord(deps, GHII, goal);
        await deactivate();
        try {
            await sweepOne(deps, GHII, (await readGoal(deps, GHII, goal.id))!);
            const after = await readGoal(deps, GHII, goal.id);
            expect(after?.rounds?.nextAt).toBe('2026-01-01T07:00:00.000Z');
            expect(after?.rounds?.count).toBe(0);
            expect(after?.works).toHaveLength(0);
        } finally {
            await reactivate();
        }
    });
});
