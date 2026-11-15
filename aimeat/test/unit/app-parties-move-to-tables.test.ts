/**
 * @file test/unit/app-parties-move-to-tables.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The boot step that moves an app's own users out of memory records into their tables
 *   (services/app-parties/move-to-tables.ts), on SQLite in memory:
 *   - the parties of an older `app-parties.` record become rows under their own uids, and the record
 *     keeps its registration only;
 *   - each `app-party-data.` key of a moved party, and a shared one, becomes a row, and the key goes;
 *   - on evidence only: a party whose address another uid already holds in the app, and a data key no
 *     app or person names, stay where they are, and one Security page incident names them;
 *   - the step runs once: a second start does nothing.
 * @usage cd aimeat && pnpm exec vitest run test/unit/app-parties-move-to-tables.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-15 — Initial
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import { APP_PARTY_SHARED, type Storage } from '../../src/storage/interface.js';
import { moveAppPartiesToTablesOnce, APP_PARTY_MOVE_INCIDENT_TYPE } from '../../src/services/app-parties/move-to-tables.js';
import { appPartiesKey, partyDataKey, sharedDataKey, toPartyRow, type AppPartyRecord } from '../../src/services/app-parties/contract.js';
import { listSecurityIncidents } from '../../src/services/security-incident.js';
import type { AimeatConfig } from '../../src/config.js';

const NODE_ID = 'aimeat-app-parties-move';
const OWNER = 'mvowner';
const GHII = `${OWNER}@${NODE_ID}`;
const APP_ID = `${OWNER}/shop.html`;
const AT = '2026-11-10T10:00:00.000Z';

let storage: Storage;
const config = { nodeId: NODE_ID } as AimeatConfig;

function party(n: number, email = `p${n}`): AppPartyRecord {
    return {
        uid: `uid-${n}`, name: `ap-00000000000${n}`, displayName: `p${n}`, kind: 'person', contact: `${email}@example.test`,
        status: 'active', createdAt: AT, createdBy: `app:${APP_ID}`, keys: [], failedAttempts: 0, lastSeenAt: null,
        app: APP_ID, emailHash: `hash-${email}`, verifiedAt: AT, link: null, epoch: 0,
    } as AppPartyRecord;
}

async function put(key: string, value: unknown): Promise<void> {
    await storage.setMemory({ key, ownerGaii: GHII, value, visibility: 'private', tags: [], version: 1, createdAt: AT, updatedAt: AT } as never);
}

beforeAll(async () => {
    storage = new SqliteStorage(':memory:') as unknown as Storage;
    // Already in the table under another uid: the record's party 3 has the same address.
    expect(await storage.importAppParty(toPartyRow({ ...party(9, 'p3'), uid: 'uid-other' }, GHII))).toBe('inserted');
    await put(appPartiesKey(APP_ID), {
        appId: APP_ID, registration: { state: 'open', role: 'member', updatedAt: AT },
        parties: [party(1), party(2), party(3)],
    });
    await put(partyDataKey(APP_ID, 'uid-1', 'cart'), { items: [1, 2] });
    await put(sharedDataKey(APP_ID, 'prices'), { eur: 5 });
    // A collection of a person the record does not name.
    await put(partyDataKey(APP_ID, 'uid-nobody', 'cart'), { items: [] });
}, 60_000);

describe('the boot move of app parties', () => {
    it('moves the parties and their collections, and leaves what it cannot name, on evidence only', async () => {
        const out = await moveAppPartiesToTablesOnce(storage, config);
        expect(out).toMatchObject({ ran: true, parties: 2, data: 2, left: 2 });

        expect((await storage.getAppParty(APP_ID, 'uid-1'))?.record).toMatchObject({ contact: 'p1@example.test' });
        expect(await storage.getAppParty(APP_ID, 'uid-2')).not.toBeNull();
        expect(await storage.getAppParty(APP_ID, 'uid-3')).toBeNull();

        const rec = await storage.getMemory(GHII, appPartiesKey(APP_ID));
        const v = rec?.value as { registration: { state: string }; parties?: AppPartyRecord[] };
        expect(v.registration.state).toBe('open');
        // The party that did not move stays in the record, as it was.
        expect(v.parties?.map(p => p.uid)).toEqual(['uid-3']);

        expect((await storage.getAppPartyData(APP_ID, 'uid-1', 'cart'))?.value).toEqual({ items: [1, 2] });
        expect((await storage.getAppPartyData(APP_ID, APP_PARTY_SHARED, 'prices'))?.value).toEqual({ eur: 5 });
        expect(await storage.getMemory(GHII, partyDataKey(APP_ID, 'uid-1', 'cart'))).toBeNull();
        expect(await storage.getMemory(GHII, sharedDataKey(APP_ID, 'prices'))).toBeNull();
        expect(await storage.getMemory(GHII, partyDataKey(APP_ID, 'uid-nobody', 'cart'))).not.toBeNull();

        const incidents = (await listSecurityIncidents(storage, config)).items.filter(i => i.type === APP_PARTY_MOVE_INCIDENT_TYPE);
        expect(incidents).toHaveLength(1);
        expect(incidents[0]!.detail).toContain('ap-000000000003');
        expect(incidents[0]!.detail).toContain('uid-nobody');
    });

    it('runs once: a second start moves nothing and opens no second incident', async () => {
        expect((await moveAppPartiesToTablesOnce(storage, config)).ran).toBe(false);
        const incidents = (await listSecurityIncidents(storage, config)).items.filter(i => i.type === APP_PARTY_MOVE_INCIDENT_TYPE);
        expect(incidents).toHaveLength(1);
    });
});
