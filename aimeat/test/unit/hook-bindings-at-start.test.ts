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
 *   v1.3.0 — 2026-09-26 — The store forgets the record of 0086, the migration that replaces 0085.
 *   v1.2.0 — 2026-09-26 — A binding stored as `id#<account name>` follows its action to the
 *     account's GHII in the same start that moves the action (secaudit 2026-09: R3 row 5).
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

    // An action a person published in person was stored under their bare account name, and a binding
    // to it as `id#name`. The deploy migration moves the action to the person's full identity when
    // the node opens its store; the binding moves with it in the same start, so it keeps naming the
    // action it was made for.
    it('moves a binding that names an action by the bare account name to the account\'s full identity', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'aimeat-hook-bindings-'));
        const file = join(dir, 'node.db');
        const { config } = loadConfig();
        const ghii = `opr@${config.nodeId}`;
        const at = '2026-09-01T00:00:00.000Z';
        const seed = new SqliteStorage(file);
        await seed.createOwner({ name: 'opr', displayName: 'opr', publicKey: 'pk', roles: ['owner'], createdAt: at });
        await seed.createGHII({
            username: 'opr', nodeId: config.nodeId, ghii, displayName: 'opr', verificationLevel: 0,
            ownerName: 'opr', totpEnabled: false, morselBalance: 0, loginCount: 0, createdAt: at, updatedAt: at,
        });
        await seed.createAction({ ...published, id: 'own-gate', providerGaii: 'opr', createdAt: '2026-09-02T00:00:00.000Z', updatedAt: '2026-09-02T00:00:00.000Z' });
        await seed.setConfigValue('hooks.pre_agent_registration', JSON.stringify(['own-gate#opr']));
        // A store written before the deploy migration existed carries no record that it ran: neither
        // 0085's nor that of 0086, which replaces it.
        const db = (seed as unknown as { db: { prepare(sql: string): { run(...a: unknown[]): unknown } } }).db;
        for (const key of ['migration:0085_actions_work_full_identity.sql', 'migration:0086_full_identity_on_evidence.sql', 'migration:0086:held']) {
            db.prepare('DELETE FROM system_settings WHERE key = ?').run(key);
        }
        seed.close();

        Object.assign(config, { storageProvider: 'sqlite', sqlitePath: file, dbUrl: null, perfTrace: false });
        const { storage } = await initializeConfig(config);
        try {
            expect((await storage.listActionsByProvider(ghii)).map((a) => a.id)).toEqual(['own-gate']);
            expect(config.extensionHooks.pre_agent_registration).toEqual([`own-gate#${ghii}`]);
            const stored = await storage.getAllConfigValues();
            expect(JSON.parse(stored['hooks.pre_agent_registration'])).toEqual([`own-gate#${ghii}`]);
            expect(await storage.getMemory(`system@${config.nodeId}`, 'migrations.hook-bindings-full-identity')).toBeTruthy();
        } finally {
            (storage as unknown as { close(): void }).close();
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
