/**
 * @file download-token.test.ts
 * @description Unit tests for the presigned download-token service (src/services/download-token.ts)
 *   used by the MCP storage_download handle flow (F11). Covers sign/verify roundtrip, expiry,
 *   wrong token type, and garbage input.
 * @version-history
 *   v1.2.0 -- 2026-10-21 -- A token without a version (minted before 2026-10-20) is served as before
 *     until it expires; a version claim that is not a string is refused.
 *   v1.1.0 -- 2026-10-20 -- The token names the file version; a token without one is refused, and
 *     servesFileVersion compares createdAt as an instant plus the size.
 *   v1.0.0 -- 2026-05-30 -- MCP audit Phase 2 (F11): download-token coverage
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { generateKeyPair, SignJWT } from 'jose';
import {
    initDownloadTokenKeys,
    generateDownloadToken,
    verifyDownloadToken,
    servesFileVersion,
    DownloadTokenError,
} from '../../src/services/download-token.js';

let privateKey: CryptoKey;

beforeAll(async () => {
    const kp = await generateKeyPair('EdDSA', { extractable: true });
    privateKey = kp.privateKey as CryptoKey;
    initDownloadTokenKeys(kp.privateKey as CryptoKey, kp.publicKey as CryptoKey);
});

describe('download-token', () => {
    it('signs and verifies a token, round-tripping the file reference', async () => {
        const token = await generateDownloadToken({ sub: 'alice@node', key: 'images/cat.png', mimeType: 'image/png', size: 12345, version: '2026-10-20T10:00:00.123Z' });
        const verified = await verifyDownloadToken(token);
        expect(verified.sub).toBe('alice@node');
        expect(verified.key).toBe('images/cat.png');
        expect(verified.mimeType).toBe('image/png');
        expect(verified.size).toBe(12345);
        expect(verified.version).toBe('2026-10-20T10:00:00.123Z');
    });

    it('accepts a token that names no file version (minted before 2026-10-20), and it serves whatever the key holds, as before', async () => {
        const old = await new SignJWT({ typ: 'download', key: 'k', mimeType: 'text/plain', size: 1 })
            .setProtectedHeader({ alg: 'EdDSA', typ: 'JWT' })
            .setSubject('alice@node')
            .setIssuedAt()
            .setExpirationTime('1h')
            .sign(privateKey);
        const verified = await verifyDownloadToken(old);
        expect(verified.key).toBe('k');
        expect(verified.version).toBeUndefined();
        expect(servesFileVersion(verified, { createdAt: '2026-10-21T08:00:00.000Z', size: 99 })).toBe(true);
    });

    it('refuses a token whose version claim is not a string', async () => {
        const odd = await new SignJWT({ typ: 'download', key: 'k', mimeType: 'text/plain', size: 1, ver: 7 })
            .setProtectedHeader({ alg: 'EdDSA', typ: 'JWT' })
            .setSubject('alice@node')
            .setIssuedAt()
            .setExpirationTime('1h')
            .sign(privateKey);
        await expect(verifyDownloadToken(odd)).rejects.toMatchObject({ code: 'TOKEN_INVALID' });
    });

    it('servesFileVersion: the same createdAt and size only', () => {
        const v = { version: '2026-10-20T10:00:00.123Z', size: 5 };
        expect(servesFileVersion(v, { createdAt: '2026-10-20T10:00:00.123Z', size: 5 })).toBe(true);
        // One instant spelt another way (a backend's offset form) is the same version.
        expect(servesFileVersion(v, { createdAt: '2026-10-20T12:00:00.123+02:00', size: 5 })).toBe(true);
        expect(servesFileVersion(v, { createdAt: '2026-10-20T10:00:00.124Z', size: 5 })).toBe(false);
        expect(servesFileVersion(v, { createdAt: '2026-10-20T10:00:00.123Z', size: 6 })).toBe(false);
    });

    it('rejects an expired token with TOKEN_EXPIRED', async () => {
        const now = Math.floor(Date.now() / 1000);
        const expired = await new SignJWT({ typ: 'download', key: 'k', mimeType: 'text/plain', size: 1 })
            .setProtectedHeader({ alg: 'EdDSA', typ: 'JWT' })
            .setSubject('alice@node')
            .setIssuedAt(now - 100)
            .setExpirationTime(now - 10)
            .sign(privateKey);
        await expect(verifyDownloadToken(expired)).rejects.toMatchObject({ code: 'TOKEN_EXPIRED' });
    });

    it('rejects a token whose typ is not "download"', async () => {
        const wrongType = await new SignJWT({ typ: 'upload', key: 'k', mimeType: 'text/plain', size: 1 })
            .setProtectedHeader({ alg: 'EdDSA', typ: 'JWT' })
            .setSubject('alice@node')
            .setIssuedAt()
            .setExpirationTime('1h')
            .sign(privateKey);
        await expect(verifyDownloadToken(wrongType)).rejects.toMatchObject({ code: 'TOKEN_INVALID' });
    });

    it('rejects garbage input with TOKEN_INVALID', async () => {
        await expect(verifyDownloadToken('not-a-jwt')).rejects.toBeInstanceOf(DownloadTokenError);
    });
});
