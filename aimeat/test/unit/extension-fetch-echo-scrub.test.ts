/**
 * @file test/unit/extension-fetch-echo-scrub.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What an extension can learn of a secret it sends: nothing, even from a host that
 *   echoes the request back.
 *
 *   WHAT THIS PINS (secrets audit 2026-10-09, item 10). ctx.fetch fills `{{secret:NAME}}` from the
 *   owner's vault, and in a provider run adds the owner's AI key, on the host side of the sandbox, so
 *   the script never holds either. The response then went back to the script as it arrived. A host
 *   that echoes the request headers (a debug endpoint, an error page quoting "invalid key sk-…")
 *   handed the script the value it was never meant to hold, and the script could write it to its
 *   world-readable `ext:` namespace.
 *
 *   Every value the node put into the request is now replaced in the body and the headers before
 *   either reaches the script: the value itself, its base64 and base64url forms, its URL-encoded form,
 *   its JSON-escaped form, and the base64 of each whole header value that carried it (the shape of a
 *   Basic credential).
 *
 *   THE ECHO SERVER is a real HTTP server on 127.0.0.1. safeFetch refuses a private address, so the
 *   test replaces it with a plain fetch, the way outbound-read-cap.test.ts replaces it with a recorder;
 *   everything between the sandbox and safeFetch is the real code.
 * @usage cd aimeat && pnpm exec vitest run test/unit/extension-fetch-echo-scrub.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-09 — Initial (secrets audit 2026-10-09, item 10).
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { AimeatConfig } from '../../src/config.js';
import type { Storage } from '../../src/storage/interface.js';
import type { SecretRecord } from '../../src/storage/types/secrets.js';

vi.mock('../../src/utils/url-validator.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../src/utils/url-validator.js')>();
    return {
        ...actual,
        // The echo server is on 127.0.0.1, which the real checks refuse. Everything else is real.
        validateOutboundUrl: vi.fn(async () => ({ valid: true })),
        safeFetch: vi.fn(async (url: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) =>
            fetch(url, { method: init.method, headers: init.headers, body: init.body })),
    };
});

const { buildExtensionCtx } = await import('../../src/services/extension-ctx.js');
const { encrypt } = await import('../../src/services/encryption.js');

const KEY_HEX = '0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20';
const config = {
    nodeId: 'node-1', encryptionKey: KEY_HEX, totpSecretEncryptionKey: null,
    extensionMaxMemoryMb: 64, extensionTimeoutMs: 10_000, extensionMaxApiCalls: 10,
} as unknown as AimeatConfig;
const VAULT_VALUE = 'vault-secret-Value+/=&"x';
const PROVIDER_KEY = 'sk-owner-provider-key-QQ7';
const OWNER = 'ada@node-1';

/** One vault row, unbound, and the storage calls resolveSecretForHeaders makes. */
const rows = new Map<string, SecretRecord>();
const storage = {
    getSecret: async (owner: string, name: string) => rows.get(`${owner}/${name}`) ?? null,
    bindSecretHost: async (owner: string, name: string, host: string) => {
        const r = rows.get(`${owner}/${name}`);
        if (r && !r.hosts.length) r.hosts = [host];
        return r?.hosts ?? [];
    },
    noteSecretUse: async () => undefined,
} as unknown as Storage;

/** The echo server: the request headers and body, back in the body and in response headers. */
let server: Server;
let base = '';
beforeAll(async () => {
    server = createServer((req, res) => {
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => {
            const auth = String(req.headers.authorization ?? '');
            res.writeHead(200, {
                'Content-Type': 'application/json',
                'X-Echo-Authorization': auth,
                'X-Echo-B64': Buffer.from(auth).toString('base64'),
            });
            res.end(JSON.stringify({
                headers: req.headers,
                body,
                quoted: `invalid key ${auth.replace(/^Bearer /, '')}`,
                encoded: encodeURIComponent(auth.replace(/^Bearer /, '')),
                b64: Buffer.from(auth.replace(/^Bearer /, '')).toString('base64'),
                b64url: Buffer.from(auth.replace(/^Bearer /, '')).toString('base64url'),
                wholeHeaderB64: Buffer.from(auth).toString('base64'),
            }));
        });
    });
    // Every address of this machine, so the provider case can reach it as localhost on IPv4 or IPv6.
    await new Promise<void>((resolve) => server.listen(0, () => resolve()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const now = new Date().toISOString();
    rows.set(`${OWNER}/TOKEN`, {
        ownerGaii: OWNER, name: 'TOKEN', ciphertext: encrypt(VAULT_VALUE, Buffer.from(KEY_HEX, 'hex')),
        setAt: now, updatedAt: now, usedBy: {}, hosts: [],
    } as SecretRecord);
});
afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });

const ctxWith = (providerCall?: Parameters<typeof buildExtensionCtx>[0]['providerCall']) => buildExtensionCtx({
    capabilities: { network: true, ai: true, email: true, payments: true, declared: true },
    config, storage, extMemoryOwner: 'ext:echo-probe',
    caller: { gaii: OWNER, owner: 'ada', roles: ['owner'] }, extConfig: {}, logPrefix: '[ext:echo-probe]',
    extension: { name: 'echo-probe', owner: 'ada' },
    ...(providerCall ? { providerCall } : {}),
});

/** Every form of `v` a script could decode back into the value. */
const formsOf = (v: string): string[] => [
    v, encodeURIComponent(v), Buffer.from(v).toString('base64'), Buffer.from(v).toString('base64url'),
    JSON.stringify(v).slice(1, -1),
];

describe('ctx.fetch: a value the node put into a request does not come back to the script', () => {
    it('a vault secret echoed in the body and the headers reaches the script as a placeholder', async () => {
        const res = await ctxWith().fetch(`${base}/echo`, {
            method: 'POST', headers: { Authorization: 'Bearer {{secret:TOKEN}}' }, body: '{"q":1}',
        });
        expect(res.status).toBe(200);
        const seen = res.text + JSON.stringify(res.headers);
        for (const form of [...formsOf(VAULT_VALUE), Buffer.from(`Bearer ${VAULT_VALUE}`).toString('base64')]) {
            expect(seen, `the script received the form ${form}`).not.toContain(form);
        }
        expect(res.text).toContain('[redacted]');
        // The rest of the answer is untouched.
        expect(JSON.parse(res.text).body).toBe('{"q":1}');
    });

    it("the owner's provider key echoed back in a provider run reaches the script as a placeholder", async () => {
        // An injected key travels over plain http only to localhost, so the echo is reached by that name.
        const res = await ctxWith({ hosts: ['localhost'], inject: { name: 'Authorization', value: `Bearer ${PROVIDER_KEY}` } })
            .fetch(`http://localhost:${new URL(base).port}/echo`, { method: 'POST', body: '{}' });
        expect(res.status).toBe(200);
        const seen = res.text + JSON.stringify(res.headers);
        for (const form of [...formsOf(PROVIDER_KEY), Buffer.from(`Bearer ${PROVIDER_KEY}`).toString('base64')]) {
            expect(seen, `the script received the form ${form}`).not.toContain(form);
        }
    });

    it('an answer that carries no secret reaches the script unchanged', async () => {
        const res = await ctxWith().fetch(`${base}/echo`, { method: 'POST', headers: { 'X-Plain': 'hello' }, body: 'abc' });
        const parsed = JSON.parse(res.text) as { headers: Record<string, string>; body: string };
        expect(parsed.headers['x-plain']).toBe('hello');
        expect(parsed.body).toBe('abc');
        expect(res.text).not.toContain('[redacted]');
    });
});
