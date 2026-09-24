/**
 * @file test/unit/owner-secrets.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The owner's secrets vault, at the three points where getting it wrong is silent.
 *
 *   THE NAME RULE, because a name is an ADDRESS: it is typed by hand into a header as
 *   {{secret:NAME}}, so a name the vault accepts and the placeholder scanner cannot see is a
 *   credential that can be stored and never used, with no error anywhere.
 *
 *   THE ENVELOPE, because nothing reads a value back. If the round trip is wrong, the failure
 *   surfaces as "the far end says 401" days later, on somebody else's machine.
 *
 *   THE HEADER RESOLVER, because it decides what leaves this node. Substituting into a header name,
 *   a URL or a body would put the value somewhere it can be read; half-substituting would send the
 *   word Bearer with nothing after it and let the owner read a 401 as "the service is down".
 *
 *   FIRST FAIL: against the tree before this vault existed, this file cannot import
 *   services/owner-secrets.js — the module is not there. Every assertion below is new behaviour.
 * @usage pnpm test -- owner-secrets
 * @version-history
 *   v1.2.0 — 2026-09-24 — The host binding is made only once the call is accepted: not when a later
 *     name refuses it (7d6c102099f3), not before ctx.fetch has checked the address (919ef5f56d69).
 *     Against an in-memory store; both failed on the old code first.
 *   v1.1.0 — 2026-09-16 — The summary carries `hosts`, the hosts a secret is bound to.
 *   v1.0.0 — 2026-09-06 — Initial.
 */
import { describe, it, expect } from 'vitest';
import {
    SECRET_NAME_RE, SECRET_MAX_BYTES, USED_BY_WINDOW_DAYS,
    toSummary, secretPlaceholderNames, resolveHeaderSecrets, extensionConfigSecrets,
    secretUnknownMessage, putOwnerSecret, listOwnerSecrets, resolveSecretForHeaders,
} from '../../src/services/owner-secrets.js';
import { encrypt, decrypt, getEncryptionKey } from '../../src/services/encryption.js';
import type { SecretRecord } from '../../src/storage/types/secrets.js';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import { buildExtensionCtx } from '../../src/services/extension-ctx.js';
import { loadConfig } from '../../src/config.js';

const KEY_HEX = '0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20';
const key = getEncryptionKey({ encryptionKey: KEY_HEX, totpSecretEncryptionKey: null })!;

describe('the name rule — a secret name is an address, not a label', () => {
    it('accepts what a person types into a header', () => {
        for (const good of ['STRIPE_KEY', 'a', 'A-B_c9', 'x'.repeat(64), '0', '__', '--']) {
            expect(SECRET_NAME_RE.test(good), good).toBe(true);
        }
    });

    it('refuses everything that would not survive being written into one', () => {
        for (const bad of [
            '', 'x'.repeat(65),
            'has space', 'has.dot', 'has:colon', 'has/slash', 'has{brace}',
            'ä', '👍', 'quote"', "apos'", 'semi;colon', 'new\nline', ' leading', 'trailing ',
        ]) {
            expect(SECRET_NAME_RE.test(bad), bad).toBe(false);
        }
    });

    it('is case-sensitive, because the placeholder that names it is', () => {
        expect(SECRET_NAME_RE.test('Token')).toBe(true);
        expect('Token').not.toBe('TOKEN');
    });

    // The trap this closes: the placeholder scanner allows a dot (living-hooks' own secret map
    // always did, and a document written before the vault existed may name `service.key`), and the
    // vault does not. Those two facts are only safe TOGETHER — the scanner must be the wider of the
    // two, so a name it cannot store is still SEEN and refused by name rather than sent literally.
    it('every name the vault accepts is a name the placeholder scanner can see', () => {
        for (const name of ['STRIPE_KEY', 'a', 'A-B_c9', 'x'.repeat(64)]) {
            expect(secretPlaceholderNames({ H: `{{secret:${name}}}` })).toEqual([name]);
        }
    });
});

describe('the envelope — a value goes in, and only the node key opens it', () => {
    it('round-trips the value it was given', () => {
        for (const value of ['sk_live_abc', 'x'.repeat(SECRET_MAX_BYTES), 'ä ö 👍', '{"json":true}']) {
            expect(decrypt(encrypt(value, key), key)).toBe(value);
        }
    });

    it('produces a different ciphertext every time, so two equal secrets do not look equal', () => {
        const a = encrypt('same', key);
        const b = encrypt('same', key);
        expect(a).not.toBe(b);
        expect(decrypt(a, key)).toBe(decrypt(b, key));
    });

    it('carries no plaintext in the stored form', () => {
        const ct = encrypt('zzTOPSECRETzz', key);
        expect(ct).not.toContain('zzTOPSECRETzz');
        expect(/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/.test(ct)).toBe(true);
    });

    it('refuses to open with another node key rather than answering nonsense', () => {
        const other = getEncryptionKey({
            encryptionKey: 'ff'.repeat(32), totpSecretEncryptionKey: null,
        })!;
        expect(() => decrypt(encrypt('secret', key), other)).toThrow();
    });

    it('has no key at all when the node configured none, which is what makes the write refuse', () => {
        expect(getEncryptionKey({ encryptionKey: null, totpSecretEncryptionKey: null })).toBeNull();
        // A short key is not a key either: a 16-byte value would be a silently weaker cipher.
        expect(getEncryptionKey({ encryptionKey: 'aa'.repeat(16), totpSecretEncryptionKey: null })).toBeNull();
    });
});

