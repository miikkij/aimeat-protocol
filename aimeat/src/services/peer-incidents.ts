/**
 * @file services/peer-incidents.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Two federation events the operator learns about on the Security page, because nobody
 *   else will.
 *
 *   PROOF FAILED. A package grant, a seller or a repository link named a node, and the node's own card
 *   (/.well-known/aimeat) answered with another node id or another key. The request was refused and
 *   nothing was written. It is either a mistake (a copied key from the wrong node) or somebody trying a
 *   node id that is not theirs; both are the operator's to know.
 *
 *   ID HELD. A node presented itself under an id this node already holds as a peer under another key:
 *   an introduction answered 409, a key exchange answered KEY_ROTATION_DENIED, an open join was
 *   refused, a package grant met the held key. Before 2026-10-01 the real node simply got the refusal
 *   and nobody here saw it, so an id taken by someone else stayed taken. The incident names both keys
 *   and addresses and the call that frees the id.
 *
 *   BOUNDED. Most of these arrive on routes nobody signs in to, and a caller can make a new key for
 *   every request. One incident per node id, kind and presented key; at most PER_NODE per node id and
 *   TOTAL in all while their markers stand. Beyond that the event is logged only. The markers live in
 *   the federation-peer-origin system namespace (`incident.<nodeId>.<kind>.<key hash>`), and freeing the
 *   node id (peer-origin.ts forgetPeer) removes them.
 * @structure PeerIncidentKind · PeerIncident · reportPeerIncident()
 * @usage
 *   void reportPeerIncident(storage, config.nodeId, { kind: 'id-held', nodeId, presented: { key, url },
 *       held: { key: peer.publicKey, url: peer.url }, via: 'introduce', actor: node_id });
 * @version-history
 *   v1.0.0 — 2026-10-01 — Initial (follow-up to the peer-registration incident, items 5 and 6).
 */
import { createHash } from 'node:crypto';
import type { Storage } from '../storage/interface.js';
import { recordSecurityIncident } from './security-incident.js';
import { NS_PEER_ORIGIN } from './peer-origin.js';
import { logger } from '../utils/logger.js';

export type PeerIncidentKind = 'proof-failed' | 'id-held';

export interface PeerIncident {
    kind: PeerIncidentKind;
    nodeId: string;
    /** What the request said: the key and address it named for the node id. */
    presented: { key: string; url?: string };
    /** proof-failed: what the card at that address answered. id-held: the peer this node already has. */
    other: { nodeId?: string; key?: string; url?: string };
    /** The code path: 'package-grant', 'package-seller', 'introduce', 'key-exchange', 'open-join', ... */
    via: string;
    /** Who asked: a local account, a seller node, or the node id an unauthenticated request named. */
    actor: string;
}

const PER_NODE = 5;
const TOTAL = 200;

const markerPrefix = (nodeId: string): string => `incident.${nodeId}.`;

/** Record the event on the Security page, within the bounds above. Never throws. */
export async function reportPeerIncident(storage: Storage, thisNodeId: string, e: PeerIncident): Promise<void> {
    try {
        const keyHash = createHash('sha256').update(e.presented.key).digest('hex').slice(0, 16);
        const marker = `${markerPrefix(e.nodeId)}${e.kind}.${keyHash}`;
        if (await storage.getMemory(NS_PEER_ORIGIN, marker)) return;
        const all = await storage.listMemory(NS_PEER_ORIGIN, { prefix: 'incident.' });
        // By the recorded node id, not the key prefix: a node id may contain dots, so one id's prefix can begin another's.
        const forNode = all.filter(r => (r.value as { nodeId?: string } | undefined)?.nodeId === e.nodeId).length;
        if (forNode >= PER_NODE || all.length >= TOTAL) {
            logger.warn('Federation peer event not recorded: the Security page already holds as many as it takes', { ...e });
            return;
        }
        const release = `DELETE /v1/federation/peers/${e.nodeId}?emergency=true (aimeat_admin_federation_peer_remove)`;
        const detail = e.kind === 'proof-failed'
            ? `A ${e.via} named ${e.nodeId} at ${e.presented.url ?? '?'} with key ${e.presented.key}, and the card there answered `
              + `${e.other.nodeId === e.nodeId ? `with key ${e.other.key}` : `as node ${e.other.nodeId}`}. Nothing was written. `
              + `Asked by ${e.actor}. A copied key from another node, or a node id that is not the asker's.`
            : `A node presented itself as ${e.nodeId} (key ${e.presented.key}${e.presented.url ? `, address ${e.presented.url}` : ''}) `
              + `through ${e.via}, and this node already holds ${e.nodeId} under key ${e.other.key}${e.other.url ? ` at ${e.other.url}` : ''}. `
              + `The request was refused. If the held peer is not the real node, free the id: ${release}.`;
        const out = await recordSecurityIncident(storage, { nodeId: thisNodeId }, {
            type: 'federation_peer', code: e.kind === 'proof-failed' ? 'PEER_PROOF_FAILED' : 'PEER_ID_HELD',
            actorGhii: e.actor, detail, source: e.via,
        });
        if (!out.recorded) return;
        const now = new Date().toISOString();
        await storage.setMemory({
            key: marker, ownerGaii: NS_PEER_ORIGIN, value: { nodeId: e.nodeId, kind: e.kind, incident: out.id, at: now },
            visibility: 'private', tags: ['peer-incident'], ttlHours: null, version: 1, createdAt: now, updatedAt: now,
        });
    } catch (err) {
        logger.warn('reportPeerIncident: the Security page entry is best-effort', { error: String(err), nodeId: e.nodeId, kind: e.kind });
    }
}
