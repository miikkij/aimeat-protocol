/**
 * @file src/auth/credential-strategies-node.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The credential strategies of another NODE: a federation peer's signed message, and a
 *   package seller's or claimant's signed request on the package repository. The registry and the
 *   middleware are in ./credential-strategies.ts; this file holds the three strategies it names
 *   (codebase analysis 2026-11-03, decision 2 of 2026-11-05).
 *
 *   A FEDERATION PEER. Every inbound federation door that takes it read the body, refused what the
 *   door needs and lacks (400), found the peer with gatePeer() (services/federation-peer-gate.ts:
 *   active, entitled to the door's capability, key on file), refused a missing signature, and verified
 *   the signature over the exact text the door signs. Those steps are this strategy, in that order and
 *   with the door's own sentences, which the route passes as options next to the text it signs, so
 *   the signed fields stay readable at the door. The verification is UNCONDITIONAL: no option skips
 *   it, and a door whose signature check depended on a field or a branch (the heartbeat and the ping
 *   of an unknown node, the presence of a peer with no key, the key exchange) is not a door of this
 *   strategy. What a door checks after the signature (the audience and delivery proofs, the send time
 *   window, single use) stays in its handler, where it reads the signed text from the principal.
 *
 *   A PACKAGE SELLER. The repository's seller doors ran sellerAct() first: the repository role
 *   (404), the selling node's signed request (verifySaleRequest), and whether the package's author
 *   names that node a seller (403, one answer for "no such package" and "not your seller").
 *
 *   A PACKAGE CLAIMANT. A node that redeems a claim code signs with the key its own body names
 *   (verifyRequestWithKey), and its body's node_id must be the signer.
 * @structure Refusal · FederationPeer · FederationPeerOptions · federationPeer · PackageSeller ·
 *   packageSeller · PackageClaimant · packageClaimant
 * @version-history
 *   v1.0.0 — 2026-11-05 — Initial: the checks moved out of the handlers unchanged (codebase analysis
 *     2026-11-03, decision 2 of 2026-11-05).
 */
import type { Request, Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { PeerInfo } from '../services/federation.js';
import { gatePeer, type PeerCapability } from '../services/federation-peer-gate.js';
import { verifySaleRequest, verifyRequestWithKey } from '../services/packages/sale/package-sale-auth.js';
import { isSellerFor } from '../services/packages/sale/package-sellers.js';
import { error } from '../middleware/envelope.js';
import { verify } from './keypair.js';

/** A refusal a door gives before or around the signature: its status, code, sentence and details. */
export interface Refusal { status: number; code: string; message: string; details?: unknown }

/** A verified federation peer: the peer, and the text and signature that verified. */
export interface FederationPeer { peer: PeerInfo; signed: string; signature: string }

export interface FederationPeerOptions {
    config: AimeatConfig;
    peers: Map<string, PeerInfo>;
    /** What the door refuses before it looks at the peer (a missing field, the feature off), or null. */
    before?: (req: Request) => Refusal | null;
    /** The node the request says it comes from. */
    node: (req: Request) => unknown;
    /** The capability the door requires of the peer (gatePeer), or null for an active peer with a key. */
    capability: PeerCapability | null;
    /** The peer statuses the door admits instead of 'active' (settlement admits 'depeering'). */
    acceptStatuses?: readonly string[];
    /** A refusal for this admitted peer before the signature is read (a link that carries no sign-in), or null. */
    admit?: (peer: PeerInfo, req: Request) => Refusal | null;
    /** The signature the request carries; the body's `signature` when left out. */
    signature?: (req: Request) => unknown;
    /**
     * The 401 sentence for a request with no signature. `absent` refuses a falsy signature, `not-text`
     * anything that is not a non-empty string. Left out when `before` already refuses one.
     */
    unsigned?: { message: string; when: 'absent' | 'not-text' };
    /** A refusal after the unsigned check and before the signature (a door that checks its time window first), or null. */
    fresh?: (peer: PeerInfo, req: Request) => Refusal | null;
    /** The exact text the peer signed. */
    signed: (req: Request) => string;
    /** The 401 UNAUTHORIZED sentence when the signature does not verify. */
    forged: string;
    /** Called when the signature does not verify, for a door that logs it. */
    onForged?: (req: Request) => void;
    /** A request with no signature passes on to the next route with this path (the operator's twin of the door). */
    unsignedPassesOn?: boolean;
}

/** A 400 INVALID_INPUT refusal, the answer of a door whose body lacks what it needs. */
export const badInput = (message: string): Refusal => ({ status: 400, code: 'INVALID_INPUT', message });

/** The body of a request, or an empty object. */
export const bodyOf = (req: Request): Record<string, unknown> => (req.body ?? {}) as Record<string, unknown>;

/**
 * The text a door signs when it is the JSON of body fields in a fixed order: `signedJson('source_node',
 * 'message', 'timestamp')` is `JSON.stringify({ source_node, message, timestamp })` of the body, a field
 * the body lacks left out as JSON.stringify leaves out undefined.
 */
export const signedJson = (...fields: string[]) => (req: Request): string => {
    const b = bodyOf(req);
    return JSON.stringify(Object.fromEntries(fields.map(f => [f, b[f]])));
};

/** What a strategy answers: the principal, null once it has sent the refusal, or 'next-route'. */
export type Verdict<T> = T | null | 'next-route';

const send = (res: Response, config: AimeatConfig, r: Refusal): null => {
    res.status(r.status).json(r.details !== undefined ? error(config.nodeId, r.code, r.message, r.status, r.details) : error(config.nodeId, r.code, r.message));
    return null;
};

/** A federation peer's signed message (was the first lines of each inbound federation handler). */
export const federationPeer = (o: FederationPeerOptions) => async (req: Request, res: Response): Promise<Verdict<FederationPeer>> => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const signature = o.signature ? o.signature(req) : body.signature;
    if (o.unsignedPassesOn && typeof signature !== 'string') return 'next-route';
    const early = o.before?.(req);
    if (early) return send(res, o.config, early);
    const gate = gatePeer(o.peers, o.node(req), o.capability, o.acceptStatuses ? { acceptStatuses: o.acceptStatuses } : undefined);
    if (!gate.ok) return send(res, o.config, gate);
    const refused = o.admit?.(gate.peer, req);
    if (refused) return send(res, o.config, refused);
    if (o.unsigned && (o.unsigned.when === 'absent' ? !signature : typeof signature !== 'string' || !signature)) {
        return send(res, o.config, { status: 401, code: 'UNAUTHORIZED', message: o.unsigned.message });
    }
    const late = o.fresh?.(gate.peer, req);
    if (late) return send(res, o.config, late);
    const signed = o.signed(req);
    if (!await verify(gate.peer.publicKey, signed, signature as string)) {
        o.onForged?.(req);
        return send(res, o.config, { status: 401, code: 'UNAUTHORIZED', message: o.forged });
    }
    return { peer: gate.peer, signed, signature: signature as string };
};

