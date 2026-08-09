/**
 * @file test/unit/quota-alarm.test.ts
 * @description The 80%/95% memory quota alarm. The behaviours worth pinning are the ones that make
 *   it useless if they drift: it must not fire below the band (or the bell becomes noise nobody
 *   reads), it must not repeat within the window (a collector writing every minute would otherwise
 *   send a notification every minute), it must route an agent's and an extension's pressure to the
 *   HUMAN owner rather than to a principal with no inbox, and it must never throw into the write
 *   path it is attached to.
 * @usage pnpm test -- quota-alarm
 * @version-history
 *   v1.0.0 — 2026-08-09 — Initial, with the alarm (memory-key-shape audit).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AimeatConfig } from '../../src/config.js';
import type { Storage } from '../../src/storage/interface.js';

const setMemory = vi.fn(async () => undefined);
const getExtension = vi.fn(async (_name: string) => ({ installedBy: 'alice' }));

vi.mock('../../src/services/push.js', () => ({}));

import { checkMemoryQuotaAlarm, __resetQuotaAlarmThrottle, QUOTA_ALARM_BANDS } from '../../src/services/quota-alarm.js';

const config = {
    nodeId: 'test-node',
    memoryMaxKeysPerAgent: 1000,
    memoryMaxValueSizeKb: 1024,
    memoryQuotaMb: 10,
} as unknown as AimeatConfig;

const storage = { setMemory, getExtension } as unknown as Storage;

/** The recipient GHII of every notification raised in the last call. */
const recipients = () => setMemory.mock.calls.map(c => (c[0] as { ownerGaii: string }).ownerGaii);
const titles = () => setMemory.mock.calls.map(c => ((c[0] as { value: { title: string } }).value.title));

beforeEach(() => {
    setMemory.mockClear();
    getExtension.mockClear();
    __resetQuotaAlarmThrottle();
});

describe('memory quota alarm', () => {
    it('stays silent below the lowest band', async () => {
        await checkMemoryQuotaAlarm(config, storage, 'bot#alice@test-node', { keyCount: 799 });
        expect(setMemory).not.toHaveBeenCalled();
    });

    it('fires once at the 80% band', async () => {
        await checkMemoryQuotaAlarm(config, storage, 'bot#alice@test-node', { keyCount: 800 });
        expect(setMemory).toHaveBeenCalledTimes(1);
        expect(titles()[0]).toContain('80%');
        expect(titles()[0]).toContain('bot');
    });

    it('does not repeat the same band for the same principal inside the window', async () => {
        await checkMemoryQuotaAlarm(config, storage, 'bot#alice@test-node', { keyCount: 810 });
        await checkMemoryQuotaAlarm(config, storage, 'bot#alice@test-node', { keyCount: 820 });
        await checkMemoryQuotaAlarm(config, storage, 'bot#alice@test-node', { keyCount: 830 });
        expect(setMemory).toHaveBeenCalledTimes(1);
    });

    it('still escalates to 95% after 80% has already fired', async () => {
        await checkMemoryQuotaAlarm(config, storage, 'bot#alice@test-node', { keyCount: 800 });
        setMemory.mockClear();
        await checkMemoryQuotaAlarm(config, storage, 'bot#alice@test-node', { keyCount: 960 });
        expect(setMemory).toHaveBeenCalledTimes(1);
        expect(titles()[0]).toContain('96%');
    });

    it('throttles per principal, not globally', async () => {
        await checkMemoryQuotaAlarm(config, storage, 'a#alice@test-node', { keyCount: 900 });
        await checkMemoryQuotaAlarm(config, storage, 'b#alice@test-node', { keyCount: 900 });
        expect(setMemory).toHaveBeenCalledTimes(2);
    });

    it('weighs keys and bytes as separate dimensions', async () => {
        await checkMemoryQuotaAlarm(config, storage, 'bot#alice@test-node', {
            keyCount: 850,
            usedBytes: 9 * 1024 * 1024,      // 90% of the 10 MB quota
        });
        expect(setMemory).toHaveBeenCalledTimes(2);
        expect(titles().some(t => t.includes('key limit'))).toBe(true);
        expect(titles().some(t => t.includes('quota'))).toBe(true);
    });

    it('sends an AGENT\'s pressure to the human owner, not to the agent', async () => {
        await checkMemoryQuotaAlarm(config, storage, 'news-fetcher#alice@test-node', { keyCount: 900 });
        expect(recipients()).toEqual(['alice@test-node']);
    });

    it('sends an EXTENSION\'s pressure to whoever installed it', async () => {
        await checkMemoryQuotaAlarm(config, storage, 'ext:luotain', { keyCount: 900 });
        expect(getExtension).toHaveBeenCalledWith('luotain');
        expect(recipients()).toEqual(['alice@test-node']);
        expect(titles()[0]).toContain('luotain');
    });

    it('resolves an instance-scoped extension namespace to its base extension', async () => {
        await checkMemoryQuotaAlarm(config, storage, 'ext:chilikaveri.oletus', { keyCount: 900 });
        expect(getExtension).toHaveBeenCalledWith('chilikaveri');
    });

    it('names FOLDING as the remedy, never deletion, when the KEY ceiling is the problem', async () => {
        await checkMemoryQuotaAlarm(config, storage, 'bot#alice@test-node', { keyCount: 900 });
        const body = (setMemory.mock.calls[0]![0] as { value: { body: string } }).value.body;
        expect(body).toContain('1024 kB');
        expect(body).toMatch(/one record/i);
    });

    it('swallows a storage failure rather than breaking the write it is attached to', async () => {
        setMemory.mockRejectedValueOnce(new Error('db down'));
        await expect(
            checkMemoryQuotaAlarm(config, storage, 'bot#alice@test-node', { keyCount: 900 }),
        ).resolves.toBeUndefined();
    });

    it('says nothing when the principal has no resolvable owner', async () => {
        getExtension.mockResolvedValueOnce(null as unknown as { installedBy: string });
        await checkMemoryQuotaAlarm(config, storage, 'ext:orphaned', { keyCount: 900 });
        expect(setMemory).not.toHaveBeenCalled();
    });

    it('has bands in ascending order, so bandFor picks the highest crossed', () => {
        expect([...QUOTA_ALARM_BANDS]).toEqual([...QUOTA_ALARM_BANDS].sort((a, b) => a - b));
    });
});
