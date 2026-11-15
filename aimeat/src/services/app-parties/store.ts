/**
 * @file src/services/app-parties/store.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Where an app's parties are kept, and the node's setting as it stands for that app
 *   (D4.3): off, apps-ask or on, forced off on a node that shows its content to signed-in accounts only.
 *
 *   THE REGISTRATION is the one service-owned memory record per app (./contract.ts appPartiesKey), read
 *   and written on its version (services/record-cas.ts).
 *   THE PARTIES are rows (storage/types/app-parties.ts). changeAppParty replaces one row on the version
 *   it read and reads again when another writer was first. Every change sends the live event
 *   `app-parties` to the owner's streams, as the record did.
 * @structure readAppParties · changeAppParties · readParty · findParty · changeAppParty · partyLimit ·
 *   registrationMode · signupOpen · appIdOf
 * @usage const { registration } = await readAppParties(storage, ownerGhii, appId);
 * @version-history
 *   v1.2.0 — 2026-11-15 — The parties are rows: readParty, findParty, changeAppParty and partyLimit;
 *     the record keeps the registration only.
 *   v1.1.0 — 2026-11-01 — A change sends the live event `app-parties` to the owner's streams (WP9d).
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D4.2, D4.3).
 */
import type { Storage } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import { updateRecord, UNCHANGED } from '../record-cas.js';
import { emitChange } from '../event-bus.js';
import { signedInOnly } from '../../config/visibility.js';
import type { PartySelfRegistration } from '../../config/data-access.js';
import {
    appPartiesKey, appPartyMaxOf, fromPartyRow, liveRuleOf, parseAppPartiesValue, toPartyRow,
    type AppPartiesValue, type AppPartyRecord, type AppPartyRegistration,
} from './contract.js';

/** `owner/filename`, the app id the roster and the record key use. */
export const appIdOf = (owner: string, filename: string): string => `${owner}/${filename}`;

/** The app's registration setting. */
export async function readAppParties(storage: Storage, ownerGhii: string, appId: string): Promise<AppPartiesValue> {
    return parseAppPartiesValue((await storage.getMemory(ownerGhii, appPartiesKey(appId)))?.value);
}

/** Change the app's registration record on its version. `mutate` answers UNCHANGED to write nothing. */
export async function changeAppParties(
    storage: Storage, ownerGhii: string, appId: string,
    mutate: (cur: AppPartiesValue) => AppPartiesValue | typeof UNCHANGED,
): Promise<AppPartiesValue> {
    let changed = false;
    const after = await updateRecord(storage, ownerGhii, appPartiesKey(appId), parseAppPartiesValue, cur => {
        const next = mutate(cur);
        if (next === UNCHANGED) return UNCHANGED;
        changed = true;
        return { ...next, appId };
    }, { tag: 'app-parties' });
    // The owner's open pages (the app's page in the App Catalog) read the list again; only the
    // owner's streams get the event (services/event-bus.ts ownerGaii).
    if (changed) emitChange('app-parties', ownerGhii);
    return after;
}

/** One party of the app by uid, or null. */
export async function readParty(storage: Storage, appId: string, uid: string): Promise<AppPartyRecord | null> {
    const row = await storage.getAppParty(appId, uid);
    return row ? fromPartyRow(row) : null;
}

/** One party of the app by its address hash, its name or its open link's hash, or null. */
export async function findParty(storage: Storage, appId: string, by: { emailHash?: string; name?: string; linkHash?: string }): Promise<AppPartyRecord | null> {
    const row = await storage.findAppParty(appId, by);
    return row ? fromPartyRow(row) : null;
}

/** How many times changeAppParty reads again when another writer changed the row first. */
const CAS_TRIES = 5;

/**
 * Change one party on the version read. `mutate` answers UNCHANGED to write nothing. Answers the party
 * as it stands after the change (or as read, when nothing changed), or null when there is no such party.
 */
export async function changeAppParty(
    storage: Storage, ownerGhii: string, appId: string, uid: string,
    mutate: (cur: AppPartyRecord) => AppPartyRecord | typeof UNCHANGED,
): Promise<AppPartyRecord | null> {
    for (let i = 0; i < CAS_TRIES; i++) {
        const row = await storage.getAppParty(appId, uid);
        if (!row) return null;
        const cur = fromPartyRow(row);
        const next = mutate(cur);
        if (next === UNCHANGED) return cur;
        if (await storage.updateAppParty(toPartyRow(next, ownerGhii, row.version), row.version)) {
            emitChange('app-parties', ownerGhii);
            return next;
        }
    }
    throw new Error(`app-parties: the party ${uid} of ${appId} kept changing under ${CAS_TRIES} writes; nothing was written`);
}

/** The app's place count against the node's cap: how many hold a place, the cap, and what is left. */
export async function partyLimit(
    storage: Storage, config: Pick<AimeatConfig, 'appPartyMax' | 'appPartyPendingHours'>, appId: string,
): Promise<{ max: number; used: number; left: number }> {
    const max = appPartyMaxOf(config);
    const used = await storage.countAppParties(appId, liveRuleOf(config.appPartyPendingHours ?? 24, Date.now()));
    return { max, used, left: Math.max(0, max - used) };
}

/** The node's setting for app parties now: a closed node is always off. */
export function registrationMode(config: Pick<AimeatConfig, 'partySelfRegistration' | 'contentAccess'>): PartySelfRegistration {
    return signedInOnly(config) ? 'off' : (config.partySelfRegistration ?? 'off');
}

/**
 * May people sign up to this app now? The node allows it and the app's signup is open; under apps-ask
 * only a signup the operator approved (`decidedBy`), so one opened while the node was `on` waits.
 */
export function signupOpen(config: Pick<AimeatConfig, 'partySelfRegistration' | 'contentAccess'>, reg: AppPartyRegistration): boolean {
    const mode = registrationMode(config);
    if (mode === 'off' || reg.state !== 'open') return false;
    return mode === 'on' || !!reg.decidedBy;
}