/** A seller node of a package on this repository. */
export interface PackageSeller { author: string; seller: string; groupId: string }

type PackageDeps = { config: AimeatConfig; storage: Storage; peers: Map<string, PeerInfo> };
const NOT_A_REPOSITORY: Refusal = { status: 404, code: 'NOT_A_REPOSITORY', message: 'This node does not serve packages as a repository.' };

/** The package's author, when the signed request comes from one of the author's seller nodes (was sellerAct() in routes/package-sales.ts). */
export const packageSeller = ({ config, storage, peers }: PackageDeps) => async (req: Request, res: Response): Promise<Verdict<PackageSeller>> => {
    if (!config.packageRepository) return send(res, config, NOT_A_REPOSITORY);
    const body = req.method === 'PUT' ? req.body : undefined;
    const who = await verifySaleRequest(req.headers, peers, config.nodeId, req.method, req.originalUrl, body);
    if (!who.ok) return send(res, config, who);
    const groupId = decodeURIComponent(req.params.groupId as string);
    const pkg = (await storage.listVersions(groupId, 1, 0)).versions[0];
    if (!pkg || !(await isSellerFor(storage, pkg.author, who.nodeId))) {
        // One answer for "no such package" and "not your seller", so a node that is nobody's seller
        // learns nothing about which private packages exist here.
        return send(res, config, {
            status: 403, code: 'NOT_A_SELLER',
            message: 'Your node does not sell this package here. The package\'s author names the nodes that sell it.',
            details: { node_id: who.nodeId, group_id: groupId, tool: 'aimeat_package_sellers' },
        });
    }
    return { author: pkg.author, seller: who.nodeId, groupId };
};

/** A node that holds the key its claim names. */
export interface PackageClaimant { nodeId: string; publicKey: string }

/** A node redeeming a claim code, signed with the key its body names (was the start of POST /v1/federation/package-claims/:groupId). */
export const packageClaimant = ({ config, purpose }: { config: AimeatConfig; purpose: string }) => async (req: Request, res: Response): Promise<Verdict<PackageClaimant>> => {
    if (!config.packageRepository) return send(res, config, NOT_A_REPOSITORY);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const publicKey = typeof body.public_key === 'string' ? body.public_key : '';
    const who = await verifyRequestWithKey(req.headers, publicKey, purpose, config.nodeId, req.method, req.originalUrl, req.body);
    if (!who.ok) return send(res, config, who);
    if (who.nodeId !== (typeof body.node_id === 'string' ? body.node_id : '')) {
        return send(res, config, { status: 400, code: 'INVALID_INPUT', message: 'node_id is the node that signs the request.' });
    }
    return { nodeId: who.nodeId, publicKey };
};
