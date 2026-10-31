/**
 * @file test/unit/schedule-instruction-hold-order.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A sibling agent's new instruction to another agent's `ai` schedule never fires with the
 *   maker's reach before the owner allows it, also while the edit is being stored and when the hold
 *   record cannot be written (services/schedule-write.ts updateScheduleRecord,
 *   services/schedule-instruction-hold.ts; secaudit 2026-10-31 inv-27).
 *
 *   With the real SQLite store. The maker R holds memory:read-as-owner, the editor A does not. A fire
 *   is simulated at the moments the edit writes (instructionHoldAtFire, the step runAiJob takes
 *   first), and what it would run is recorded:
 *   - refused: no fire runs A's instruction while the edit is being stored, whether the owner was
 *     asked or could not be asked; when the hold cannot be written, A's instruction is not stored;
 *   - kept: the owner edits and the next fire runs the owner's instruction; A's held instruction runs
 *     once the owner allows it; one the owner could not be asked about runs the earlier instruction.
 * @usage cd aimeat && pnpm exec vitest run test/unit/schedule-instruction-hold-order.test.ts
 * @version-history
 *   v1.0.0 -- 2026-10-31 -- Initial (secaudit 2026-10-31 inv-27).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { rmSync, existsSync } from 'node:fs';

vi.mock('../../src/utils/logger.js', async (importOriginal) => {
    const real = await importOriginal<Record<string, unknown>>();
    // No `then`: a logger call returned from a .catch handler must not read as a promise.
    const quiet: unknown = new Proxy({}, { get: (_t, p) => (p === 'then' ? undefined : () => quiet) });
    return { ...real, logger: quiet };
});

import { createStorage } from '../../src/storage/storage-factory.js';
import { setThisNodeId } from '../../src/utils/gaii.js';
import { updateScheduleRecord, type ScheduleWriteCaller } from '../../src/services/schedule-write.js';
import { instructionHoldAtFire, HOLD_PREFIX } from '../../src/services/schedule-instruction-hold.js';
import { decidePublishRequest } from '../../src/services/publish-requests/decide.js';
import { PUBLISH_REQUEST_PREFIX } from '../../src/services/publish-requests/store.js';
import { callerFromAuth } from '../../src/services/caller-context.js';
import type { Storage, ScheduledJobRecord, MemoryRecord } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';

const SQLITE_PATH = `./test/.schedhold-${process.pid}.db`;
const NODE = 'aimeat-sched-hold';
const OWNER = 'holder';
const GHII = `${OWNER}@${NODE}`;
const MAKER = `maker#${OWNER}@${NODE}`;
const EDITOR = `editor#${OWNER}@${NODE}`;
const BASE = ['ai:use', 'memory:read', 'memory:write', 'task:write'];
let real: Storage;
let storage: Storage;
let config: AimeatConfig;

/** What the test makes the store do around an edit. */
const faults = { holdWritesFail: false, asksFail: false, fireAtEdit: false };
/** The prompt each simulated fire would run, or 'wait'. */
let fires: string[] = [];
let inFire = false;

async function fireNow(id: string): Promise<void> {
    if (inFire) return;
    inFire = true;
    try {
        const job = await real.getScheduledJob(id);
        const held = await instructionHoldAtFire({ storage, config }, job!);
        fires.push('wait' in held ? 'wait' : String((held.job.input as { prompt?: string }).prompt));
    } finally { inFire = false; }
}

const isHold = (owner: string, key: string) => owner.startsWith('system@') && key.startsWith(HOLD_PREFIX);

/** The real store, with the faults above and a fire before and after each schedule row write. */
function watched(s: Storage): Storage {
    return new Proxy(s, {
        get(target, prop, receiver) {
            const orig = Reflect.get(target, prop, receiver);
            if (typeof orig !== 'function') return orig;
            if (prop === 'updateScheduledJob') {
                return async (id: string, patch: Partial<ScheduledJobRecord>) => {
                    if (faults.fireAtEdit) await fireNow(id);
                    const out = await orig.call(target, id, patch);
                    if (faults.fireAtEdit) await fireNow(id);
                    return out;
                };
            }
            if (prop === 'createMemoryIfAbsent' || prop === 'setMemory' || prop === 'setMemoryIfVersion') {
                return async (r: MemoryRecord, ...rest: unknown[]) => {
                    if (faults.holdWritesFail && isHold(r.ownerGaii, r.key)) throw new Error('disk full');
                    return orig.call(target, r, ...rest);
                };
            }
            if (prop === 'listMemory') {
                return async (owner: string, opts?: { prefix?: string }) => {
                    if (faults.asksFail && opts?.prefix === PUBLISH_REQUEST_PREFIX) throw new Error('queue unreadable');
                    return orig.call(target, owner, opts);
                };
            }
            return orig.bind(target);
        },
    });
}

async function agent(gaii: string, scopes: string[]): Promise<void> {
    await real.createAgent({
        name: gaii.split('#')[0]!, owner: OWNER, gaii, capabilities: [], publicKey: 'pk', trustScore: 0, morselBalance: 0,
        createdAt: '2026-10-01T00:00:00.000Z', lastSeen: '2026-10-01T00:00:00.000Z', defaultScopes: scopes,
    } as never);
}

