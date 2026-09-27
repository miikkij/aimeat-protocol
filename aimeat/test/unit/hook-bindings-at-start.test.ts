/**
 * @file test/unit/hook-bindings-at-start.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What a node does at start with the hook bindings its store holds, through the real
 *   start step (server-bootstrap/config-init.ts initializeConfig) on a real SQLite file.
 *
 *   A hook binds only an action that is already published, and a binding is stored as the
 *   `id#provider` of the action it names. A store can hold a bare id written before that rule. The
 *   start step brings it to the same form: a bare id one provider publishes is stored with its
 *   provider, and one that no provider publishes is taken off its moment, with a line on the Hooks
 *   page that says so. test/unit/hooks.test.ts holds every case of settleStoredHookBindings; this
 *   file proves that the start step calls it on what it loaded, and that the change is saved.
 * @structure one real SQLite file, seeded, then opened by initializeConfig as a node opens it
 * @usage cd aimeat && pnpm exec vitest run test/unit/hook-bindings-at-start.test.ts
 * @version-history
 *   v1.1.0 — 2026-09-26 — The start records that the bindings are settled, once per node (A8-3).
 *   v1.0.0 — 2026-09-26 — Initial (security audit A8-3).
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../../src/config.js';
import { initializeConfig } from '../../src/server-bootstrap/config-init.js';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import { readHookRuns } from '../../src/services/hook-log.js';
import { HOOK_BINDINGS_SETTLED_KEY } from '../../src/services/hooks-overview.js';
import type { ActionRecord } from '../../src/storage/types/commerce.js';

const published: ActionRecord = {
    id: 'mine', providerGaii: 'bot#opr@node', displayName: 'Mine', description: 'The operator\'s own gate.',
    inputSchema: {}, outputSchema: {}, pricing: { baseMorsels: 0 }, tags: [],
    webhookUrl: 'https://operator.example/mine',
    createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
} as ActionRecord;

describe('a node settles the hook bindings its store holds when it starts', () => {
    it('stores a bare id one provider publishes with its provider, and takes off one nobody publishes', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'aimeat-hook-bindings-'));
        const file = join(dir, 'node.db');
        const seed = new SqliteStorage(file);
        await seed.createAction(published);
        await seed.setConfigValue('hooks.pre_owner_registration', JSON.stringify(['mine', 'gone']));
        await seed.setConfigValue('hooks.post_settlement', JSON.stringify(['gone']));
        seed.close();

        const { config } = loadConfig();
        Object.assign(config, { storageProvider: 'sqlite', sqlitePath: file, dbUrl: null, perfTrace: false });
        const { storage } = await initializeConfig(config);
        try {
            expect(config.extensionHooks.pre_owner_registration).toEqual(['mine#bot#opr@node']);
            expect(config.extensionHooks.post_settlement).toEqual([]);
            const stored = await storage.getAllConfigValues();
            expect(JSON.parse(stored['hooks.pre_owner_registration'])).toEqual(['mine#bot#opr@node']);
            expect(stored['hooks.post_settlement']).toBeUndefined();
            const runs = await readHookRuns(storage);
            expect(runs.filter((r) => r.actionRef === 'gone').map((r) => [r.hook, r.answer]).sort()).toEqual([
                ['post_settlement', 'missing'], ['pre_owner_registration', 'missing'],
            ]);
            // Once per node: the record says so, and a later start reads it and changes nothing.
            expect(await storage.getMemory(`system@${config.nodeId}`, HOOK_BINDINGS_SETTLED_KEY)).toBeTruthy();
        } finally {
            (storage as unknown as { close(): void }).close();
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
