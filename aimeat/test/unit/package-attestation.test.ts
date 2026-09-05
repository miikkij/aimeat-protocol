/**
 * @file test/unit/package-attestation.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The half of package verification an HTTP test cannot reach: what happens when the
 *   signature is genuine and the BYTES are not.
 *
 *   WHY THIS IS A UNIT TEST. Over the wire a well-behaved node serves the components it signed, so
 *   the digest check never fires and a suite that only drives the pull door would pass with step two
 *   deleted. Tampering is what a hostile middle does, and that is reachable here and nowhere else.
 * @structure sign string stability · signature · digest tampering · added and missing components
 * @usage pnpm exec vitest run test/unit/package-attestation.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-05 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { generateKeyPair } from '../../src/auth/keypair.js';
import {
    buildDescriptor, attestationSignString, signAttestation, verifyAttestation,
    verifyComponentDigests, ATTESTATION_SPEC,
} from '../../src/services/package-attestation.js';
import type { PackageRecord } from '../../src/storage/interface.js';

function pkg(components: Array<{ id: string; content: string }>): PackageRecord {
    return {
        id: 'p1',
        packageGroupId: 'signage::alice',
        name: 'signage',
        author: 'alice',
        authorGhii: 'alice@node-a',
        version: 'v2026-09-05-1200',
        changelog: '',
        description: 'A package',
        category: 'utility',
        tags: [],
        visibility: 'public',
        status: 'published',
        components: components.map(c => ({
            id: c.id, type: 'csm' as const, label: c.id, content: c.content,
            contentHash: 'unused-here', dependencies: [],
        })),
        manifest: '',
        createdAt: '2026-09-05T12:00:00.000Z',
        updatedAt: '2026-09-05T12:00:00.000Z',
    };
}

const NODE = { nodeId: 'node-a', baseUrl: 'https://a.example' };

describe('the signed string', () => {
    it('orders components by id, so the same package always signs the same bytes', () => {
        const one = buildDescriptor(pkg([{ id: 'b', content: 'B' }, { id: 'a', content: 'A' }]), NODE);
        const two = buildDescriptor(pkg([{ id: 'a', content: 'A' }, { id: 'b', content: 'B' }]), NODE);
        expect(attestationSignString(one)).toBe(attestationSignString(two));
        expect(one.component_digests.map(c => c.id)).toEqual(['a', 'b']);
    });

    it('length-prefixes every field, so no two different descriptors collide', () => {
        // Without the prefixes these two would produce the same concatenation.
        const a = buildDescriptor(pkg([{ id: 'x', content: 'x' }]), NODE);
        const b = { ...a, name: 'sign', author: 'agealice' };
        const c = { ...a, name: 'signage', author: 'alice' };
        expect(attestationSignString(b)).not.toBe(attestationSignString(c));
    });

    it('carries the digests and never the content', () => {
        const d = buildDescriptor(pkg([{ id: 'x', content: 'secret bytes' }]), NODE);
        expect(JSON.stringify(d)).not.toContain('secret bytes');
        expect(d.component_digests[0].sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(d.spec).toBe(ATTESTATION_SPEC);
    });
});

describe('the signature', () => {
    it('verifies against the key that made it', async () => {
        const key = await generateKeyPair();
        const doc = await signAttestation(key.privateKey, buildDescriptor(pkg([{ id: 'x', content: 'X' }]), NODE));
        expect(await verifyAttestation(key.publicKey, doc)).toBe(true);
    });

    it('does not verify against another key', async () => {
        const mine = await generateKeyPair();
        const theirs = await generateKeyPair();
        const doc = await signAttestation(mine.privateKey, buildDescriptor(pkg([{ id: 'x', content: 'X' }]), NODE));
        expect(await verifyAttestation(theirs.publicKey, doc)).toBe(false);
    });

    it('does not verify when a signed field is edited afterwards', async () => {
        const key = await generateKeyPair();
        const doc = await signAttestation(key.privateKey, buildDescriptor(pkg([{ id: 'x', content: 'X' }]), NODE));
        doc.descriptor.published_at = '2030-01-01T00:00:00.000Z';
        expect(await verifyAttestation(key.publicKey, doc)).toBe(false);
    });

    it('refuses a document of an unknown spec, whatever it is signed with', async () => {
        const key = await generateKeyPair();
        const descriptor = { ...buildDescriptor(pkg([{ id: 'x', content: 'X' }]), NODE), spec: 'something-else/9.9' };
        const doc = await signAttestation(key.privateKey, descriptor);
        expect(await verifyAttestation(key.publicKey, doc)).toBe(false);
    });
});

describe('the digests, which is what makes the signature cover the bytes', () => {
    const descriptor = buildDescriptor(pkg([{ id: 'a', content: 'A' }, { id: 'b', content: 'B' }]), NODE);

    it('passes when the components that arrived are the ones signed about', () => {
        expect(verifyComponentDigests(descriptor, [{ id: 'a', content: 'A' }, { id: 'b', content: 'B' }]))
            .toEqual({ ok: true });
    });

    it('fails on a single changed byte', () => {
        const out = verifyComponentDigests(descriptor, [{ id: 'a', content: 'A' }, { id: 'b', content: 'C' }]);
        expect(out.ok).toBe(false);
        expect(out.ok === false && out.reason).toContain('"b"');
    });

    it('fails on a component the descriptor never named', () => {
        const out = verifyComponentDigests(descriptor, [
            { id: 'a', content: 'A' }, { id: 'b', content: 'B' }, { id: 'extra', content: 'X' },
        ]);
        expect(out.ok).toBe(false);
        expect(out.ok === false && out.reason).toContain('"extra"');
    });

    it('fails when a signed component did not arrive', () => {
        const out = verifyComponentDigests(descriptor, [{ id: 'a', content: 'A' }]);
        expect(out.ok).toBe(false);
        expect(out.ok === false && out.reason).toContain('b');
    });

    it('treats a missing content as the empty string rather than skipping the check', () => {
        const empty = buildDescriptor(pkg([{ id: 'a', content: '' }]), NODE);
        expect(verifyComponentDigests(empty, [{ id: 'a' }])).toEqual({ ok: true });
        expect(verifyComponentDigests(empty, [{ id: 'a', content: 'x' }]).ok).toBe(false);
    });
});
