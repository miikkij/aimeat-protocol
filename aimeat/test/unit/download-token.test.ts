/**
 * @file download-token.test.ts
 * @description Unit tests for the presigned download-token service (src/services/download-token.ts)
 *   used by the MCP storage_download handle flow (F11). Covers sign/verify roundtrip, expiry,
 *   wrong token type, and garbage input.
 * @version-history
 *   v1.0.0 -- 2026-05-30 -- MCP audit Phase 2 (F11): download-token coverage
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { generateKeyPair, SignJWT } from 'jose';
import {
    initDownloadTokenKeys,
    generateDownloadToken,
    verifyDownloadToken,
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
        const token = await generateDownloadToken({ sub: 'alice@node', key: 'images/cat.png', mimeType: 'image/png', size: 12345 });
        const verified = await verifyDownloadToken(token);
        expect(verified.sub).toBe('alice@node');
        expect(verified.key).toBe('images/cat.png');
        expect(verified.mimeType).toBe('image/png');
        expect(verified.size).toBe(12345);
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
