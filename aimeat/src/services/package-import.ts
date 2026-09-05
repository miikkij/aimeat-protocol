/**
 * @file services/package-import.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Taking a parsed package into this node as the caller's own: the quota, the name
 *   conflict, and the record that lands.
 *
 *   TWO ROADS, ONE LANDING. A ZIP a person uploads and a package pulled from a peer differ in how
 *   the bytes arrived and in what was proven about them; they do not differ in what is written. This
 *   is that landing, so the pull cannot drift into a second set of ceilings.
 *
 *   OWNERSHIP IS THE IMPORTER'S, AND THAT IS DELIBERATE. The package registers under this owner's
 *   name, its components run on this node, and this owner answers for them. The publishing author's
 *   GHII travels as provenance on `upstream` and authorizes nothing. The ZIP road has always
 *   collapsed ownership this way.
 *
 *   AND IT LANDS PRIVATE. An imported package is installable by whoever imported it and invisible to
 *   everyone else until they choose otherwise. A package can carry an extension that runs code and
 *   an app that gets an address, so arriving world-visible is not a default anybody should get by
 *   omission.
 * @structure PackageImportInput · importParsedPackage(deps, caller, input)
 * @usage
 *   import { importParsedPackage } from '../services/package-import.js';
 *   const out = await importParsedPackage({ storage, config }, caller, { parsed, via: 'zip' });
 * @version-history
 *   v1.0.0 — 2026-09-05 — Extraction out of routes/packages.ts POST /v1/packages/import, so the
 *     federation pull writes through the same door. One behaviour change: the version string goes
 *     through nextPackageVersion, so two imports in the same minute get -2 instead of colliding on
 *     UNIQUE(packageGroupId, version) and answering 409 for a reason nobody could act on.
 */
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../config.js';
import type { Storage, PackageRecord, UpstreamRef } from '../storage/interface.js';
import type { ParsedPackage } from './package-zip.js';
import type { PeerInfo } from './federation.js';
import { verifyAttestation, verifyComponentDigests, type AttestationDoc } from './package-attestation.js';
import { resolveGhii } from '../utils/ghii-resolver.js';
import {
    normalizeComponents, nextPackageVersion, checkAuthorQuota,
    type PackageWriteResult, type PackageCreateCaller,
} from './package-create.js';
import { emitChange } from './event-bus.js';

export interface PackageImportDeps { storage: Storage; config: AimeatConfig }

/**
 * What a hand-uploaded ZIP's signature is worth here.
 *
 * THREE ANSWERS, AND THE MIDDLE ONE IS THE POINT. `undefined` — no signature, or one whose signer
 * this node has never heard of, so nothing is claimed. An `UpstreamRef` with `verifiedAt` set — the
 * signer is a peer, the signature checks out against their key, and the components hash to what it
 * covers. `'INVALID'` — the signer IS a peer this node knows and the proof fails, which is a
 * refusal: a package claiming to come from somewhere it does not is worse than one claiming nothing.
 *
 * This road does not DEMAND a signature. Somebody moving their own package between their own nodes
 * should not have to peer them first. The federation road is where a signature is compulsory.
 */
export async function upstreamFromZip(
    parsed: ParsedPackage,
    peers: Map<string, PeerInfo>,
): Promise<UpstreamRef | undefined | 'INVALID'> {
    const doc = parsed.attestation as AttestationDoc | undefined;
    const d = doc?.descriptor;
    if (!d || typeof d.source_node !== 'string' || typeof doc?.signature !== 'string') return undefined;

    const base: UpstreamRef = {
        node: d.source_node,
        url: typeof d.source_url === 'string' ? d.source_url : '',
        groupId: `${d.name}::${d.author}`,
        version: d.version,
        publishedAt: d.published_at,
        authorGhii: d.author_ghii,
        publicKey: '',
        verifiedAt: null,
    };

    const peer = [...peers.values()].find(p => p.nodeId === d.source_node);
    if (!peer?.publicKey) {
        // Nobody here can check it, so nothing here claims it was checked.
        return base;
    }

    if (!(await verifyAttestation(peer.publicKey, doc))) return 'INVALID';
    const digests = verifyComponentDigests(d, parsed.components);
    if (!digests.ok) return 'INVALID';

    return { ...base, publicKey: peer.publicKey, verifiedAt: new Date().toISOString() };
}

export interface PackageImportInput {
    parsed: ParsedPackage;
    /** Where the bytes came from, when they came from another node. */
    upstream?: UpstreamRef;
    /** How they arrived. Decides the changelog line when the package carries none. */
    via: 'zip' | 'pull';
}

export async function importParsedPackage(
    deps: PackageImportDeps,
    caller: PackageCreateCaller,
    input: PackageImportInput,
): Promise<PackageWriteResult> {
    const { storage, config } = deps;
    const { parsed } = input;
    const owner = caller.owner;

    if (parsed.components.length > config.packageMaxComponents) {
        return {
            ok: false, status: 413, code: 'COMPONENT_LIMIT_EXCEEDED',
            message: `Package has ${parsed.components.length} components, max is ${config.packageMaxComponents}`,
        };
    }

    const quota = await checkAuthorQuota({ storage, config }, owner);
    if (quota) return quota;

    // Same name by a DIFFERENT author is a refusal; by the same author it is a new version. The
    // group id carries the owner, so the second case can only mean this person's own package.
    const packageGroupId = `${parsed.name}::${owner}`;
    const existingGroup = await storage.listVersions(packageGroupId, 1, 0);
    if (existingGroup.total > 0 && existingGroup.versions[0].author !== owner) {
        return {
            ok: false, status: 409, code: 'CONFLICT',
            message: `Package "${parsed.name}" already exists by a different author`,
        };
    }

    const now = new Date().toISOString();
    const record: PackageRecord = {
        id: randomUUID(),
        packageGroupId,
        name: parsed.name,
        author: owner,
        authorGhii: await resolveGhii(storage, owner, caller.sub),
        version: await nextPackageVersion(storage, packageGroupId),
        changelog: parsed.changelog
            ?? (input.via === 'pull' ? `Pulled from ${input.upstream?.node ?? 'another node'}` : 'Imported from ZIP'),
        description: parsed.description ?? '',
        category: parsed.category ?? 'other',
        tags: parsed.tags ?? [],
        visibility: 'private',
        status: 'published',
        components: normalizeComponents(parsed.components),
        manifest: '',
        ...(input.upstream ? { upstream: input.upstream } : {}),
        createdAt: now,
        updatedAt: now,
    };

    try {
        const created = await storage.createPackage(record);
        emitChange('packages');
        return { ok: true, package: created };
    } catch (e) {
        const err = e as { message?: string; code?: string };
        if (err.message === 'PACKAGE_EXISTS' || err.code === 'SQLITE_CONSTRAINT_UNIQUE' || err.code === 'P2002') {
            return {
                ok: false, status: 409, code: 'CONFLICT',
                message: `Package "${parsed.name}" already exists for this author`,
            };
        }
        throw e;
    }
}
