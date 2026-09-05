/**
 * @file services/package-attestation.ts
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
 *   signAttestation · verifyAttestation · verifyComponentDigests
 * @usage
 *   import { buildDescriptor, signAttestation, verifyAttestation } from './package-attestation.js';
 * @version-history
 *   v1.0.0 — 2026-09-05 — Initial.
 */
import { createHash } from 'node:crypto';
import type { PackageRecord } from '../storage/interface.js';
import { sign, verify } from '../auth/keypair.js';

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
}

export interface AttestationDoc {
    descriptor: AttestationDescriptor;
    signature: string;
}

/** sha256 of a UTF-8 string, hex, the same shape package-hash and the registrar use. */
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
    return { descriptor, signature: await sign(privateKeyBase64, attestationSignString(descriptor)) };
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
    components: Array<{ id: string; content?: string }>,
): { ok: true } | { ok: false; reason: string } {
    const claimed = new Map(descriptor.component_digests.map(c => [c.id, c.sha256]));

    for (const comp of components) {
        const want = claimed.get(comp.id);
        if (want === undefined) {
            return { ok: false, reason: `component "${comp.id}" is not named in the signed descriptor` };
        }
        const got = sha256(comp.content ?? '');
        if (got !== want) {
            return { ok: false, reason: `component "${comp.id}" does not match its signed digest` };
        }
        claimed.delete(comp.id);
    }

    if (claimed.size > 0) {
        return { ok: false, reason: `the signed descriptor names components that did not arrive: ${[...claimed.keys()].join(', ')}` };
    }
    return { ok: true };
}
