/**
 * @file extension-secrets.test.ts
 * @description Guards the write-side of extension secret config. A manifest field declared
 *   `type: secret` must never reach storage as plaintext, whichever path installed the extension.
 *   The MCP install tool used to skip this entirely: it built the record inline, omitted the
 *   __secretKeys marker and wrote config straight to storage, so the value was persisted in the
 *   clear and served by the unauthenticated GET /v1/extensions/:name (whose mask only covers
 *   encrypted values). These tests pin the shared helper both paths now go through.
 * @usage pnpm test
 * @version-history
 *   v1.1.0 - 2026-10-09 - Every call names the binding; the binding itself, the deep strip and the
 *     legacy rewrite are pinned (secrets audit 2026-10-09, finding 1.1).
 *   v1.0.0 - 2026-07-26 - Added with the MCP secret-config fix.
 */
import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import {
    SECRET_KEYS_FIELD,
    computeManifestSecretKeys,
    isEncryptedValue,
    maskSecretFields,
    decryptSecretFields,
    encryptSecretFields,
    prepareSecretConfigForWrite,
    stripClientEncryptedValues,
    rebindLegacySecretFields,
    secretContext,
    SECRET_MASK,
} from '../../src/services/extension-secrets.js';
import { encrypt, encryptBound, decryptBound, isBoundCiphertext } from '../../src/services/encryption.js';

const KEY = randomBytes(32);
const B = { extension: 'ext-a' };

/** A config as the manifest builders produce it: descriptors flattened to their `default`, plus the marker. */
function builtConfig(secretValue?: string): Record<string, unknown> {
    return {
        base_url: 'https://example.invalid',
        ...(secretValue === undefined ? {} : { api_key: secretValue }),
        [SECRET_KEYS_FIELD]: ['api_key'],
    };
}

describe('computeManifestSecretKeys', () => {
    it('picks up a descriptor declared type: secret', () => {
        expect(computeManifestSecretKeys({
            base_url: 'https://example.invalid',
            api_key: { type: 'secret', default: 'plaintext', description: 'a key' },
        })).toEqual(['api_key']);
    });

    it('ignores plain values and other descriptor types', () => {
        expect(computeManifestSecretKeys({
            base_url: 'https://example.invalid',
            retries: { type: 'number', default: 3 },
        })).toEqual([]);
    });
});

describe('prepareSecretConfigForWrite', () => {
    it('encrypts a plaintext secret so it never reaches storage in the clear', () => {
        const out = prepareSecretConfigForWrite(builtConfig('super-secret-value'), undefined, KEY, B);
        expect(out).not.toBeNull();
        expect(isEncryptedValue(out!.api_key)).toBe(true);
        expect(JSON.stringify(out)).not.toContain('super-secret-value');
    });

    it('round-trips back to the plaintext the sandbox needs', () => {
        const stored = prepareSecretConfigForWrite(builtConfig('super-secret-value'), undefined, KEY, B)!;
        const forVm = decryptSecretFields(stored, ['api_key'], KEY, B);
        expect(forVm.api_key).toBe('super-secret-value');
        expect(forVm[SECRET_KEYS_FIELD]).toBeUndefined();
    });

    it('refuses rather than storing plaintext when the node has no encryption key', () => {
        expect(prepareSecretConfigForWrite(builtConfig('super-secret-value'), undefined, null, B)).toBeNull();
    });

    it('leaves a config with no declared secrets untouched', () => {
        const plain = { base_url: 'https://example.invalid' };
        expect(prepareSecretConfigForWrite(plain, undefined, KEY, B)).toEqual(plain);
    });

    it('carries an existing secret forward when the incoming manifest omits it', () => {
        const existing = prepareSecretConfigForWrite(builtConfig('original-value'), undefined, KEY, B)!;
        const reinstalled = prepareSecretConfigForWrite(builtConfig(), existing, KEY, B)!;
        expect(decryptSecretFields(reinstalled, ['api_key'], KEY, B).api_key).toBe('original-value');
    });

    it('carries an existing secret forward when the mask is submitted back', () => {
        const existing = prepareSecretConfigForWrite(builtConfig('original-value'), undefined, KEY, B)!;
        const reinstalled = prepareSecretConfigForWrite(builtConfig(SECRET_MASK), existing, KEY, B)!;
        expect(decryptSecretFields(reinstalled, ['api_key'], KEY, B).api_key).toBe('original-value');
    });
});

