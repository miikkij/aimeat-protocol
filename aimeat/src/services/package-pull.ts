/**
 * @file services/package-pull.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Fetching a package published on another node, proving it is what that node signed,
 *   and landing it here as this owner's own.
 *
 *   REFUSE BEFORE YOU WRITE, AND REFUSE BEFORE YOU FETCH. The order below is the whole design. The
 *   quota and the name conflict are checked BEFORE a byte is downloaded, so a ten-megabyte fetch is
 *   never spent to answer a 409. The signature and the digests are checked before anything is
 *   written. Nothing is stored until every one of them has passed.
 *
 *   VERIFICATION IS TWO STEPS, NOT ONE. The signature proves the source node signed the descriptor;
 *   recomputing every component's sha256 proves the bytes that arrived are the bytes it signed
 *   about. A caller that does the first alone has checked nothing about the payload, which is why
 *   both live here rather than in the caller.
 *
 *   THE KEY NEVER COMES FROM THE BODY. For a known peer it comes from the peers map, keyed by the
 *   node id, and so does the base URL. That is invariant 13: a gate reads the normalized value. A
 *   pull that took the URL or the key from the request would verify the attacker's signature against
 *   the attacker's key and call it proof.
 * @structure PullRefusal · PackagePullResult · pullPackage(deps, caller, input)
 * @usage
 *   import { pullPackage } from '../services/package-pull.js';
 *   const out = await pullPackage({ storage, config, peers }, caller, { groupId, nodeId });
 * @version-history
 *   v1.0.0 — 2026-09-05 — Initial.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, PackageRecord, UpstreamRef } from '../storage/interface.js';
import type { PeerInfo } from './federation.js';
import { gatePeer } from './federation-peer-gate.js';
import { safeFetch } from '../utils/url-validator.js';
import { parseZip, ZipValidationError } from './package-zip.js';
import {
    verifyAttestation, verifyComponentDigests, type AttestationDoc,
} from './package-attestation.js';
import { importParsedPackage } from './package-import.js';
import { getPackageFor } from './package-read.js';
import { logger } from '../utils/logger.js';

export interface PackagePullDeps {
    storage: Storage;
    config: AimeatConfig;
    peers: Map<string, PeerInfo>;
}

export interface PackagePullCaller {
    owner: string;
    sub: string;
    /** Operator role is what the arbitrary-URL branch requires. */
    isOperator: boolean;
}

export interface PackagePullInput {
    groupId: string;
    /** A known peer. Its URL and key are read from the peers map, never from this request. */
    nodeId?: string;
    /** Any node, operator only, and only together with trust: 'tofu'. */
    sourceUrl?: string;
    trust?: string;
    version?: string;
}

export type PackagePullResult =
    | { ok: true; applied: true; package: PackageRecord; upstream: UpstreamRef }
    | { ok: true; applied: false; reason: 'not_newer'; upstream: UpstreamRef }
    | { ok: false; status: number; code: string; message: string };

/** The source a pull resolved to: where to fetch from, and whose key proves it. */
interface ResolvedSource {
    nodeId: string;
    baseUrl: string;
    publicKey: string;
}

