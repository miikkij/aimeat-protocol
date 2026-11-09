/**
 * @file test/unit/app-parties-owner-deactivated.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A person registered to an app (services/app-parties/service.ts appPartyFromRequest) while
 *   the app's owner is deactivated, on SQLite in memory (secaudit2026nov08 round 14, older item O3).
 *   - Designed use: an active party with its session token is admitted while the owner is active.
 *   - While the owner is deactivated the same token answers 403 ACCOUNT_DISABLED, naming the deactivation.
 *   - After reactivation the same token is admitted again: nothing was deleted.
 * @usage cd aimeat && pnpm exec vitest run test/unit/app-parties-owner-deactivated.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-08 — Initial (secaudit2026nov08 round 14, older item O3).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { webcrypto } from 'node:crypto';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import { loadConfig, type AimeatConfig } from '../../src/config.js';
import { generateKeyPair } from '../../src/auth/keypair.js';
import { setThisNodeId } from '../../src/utils/gaii.js';
import { initPartyTokenKeys, mintPartyToken } from '../../src/services/parties/token.js';
import { appPartyFromRequest } from '../../src/services/app-parties/service.js';
import { changeAppParties } from '../../src/services/app-parties/store.js';
import type { AppPartyRecord } from '../../src/services/app-parties/contract.js';

const NODE_ID = 'aimeat-app-parties-deactivated';
const OWNER = 'apdowner';
const GHII = `${OWNER}@${NODE_ID}`;
const APP = 'members.html';
const APP_ID = `${OWNER}/${APP}`;

let storage: Storage;
let config: AimeatConfig;
let token = '';

beforeAll(async () => {
    setThisNodeId(null);
    storage = new SqliteStorage(':memory:') as unknown as Storage;
    config = { ...loadConfig().config, nodeId: NODE_ID, baseUrl: 'https://node.test', partySelfRegistration: 'on', contentAccess: 'open' } as AimeatConfig;
    const keys = await webcrypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']) as { privateKey: CryptoKey; publicKey: CryptoKey };
    initPartyTokenKeys(keys.privateKey, keys.publicKey);
    const k = await generateKeyPair();
    await storage.createOwner({ name: OWNER, displayName: OWNER, publicKey: k.publicKey, roles: ['owner'], createdAt: new Date().toISOString() } as never);
    const data = Buffer.from('<!doctype html><title>m</title>');
    await storage.createApp({
        ownerGaii: GHII, ownerName: OWNER, filename: APP, versionNumber: 1,
        manifest: { name: 'members', description: 'd', version: '1.0.0', author: OWNER, category: 'tool', tags: [] } as never,
        mimeType: 'text/html', size: data.length, data, createdAt: new Date().toISOString(),
    });
    const at = new Date().toISOString();
    const party: AppPartyRecord = {
        uid: 'ap-uid-1', name: 'ap-000000000001', displayName: 'liisa', kind: 'person', contact: 'liisa@example.test',
        status: 'active', createdAt: at, createdBy: `app:${APP_ID}`, keys: [], failedAttempts: 0, lastSeenAt: null,
        app: APP_ID, emailHash: 'hash-liisa', verifiedAt: at, link: null, epoch: 0,
    } as AppPartyRecord;
    await changeAppParties(storage, GHII, APP_ID, () => ({ registration: { state: 'open', role: 'member', updatedAt: at }, parties: [party] }));
    token = await mintPartyToken({ owner: OWNER, uid: party.uid, kid: 'app', app: APP_ID, ep: 0 }, 600);
}, 60_000);

const ask = () => appPartyFromRequest({ storage, config }, { owner: OWNER, filename: APP }, { headers: { authorization: `Bearer ${token}` } });

describe('an app party while the app owner is deactivated', () => {
    it('is admitted while the owner is active (designed use)', async () => {
        const v = await ask();
        expect(v.ok).toBe(true);
    });

    it('answers 403 ACCOUNT_DISABLED while the owner is deactivated, naming the deactivation', async () => {
        await storage.updateOwner(OWNER, { disabledAt: new Date().toISOString(), disabledBy: 'operator' } as never);
        const v = await ask();
        expect(v.ok).toBe(false);
        if (!v.ok) {
            expect(v.status).toBe(403);
            expect(v.code).toBe('ACCOUNT_DISABLED');
            expect(v.message).toMatch(/deactivated/);
        }
    });

    it('is admitted again after reactivation, with the same token', async () => {
        await storage.updateOwner(OWNER, { disabledAt: null, disabledBy: null } as never);
        const v = await ask();
        expect(v.ok).toBe(true);
    });
});
