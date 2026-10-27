/**
 * @file test/unit/extension-memory-search-queue.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description ctx.memory.search reads the extension's whole matching namespace into host memory, and
 *   a script may start every one of its host calls at once without awaiting them, so one run could
 *   hold up to its API-call limit of full copies at once (secaudit2026oct26,
 *   extension-ctx/memory-search-unbounded-namespace-load). One run's searches now run one after
 *   another, queued and not refused, as the fetch gate queues fetches.
 *
 *   Usage kept: every search still answers, each with every record under its prefix.
 * @usage cd aimeat && pnpm exec vitest run test/unit/extension-memory-search-queue.test.ts
 * @version-history
 *   v1.0.0 -- 2026-10-27 -- Initial (secaudit2026oct26).
 */
import { describe, it, expect } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import { buildExtensionCtx } from '../../src/services/extension-ctx.js';
import { loadConfig } from '../../src/config.js';

describe('one run\'s ctx.memory.search calls', () => {
    it('run one at a time when the script starts many at once, and each answers in full', async () => {
        const cfg = loadConfig().config;
        const storage = new SqliteStorage(':memory:');
        const owner = 'ext:collector';
        for (let i = 0; i < 5; i++) {
            await storage.setMemory({ key: `item.${i}`, ownerGaii: owner, value: { n: i }, visibility: 'private', tags: [], ttlHours: null, version: 1,
                createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as never);
        }
        let inFlight = 0, most = 0;
        const list = storage.listMemory.bind(storage);
        (storage as unknown as { listMemory: typeof list }).listMemory = async (...args: Parameters<typeof list>) => {
            inFlight++; most = Math.max(most, inFlight);
            try {
                await new Promise(r => setTimeout(r, 5));
                return await list(...args);
            } finally { inFlight--; }
        };
        const ctx = buildExtensionCtx({ capabilities: { network: false, ai: false, email: false, payments: false, declared: true },
            config: cfg, storage: storage as never, extMemoryOwner: owner,
            caller: { gaii: `alice@${cfg.nodeId}`, owner: 'alice', roles: ['owner'] } as never, extConfig: {}, logPrefix: 'test',
        });
        const answers = await Promise.all(Array.from({ length: 20 }, () => ctx.memory.search('item.')));
        expect(most).toBe(1);
        expect(answers.every(a => a.length === 5)).toBe(true);
    });
});