beforeAll(async () => {
    setThisNodeId(NODE);
    real = await createStorage({ provider: 'sqlite', sqlitePath: SQLITE_PATH });
    storage = watched(real);
    config = { nodeId: NODE, baseUrl: 'http://localhost' } as AimeatConfig;
    await real.createOwner({ name: OWNER, displayName: OWNER, publicKey: 'pk', roles: ['owner'], createdAt: '2026-01-01T00:00:00.000Z' } as never);
    await agent(MAKER, [...BASE, 'memory:read-as-owner']);
    await agent(EDITOR, BASE);
}, 60_000);

afterAll(async () => {
    setThisNodeId(null);
    await (real as unknown as { close?: () => void | Promise<void> }).close?.();
    for (const suffix of ['', '-wal', '-shm']) {
        const p = SQLITE_PATH + suffix;
        if (existsSync(p)) { try { rmSync(p); } catch { /* the test's own scratch */ } }
    }
});

beforeEach(() => { fires = []; Object.assign(faults, { holdWritesFail: false, asksFail: false, fireAtEdit: false }); });

let n = 0;
/** An ai schedule the maker made over the owner's private record. */
async function makerSchedule(): Promise<string> {
    n++;
    const now = new Date().toISOString();
    const job = await real.createScheduledJob({
        id: `hold-${n}-${Date.now()}`, name: `hold-${n}`, type: 'ai', cron: '0 4 1 1 *', enabled: true, ownerScope: GHII,
        createdBy: MAKER, createdByAgent: true, createdAt: now, updatedAt: now,
        input: { prompt: 'ORIGINAL', inputKeys: ['owner.private'], outputKey: `out.${n}`, outputVisibility: 'owner' },
    } as unknown as ScheduledJobRecord);
    return job.id;
}

const editor: ScheduleWriteCaller = { owner: OWNER, identity: EDITOR, isOwnerSession: false, scopes: BASE, roles: ['agent'] };
const person: ScheduleWriteCaller = { owner: OWNER, identity: GHII, isOwnerSession: true, scopes: ['*'], roles: ['owner'] };
const deps = () => ({ storage, config, scheduler: null });
const storedPrompt = async (id: string) => ((await real.getScheduledJob(id))!.input as { prompt?: string }).prompt;

describe('a sibling\'s new instruction to another agent\'s ai schedule', () => {
    it('no fire runs it while the edit is being stored and the owner is asked', async () => {
        const id = await makerSchedule();
        faults.fireAtEdit = true;
        const out = await updateScheduleRecord(deps(), editor, id, { prompt: 'NEW' });
        expect(out.ok).toBe(true);
        expect(fires).not.toContain('NEW');
        faults.fireAtEdit = false;
        await fireNow(id);
        expect(fires.at(-1)).toBe('wait');
    });

    it('no fire runs it while the edit is being stored and the owner could not be asked; the next fire runs the earlier one', async () => {
        const id = await makerSchedule();
        faults.fireAtEdit = true;
        faults.asksFail = true;
        const out = await updateScheduleRecord(deps(), editor, id, { prompt: 'NEW' });
        expect(out.ok).toBe(true);
        expect(fires).not.toContain('NEW');
        faults.fireAtEdit = false;
        faults.asksFail = false;
        await fireNow(id);
        expect(fires.at(-1)).toBe('ORIGINAL');
        await fireNow(id);
        expect(fires.at(-1)).toBe('ORIGINAL');
    });

    it('when the hold cannot be written, the instruction is not stored and no fire runs it', async () => {
        const id = await makerSchedule();
        faults.holdWritesFail = true;
        await updateScheduleRecord(deps(), editor, id, { prompt: 'NEW' }).catch(() => null);
        faults.holdWritesFail = false;
        expect(await storedPrompt(id)).toBe('ORIGINAL');
        await fireNow(id);
        expect(fires).not.toContain('NEW');
    });

    it('usage: the owner\'s edit fires at once with the owner\'s instruction', async () => {
        const id = await makerSchedule();
        const out = await updateScheduleRecord(deps(), person, id, { prompt: 'OWNER SAYS' });
        expect(out.ok).toBe(true);
        await fireNow(id);
        expect(fires).toEqual(['OWNER SAYS']);
    });

    it('usage: the held instruction runs once the owner allows it', async () => {
        const id = await makerSchedule();
        const out = await updateScheduleRecord(deps(), editor, id, { prompt: 'NEW' });
        expect(out.ok).toBe(true);
        const requestId = (out as { approval_request?: { request_id: string } }).approval_request!.request_id;
        const owner = { caller: callerFromAuth({ sub: OWNER, owner: OWNER, roles: ['owner'], scopes: [] }, NODE, storage) };
        expect((await decidePublishRequest({ storage, config }, owner, requestId, 'approve')).ok).toBe(true);
        await fireNow(id);
        expect(fires).toEqual(['NEW']);
    });
});
