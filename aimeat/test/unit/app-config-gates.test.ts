/**
 * @file test/unit/app-config-gates.test.ts
 * @description An app's config read applies the app's own gates (services/app-config.ts, secaudit
 *   2026-10, APP-6): an app an operator hid is not found except for its owner and operators, and an
 *   access-coded app's workspace ids need the code or the owner. The values stay readable.
 * @version-history
 *   v1.0.0 — 2026-10-05 — Initial.
 */
import { describe, it, expect } from 'vitest';
import type { Storage } from '../../src/storage/interface.js';
import { getAppConfig } from '../../src/services/app-config.js';
import { appWorkspacesKey } from '../../src/services/app-workspaces.js';

const OWNER_GHII = 'alice@test-node';
const LINK = { organism_id: 'org-1', workspace_id: 'ws-secret' };

function storageWith(app: Record<string, unknown>): Storage {
    return {
        getAppByOwnerName: async () => ({
            ownerGaii: OWNER_GHII, ownerName: 'alice', filename: 'shop.html',
            manifest: { workspaces: [{ contract: 'shop/1' }] }, ...app,
        }),
        getMemory: async (_owner: string, key: string) => (key === appWorkspacesKey('shop.html') ? { value: { links: { 'shop/1': LINK } } } : null),
    } as unknown as Storage;
}

const stranger = { ownerOrOperator: false };

describe('the config read of an app with gates', () => {
    it('an app an operator hid is not found for a stranger, and is read by its owner', async () => {
        const s = storageWith({ operatorHidden: true });
        const out = await getAppConfig(s, 'alice', 'shop.html', stranger);
        expect(out.ok === false && out.status).toBe(404);
        expect((await getAppConfig(s, 'alice', 'shop.html', { ownerOrOperator: true })).ok).toBe(true);
    });

    it('an access-coded app keeps its workspace ids from a stranger without the code, and gives them with it', async () => {
        const s = storageWith({ accessCode: 'open-sesame' });
        const without = await getAppConfig(s, 'alice', 'shop.html', stranger);
        expect(without.ok && without.view.workspaces).toBeFalsy();
        const withCode = await getAppConfig(s, 'alice', 'shop.html', { ownerOrOperator: false, code: 'open-sesame' });
        expect(withCode.ok && withCode.view.workspaces).toEqual({ 'shop/1': LINK });
        const owner = await getAppConfig(s, 'alice', 'shop.html', { ownerOrOperator: true });
        expect(owner.ok && owner.view.workspaces).toEqual({ 'shop/1': LINK });
    });

    it('an app with no gates answers as before', async () => {
        const out = await getAppConfig(storageWith({}), 'alice', 'shop.html', stranger);
        expect(out.ok && out.view.workspaces).toEqual({ 'shop/1': LINK });
    });
});
