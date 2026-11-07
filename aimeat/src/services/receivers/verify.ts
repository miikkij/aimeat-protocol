/**
 * @file src/services/receivers/verify.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The one verifier of a receiver key, behind acceptCredential('receiver')
 *   (auth/credential-strategies.ts). It reads `Authorization: Bearer aimeat_rcv_…` and the route's
 *   :owner and :name, and answers the receiver or a refusal.
 *
 *   NOTHING TELLS A RECEIVER APART FROM A WRONG KEY. A missing receiver, a receiver with no key yet
 *   (a proposal), a wrong key and an old key past its overlap all answer the same 401 with the same
 *   sentence, and the key is compared against a hash in constant time even when there is no receiver,
 *   so neither the answer nor its timing says which receivers exist. Only after the key matched does
 *   the answer name the receiver's state (paused, stopped, expired, waiting).
 *
 *   A KEY IN THE ADDRESS IS REFUSED. Addresses are written to logs and proxies; the key travels only in
 *   the Authorization header.
 *
 *   WRONG KEYS are counted on the receiver for its owner (./deliveries.ts) and, when one receiver meets
 *   WRONG_KEY_INCIDENT_AT wrong keys in an hour in this process, the operator gets one security incident.
 * @structure ReceiverContext · verifyReceiverRequest · WRONG_KEY_INCIDENT_AT
 * @usage const v = await verifyReceiverRequest(deps, req); if (!v.ok) res.status(v.status).json(...)
 * @version-history
 *   v1.0.0 — 2026-11-07 — Initial (wish-vastaanottimet-receivers-ulkopuolinen-ohjelma-kirjoittaa-yht).
 */
import type { Storage } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import { partyKeyMatches, hashPartyKey } from '../parties/keys.js';
import { recordSecurityIncident } from '../security-incident.js';
import { logger } from '../../utils/logger.js';
import { RECEIVER_KEY_PREFIX, RECEIVER_NAME_RE, receiverPrincipalOf, effectiveState, type ReceiverRecord } from './contract.js';
import { getReceiver } from './store.js';
import { noteWrongKey, logDelivery } from './deliveries.js';
import { receiversModeOf } from './policy.js';

/** A receiver whose key matched, as the write path reads it. */
export interface ReceiverContext {
    ownerGhii: string;
    owner: string;
    name: string;
    /** `receiver:<owner>/<name>@<node>`: who wrote what this request writes. */
    principal: string;
    receiver: ReceiverRecord;
}

/** Wrong keys for one receiver in an hour, in this process, that make one security incident. */
export const WRONG_KEY_INCIDENT_AT = 5;

const OWNER_RE = /^[a-z0-9][a-z0-9_.-]{0,63}$/;
/** Compared when there is no receiver, so a missing one costs the same as a wrong key. */
const NO_RECEIVER_HASH = hashPartyKey(`${RECEIVER_KEY_PREFIX}no-such-receiver`);

const UNAUTHORIZED = 'This address takes the receiver\'s own key as "Authorization: Bearer aimeat_rcv_…". The key was missing, or it is not this receiver\'s key.';

// process-local: each process counts its own wrong keys for the incident; the owner's count is in storage.
const wrongKeys = new Map<string, { start: number; count: number; reported: boolean }>();

function countWrongKey(deps: { storage: Storage; config: AimeatConfig }, ctx: { ownerGhii: string; owner: string; name: string; uid: string }): void {
    noteWrongKey(deps.storage, ctx.ownerGhii, ctx.name);
    const now = Date.now();
    let w = wrongKeys.get(ctx.uid);
    if (!w || now - w.start > 3_600_000) { w = { start: now, count: 0, reported: false }; wrongKeys.set(ctx.uid, w); }
    w.count++;
    if (w.count >= WRONG_KEY_INCIDENT_AT && !w.reported) {
        w.reported = true;
        const principal = receiverPrincipalOf(ctx.owner, ctx.name, deps.config.nodeId);
        void recordSecurityIncident(deps.storage, deps.config, {
            type: 'receiver_key', code: 'RECEIVER_WRONG_KEYS', actorGhii: principal, actorName: `${ctx.owner}/${ctx.name}`,
            detail: `The receiver ${ctx.owner}/${ctx.name} was sent a wrong key ${w.count} times within an hour. Someone may be guessing, or a program still holds a key that was changed. The owner sees the count on the receiver's page; the operator can stop the receiver.`,
            source: 'receiver',
        }).catch(err => logger.warn('receiver: the wrong-key incident could not be recorded', { error: String(err) }));
    }
}

