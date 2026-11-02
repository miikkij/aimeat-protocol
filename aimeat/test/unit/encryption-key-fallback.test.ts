/**
 * @file test/unit/encryption-key-fallback.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A node that ran on AIMEAT_TOTP_ENCRYPTION_KEY alone (which `aimeat init` sets up) and
 *   is later given AIMEAT_ENCRYPTION_KEY keeps opening every secret it stored before.
 *
 *   WHY. getEncryptionKey() takes AIMEAT_ENCRYPTION_KEY first and the TOTP key only when the first is
 *   unset, and nothing re-encrypts what is stored. Until 2026-11-02 the moment the data key was added,
 *   every AI provider key, MCP server credential, connected account and payment key written under the
 *   TOTP key stopped opening; only the TOTP secrets and secret Config settings tried both keys (IT
 *   adoption review, 2026-11-01; Jouni, 2026-11-02: "korjaa kaikki nämä puutteet").
 *
 *   FIRST FAIL: against encryption.ts v1.1.0, "a value written under the TOTP key opens with the
 *   key getEncryptionKey now returns" throws "Unsupported state or unable to authenticate data" for
 *   both forms, and so does the vault round trip. The other cases hold the edges.
 * @usage pnpm exec vitest run test/unit/encryption-key-fallback.test.ts
 * @version-history
 *   v1.0.0 -- 2026-11-02 -- Initial.
 */
import { describe, it, expect } from 'vitest';
import { encrypt, decrypt, encryptBound, decryptBound, getEncryptionKey } from '../../src/services/encryption.js';
import { putOwnerSecret, resolveSecretForHeaders } from '../../src/services/owner-secrets.js';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import { loadConfig } from '../../src/config.js';

const TOTP_HEX = '0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20';
const DATA_HEX = 'a1a2a3a4a5a6a7a8a9aaabacadaeafb0b1b2b3b4b5b6b7b8b9babbbcbdbebfc0';
const OTHER_HEX = 'f0f1f2f3f4f5f6f7f8f9fafbfcfdfeff000102030405060708090a0b0c0d0e0f';

const before = { encryptionKey: null, totpSecretEncryptionKey: TOTP_HEX };
const after = { encryptionKey: DATA_HEX, totpSecretEncryptionKey: TOTP_HEX };

describe('a secret stored under the TOTP key, after the data key is added', () => {
    it('a value written under the TOTP key opens with the key getEncryptionKey now returns', () => {
        const old = encrypt('sk-or-v1-provider-key', getEncryptionKey(before)!);
        const oldBound = encryptBound('mcp-token', getEncryptionKey(before)!, 'mcp:alice:server-1');
        const key = getEncryptionKey(after)!;
        expect(key.equals(Buffer.from(DATA_HEX, 'hex'))).toBe(true);
        expect(decrypt(old, key)).toBe('sk-or-v1-provider-key');
        expect(decryptBound(oldBound, key, 'mcp:alice:server-1')).toBe('mcp-token');
    });

    it('a new value is written under the data key, and still opens after the TOTP key is removed', () => {
        const fresh = encrypt('new-secret', getEncryptionKey(after)!);
        const dataOnly = getEncryptionKey({ encryptionKey: DATA_HEX, totpSecretEncryptionKey: null })!;
        expect(decrypt(fresh, dataOnly)).toBe('new-secret');
    });

    it('the fallback opens nothing a third key wrote, and a bound value only in its own context', () => {
        const key = getEncryptionKey(after)!;
        expect(() => decrypt(encrypt('x', Buffer.from(OTHER_HEX, 'hex')), key)).toThrow();
        const oldBound = encryptBound('mcp-token', getEncryptionKey(before)!, 'mcp:alice:server-1');
        expect(() => decryptBound(oldBound, key, 'mcp:mallory:server-1')).toThrow();
    });

    it('a node with one key has no fallback: a value under the other key does not open', () => {
        const dataOnly = getEncryptionKey({ encryptionKey: DATA_HEX, totpSecretEncryptionKey: null })!;
        const underOther = encrypt('x', Buffer.from(OTHER_HEX, 'hex'));
        expect(() => decrypt(underOther, dataOnly)).toThrow();
    });

    it('the secrets vault reads a value stored before the data key was added', async () => {
        const base = loadConfig().config;
        const owner = `alice@${base.nodeId}`;
        const storage = new SqliteStorage(':memory:');
        const cfgBefore = { ...base, ...before };
        const cfgAfter = { ...base, ...after };
        expect((await putOwnerSecret(storage as never, cfgBefore, owner, 'API_KEY', 'v-before')).ok).toBe(true);
        const out = await resolveSecretForHeaders({
            storage: storage as never, config: cfgAfter, ownerGhii: owner, extConfig: {}, extName: 'probe',
            headers: { Authorization: 'Bearer {{secret:API_KEY}}' }, url: 'https://api.example.com/x',
            firstUse: async () => ({ allowed: true, by: owner }),
        });
        expect(out).toMatchObject({ ok: true, headers: { Authorization: 'Bearer v-before' } });
    });
});