/** A node's own public key, from the address every AIMEAT node publishes it at. */
async function tofuKeyOf(baseUrl: string, timeoutMs: number): Promise<ResolvedSource | null> {
    const res = await safeFetch(`${baseUrl.replace(/\/+$/, '')}/.well-known/aimeat`, {
        signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    // The node card is inside the standard envelope, like every other answer this protocol gives.
    const body = await res.json() as { data?: { node_id?: string; public_key?: string | null } };
    const card = body?.data;
    if (!card?.node_id || !card?.public_key) return null;
    return { nodeId: card.node_id, baseUrl, publicKey: card.public_key };
}

/**
 * Pull one package version from another node.
 *
 * Authorisation happened before this call — `packages:write` on every door. What is decided HERE is
 * WHERE an authorised caller may pull from, and on what proof.
 */
export async function pullPackage(
    deps: PackagePullDeps,
    caller: PackagePullCaller,
    input: PackagePullInput,
): Promise<PackagePullResult> {
    const { storage, config, peers } = deps;
    const timeoutMs = config.federationTimeoutMs ?? 10000;

    // 1. One switch, both directions. A pulled extension runs code in the sandbox and a pulled app
    //    gets an address, so an operator needs an inbound off switch and this is it.
    if (!config.packageFederationEnabled) {
        return {
            ok: false, status: 403, code: 'PACKAGE_FEDERATION_DISABLED',
            message: 'This node does not exchange packages with other nodes. An operator turns it on with AIMEAT_PACKAGE_FEDERATION_ENABLED.',
        };
    }

    // 2. The group id, before anything else is looked up.
    const groupId = typeof input.groupId === 'string' ? input.groupId.trim() : '';
    if (!groupId || !groupId.includes('::')) {
        return {
            ok: false, status: 400, code: 'INVALID_INPUT',
            message: 'group_id is required and looks like "package-name::author"',
        };
    }

    // 3. Where this may be pulled from, and whose key proves it.
    let source: ResolvedSource;
    if (input.nodeId) {
        const gate = gatePeer(peers, input.nodeId, 'shareCatalogue');
        if (!gate.ok) return { ok: false, status: gate.status, code: gate.code, message: gate.message };
        source = { nodeId: gate.peer.nodeId, baseUrl: gate.peer.url, publicKey: gate.peer.publicKey };
    } else if (input.sourceUrl) {
        if (!caller.isOperator) {
            return {
                ok: false, status: 403, code: 'FORBIDDEN',
                message: 'Pulling from a node that is not a peer is an operator decision.',
            };
        }
        if (input.trust !== 'tofu') {
            return {
                ok: false, status: 403, code: 'UNKNOWN_ISSUER',
                message: 'That node is not a peer, so nothing here knows its key. Add it as a peer, or repeat with trust:"tofu" to accept the key it publishes and pin it.',
            };
        }
        const resolved = await tofuKeyOf(input.sourceUrl, timeoutMs).catch(err => {
            logger.warn('package-pull: could not read the source node key', { error: String(err) });
            return null;
        });
        if (!resolved) {
            return {
                ok: false, status: 502, code: 'SOURCE_UNREACHABLE',
                message: 'That address did not answer with an AIMEAT node card carrying a public key.',
            };
        }
        source = resolved;
    } else {
        return {
            ok: false, status: 400, code: 'INVALID_INPUT',
            message: 'Name the peer to pull from (node_id), or an address (source_url) as an operator.',
        };
    }

    // 4. What is already here, and whether this may be written at all — BEFORE the download.
    const localGroupId = `${groupId.split('::')[0]}::${caller.owner}`;
    const existing = await getPackageFor(storage, localGroupId, caller.owner);
    if (existing?.upstream && existing.upstream.node !== source.nodeId) {
        return {
            ok: false, status: 409, code: 'CONFLICT',
            message: `Your package "${existing.name}" was pulled from ${existing.upstream.node}, not from ${source.nodeId}.`,
        };
    }
    if (existing?.upstream && existing.upstream.publicKey !== source.publicKey) {
        // A source whose key changed is a refusal, never a silent downgrade: this is the only thing
        // between a pinned upstream and somebody else answering for it.
        return {
            ok: false, status: 409, code: 'KEY_CHANGED',
            message: `${source.nodeId} is signing with a different key than the one your copy was pulled under. An operator has to look at that before anything else happens.`,
        };
    }

    // 5. Fetch, with a cap and a clock.
    const base = source.baseUrl.replace(/\/+$/, '');
    const path = `${base}/v1/packages/${encodeURIComponent(groupId)}/export`
        + (input.version ? `?version=${encodeURIComponent(input.version)}` : '');

    let buf: Buffer;
    try {
        const res = await safeFetch(path, { signal: AbortSignal.timeout(timeoutMs) });
        if (res.status === 404) {
            return { ok: false, status: 404, code: 'NOT_FOUND', message: `${source.nodeId} does not serve a package "${groupId}" you may read.` };
        }
        if (!res.ok) {
            return { ok: false, status: 502, code: 'SOURCE_REFUSED', message: `${source.nodeId} answered ${res.status} for that package.` };
        }
        const declared = Number(res.headers.get('content-length') ?? '0');
        const capBytes = config.packageMaxSizeMb * 1024 * 1024;
        if (declared > capBytes) {
            return {
                ok: false, status: 413, code: 'SIZE_EXCEEDED',
                message: `That package is ${(declared / 1024 / 1024).toFixed(1)}MB, over this node's ${config.packageMaxSizeMb}MB limit.`,
            };
        }
        buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > capBytes) {
            return {
                ok: false, status: 413, code: 'SIZE_EXCEEDED',
                message: `That package is over this node's ${config.packageMaxSizeMb}MB limit.`,
            };
        }
    } catch (err) {
        return { ok: false, status: 502, code: 'SOURCE_UNREACHABLE', message: `Could not fetch from ${source.nodeId}: ${String(err)}` };
    }

    // 6. The archive's own validation chain: magic bytes, size, bomb, traversal, manifest.
    let parsed;
    try {
        parsed = await parseZip(buf, { maxSizeMb: config.packageMaxSizeMb });
    } catch (err) {
        if (err instanceof ZipValidationError) {
            const status = err.code === 'SIZE_EXCEEDED' || err.code === 'DECOMPRESSION_BOMB' ? 413 : 400;
            return { ok: false, status, code: err.code, message: err.message };
        }
        throw err;
    }

    // 7. The signature. On this road it is not optional and no setting makes it so.
    const doc = parsed.attestation as AttestationDoc | undefined;
    if (!doc?.descriptor) {
        return {
            ok: false, status: 400, code: 'MISSING_ATTESTATION',
            message: `${source.nodeId} served that package without a signature, so nothing here can say what it is.`,
        };
    }
    if (doc.descriptor.source_node !== source.nodeId) {
        return {
            ok: false, status: 401, code: 'INVALID_SIGNATURE',
            message: `That package is signed as coming from ${doc.descriptor.source_node}, not from ${source.nodeId}.`,
        };
    }
    if (!(await verifyAttestation(source.publicKey, doc))) {
        return {
            ok: false, status: 401, code: 'INVALID_SIGNATURE',
            message: `The signature on that package does not check out against ${source.nodeId}'s key.`,
        };
    }

    // 8. And the bytes that arrived are the bytes it signed about.
    const digests = verifyComponentDigests(doc.descriptor, parsed.components);
    if (!digests.ok) {
        return { ok: false, status: 400, code: 'DIGEST_MISMATCH', message: digests.reason };
    }

    const upstream: UpstreamRef = {
        node: source.nodeId,
        url: base,
        groupId,
        version: doc.descriptor.version,
        publishedAt: doc.descriptor.published_at,
        authorGhii: doc.descriptor.author_ghii,
        publicKey: source.publicKey,
        verifiedAt: new Date().toISOString(),
    };

    // 9. Not-newer gate, on the instant inside the signature rather than on a version string. The
    //    string sorts by luck; the instant is asserted by the signer and cannot be moved backwards
    //    without their private key.
    if (existing?.upstream) {
        const have = Date.parse(existing.upstream.publishedAt);
        const offered = Date.parse(upstream.publishedAt);
        if (Number.isFinite(have) && Number.isFinite(offered) && offered <= have) {
            return { ok: true, applied: false, reason: 'not_newer', upstream: existing.upstream };
        }
    }

    // 10. Only now.
    const written = await importParsedPackage({ storage, config },
        { owner: caller.owner, sub: caller.sub }, { parsed, upstream, via: 'pull' });
    if (!written.ok) return written;

    return { ok: true, applied: true, package: written.package, upstream };
}

export interface UpstreamCheckAnswer {
    hasUpstream: true;
    updateAvailable: boolean;
    node: string;
    haveVersion: string;
    havePublishedAt: string;
    upstreamVersion: string;
    upstreamPublishedAt: string;
    /** False when the source signed with a key other than the one this copy was pulled under. */
    signerUnchanged: boolean;
}

export type UpstreamCheckResult =
    | { ok: true; answer: UpstreamCheckAnswer }
    | { ok: false; status: number; code: string; message: string };

/**
 * Ask the source node what it has now, without downloading anything.
 *
 * Reads the signed statement and nothing else, so this costs one small JSON read. It still VERIFIES
 * that statement: an unsigned or wrongly signed answer is not an update notice, it is a reason to
 * stop. Writes nothing either way.
 */
export async function checkUpstream(
    deps: PackagePullDeps, pkg: PackageRecord,
): Promise<UpstreamCheckResult> {
    const { config } = deps;
    const up = pkg.upstream;
    if (!up) {
        return { ok: false, status: 400, code: 'NO_UPSTREAM', message: 'This package was made here, so there is nowhere to check.' };
    }

    const timeoutMs = config.federationTimeoutMs ?? 10000;
    const base = up.url.replace(/\/+$/, '');
    const url = `${base}/v1/federation/packages/${encodeURIComponent(up.groupId)}/attestation`;

    let doc: AttestationDoc;
    try {
        const res = await safeFetch(url, { signal: AbortSignal.timeout(timeoutMs) });
        if (!res.ok) {
            return { ok: false, status: 502, code: 'SOURCE_REFUSED', message: `${up.node} answered ${res.status}.` };
        }
        const body = await res.json() as { data?: AttestationDoc };
        const found = body?.data;
        if (!found?.descriptor) {
            return { ok: false, status: 502, code: 'MISSING_ATTESTATION', message: `${up.node} did not answer with a signed statement.` };
        }
        doc = found;
    } catch (err) {
        return { ok: false, status: 502, code: 'SOURCE_UNREACHABLE', message: `Could not reach ${up.node}: ${String(err)}` };
    }

    // The pinned key, not whatever the answer would like to be checked against.
    const signerUnchanged = up.publicKey.length > 0 && await verifyAttestation(up.publicKey, doc);
    if (up.publicKey.length > 0 && !signerUnchanged) {
        return {
            ok: false, status: 409, code: 'KEY_CHANGED',
            message: `${up.node} is answering with a signature that does not check out against the key your copy was pulled under.`,
        };
    }

    const have = Date.parse(up.publishedAt);
    const offered = Date.parse(doc.descriptor.published_at);
    const updateAvailable = Number.isFinite(have) && Number.isFinite(offered) && offered > have;

    return {
        ok: true,
        answer: {
            hasUpstream: true,
            updateAvailable,
            node: up.node,
            haveVersion: up.version,
            havePublishedAt: up.publishedAt,
            upstreamVersion: doc.descriptor.version,
            upstreamPublishedAt: doc.descriptor.published_at,
            signerUnchanged: true,
        },
    };
}