describe('the summary — what a caller may know', () => {
    const record = (usedBy: Record<string, string>): SecretRecord => ({
        ownerGaii: 'alice@node', name: 'TOKEN', ciphertext: encrypt('v', key),
        setAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-02-01T00:00:00.000Z', usedBy, hosts: ['api.example.com'],
    });
    const now = Date.parse('2026-09-06T00:00:00.000Z');
    const daysAgo = (d: number) => new Date(now - d * 24 * 60 * 60 * 1000).toISOString();

    it('never carries the value or the ciphertext', () => {
        const s = toSummary(record({}), now);
        expect(JSON.stringify(s)).not.toContain(record({}).ciphertext);
        // `hosts` names where the value may go, which the owner needs to see; it carries no value.
        expect(Object.keys(s).sort()).toEqual(['hosts', 'name', 'setAt', 'updatedAt', 'usedBy']);
        expect(s.hosts).toEqual(['api.example.com']);
    });

    it('reports the extensions that used it inside the window, most recent first', () => {
        const s = toSummary(record({ 'living-hooks': daysAgo(1), weather: daysAgo(10) }), now);
        expect(s.usedBy).toEqual(['living-hooks', 'weather']);
    });

    it('drops a use older than the window, so the list says who is using it NOW', () => {
        const s = toSummary(record({
            recent: daysAgo(USED_BY_WINDOW_DAYS - 1),
            stale: daysAgo(USED_BY_WINDOW_DAYS + 1),
        }), now);
        expect(s.usedBy).toEqual(['recent']);
    });

    it('survives a malformed stamp instead of failing the whole list', () => {
        expect(toSummary(record({ broken: 'not a date' }), now).usedBy).toEqual([]);
    });
});

describe('secretPlaceholderNames — where a placeholder counts', () => {
    it('finds every distinct name in the header VALUES, in first-seen order', () => {
        expect(secretPlaceholderNames({
            Authorization: 'Bearer {{secret:TOKEN}}',
            'X-Api-Key': '{{secret:KEY}}-{{secret:TOKEN}}',
        })).toEqual(['TOKEN', 'KEY']);
    });

    it('finds nothing in a header NAME, so a placeholder cannot build a header nobody declared', () => {
        expect(secretPlaceholderNames({ '{{secret:EVIL}}': 'v' })).toEqual([]);
    });

    it('finds nothing when there is nothing, which is what keeps an ordinary fetch free', () => {
        expect(secretPlaceholderNames({ Accept: 'application/json' })).toEqual([]);
        expect(secretPlaceholderNames(undefined)).toEqual([]);
        expect(secretPlaceholderNames({})).toEqual([]);
    });

    it('ignores a malformed placeholder rather than guessing what was meant', () => {
        expect(secretPlaceholderNames({
            A: '{{ secret:X }}', B: '{{secret:}}', C: '{secret:X}', D: `{{secret:${'x'.repeat(65)}}}`,
        })).toEqual([]);
    });
});

describe('resolveHeaderSecrets — the substitution itself', () => {
    const vault = (m: Record<string, string>) => (n: string) => m[n];

    it('substitutes into the value and leaves everything else alone', () => {
        const out = resolveHeaderSecrets(
            { Authorization: 'Bearer {{secret:T}}', Accept: 'application/json' },
            vault({ T: 's3cret' }),
        );
        expect(out).toEqual({ ok: true, headers: { Authorization: 'Bearer s3cret', Accept: 'application/json' } });
    });

    it('substitutes several names in one value, and the same name twice', () => {
        const out = resolveHeaderSecrets({ H: '{{secret:A}}/{{secret:B}}/{{secret:A}}' }, vault({ A: '1', B: '2' }));
        expect(out.ok && out.headers.H).toBe('1/2/1');
    });

    it('refuses BY NAME rather than sending half a credential', () => {
        const out = resolveHeaderSecrets(
            { Authorization: 'Bearer {{secret:MISSING}}' },
            vault({ OTHER: 'zzTOPSECRETzz' }),
        );
        expect(out.ok).toBe(false);
        expect(!out.ok && out.missing).toBe('MISSING');
        expect(JSON.stringify(out)).not.toContain('zzTOPSECRETzz');
    });

    it('treats an empty stored value as not set: an empty Bearer is a 401 nobody can diagnose', () => {
        expect(resolveHeaderSecrets({ H: '{{secret:E}}' }, vault({ E: '' })).ok).toBe(false);
    });

    it('names the FIRST missing secret, so the message is about one thing', () => {
        const out = resolveHeaderSecrets({ H: '{{secret:A}}{{secret:B}}' }, vault({}));
        expect(!out.ok && out.missing).toBe('A');
    });

    it('passes headers with no placeholder through byte for byte', () => {
        const headers = { Accept: 'application/json', 'X-Living-Doc': 'a{b}c' };
        expect(resolveHeaderSecrets(headers, vault({}))).toEqual({ ok: true, headers });
    });
});