type Refusal = { ok: false; status: number; code: string; message: string };

/** What the verifier reads of a request: the route hands these over, so no Express type reaches a service. */
export interface ReceiverRequestFacts {
    /** The Authorization header as it arrived. */
    authorization: string | undefined;
    /** The route's :owner and :name. */
    owner: string;
    name: string;
    /** True when the query string carries a key or a token. */
    keyInAddress: boolean;
    /** The HTTP method, for the delivery log of a refusal made here. */
    method?: string;
}

/** Verify the request's receiver key against the route's :owner and :name. */
export async function verifyReceiverRequest(
    deps: { storage: Storage; config: AimeatConfig }, rq: ReceiverRequestFacts,
): Promise<{ ok: true; ctx: ReceiverContext } | Refusal> {
    const refuse = (status: number, code: string, message: string): Refusal => ({ ok: false, status, code, message });
    if (rq.keyInAddress) {
        return refuse(400, 'KEY_IN_ADDRESS', 'A receiver key never travels in the address, where logs keep it. Send it as "Authorization: Bearer aimeat_rcv_…", and change this key now: it has been written down somewhere.');
    }
    const header = rq.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    const owner = rq.owner;
    const name = rq.name;
    const wellFormed = token.startsWith(RECEIVER_KEY_PREFIX) && token.length <= 200 && OWNER_RE.test(owner) && RECEIVER_NAME_RE.test(name);
    const ownerGhii = `${owner}@${deps.config.nodeId}`;
    const receiver = wellFormed ? await getReceiver(deps.storage, ownerGhii, name) : null;

    // One comparison against the current key, one against the overlap key, whatever exists, so the
    // time taken does not say whether there is a receiver or a previous key.
    const now = Date.now();
    const current = partyKeyMatches(token, receiver?.keyHash ?? NO_RECEIVER_HASH);
    const prev = receiver?.previousKey;
    const previous = partyKeyMatches(token, prev?.hash ?? NO_RECEIVER_HASH) && !!prev && Date.parse(prev.until) > now;
    if (!receiver || !receiver.keyHash || !(current || previous)) {
        if (receiver && token.startsWith(RECEIVER_KEY_PREFIX)) countWrongKey(deps, { ownerGhii, owner, name, uid: receiver.uid });
        return refuse(401, 'UNAUTHORIZED', UNAUTHORIZED);
    }

    // From here the key matched, so the refusal is the receiver's own and goes to its log: the owner
    // asking "why did the program stop" finds the pause, the stop or the end date there.
    const logged = (status: number, code: string, message: string): Refusal => {
        logDelivery(deps.storage, ownerGhii, name, { at: new Date(now).toISOString(), verb: rq.method ?? 'call', status, code, reason: message, bytes: 0 });
        return refuse(status, code, message);
    };
    if (receiversModeOf(deps.config) === 'off') return logged(503, 'RECEIVERS_OFF', 'The operator of this node has switched receivers off. Nothing was written.');
    const state = effectiveState(receiver, now);
    switch (state) {
        case 'active': break;
        case 'paused': return logged(403, 'PAUSED', 'The owner has paused this receiver. Nothing was written.');
        case 'stopped': return logged(403, 'STOPPED', 'The operator of this node has stopped this receiver. Nothing was written.');
        case 'expired': return logged(403, 'EXPIRED', 'This receiver has passed its end date. The owner extends it on the receiver\'s page. Nothing was written.');
        case 'awaiting_operator': return logged(403, 'NOT_APPROVED', 'This receiver waits for the operator of this node to approve it. Nothing was written.');
        default: return refuse(401, 'UNAUTHORIZED', UNAUTHORIZED);
    }
    return { ok: true, ctx: { ownerGhii, owner, name, principal: receiverPrincipalOf(owner, name, deps.config.nodeId), receiver } };
}
