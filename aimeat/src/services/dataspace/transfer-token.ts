/**
 * @file src/services/dataspace/transfer-token.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The token a DSP transfer's data address carries (plan doc-mvwxcas3dom3, D8.4): the
 *   outside party token of services/parties/token.ts (`aimeat_party_…`, a purpose token, never a
 *   session), minted for a key of the participant's party that exists for this one transfer and names
 *   the agreement's share. The OData and CSV reads that take a party token read it already
 *   (PARTY_TOKEN_ROUTES); the read gate holds it to that one share (services/parties/read-gate.ts).
 *
 *   REVOCATION IS THE KEY. A party token names its key id and every read checks that the key is still
 *   on the party (services/parties/verify.ts), so: a suspension removes the key (every read refused)
 *   and a resumption puts the same key id back (the token works again until it expires); a completion
 *   or a termination removes it for good; ending the agreement removes every key of its share. The key
 *   holds a random hash nobody knows: only the token opens it, and it opens nothing else (verifyParty
 *   refuses a transfer key outside the data reads).
 *
 *   LIFE. The token lasts TRANSFER_TOKEN_HOURS, or until the share ends if that is sooner, and at
 *   least a minute. A party holds at most MAX_TRANSFER_KEYS transfer keys; expired ones are dropped
 *   whenever one is added.
 * @structure TRANSFER_TOKEN_HOURS · MAX_TRANSFER_KEYS · mintTransferKey · dropTransferKey · restoreTransferKey
 * @usage const t = await mintTransferKey(storage, ownerGhii, partyName, { shareId, transfer, shareExpires });
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (plan doc-mvwxcas3dom3, D8.4).
 */
import type { Storage } from '../../storage/interface.js';
import { localAccountName } from '../../utils/gaii.js';
import { UNCHANGED } from '../record-cas.js';
import { changeParty } from '../parties/store.js';
import { newPartyKey, newPartyKeyId } from '../parties/keys.js';
import { mintPartyToken } from '../parties/token.js';
import type { PartyKey } from '../parties/contract.js';

export const TRANSFER_TOKEN_HOURS = 24;
export const MAX_TRANSFER_KEYS = 50;

const live = (k: PartyKey, nowMs: number): boolean => !k.expiresAt || Date.parse(k.expiresAt) > nowMs;

/** Put `key` on the party, dropping expired transfer keys; false when the party is gone or full. */
async function putKey(storage: Storage, ownerGhii: string, partyName: string, key: PartyKey): Promise<{ uid: string } | null> {
    let uid: string | null = null;
    let full = false;
    const after = await changeParty(storage, ownerGhii, partyName, p => {
        const now = Date.now();
        const keys = p.keys.filter(k => k.id !== key.id && (!k.transfer || live(k, now)));
        if (keys.filter(k => k.transfer).length >= MAX_TRANSFER_KEYS) { full = true; return UNCHANGED; }
        full = false;
        uid = p.uid;
        return { ...p, keys: [...keys, key] };
    });
    return after && !full && uid ? { uid } : null;
}

/** A new transfer key and its token. Null when the party is gone, stopped or holds too many transfers. */
export async function mintTransferKey(
    storage: Storage, ownerGhii: string, partyName: string, opts: { shareId: string; transfer: string; shareExpires?: string | null },
): Promise<{ keyId: string; token: string; expiresAt: string } | null> {
    const now = Date.now();
    const shareEnd = opts.shareExpires ? Date.parse(opts.shareExpires) : Infinity;
    const ttlMs = Math.max(60_000, Math.min(TRANSFER_TOKEN_HOURS * 3_600_000, shareEnd - now));
    const expiresAt = new Date(now + ttlMs).toISOString();
    const keyId = newPartyKeyId();
    const put = await putKey(storage, ownerGhii, partyName, {
        id: keyId, hash: newPartyKey().hash, createdAt: new Date(now).toISOString(), lastUsedAt: null, expiresAt,
        share: opts.shareId, transfer: opts.transfer,
    });
    if (!put) return null;
    const token = await mintPartyToken({ owner: localAccountName(ownerGhii), uid: put.uid, kid: keyId }, Math.floor(ttlMs / 1000));
    return { keyId, token, expiresAt };
}

/** Remove a transfer key: every read with its token is refused from the next request. */
export async function dropTransferKey(storage: Storage, ownerGhii: string, partyName: string, keyId: string): Promise<void> {
    await changeParty(storage, ownerGhii, partyName, p => (p.keys.some(k => k.id === keyId) ? { ...p, keys: p.keys.filter(k => k.id !== keyId) } : UNCHANGED));
}

/** Put a suspended transfer's key back under its id, so the token handed out at the start reads again. */
export async function restoreTransferKey(
    storage: Storage, ownerGhii: string, partyName: string, key: { keyId: string; shareId: string; transfer: string; expiresAt: string },
): Promise<boolean> {
    if (Date.parse(key.expiresAt) <= Date.now()) return false;
    return !!(await putKey(storage, ownerGhii, partyName, {
        id: key.keyId, hash: newPartyKey().hash, createdAt: new Date().toISOString(), lastUsedAt: null, expiresAt: key.expiresAt,
        share: key.shareId, transfer: key.transfer,
    }));
}