describe('the extension config fallback', () => {
    it('reads the one encrypted JSON string the manifest allows', () => {
        expect(extensionConfigSecrets({ secrets: '{"KEY":"abc"}' })).toEqual({ KEY: 'abc' });
        expect(extensionConfigSecrets({ secrets: { KEY: 'abc' } })).toEqual({ KEY: 'abc' });
    });

    it('answers an empty map for anything unreadable, so the placeholder refuses by name', () => {
        for (const raw of ['not json', '[1,2]', '', null, undefined, 42]) {
            expect(extensionConfigSecrets({ secrets: raw })).toEqual({});
        }
        expect(extensionConfigSecrets(undefined)).toEqual({});
        expect(extensionConfigSecrets({})).toEqual({});
    });
});

describe('the refusal words', () => {
    it('name the header and the secret, and say where to fix it', () => {
        const msg = secretUnknownMessage('Authorization', 'STRIPE_KEY');
        expect(msg).toContain('Authorization');
        expect(msg).toContain('STRIPE_KEY');
        expect(msg).toContain('aimeat_secret_set');
    });
});

// A vault secret is bound to the host of its first use, and a bound secret goes nowhere else. So
// binding is a WRITE that a refused call must not make: bound to a host that received nothing, the
// secret then refuses the owner's real host until they store the value again. It was made inside
// the per-name loop, before a later name refused the call (7d6c102099f3), and before ctx.fetch
// checked the address it would send to (919ef5f56d69). Against a real store, in memory.
describe('the host binding — made only once the call is accepted', () => {
    const cfg = { ...loadConfig().config, encryptionKey: KEY_HEX };
    const owner = `alice@${cfg.nodeId}`;
    const hostsOf = async (storage: SqliteStorage, name: string) =>
        (await listOwnerSecrets(storage as never, owner)).find(s => s.name === name)?.hosts;
    const resolve = (storage: SqliteStorage, headers: Record<string, string>, url: string) => resolveSecretForHeaders({
        storage: storage as never, config: cfg, ownerGhii: owner, extConfig: {}, extName: 'probe', headers, url,
    });

    it('binds nothing when a later name in the same call refuses it', async () => {
        const storage = new SqliteStorage(':memory:');
        expect((await putOwnerSecret(storage as never, cfg, owner, 'FIRST', 'first-value')).ok).toBe(true);
        const out = await resolve(storage, { 'X-First': '{{secret:FIRST}}', 'X-Missing': '{{secret:NOT_SET}}' }, 'https://api.example.com/x');
        expect(out).toMatchObject({ ok: false, reason: 'unknown', secretName: 'NOT_SET' });
        expect(await hostsOf(storage, 'FIRST')).toEqual([]);
        // …and the call that IS accepted binds it, to the host it goes to.
        expect((await resolve(storage, { 'X-First': '{{secret:FIRST}}' }, 'https://api.example.com/x')).ok).toBe(true);
        expect(await hostsOf(storage, 'FIRST')).toEqual(['api.example.com']);
    });

    it('ctx.fetch binds nothing to an address it refuses to reach', async () => {
        const storage = new SqliteStorage(':memory:');
        expect((await putOwnerSecret(storage as never, cfg, owner, 'SECOND', 'second-value')).ok).toBe(true);
        const ctx = buildExtensionCtx({
            config: cfg, storage: storage as never, extMemoryOwner: 'ext:probe',
            caller: { gaii: owner, owner: 'alice', roles: ['owner'] } as never, extConfig: {}, logPrefix: 'test',
        });
        await expect(ctx.fetch('http://169.254.169.254/latest/meta-data/', { headers: { Authorization: 'Bearer {{secret:SECOND}}' } }))
            .rejects.toThrow(/Fetch blocked/);
        expect(await hostsOf(storage, 'SECOND')).toEqual([]);
    });
});
