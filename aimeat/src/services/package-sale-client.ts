/**
 * @file services/package-sale-client.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The selling node's side of a sale (install packages, phase 5): this node signs the
 *   request with its own key (package-sale-auth.ts) and sends it to the package repository, which
 *   checks that this node is a seller of the package's author (package-sellers.ts).
 *
 *   The shop's automation calls its own node (POST/GET/DELETE /v1/package-sales/..., or the MCP tool
 *   aimeat_package_sale) with the credentials it already has there. Nothing about the repository's
 *   accounts reaches the shop. Jouni ruled on 2026-09-29 that the system does this itself.
 *
 *   THE REPOSITORY IS A PEER. Named by its node id when it already is one; otherwise the call carries
 *   { node_id, url, public_key } and this node links it as a packages-only peer under that key, the
 *   same registration a repository makes for its customer nodes (package-peer-register.ts): only
 *   when the repository's own card answers with that id and key, and with how it arrived recorded.
 * @structure SaleRepositoryRef · saleRequest() · saleConfigNeeds() · saleGrant() · saleRevoke() ·
 *   saleOffer() · saleClaim() · redeemClaimAt()
 * @version-history
 *   v1.2.0 — 2026-10-02 — saleOffer (the author's terms), saleClaim (a code for a node not known yet),
 *     redeemClaimAt (a node claims with its own key); a grant may carry `terms_id` (package sale
 *     design, phase 3).
 *   v1.1.0 — 2026-10-01 — A repository linked from the request is registered only after its card answers
 *     with the same id and key (linkPackagePeer), and its origin is recorded (the peer-registration
 *     incident, finding F). A repository that does not answer is REPOSITORY_UNREACHABLE, as the sale
 *     itself would be.
 *   v1.0.0 — 2026-09-29 — Initial (install packages, phase 5: seller nodes).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { PeerInfo } from './federation.js';
import { signedSaleHeaders, CLAIM_PURPOSE } from './package-sale-auth.js';
import { linkPackagePeer } from './package-peer-register.js';
import { safeFetch, stripTrailingSlashes } from '../utils/url-validator.js';
import { readBodyCapped } from '../utils/read-capped.js';
import { rememberClaimedRepository } from './install-set-trust.js';

export type SaleRepositoryRef = string | { node_id?: unknown; url?: unknown; public_key?: unknown };

type Refusal = { ok: false; status: number; code: string; message: string };

const MAX_ANSWER_BYTES = 1024 * 1024;

type SaleDeps = { storage: Storage; config: AimeatConfig; peers: Map<string, PeerInfo> };

/** The repository's base URL: a known peer, or one linked now from the address and key given. */
async function repositoryUrl(deps: SaleDeps, ref: unknown): Promise<Refusal | { ok: true; nodeId: string; url: string }> {
    const { storage, peers } = deps;
    const nodeId = typeof ref === 'string' ? ref : (ref && typeof ref === 'object' ? (ref as { node_id?: unknown }).node_id : undefined);
    if (typeof nodeId !== 'string' || !nodeId) {
        return { ok: false, status: 400, code: 'INVALID_INPUT', message: 'repository is the repository\'s node id, or { node_id, url, public_key } the first time.' };
    }
    if (typeof ref === 'object' && ref !== null) {
        const link = await linkPackagePeer({ storage, peers, timeoutMs: deps.config.federationTimeoutMs ?? 10000, thisNodeId: deps.config.nodeId }, nodeId, ref,
            { source: 'sale-repository', by: 'operator' }, { pendingWhenUnreachable: false });
        if (!link.ok) return link.code === 'PEER_UNREACHABLE' ? { ...link, status: 502, code: 'REPOSITORY_UNREACHABLE' } : link;
    }
    const peer = peers.get(nodeId);
    if (!peer || peer.status !== 'active') {
        return { ok: false, status: 409, code: 'PEER_UNKNOWN', message: `${nodeId} is not an active peer of this node. Give repository as { node_id, url, public_key } to link it.` };
    }
    return { ok: true, nodeId, url: stripTrailingSlashes(peer.url) };
}

/**
 * One signed request to the repository. The answer is the repository's own status and JSON body, so
 * a refusal there (NOT_A_SELLER, PEER_KEY_MISMATCH, NOT_FOUND) reaches the caller as it was said.
 */
export async function saleRequest(
    deps: { storage: Storage; config: AimeatConfig; peers: Map<string, PeerInfo> },
    input: { repository: unknown; method: 'GET' | 'PUT' | 'POST' | 'DELETE'; path: string; body?: Record<string, unknown>; purpose?: string },
): Promise<Refusal | { ok: true; status: number; body: unknown; repository: string }> {
    const repo = await repositoryUrl(deps, input.repository);
    if (!repo.ok) return repo;
    const body = input.method === 'PUT' || input.method === 'POST' ? (input.body ?? {}) : undefined;
    const headers = await signedSaleHeaders(deps.storage, deps.config, input.method, input.path, body, input.purpose);
    if (!headers['x-signature']) return { ok: false, status: 503, code: 'NODE_KEY_MISSING', message: 'This node has no key yet, so it cannot sign a sale.' };
    let res: Response;
    try {
        res = await safeFetch(`${repo.url}${input.path}`, {
            method: input.method,
            headers: { ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) },
            ...(body ? { body: JSON.stringify(body) } : {}),
            signal: AbortSignal.timeout(deps.config.federationTimeoutMs ?? 10000),
        });
    } catch (err) {
        return { ok: false, status: 502, code: 'REPOSITORY_UNREACHABLE', message: `Could not reach ${repo.nodeId}: ${String(err)}` };
    }
    const raw = await readBodyCapped(res, MAX_ANSWER_BYTES);
    if (!raw) return { ok: false, status: 502, code: 'REPOSITORY_ANSWER_TOO_LARGE', message: `${repo.nodeId} answered with more than a sale answer can be.` };
    let parsed: unknown;
    try { parsed = JSON.parse(raw.toString('utf8')); } catch (err) {
        return { ok: false, status: 502, code: 'REPOSITORY_ANSWER_INVALID', message: `${repo.nodeId} did not answer with JSON (${res.status}): ${String(err).slice(0, 200)}` };
    }
    return { ok: true, status: res.status, body: parsed, repository: repo.nodeId };
}