/**
 * An unset secret has to read as ABSENT in the sandbox. A manifest field declared `type: secret`
 * with no `default` used to be stored as its own descriptor object, and a mask submitted on a first
 * install was stored as the mask string, so `if (ctx.config.apiKey)` passed and the extension sent
 * "Bearer [object Object]" or "Bearer ••••••••" upstream (appdev pitfall
 * ext/unset-secret-config-reads-back-as-mask, 2026-09-13).
 */
describe('an unset secret reads as undefined', () => {
    it('a descriptor with no default does not reach the sandbox as an object', () => {
        const incoming = { apiKey: { type: 'secret', description: 'upstream key' }, [SECRET_KEYS_FIELD]: ['apiKey'] };
        const stored = prepareSecretConfigForWrite(incoming, undefined, KEY, B)!;
        expect(decryptSecretFields(stored, ['apiKey'], KEY, B).apiKey).toBeUndefined();
        expect('apiKey' in decryptSecretFields(stored, ['apiKey'], KEY, B)).toBe(false);
    });

    it('the mask submitted on a first install is not stored as a value', () => {
        const stored = prepareSecretConfigForWrite({ apiKey: SECRET_MASK, [SECRET_KEYS_FIELD]: ['apiKey'] }, undefined, KEY, B)!;
        expect(stored.apiKey).toBeUndefined();
        expect(decryptSecretFields(stored, ['apiKey'], KEY, B).apiKey).toBeUndefined();
    });

    it('a record already stored with a descriptor, the mask or an empty string reads as unset, with no migration', () => {
        for (const bad of [{ type: 'secret' }, SECRET_MASK, '']) {
            const forVm = decryptSecretFields({ apiKey: bad, other: 'kept', [SECRET_KEYS_FIELD]: ['apiKey'] }, ['apiKey'], KEY, B);
            expect(forVm.apiKey, JSON.stringify(bad)).toBeUndefined();
            expect(forVm.other).toBe('kept');
        }
    });

    it('an encrypted secret on a node with no key reads as unset rather than as an empty string', () => {
        const stored = prepareSecretConfigForWrite(builtConfig('super-secret-value'), undefined, KEY, B)!;
        expect('api_key' in decryptSecretFields(stored, ['api_key'], null, B)).toBe(false);
    });

    it('a re-install that declares the field without a value still keeps the stored secret', () => {
        const existing = prepareSecretConfigForWrite(builtConfig('original-value'), undefined, KEY, B)!;
        const incoming = { base_url: 'https://example.invalid', api_key: { type: 'secret' }, [SECRET_KEYS_FIELD]: ['api_key'] };
        const reinstalled = prepareSecretConfigForWrite(incoming, existing, KEY, B)!;
        expect(decryptSecretFields(reinstalled, ['api_key'], KEY, B).api_key).toBe('original-value');
    });

    it('the record read shows an unset secret as absent, not as a mask that claims it is set', () => {
        const shown = maskSecretFields({ apiKey: { type: 'secret' }, other: SECRET_MASK, [SECRET_KEYS_FIELD]: ['apiKey', 'other'] }, ['apiKey', 'other']);
        expect('apiKey' in shown).toBe(false);
        expect('other' in shown).toBe(false);
    });
});

