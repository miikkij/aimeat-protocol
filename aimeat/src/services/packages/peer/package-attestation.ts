/**
 * @file services/packages/peer/package-attestation.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What a node says about a package it serves, signed with the node's own key, so
 *   another node can decide whether to install it.
 *
 *   THE NODE SIGNS, NOT THE AUTHOR. A node holds only the owner's public key — the private half went
 *   to the person at registration — so a per-author signature is not producible server side. The
 *   honest statement a node can make is: *node A attests that this package, with these component
 *   digests, is published here, by an author whose GHII is Y*. That is the weight a peer
 *   relationship carries, and the same shape as the network-policy document, which is signed by the
 *   issuing node's key.
 *
 *   THE DIGESTS ARE SIGNED, NOT THE CONTAINER. `archiver` stamps `new Date()` on every entry when it
 *   is given none, so two exports of the same version differ byte for byte and a digest over the ZIP
 *   could never be stable. Component digests survive a re-zip and a manual download-and-reupload,
 *   and they reuse the sha256 convention this node already publishes at
 *   /.well-known/agent-skills/index.json. Verification is therefore TWO steps: the signature over the
 *   descriptor, then each component's sha256 recomputed from the content that arrived. The second
 *   step is what makes the signature cover the bytes; a caller that does the first alone has checked
 *   nothing about the payload.
 *
 *   THE SIGN STRING NAMES ITS FIELDS. It is built by a function with the field order written out,
 *   never by walking a parsed object: services/network-policy.ts does the latter and survives only
 *   because JSON.parse happens to preserve wire order. A signature whose input depends on how a
 *   parser felt is a signature that fails for the wrong reason one day.
 * @structure AttestationDescriptor · AttestationDoc · buildDescriptor · attestationSignString ·
 *   componentMetadataDigest · metadataSignString · signAttestation · verifyAttestation ·
 *   verifyComponentDigests · verifyComponentMetadata
 * @usage
 *   import { buildDescriptor, signAttestation, verifyAttestation } from './package-attestation.js';
 * @version-history
 *   v1.2.0 — 2026-10-27 — The node also signs each component's install-relevant metadata from
 *     manifest.yaml (label, dependencies, meta): metadata_sha256 in the descriptor, signed by a second
 *     signature, metadata_signature, so the sign string of `signature` and every node that verifies
 *     only it are unchanged. verifyComponentMetadata checks it where present (secaudit2026oct26).
 *   v1.1.0 — 2026-10-25 — verifyComponentDigests also compares each arrived component's type with
 *     its signed type, since the type decides how a part is installed (secaudit2026oct22).
 *   v1.0.0 — 2026-09-05 — Initial.
 */
import { createHash } from 'node:crypto';
import type { PackageRecord } from '../../../storage/interface.js';
import { sign, verify } from '../../../auth/keypair.js';
import { stableStringify } from '../../../utils/stable-json.js';

export const ATTESTATION_SPEC = 'aimeat-package-attestation/1.0';

export interface ComponentDigest {
    id: string;
    type: string;
    sha256: string;
}

export interface AttestationDescriptor {
    spec: string;
    name: string;
    author: string;
    author_ghii: string;
    version: string;
    source_node: string;
    source_url: string;
    published_at: string;
    manifest_sha256: string;
    /** Sorted by id, so the same package always produces the same string. */
    component_digests: ComponentDigest[];
    /**
     * sha256 of each component's install-relevant metadata from manifest.yaml (label, dependencies,
     * meta: an app's tools, data map, name and icon), canonical (componentMetadataDigest). Signed by
     * `metadata_signature`, not by `signature`, so a node that does not know the field still verifies
     * the rest. Absent on an attestation made before 2026-10-27.
     */
    metadata_sha256?: string;
}

export interface AttestationDoc {
    descriptor: AttestationDescriptor;
    signature: string;
    /** The signature over the sign string plus metadata_sha256 (metadataSignString). */
    metadata_signature?: string;
}

/**
 * The canonical digest of what manifest.yaml says about each component and the install reads: its
 * label, its dependencies and its `meta`. Normalised the way the ZIP round trip leaves them (an empty
 * meta is no meta, a missing dependency list is empty), so the record a node signs and the parts a
 * puller parses from the archive give the same digest.
 */
export function componentMetadataDigest(components: Array<{ id: string; label?: string; dependencies?: string[]; meta?: unknown }>): string {
    const rows = components
        .map(c => ({
            id: c.id,
            label: c.label ?? '',
            dependencies: c.dependencies ?? [],
            meta: c.meta && typeof c.meta === 'object' && !Array.isArray(c.meta) && Object.keys(c.meta).length > 0 ? c.meta : null,
        }))
        .sort((a, b) => a.id.localeCompare(b.id));
    return sha256(stableStringify(rows));
}

/** The bytes `metadata_signature` signs: the attestation's sign string and the metadata digest. */
export function metadataSignString(d: AttestationDescriptor): string {
    const value = d.metadata_sha256 ?? '';
    return `${attestationSignString(d)}\nmetadata_sha256:${value.length}:${value}`;
}

/** sha256 of a UTF-8 string, hex, the same shape the registrar uses. */
function sha256(text: string): string {
    return createHash('sha256').update(text, 'utf-8').digest('hex');
}

