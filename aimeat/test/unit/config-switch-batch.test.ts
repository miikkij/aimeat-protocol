/**
 * @file test/unit/config-switch-batch.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The classification switch in a batch of setting changes (changeNodeSettings,
 *   services/config-admin-view.ts, behind PUT /v1/admin/config and aimeat_admin_config_set): an AI
 *   credential is refused every loosening step of the switch, also when the batch names the switch
 *   more than once and an earlier change tightens it; nothing of a refused batch is applied. The
 *   same credential still tightens the switch, alone or twice in one batch.
 * @usage cd aimeat && pnpm exec vitest run test/unit/config-switch-batch.test.ts
 * @version-history
 *   2026-10-31 — Initial (secaudit 2026-10-31 inv-14).
 */
import { describe, it, expect } from 'vitest';
import { changeNodeSettings } from '../../src/services/config-admin-view.js';
import type { AimeatConfig } from '../../src/config.js';
import type { Storage } from '../../src/storage/interface.js';
import type { SwitchCaller } from '../../src/services/classification/switch.js';

const NODE = 'switch-batch-test';
const agent: SwitchCaller = { sub: `claude#op@${NODE}`, owner: 'op', roles: ['agent'], scopes: ['operator:admin'] };

function world(mode: 'off' | 'owner' | 'all') {
    const stored: Record<string, string> = {};
    const storage = {
        supportsConfigPersistence: () => true,
        setConfigValue: async (p: string, v: string) => { stored[p] = v; },
    } as unknown as Storage;
    const config = { nodeId: NODE, sealedConfigKeys: [], classificationMode: mode } as unknown as AimeatConfig;
    return { storage, config, stored };
}

const MODE = 'classification.mode';

describe('the classification switch in a batch, from an AI credential', () => {
    it('owner → all → off in one batch is refused, and nothing is applied', async () => {
        const { storage, config, stored } = world('owner');
        const r = await changeNodeSettings({ config, storage }, agent, [{ path: MODE, value: 'all' }, { path: MODE, value: 'off' }]);
        expect(r.ok).toBe(false);
        expect(r.ok === false && r.code).toBe('PERSON_REQUIRED');
        expect(config.classificationMode).toBe('owner');
        expect(stored[MODE]).toBeUndefined();
    });

    it('all → all → owner in one batch is refused', async () => {
        const { storage, config } = world('all');
        const r = await changeNodeSettings({ config, storage }, agent, [{ path: MODE, value: 'all' }, { path: MODE, value: 'owner' }]);
        expect(r.ok === false && r.code).toBe('PERSON_REQUIRED');
        expect(config.classificationMode).toBe('all');
    });

    it('owner → all alone is applied', async () => {
        const { storage, config } = world('owner');
        const r = await changeNodeSettings({ config, storage }, agent, [{ path: MODE, value: 'all' }]);
        expect(r.ok).toBe(true);
        expect(config.classificationMode).toBe('all');
    });

    it('off → owner → all in one batch is applied: every step tightens', async () => {
        const { storage, config } = world('off');
        const r = await changeNodeSettings({ config, storage }, agent, [{ path: MODE, value: 'owner' }, { path: MODE, value: 'all' }]);
        expect(r.ok).toBe(true);
        expect(config.classificationMode).toBe('all');
    });
});
