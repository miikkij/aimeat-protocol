/**
 * @file test/unit/extension-host-bounds.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The host memory one extension run holds through its host calls is bounded, not only
 *   each call (secaudit2026oct22). Against the real ctx builder:
 *     - ctx.fetch calls started together are queued so at most EXT_FETCH_INFLIGHT_BYTES of answers
 *       are in flight (32 at the 4 MB ceiling, 4 at 32 MB), and every one of them still answers;
 *     - a queued call ends with the run's signal;
 *     - ctx.memory.getPublic by a bare owner name reads one record, not every record of that owner's
 *       agents under the key as a prefix (every record for an empty key), and answers as before.
 *   FIRST FAIL: on the tree before this change all the fetches are in flight at once, and getPublic
 *   lists the agents' records with their values.
 * @usage cd aimeat && pnpm exec vitest run test/unit/extension-host-bounds.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial (secaudit2026oct22).
 */
import { describe, it, expect, vi } from 'vitest';
import type { AimeatConfig } from '../../src/config.js';
import type { Storage } from '../../src/storage/interface.js';

let inFlight = 0, peak = 0;
vi.mock('../../src/utils/url-validator.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../src/utils/url-validator.js')>();
    return {
        ...actual,
        safeFetch: vi.fn(async () => {
            inFlight++; peak = Math.max(peak, inFlight);
            await new Promise(r => setTimeout(r, 15));
            inFlight--;
            return new Response('ok', { status: 200 });
        }),
    };
});

const { buildExtensionCtx } = await import('../../src/services/extension-ctx.js');
const { SqliteStorage } = await import('../../src/storage/providers/sqlite/index.js');

const config = { nodeId: 'node-1', encryptionKey: null, totpSecretEncryptionKey: null } as unknown as AimeatConfig;
const ctxWith = (storage: Storage, fetchMaxBytes?: number) => buildExtensionCtx({
    capabilities: { network: true, ai: false, email: false, payments: false, declared: true, ...(fetchMaxBytes ? { fetchMaxBytes } : {}) },
    config, storage, extMemoryOwner: 'ext:collector',
    caller: { gaii: 'alice@node-1', owner: 'alice', roles: ['owner'] }, extConfig: {}, logPrefix: '[ext:collector]',
});

describe('ctx.fetch calls started together', () => {
    it('at the 32 MB ceiling: at most 4 in flight, and all twelve answer', async () => {
        inFlight = 0; peak = 0;
        const ctx = ctxWith({} as Storage, 32 * 1024 * 1024);
        const all = await Promise.all(Array.from({ length: 12 }, (_, i) => ctx.fetch(`https://feed.example/${i}`)));
        expect(all.every(r => r.ok && r.text === 'ok')).toBe(true);
        expect(peak).toBeLessThanOrEqual(4);
    });

    it('at the 4 MB default: at most 32 in flight, and all forty answer', async () => {
        inFlight = 0; peak = 0;
        const ctx = ctxWith({} as Storage);
        const all = await Promise.all(Array.from({ length: 40 }, (_, i) => ctx.fetch(`https://feed.example/${i}`)));
        expect(all).toHaveLength(40);
        expect(peak).toBeLessThanOrEqual(32);
        expect(peak).toBeGreaterThan(4);
    });

    it('a call waiting for a slot ends with the run\'s signal', async () => {
        const ctx = ctxWith({} as Storage, 32 * 1024 * 1024);
        const run = new AbortController();
        const calls = Array.from({ length: 5 }, (_, i) => ctx.fetch(`https://feed.example/${i}`, undefined, { signal: run.signal }));
        run.abort(new Error('run ended'));
        const settled = await Promise.allSettled(calls);
        expect(settled.filter(s => s.status === 'rejected').length).toBeGreaterThanOrEqual(1);
    });
});

describe('ctx.memory.getPublic by a bare owner name', () => {
    async function store() {
        const storage = new SqliteStorage(':memory:') as unknown as Storage;
        const now = new Date().toISOString();
        const put = (ownerGaii: string, key: string, value: unknown, visibility = 'public') => storage.setMemory({
            key, ownerGaii, value, visibility, tags: [], ttlHours: null, version: 1, createdAt: now, updatedAt: now,
        } as never);
        await put('claude#carol@node-1', 'notes', { text: 'the public note' });
        await put('claude#carol@node-1', 'notes.big', { text: 'x'.repeat(1000) });
        await put('codex#carol@node-1', 'notes.other', { text: 'y'.repeat(1000) });
        const listed: string[] = [];
        const spy = new Proxy(storage, {
            get(target, prop, recv) {
                if (prop === 'getAgentsByOwner') return async () => [{ gaii: 'claude#carol@node-1' }, { gaii: 'codex#carol@node-1' }];
                if (prop === 'listMemoryForOwners') return async (...args: unknown[]) => { listed.push(JSON.stringify(args[1])); return (target as never as { listMemoryForOwners: (...a: unknown[]) => unknown }).listMemoryForOwners(...args); };
                const v = Reflect.get(target, prop, recv);
                return typeof v === 'function' ? v.bind(target) : v;
            },
        });
        return { storage: spy as Storage, listed };
    }

    it('answers the agent\'s public record, and loads no values under the prefix', async () => {
        const { storage, listed } = await store();
        expect(await ctxWith(storage).memory.getPublic('carol', 'notes')).toEqual({ text: 'the public note' });
        expect(listed).toEqual([]);
    });

    it('an empty key loads nothing and answers null', async () => {
        const { storage, listed } = await store();
        expect(await ctxWith(storage).memory.getPublic('carol', '')).toBeNull();
        expect(listed).toEqual([]);
    });
});
