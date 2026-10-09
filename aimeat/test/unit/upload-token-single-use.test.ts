/**
 * @file test/unit/upload-token-single-use.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An upload token is spent once, whichever process of the node sees it first.
 *
 *   WHAT THIS PINS (secrets audit 2026-10-09, S-7). The spent set lived in a Map in the process, so
 *   after a restart, or on a second process over the same database, a used token uploaded again
 *   for the rest of its sixty minutes. The spend is a row in the revoked-token table now, keyed to
 *   the token's own id and kept until the token's expiry, which the table's sweep then removes.
 *
 *   "Another process" is a fresh copy of the module (vi.resetModules) over the same storage, as
 *   test/unit/token-revocation.test.ts models a second process. The token is the raw JWT, because a
 *   short handle is known only to the process that minted it and the JWT is what replays.
 * @usage cd aimeat && pnpm exec vitest run test/unit/upload-token-single-use.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-09 — Initial (secrets audit 2026-10-09, S-7).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { SignJWT, generateKeyPair } from 'jose';
import type { Storage } from '../../src/storage/interface.js';

type UploadTokens = typeof import('../../src/services/upload-token.js');

/** The revoked-token table in miniature, shared by every "process" as one database is. */
const rows = new Map<string, number>();
const store = {
    revokeTokenIfAbsent: async (hash: string, expiresAt: number) => {
        if (rows.has(hash)) return false;
        rows.set(hash, expiresAt);
        return true;
    },
    isTokenRevoked: async (hash: string) => rows.has(hash),
} as unknown as Storage;

let privateKey: CryptoKey;
let publicKey: CryptoKey;

async function aProcess(): Promise<UploadTokens> {
    vi.resetModules();
    const mod = await import('../../src/services/upload-token.js');
    mod.initUploadTokenKeys(privateKey, publicKey);
    return mod;
}

/** A raw upload JWT, as services/upload-token.ts signs one. */
const mint = (jti: string) => new SignJWT({ typ: 'upload', utype: 'storage', meta: {}, maxBytes: 10, contentType: 'text/plain' })
    .setProtectedHeader({ alg: 'EdDSA', typ: 'JWT' }).setJti(jti).setSubject('ada@node').setIssuedAt().setExpirationTime('1h')
    .sign(privateKey);

beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const kp = await generateKeyPair('EdDSA', { extractable: true });
    privateKey = kp.privateKey as CryptoKey;
    publicKey = kp.publicKey as CryptoKey;
});
afterAll(() => { vi.useRealTimers(); });

describe('an upload token is single-use across processes', () => {
    it('a token spent on one process is refused on another', async () => {
        const token = await mint('u-cross-1');
        const first = await aProcess();
        expect((await first.verifyUploadToken(token, store)).sub).toBe('ada@node');
        const second = await aProcess();
        await expect(second.verifyUploadToken(token, store)).rejects.toMatchObject({ code: 'TOKEN_USED' });
    });

    it('a token spent before a restart is refused after it', async () => {
        const token = await mint('u-restart-1');
        await (await aProcess()).verifyUploadToken(token, store);
        const restarted = await aProcess();
        await expect(restarted.verifyUploadToken(token, store)).rejects.toMatchObject({ code: 'TOKEN_USED' });
    });

    it('the spend row lasts as long as the token and no longer', async () => {
        const token = await mint('u-expiry-1');
        const before = rows.size;
        await (await aProcess()).verifyUploadToken(token, store);
        expect(rows.size).toBe(before + 1);
        const exp = (JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()) as { exp: number }).exp;
        expect([...rows.values()].pop()).toBe(exp);
    });

    it('a different token is not refused by another one\'s spend', async () => {
        const p = await aProcess();
        await p.verifyUploadToken(await mint('u-own-a'), store);
        expect((await p.verifyUploadToken(await mint('u-own-b'), store)).sub).toBe('ada@node');
    });

    it('a token that does not verify spends nothing', async () => {
        const before = rows.size;
        const token = await mint('u-bad-1');
        const tampered = `${token.slice(0, -6)}AAAAAA`;
        await expect((await aProcess()).verifyUploadToken(tampered, store)).rejects.toMatchObject({ code: 'TOKEN_INVALID' });
        expect(rows.size).toBe(before);
    });
});