describe('maskSecretFields', () => {
    it('masks a stored secret for any API surface', () => {
        const stored = prepareSecretConfigForWrite(builtConfig('super-secret-value'), undefined, KEY, B)!;
        const shown = maskSecretFields(stored, ['api_key']);
        expect(shown.api_key).toBe(SECRET_MASK);
        expect(shown[SECRET_KEYS_FIELD]).toBeUndefined();
        expect(JSON.stringify(shown)).not.toContain('super-secret-value');
    });

    it('cannot rescue a value that was stored in the clear, which is why the write side must encrypt', () => {
        // The exact failure this file exists to prevent: mask only covers { encrypted } wrappers, so a
        // plaintext secret that slipped past the write path is served verbatim.
        const leaked = maskSecretFields({ api_key: 'plaintext-that-slipped-through' }, ['api_key']);
        expect(leaked.api_key).toBe('plaintext-that-slipped-through');
    });
});

/**
 * Secrets audit 2026-10-09, finding 1.1: the owner's AI-key ciphertext left through a route that did
 * not mask it, and a manifest descriptor's `default` or a package install's config carried it into a
 * secret field, where the node decrypted it for the planter's script. A value now opens only in the
 * field it was encrypted for.
 */
describe('a secret opens only where it was encrypted', () => {
    it('a value bound to one extension does not open in another', () => {
        const stored = prepareSecretConfigForWrite(builtConfig('owned-by-a'), undefined, KEY, B)!;
        expect(decryptSecretFields(stored, ['api_key'], KEY, B).api_key).toBe('owned-by-a');
        expect('api_key' in decryptSecretFields(stored, ['api_key'], KEY, { extension: 'ext-b' })).toBe(false);
        expect('api_key' in decryptSecretFields(stored, ['api_key'], KEY, { extension: 'ext-a', instance: 'i1' })).toBe(false);
    });

    it('a ciphertext from elsewhere is dropped at the write and never opened', () => {
        const fromElsewhere = { encrypted: encrypt('sk-or-owner-key', KEY) };                 // an unbound record ciphertext
        const otherField = { encrypted: encryptBound('other', KEY, secretContext({ extension: 'ext-b' }, 'api_key')) };
        for (const planted of [fromElsewhere, otherField]) {
            const written = encryptSecretFields({ api_key: planted }, ['api_key'], KEY, B)!;
            expect('api_key' in written, JSON.stringify(planted)).toBe(false);
            expect('api_key' in decryptSecretFields({ api_key: planted }, ['api_key'], KEY, B)).toBe(false);
        }
    });

    it('the door strip finds a wrapper inside a descriptor default', () => {
        const { config, stripped } = stripClientEncryptedValues({
            stolen: { type: 'secret', default: { encrypted: 'aa:bb:cc' } },
            nested: { a: [{ encrypted: 'aa:bb:cc' }] },
            fine: { type: 'secret', default: 'typed-by-the-author' },
        });
        expect(stripped.sort()).toEqual(['nested', 'stolen']);
        expect(config).toEqual({ fine: { type: 'secret', default: 'typed-by-the-author' } });
    });

    it('a value written before the binding is rewritten bound, and opens only in its own field', () => {
        const legacy = { api_key: { encrypted: encrypt('old-value', KEY) }, [SECRET_KEYS_FIELD]: ['api_key'] };
        expect('api_key' in decryptSecretFields(legacy, ['api_key'], KEY, B)).toBe(false);
        const rebound = rebindLegacySecretFields(legacy, ['api_key'], KEY, B)!;
        expect(isBoundCiphertext((rebound.api_key as { encrypted: string }).encrypted)).toBe(true);
        expect(decryptSecretFields(rebound, ['api_key'], KEY, B).api_key).toBe('old-value');
        expect(rebindLegacySecretFields(rebound, ['api_key'], KEY, B)).toBeNull();
    });

    it('decryptBound refuses another context and the unbound form', () => {
        const v = encryptBound('x', KEY, 'ctx-1');
        expect(decryptBound(v, KEY, 'ctx-1')).toBe('x');
        expect(() => decryptBound(v, KEY, 'ctx-2')).toThrow();
        expect(() => decryptBound(encrypt('x', KEY), KEY, 'ctx-1')).toThrow();
    });
});