type SaleAnswer = Awaited<ReturnType<typeof saleRequest>>;
const salePath = (groupId: string, tail: string): string => `/v1/federation/package-sales/${encodeURIComponent(groupId)}/${tail}`;
const missing = (what: string): SaleAnswer => ({ ok: false, status: 400, code: 'INVALID_INPUT', message: `${what} required.` });

/** The questions `groupId` asks, from the repository. */
export async function saleConfigNeeds(deps: SaleDeps, repository: unknown, groupId: string): Promise<SaleAnswer> {
    if (!groupId) return missing('group_id is');
    return saleRequest(deps, { repository, method: 'GET', path: salePath(groupId, 'config-needs') });
}

/** Grant `nodeId` the package, change its grant, or end its updates (`updates_until`). */
export async function saleGrant(
    deps: SaleDeps, repository: unknown, groupId: string, nodeId: string, fields: Record<string, unknown>,
): Promise<SaleAnswer> {
    if (!groupId || !nodeId) return missing('group_id and node_id are');
    const body: Record<string, unknown> = {};
    for (const k of ['node', 'updates_until', 'channel', 'note', 'terms_id']) if (fields[k] !== undefined) body[k] = fields[k];
    return saleRequest(deps, { repository, method: 'PUT', path: salePath(groupId, `entitlements/${encodeURIComponent(nodeId)}`), body });
}

/** The author's offer for `groupId`, read by this node as a seller (package-offer.ts). */
export async function saleOffer(deps: SaleDeps, repository: unknown, groupId: string): Promise<SaleAnswer> {
    if (!groupId) return missing('group_id is');
    return saleRequest(deps, { repository, method: 'GET', path: salePath(groupId, 'offer') });
}

/** A one-time claim code for a sale whose customer node is not known yet (package-claims.ts). */
export async function saleClaim(deps: SaleDeps, repository: unknown, groupId: string, fields: Record<string, unknown>): Promise<SaleAnswer> {
    if (!groupId) return missing('group_id is');
    const body: Record<string, unknown> = {};
    for (const k of ['updates_until', 'channel', 'note', 'terms_id']) if (fields[k] !== undefined) body[k] = fields[k];
    return saleRequest(deps, { repository, method: 'PUT', path: salePath(groupId, 'claims'), body });
}

/**
 * Redeem a claim code for this node and take packages from that repository from now on: the act of
 * POST /v1/package-claims and aimeat_package_claim. Redeeming is the operator's decision to take
 * packages from the repository, as an install set's is, so the repository joins the trusted ones
 * (install-set-trust.ts) and this node's peer record of it shares the catalogue, which pulls and the
 * listing ask of it (install-set-apply.ts links its repository the same way).
 */
export async function claimPackageHere(deps: SaleDeps, repository: unknown, groupId: string, code: string): Promise<SaleAnswer> {
    const out = await redeemClaimAt(deps, repository, groupId, code);
    if (out.ok && out.status < 300) {
        await rememberClaimedRepository(deps.storage, out.repository);
        const peer = deps.peers.get(out.repository);
        if (peer && peer.shareCatalogue === false) {
            const shared = { ...peer, shareCatalogue: true };
            deps.peers.set(out.repository, shared);
            await deps.storage.saveFederationPeer(shared);
        }
    }
    return out;
}

/**
 * This node redeems a claim code at the repository, signed with its own key, which the body names:
 * the repository registers the node under that key once its card answers with it. The repository is
 * named as a peer, or linked the first time with { node_id, url, public_key }.
 */
export async function redeemClaimAt(deps: SaleDeps, repository: unknown, groupId: string, code: string): Promise<SaleAnswer> {
    if (!groupId || !code) return missing('group_id and code are');
    const key = await deps.storage.getNodeKey();
    if (!key?.publicKey) return { ok: false, status: 503, code: 'NODE_KEY_MISSING', message: 'This node has no key yet, so it cannot claim a package.' };
    const body = { code, node_id: deps.config.nodeId, url: stripTrailingSlashes(deps.config.baseUrl), public_key: key.publicKey };
    return saleRequest(deps, {
        repository, method: 'POST', path: `/v1/federation/package-claims/${encodeURIComponent(groupId)}`, body, purpose: CLAIM_PURPOSE,
    });
}

/** Revoke `nodeId`'s grant. */
export async function saleRevoke(deps: SaleDeps, repository: unknown, groupId: string, nodeId: string): Promise<SaleAnswer> {
    if (!groupId || !nodeId) return missing('group_id and node_id are');
    return saleRequest(deps, { repository, method: 'DELETE', path: salePath(groupId, `entitlements/${encodeURIComponent(nodeId)}`) });
}
