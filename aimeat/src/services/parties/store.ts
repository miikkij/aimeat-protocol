/**
 * @file src/services/parties/store.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The owner's `parties` record (plan doc-mvwxcas3dom3, D2; lead decision L3): read it,
 *   and change one party on the record's version (services/record-cas.ts), so two requests that change
 *   two parties of one owner at once both land. The callers decide who may change what (./service.ts,
 *   ./admin.ts); this file only reads and writes.
 * @structure readParties · findParty · findPartyByUid · insertParty · changeParty · removeParty
 * @usage const { parties } = await readParties(storage, ownerGhii);
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D2).
 */
import type { Storage } from '../../storage/interface.js';
import { updateRecord, UNCHANGED } from '../record-cas.js';
import { PARTIES_KEY, MAX_PARTIES, parsePartiesValue, type PartiesValue, type PartyRecord } from './contract.js';

const TAG = 'parties';

/** The owner's parties. A missing record is none. */
export async function readParties(storage: Storage, ownerGhii: string): Promise<PartiesValue> {
    const rec = await storage.getMemory(ownerGhii, PARTIES_KEY);
    return parsePartiesValue(rec?.value);
}

/** One party of the owner by name, or undefined. */
export async function findParty(storage: Storage, ownerGhii: string, name: string): Promise<PartyRecord | undefined> {
    return (await readParties(storage, ownerGhii)).parties.find(p => p.name === name);
}

/** One party of the owner by uid, or undefined: what a token and a share name. */
export async function findPartyByUid(storage: Storage, ownerGhii: string, uid: string): Promise<PartyRecord | undefined> {
    return (await readParties(storage, ownerGhii)).parties.find(p => p.uid === uid);
}

/** Add a party. 'exists' when the name is taken, 'full' past MAX_PARTIES; both write nothing. */
export async function insertParty(storage: Storage, ownerGhii: string, party: PartyRecord): Promise<'ok' | 'exists' | 'full'> {
    let outcome: 'ok' | 'exists' | 'full' = 'ok';
    await updateRecord(storage, ownerGhii, PARTIES_KEY, parsePartiesValue, cur => {
        if (cur.parties.some(p => p.name === party.name)) { outcome = 'exists'; return UNCHANGED; }
        if (cur.parties.length >= MAX_PARTIES) { outcome = 'full'; return UNCHANGED; }
        outcome = 'ok';
        return { parties: [...cur.parties, party] };
    }, { tag: TAG });
    return outcome;
}

/**
 * Change the party `name` with `change`, which answers the new record or UNCHANGED. Answers the party
 * as written, or undefined when there is no such party.
 */
export async function changeParty(
    storage: Storage, ownerGhii: string, name: string,
    change: (p: PartyRecord) => PartyRecord | typeof UNCHANGED,
): Promise<PartyRecord | undefined> {
    let after: PartyRecord | undefined;
    await updateRecord(storage, ownerGhii, PARTIES_KEY, parsePartiesValue, cur => {
        const i = cur.parties.findIndex(p => p.name === name);
        if (i < 0) { after = undefined; return UNCHANGED; }
        const next = change(cur.parties[i]!);
        if (next === UNCHANGED) { after = cur.parties[i]; return UNCHANGED; }
        after = next;
        const parties = [...cur.parties];
        parties[i] = next;
        return { parties };
    }, { tag: TAG });
    return after;
}

/** Remove the party `name`. Answers the removed party, or undefined when there was none. */
export async function removeParty(storage: Storage, ownerGhii: string, name: string): Promise<PartyRecord | undefined> {
    let removed: PartyRecord | undefined;
    await updateRecord(storage, ownerGhii, PARTIES_KEY, parsePartiesValue, cur => {
        removed = cur.parties.find(p => p.name === name);
        if (!removed) return UNCHANGED;
        return { parties: cur.parties.filter(p => p.name !== name) };
    }, { tag: TAG });
    return removed;
}