/** What node A claims about this package version. */
export function buildDescriptor(
    pkg: PackageRecord,
    node: { nodeId: string; baseUrl: string },
    publishedAt?: string,
): AttestationDescriptor {
    return {
        spec: ATTESTATION_SPEC,
        name: pkg.name,
        author: pkg.author,
        author_ghii: pkg.authorGhii,
        version: pkg.version,
        source_node: node.nodeId,
        source_url: node.baseUrl,
        // The instant this VERSION was created here, which is the only ordering two nodes share.
        published_at: publishedAt ?? pkg.createdAt,
        manifest_sha256: sha256(pkg.manifest ?? ''),
        component_digests: pkg.components
            .map(c => ({ id: c.id, type: c.type, sha256: sha256(c.content ?? '') }))
            .sort((a, b) => a.id.localeCompare(b.id)),
        metadata_sha256: componentMetadataDigest(pkg.components),
    };
}

/**
 * The exact bytes that are signed.
 *
 * Every field is named here in a fixed order, and every value is length-prefixed so no combination
 * of contents can be rearranged into the same string.
 */
export function attestationSignString(d: AttestationDescriptor): string {
    const field = (label: string, value: string): string => `${label}:${value.length}:${value}`;
    const parts = [
        field('spec', d.spec),
        field('name', d.name),
        field('author', d.author),
        field('author_ghii', d.author_ghii),
        field('version', d.version),
        field('source_node', d.source_node),
        field('source_url', d.source_url),
        field('published_at', d.published_at),
        field('manifest_sha256', d.manifest_sha256),
        field('components', String(d.component_digests.length)),
    ];
    for (const c of d.component_digests) {
        parts.push(field('component', `${c.id}|${c.type}|${c.sha256}`));
    }
    return parts.join('\n');
}

export async function signAttestation(
    privateKeyBase64: string, descriptor: AttestationDescriptor,
): Promise<AttestationDoc> {
    const signature = await sign(privateKeyBase64, attestationSignString(descriptor));
    if (descriptor.metadata_sha256 === undefined) return { descriptor, signature };
    return { descriptor, signature, metadata_signature: await sign(privateKeyBase64, metadataSignString(descriptor)) };
}

/**
 * Step three: does the metadata that arrived in manifest.yaml match what the node signed? An
 * attestation from a node that signs no metadata (made before 2026-10-27) answers `checked: false`
 * and is decided as before; one that signs it must match, or the pull stops before any write.
 */
export async function verifyComponentMetadata(
    publicKeyBase64: string, doc: AttestationDoc,
    components: Array<{ id: string; label?: string; dependencies?: string[]; meta?: unknown }>,
): Promise<{ ok: true; checked: boolean } | { ok: false; reason: string }> {
    const d = doc.descriptor;
    if (typeof doc.metadata_signature !== 'string' || typeof d.metadata_sha256 !== 'string') return { ok: true, checked: false };
    if (!(await verify(publicKeyBase64, metadataSignString(d), doc.metadata_signature))) {
        return { ok: false, reason: 'the signature over the package metadata does not check out' };
    }
    if (componentMetadataDigest(components) !== d.metadata_sha256) {
        return { ok: false, reason: 'the component metadata in manifest.yaml (labels, dependencies, app tools, data map, name or icon) is not what was signed' };
    }
    return { ok: true, checked: true };
}

/** Step one: did the node that claims to have signed this actually sign it? */
export async function verifyAttestation(publicKeyBase64: string, doc: AttestationDoc): Promise<boolean> {
    if (!doc?.descriptor || typeof doc.signature !== 'string') return false;
    if (doc.descriptor.spec !== ATTESTATION_SPEC) return false;
    return verify(publicKeyBase64, attestationSignString(doc.descriptor), doc.signature);
}

/**
 * Step two: do the components that arrived hash to what the signature covers?
 *
 * Refuses a component the descriptor does not name and a descriptor entry that did not arrive, both
 * of which are ways to smuggle bytes past a signature that only lists some of them.
 */
export function verifyComponentDigests(
    descriptor: AttestationDescriptor,
    components: Array<{ id: string; type?: string; content?: string }>,
): { ok: true } | { ok: false; reason: string } {
    const claimed = new Map(descriptor.component_digests.map(c => [c.id, c]));

    for (const comp of components) {
        const want = claimed.get(comp.id);
        if (want === undefined) {
            return { ok: false, reason: `component "${comp.id}" is not named in the signed descriptor` };
        }
        const got = sha256(comp.content ?? '');
        if (got !== want.sha256) {
            return { ok: false, reason: `component "${comp.id}" does not match its signed digest` };
        }
        // The type decides how a part is installed, and the manifest that carries it is not signed.
        if (comp.type !== undefined && comp.type !== want.type) {
            return { ok: false, reason: `component "${comp.id}" arrived as type "${comp.type}", signed as "${want.type}"` };
        }
        claimed.delete(comp.id);
    }

    if (claimed.size > 0) {
        return { ok: false, reason: `the signed descriptor names components that did not arrive: ${[...claimed.keys()].join(', ')}` };
    }
    return { ok: true };
}
