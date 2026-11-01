/**
 * @file src/services/dataspace/participant.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A data space participant as an outside party of a package owner (plan doc-mvwxcas3dom3,
 *   D8.5): kind `dataspace`, credential type `did`, its participant id in `did`. One party per owner per
 *   participant, named `ds-<12 hex of the id's SHA-256>` so the same participant always lands on the
 *   same party, and made when an agreement first materialises (./agreement.ts), never before: a request
 *   the owner declines leaves no party behind. Such a party holds no key the owner hands out; its keys
 *   are minted per transfer (./transfer-token.ts).
 *
 *   ACROSS OWNERS. The catalog asks which owners have this participant as a party (participantParties):
 *   one scan of the `parties` records of the node, one read each.
 * @structure dataspacePartyName · findParticipantParty · ensureParticipantParty · participantParties
 * @usage const p = await ensureParticipantParty(storage, ownerGhii, did, 'dsp:agreement');
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D8.5).
 */
import { createHash } from 'node:crypto';
import type { Storage } from '../../storage/interface.js';
import { PARTIES_KEY, parsePartiesValue, type PartyRecord } from '../parties/contract.js';
import { newPartyUid } from '../parties/keys.js';
import { readParties, insertParty } from '../parties/store.js';

/** The party name a participant has under every owner. */
export function dataspacePartyName(participantId: string): string {
    return `ds-${createHash('sha256').update(participantId, 'utf8').digest('hex').slice(0, 12)}`;
}

/** The owner's party for this participant, or undefined. */
export async function findParticipantParty(storage: Storage, ownerGhii: string, participantId: string): Promise<PartyRecord | undefined> {
    return (await readParties(storage, ownerGhii)).parties.find(p => p.kind === 'dataspace' && p.did === participantId);
}

/** The owner's party for this participant, made now when there is none. 'full' past the owner's party limit. */
export async function ensureParticipantParty(storage: Storage, ownerGhii: string, participantId: string, createdBy: string): Promise<PartyRecord | 'full' | 'taken'> {
    const found = await findParticipantParty(storage, ownerGhii, participantId);
    if (found) return found;
    const at = new Date().toISOString();
    const party: PartyRecord = {
        uid: newPartyUid(), name: dataspacePartyName(participantId), displayName: participantId.slice(0, 120), kind: 'dataspace',
        did: participantId, credential: 'did', status: 'active', createdAt: at, createdBy, keys: [], failedAttempts: 0, lastSeenAt: null,
    };
    const outcome = await insertParty(storage, ownerGhii, party);
    if (outcome === 'full') return 'full';
    if (outcome === 'exists') {
        // Made by a request beside this one: read it again. A different party under the name is not this participant's.
        const again = await findParticipantParty(storage, ownerGhii, participantId);
        return again ?? 'taken';
    }
    return party;
}

/** Every owner of this node that has the participant as a party, with the party. */
export async function participantParties(storage: Storage, participantId: string): Promise<Array<{ ownerGhii: string; party: PartyRecord }>> {
    const out: Array<{ ownerGhii: string; party: PartyRecord }> = [];
    const owners = new Set<string>();
    for (let offset = 0; ; offset += 500) {
        const page = await storage.listAllMemoryMeta({ prefix: PARTIES_KEY, limit: 500, offset, excludeVersionRows: true });
        for (const row of page.items) if (row.key === PARTIES_KEY) owners.add(row.ownerGaii);
        if (page.items.length < 500) break;
    }
    for (const ownerGhii of owners) {
        const rec = await storage.getMemory(ownerGhii, PARTIES_KEY);
        const party = parsePartiesValue(rec?.value).parties.find(p => p.kind === 'dataspace' && p.did === participantId);
        if (party && party.status === 'active') out.push({ ownerGhii, party });
    }
    return out;
}
