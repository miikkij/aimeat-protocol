/**
 * @file test/unit/federation-book-signature.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The federation book's signature survives a store that reorders keys, and a book a
 *   peer on an earlier version signed still verifies.
 *
 *   WHY. The book is stored as a memory value. A PostgreSQL jsonb column gives an object's keys back
 *   in its own order (shorter keys first), and the book was signed over JSON.stringify of the
 *   object, so a book served from a PostgreSQL primary failed verification on every leaf with 401
 *   INVALID_SIGNATURE. Found when e2e-federation-book first ran its nodes on PostgreSQL (QA audit
 *   P1-02). The first case fails on src/services/federation-book.ts v1.0.1.
 * @version-history
 *   2026-10-16 — Initial (QA audit P1-02).
 */
import { describe, expect, it } from 'vitest';
import { generateKeyPair, sign } from '../../src/auth/keypair.js';
import { bookSignString, legacyBookSignString, verifyBookSignature, type FederationBook } from '../../src/services/federation-book.js';

const book = (): FederationBook => ({
    book_version: 3,
    issued_by: 'aimeat-test-001-primary',
    issued_at: '2026-10-16T00:00:00.000Z',
    nodes: [{ node_id: 'aimeat-test-001-primary', url: 'https://primary.example', listed: true, software_version: '4.0.3', operators: [{ ghii: 'op@aimeat-test-001-primary', display_name: 'Op', avatar: null }] }],
});

/** The same book with every object's keys in another order, the way a jsonb column returns it. */
function reordered(b: FederationBook): FederationBook {
    const flip = (v: unknown): unknown => {
        if (Array.isArray(v)) return v.map(flip);
        if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, flip(x)]));
        return v;
    };
    return flip(b) as FederationBook;
}

describe('the federation book signature', () => {
    it('verifies a book whose keys came back from storage in another order', async () => {
        const keys = await generateKeyPair();
        const signed = book();
        signed.signature = await sign(keys.privateKey, bookSignString(signed));
        const fromStore = reordered(signed);
        expect(Object.keys(fromStore)).not.toEqual(Object.keys(signed));
        expect(await verifyBookSignature(keys.publicKey, fromStore)).toBe(true);
    });

    it('still verifies a book a peer on an earlier version signed the legacy way, in its arrival order', async () => {
        const keys = await generateKeyPair();
        const signed = book();
        signed.signature = await sign(keys.privateKey, legacyBookSignString(signed));
        expect(await verifyBookSignature(keys.publicKey, signed)).toBe(true);
    });

    it('refuses a changed book, a book with no signature, and another key', async () => {
        const keys = await generateKeyPair();
        const other = await generateKeyPair();
        const signed = book();
        signed.signature = await sign(keys.privateKey, bookSignString(signed));
        expect(await verifyBookSignature(keys.publicKey, { ...signed, book_version: 4 })).toBe(false);
        expect(await verifyBookSignature(other.publicKey, signed)).toBe(false);
        const unsigned = { ...signed };
        delete unsigned.signature;
        expect(await verifyBookSignature(keys.publicKey, unsigned)).toBe(false);
        expect(await verifyBookSignature(keys.publicKey, { ...signed, signature: 'not-base64!' })).toBe(false);
    });
});
