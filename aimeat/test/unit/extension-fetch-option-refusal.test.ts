/**
 * @file test/unit/extension-fetch-option-refusal.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A ctx.fetch call that is refused for an option it does not know binds no secret.
 *   A vault secret with no host is bound to the host of its first use (resolveOutboundSecrets), so
 *   every refusal ctx.fetch makes must come before that step, as the https check of I16 does. An
 *   unknown `responseType` was refused after it: the call was never sent, and the secret was left
 *   bound to the host the refused call named.
 *   FIRST FAIL: against the tree before this change the secret's hosts are ['refused.example'] after
 *   the refused call.
 * @usage cd aimeat && pnpm exec vitest run test/unit/extension-fetch-option-refusal.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-31 — Initial (secaudit 2026-10-31 inv-19).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AimeatConfig } from '../../src/config.js';
import type { Storage } from '../../src/storage/interface.js';
import type { SecretRecord } from '../../src/storage/types/secrets.js';

vi.mock('../../src/utils/url-validator.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../src/utils/url-validator.js')>();
    return {
        ...actual,
        // No network in a unit test: every address is valid and the far side answers 200.
        validateOutboundUrl: vi.fn(async () => ({ valid: true })),
        safeFetch: vi.fn(async () => new Response('ok', { status: 200, headers: { 'content-type': 'text/plain' } })),
    };
});

const { buildExtensionCtx } = await import('../../src/services/extension-ctx.js');
const { encrypt } = await import('../../src/services/encryption.js');

const KEY_HEX = '0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20';
const config = {
    nodeId: 'node-1', encryptionKey: KEY_HEX, totpSecretEncryptionKey: null,
    extensionMaxMemoryMb: 64, extensionTimeoutMs: 10_000, extensionMaxApiCalls: 10,
} as unknown as AimeatConfig;
const OWNER = 'ada@node-1';

const rows = new Map<string, SecretRecord>();
const storage = {
    getSecret: async (owner: string, name: string) => rows.get(`${owner}/${name}`) ?? null,
    bindSecretHost: async (owner: string, name: string, host: string) => {
        const r = rows.get(`${owner}/${name}`);
        if (r && !r.hosts.length) r.hosts = [host];
        return r?.hosts ?? [];
    },
    noteSecretUse: async () => undefined,
    // The account's "ask before a new address" setting: none stored, so the node default applies.
    getMemory: async () => null,
} as unknown as Storage;

beforeEach(() => {
    const now = new Date().toISOString();
    rows.set(`${OWNER}/TOKEN`, {
        ownerGaii: OWNER, name: 'TOKEN', ciphertext: encrypt('vault-value-1', Buffer.from(KEY_HEX, 'hex')),
        setAt: now, updatedAt: now, usedBy: {}, hosts: [],
    } as SecretRecord);
});

const ctx = () => buildExtensionCtx({
    capabilities: { network: true, ai: false, email: false, payments: false, declared: true },
    config, storage, extMemoryOwner: 'ext:probe',
    caller: { gaii: OWNER, owner: 'ada', roles: ['owner'] }, extConfig: {}, logPrefix: '[ext:probe]',
    extension: { name: 'probe', owner: 'ada' },
});

describe('ctx.fetch: a call refused for its options binds no secret', () => {
    it('an unknown responseType is refused, and the secret it carried stays unbound', async () => {
        const failure = await ctx().fetch('https://refused.example/x', {
            headers: { Authorization: 'Bearer {{secret:TOKEN}}' }, responseType: 'arraybuffer' as never,
        }).then(() => null, (err: Error) => err);
        expect(failure?.message ?? 'ctx.fetch accepted it').toMatch(/^Fetch refused: responseType "arraybuffer"/);
        expect(rows.get(`${OWNER}/TOKEN`)!.hosts, 'the refused call bound the secret').toEqual([]);
    });

    it('the same call with a known responseType goes out and binds the secret to its host, as before', async () => {
        const res = await ctx().fetch('https://api.example/x', {
            headers: { Authorization: 'Bearer {{secret:TOKEN}}' }, responseType: 'base64',
        });
        expect(res.status).toBe(200);
        expect(Buffer.from(res.base64!, 'base64').toString('utf8')).toBe('ok');
        expect(rows.get(`${OWNER}/TOKEN`)!.hosts).toEqual(['api.example']);
    });
});
