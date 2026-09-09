/**
 * @file test/unit/fake-push-der.test.ts
 * @description The DER INTEGER encoder behind the fake push receiver's self-signed certificate.
 *
 *   WHY A UNIT TEST AND NOT A CERTIFICATE. The certificate's serial is eight random bytes, and the
 *   encoding was wrong only when the first of them was 0x00 and the second under 0x80 — about one
 *   run in five hundred. e2e-mailbox-push died on it on the nightly sweep of 2026-09-09 with
 *   `error:068000DD:asn1 encoding routines::illegal padding`, 0 of 1, in 0.29 seconds, having
 *   started nothing. Proving that by generating certificates would take thousands of key pairs and
 *   still be a coin toss, so the encoder is exported and the inputs are named.
 * @usage cd aimeat && pnpm test -- fake-push-der
 * @version-history
 *   v1.0.0 — 2026-09-09 — Initial, with the minimal-encoding fix.
 */
import { describe, it, expect } from 'vitest';
import { X509Certificate } from 'node:crypto';
import { derInt, selfSignedLoopbackCert } from '../helpers/fake-push.js';

const hex = (b: Buffer) => b.toString('hex');

describe('derInt', () => {
    it('drops a leading zero the next byte does not need', () => {
        // The case that broke the suite: 02 08 00 01 … is not minimal, and OpenSSL refuses it.
        expect(hex(derInt(Buffer.from([0x00, 0x01, 0x02, 0x03])))).toBe('0203010203');
        expect(hex(derInt(Buffer.from([0x00, 0x00, 0x7f])))).toBe('02017f');
    });

    it('keeps the leading zero when the next byte does need it', () => {
        expect(hex(derInt(Buffer.from([0x00, 0x80])))).toBe('02020080');
        expect(hex(derInt(Buffer.from([0x00, 0xff, 0x01])))).toBe('020300ff01');
    });

    it('adds a leading zero to a value that would otherwise read as negative', () => {
        expect(hex(derInt(Buffer.from([0x80])))).toBe('02020080');
        expect(hex(derInt(Buffer.from([0xff, 0x00])))).toBe('020300ff00');
    });

    it('leaves an ordinary value alone, and encodes zero as one byte', () => {
        expect(hex(derInt(Buffer.from([0x02])))).toBe('020102');
        expect(hex(derInt(Buffer.from([0x00])))).toBe('020100');
    });
});

describe('selfSignedLoopbackCert', () => {
    it('produces a certificate Node will parse, for 127.0.0.1', () => {
        const { cert } = selfSignedLoopbackCert();
        const x509 = new X509Certificate(cert);
        expect(x509.subjectAltName).toContain('127.0.0.1');
    });
});
