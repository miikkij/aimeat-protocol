/**
 * @file test/unit/app-parties-pending-expiry.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An app's signup (services/app-parties/service.ts signUp) on SQLite in memory: a person
 *   who signed up and never opened the link stops holding a place once consent.app_party_pending_hours
 *   has passed since their last link (secaudit2026nov02d round 13, pending-parties-never-expire-fill-cap).
 *   - An app full of such stale signups takes a new person (202), and the stale ones are gone.
 *   - Kept: a fresh pending signup still counts, so a full app of fresh ones still answers 429; an
 *     active person and a person the owner stopped are never dropped; a pending address asking again
 *     gets a new link; the setting at 0 keeps every pending signup, as before.
 * @usage cd aimeat && pnpm exec vitest run test/unit/app-parties-pending-expiry.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-02 — Initial (secaudit2026nov02d round 13).
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import { loadConfig, type AimeatConfig } from '../../src/config.js';
import { generateKeyPair } from '../../src/auth/keypair.js';
import { setThisNodeId } from '../../src/utils/gaii.js';
import { setActiveEmailService, type EmailService } from '../../src/services/email.js';
import { signUp } from '../../src/services/app-parties/service.js';
import { changeAppParties, readAppParties } from '../../src/services/app-parties/store.js';
import { MAX_APP_PARTIES, LINK_TTL_MS, emailHashOf, type AppPartyRecord } from '../../src/services/app-parties/contract.js';

const NODE_ID = 'aimeat-app-parties-pending';
const OWNER = 'ppowner';
const GHII = `${OWNER}@${NODE_ID}`;
const APP = 'signup.html';
const APP_ID = `${OWNER}/${APP}`;
const HOUR = 3_600_000;

let storage: Storage;
let config: AimeatConfig;
const mailed: string[] = [];

function party(i: number, status: AppPartyRecord['status'], at: number, linkAt: number | null): AppPartyRecord {
    return {
        uid: `u${i}`, name: `ap-${String(i).padStart(12, '0')}`, displayName: `p${i}`, kind: 'person', contact: `p${i}@example.test`,
        status, createdAt: new Date(at).toISOString(), createdBy: `app:${APP_ID}`, keys: [], failedAttempts: 0, lastSeenAt: null,
        app: APP_ID, emailHash: emailHashOf(`p${i}@example.test`), verifiedAt: status === 'active' ? new Date(at).toISOString() : null,
        link: linkAt === null ? null : { hash: 'h', purpose: 'verify', expiresAt: new Date(linkAt + LINK_TTL_MS).toISOString() }, epoch: 0,
    } as AppPartyRecord;
}

async function fill(parties: AppPartyRecord[]): Promise<void> {
    await changeAppParties(storage, GHII, APP_ID, cur => ({ ...cur, registration: { state: 'open', role: 'member', updatedAt: new Date().toISOString() }, parties }));
}

beforeAll(async () => {
    setThisNodeId(null);
    storage = new SqliteStorage(':memory:') as unknown as Storage;
    config = { ...loadConfig().config, nodeId: NODE_ID, baseUrl: 'https://node.test', partySelfRegistration: 'on', contentAccess: 'open' } as AimeatConfig;
    const k = await generateKeyPair();
    await storage.createOwner({ name: OWNER, displayName: OWNER, publicKey: k.publicKey, roles: ['owner'], createdAt: new Date().toISOString() } as never);
    const data = Buffer.from('<!doctype html><title>s</title>');
    await storage.createApp({
        ownerGaii: GHII, ownerName: OWNER, filename: APP, versionNumber: 1,
        manifest: { name: 'signup', description: 'd', version: '1.0.0', author: OWNER, category: 'tool', tags: [] } as never,
        mimeType: 'text/html', size: data.length, data, createdAt: new Date().toISOString(),
    });
    setActiveEmailService({ enabled: true, sendRaw: async (to: string) => { mailed.push(to); return true; } } as unknown as EmailService);
}, 60_000);

beforeEach(() => { mailed.length = 0; });

describe('a signup nobody confirmed stops holding a place', () => {
    it('an app full of signups whose last link is older than the setting takes a new person, and drops the stale ones', async () => {
        const old = Date.now() - 48 * HOUR;
        await fill(Array.from({ length: MAX_APP_PARTIES }, (_, i) => party(i, 'pending', old, old)));
        const out = await signUp({ storage, config: { ...config, appPartyPendingHours: 24 } }, { owner: OWNER, filename: APP }, { email: 'new@example.test' });
        expect(out.ok && out.status).toBe(202);
        const after = await readAppParties(storage, GHII, APP_ID);
        expect(after.parties.map(p => p.contact)).toEqual(['new@example.test']);
        expect(mailed).toEqual(['new@example.test']);
    });

    it('fresh pending signups still count: a full app of them answers 429', async () => {
        const fresh = Date.now() - 10 * 60_000;
        await fill(Array.from({ length: MAX_APP_PARTIES }, (_, i) => party(i, 'pending', fresh, fresh)));
        const out = await signUp({ storage, config: { ...config, appPartyPendingHours: 24 } }, { owner: OWNER, filename: APP }, { email: 'late@example.test' });
        expect(out.ok).toBe(false);
        expect(!out.ok && out.code).toBe('TOO_MANY_PARTIES');
        expect((await readAppParties(storage, GHII, APP_ID)).parties).toHaveLength(MAX_APP_PARTIES);
    });

    it('a pending person whose last link is recent stays, even when they signed up long ago', async () => {
        const old = Date.now() - 72 * HOUR;
        await fill([party(1, 'pending', old, Date.now() - HOUR), party(2, 'pending', old, old)]);
        const out = await signUp({ storage, config: { ...config, appPartyPendingHours: 24 } }, { owner: OWNER, filename: APP }, { email: 'third@example.test' });
        expect(out.ok).toBe(true);
        const uids = (await readAppParties(storage, GHII, APP_ID)).parties.map(p => p.uid);
        expect(uids).toHaveLength(2);
        expect(uids).toContain('u1');
        expect(uids).not.toContain('u2');
    });

    it('an active person and a person the owner stopped are never dropped', async () => {
        const old = Date.now() - 400 * HOUR;
        await fill([party(1, 'active', old, null), party(2, 'stopped', old, null)]);
        const out = await signUp({ storage, config: { ...config, appPartyPendingHours: 1 } }, { owner: OWNER, filename: APP }, { email: 'fourth@example.test' });
        expect(out.ok).toBe(true);
        const uids = (await readAppParties(storage, GHII, APP_ID)).parties.map(p => p.uid);
        expect(uids).toContain('u1');
        expect(uids).toContain('u2');
        expect(uids).toHaveLength(3);
    });

    it('a stale pending address asking again gets a new link and keeps its place', async () => {
        const old = Date.now() - 48 * HOUR;
        await fill([party(7, 'pending', old, old)]);
        const out = await signUp({ storage, config: { ...config, appPartyPendingHours: 24 } }, { owner: OWNER, filename: APP }, { email: 'p7@example.test' });
        expect(out.ok && out.status).toBe(202);
        expect(mailed).toEqual(['p7@example.test']);
        const after = await readAppParties(storage, GHII, APP_ID);
        expect(after.parties.map(p => p.uid)).toEqual(['u7']);
        expect(Date.parse(after.parties[0]!.link!.expiresAt)).toBeGreaterThan(Date.now());
    });

    it('the setting at 0 keeps every pending signup, as before', async () => {
        const old = Date.now() - 4000 * HOUR;
        await fill(Array.from({ length: MAX_APP_PARTIES }, (_, i) => party(i, 'pending', old, old)));
        const out = await signUp({ storage, config: { ...config, appPartyPendingHours: 0 } }, { owner: OWNER, filename: APP }, { email: 'zero@example.test' });
        expect(!out.ok && out.code).toBe('TOO_MANY_PARTIES');
    });
});
