/**
 * @file test/unit/signed-request-spend.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A key-signed request is spent once per signature, whatever base64 spelling of that
 *   signature is sent (auth/signed-request.ts spendSignature). The verifier decodes leniently: no
 *   padding, the URL alphabet and whitespace all decode to the same 64 bytes, so a spend keyed on the
 *   text let one signature through once per spelling (secaudit2026nov08,
 *   aimeat/src/auth/signed-request.ts:spendSignature:signature-text-spend-key). Also the operator's
 *   propose-then-confirm token (services/operator-confirm.ts): it is spent once by its id, in the
 *   node's storage, so a second process or a second spelling of the token does not apply it again.
 * @usage cd aimeat && pnpm exec vitest run test/unit/signed-request-spend.test.ts
 * @version-history
 *   v1.0.0 -- 2026-11-08 -- Initial (secaudit2026nov08 round 14).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { generateKeyPair as joseKeyPair } from 'jose';
import { generateKeyPair, sign, verify } from '../../src/auth/keypair.js';
import { spendSignature } from '../../src/auth/signed-request.js';
import { initConfirmTokenKeys, mintConfirmToken, verifyConfirmToken, ConfirmTokenError } from '../../src/services/operator-confirm.js';

/** The same bytes in the URL-safe alphabet with no padding. */
function urlSpelling(b64: string): string {
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

describe('spendSignature', () => {
  it('a fresh signature in its canonical spelling is accepted once (the agent sign-in as it is used)', async () => {
    const keys = await generateKeyPair();
    const sig = await sign(keys.privateKey, `claude#alice@node-a${new Date().toISOString()}`);
    expect(await spendSignature(sig)).toBe(true);
    expect(await spendSignature(sig)).toBe(false);
  });

  it('a second spelling of a spent signature verifies, and is refused as already used', async () => {
    const keys = await generateKeyPair();
    const message = `claude#bob@node-a${new Date().toISOString()}`;
    const sig = await sign(keys.privateKey, message);
    const respelled = urlSpelling(sig);
    expect(respelled).not.toBe(sig);
    expect(await verify(keys.publicKey, message, sig)).toBe(true);
    expect(await verify(keys.publicKey, message, respelled)).toBe(true);
    expect(await spendSignature(sig)).toBe(true);
    expect(await spendSignature(respelled)).toBe(false);
    expect(await spendSignature(` ${sig.slice(0, 40)}\n${sig.slice(40)}`)).toBe(false);
  });
});

describe('verifyConfirmToken', () => {
  beforeAll(async () => {
    const k = await joseKeyPair('EdDSA', { extractable: true });
    initConfirmTokenKeys(k.privateKey as CryptoKey, k.publicKey as CryptoKey);
  });

  it('applies a confirm token once, and a second spelling of its signature is refused as used', async () => {
    const payload = { key: 'security.x', value: 1 };
    const token = await mintConfirmToken('carol', 'config.set', payload);
    await verifyConfirmToken(token, 'carol', 'config.set', payload);
    await expect(verifyConfirmToken(token, 'carol', 'config.set', payload)).rejects.toMatchObject({ code: 'TOKEN_USED' });
    // The signature segment with spare low bits set in its last character decodes to the same bytes.
    const [h, p, s] = token.split('.');
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const last = alphabet.indexOf(s[s.length - 1]);
    const variant = `${h}.${p}.${s.slice(0, -1)}${alphabet[last | 3]}`;
    let code = '';
    try { await verifyConfirmToken(variant, 'carol', 'config.set', payload); } catch (e) { code = (e as ConfirmTokenError).code; }
    expect(code === 'TOKEN_USED' || code === 'TOKEN_INVALID').toBe(true);
  });

  it('a payload that changed since the proposal is refused and leaves the token unspent', async () => {
    const token = await mintConfirmToken('carol', 'config.set', { a: 1 });
    await expect(verifyConfirmToken(token, 'carol', 'config.set', { a: 2 })).rejects.toMatchObject({ code: 'PAYLOAD_MISMATCH' });
    await verifyConfirmToken(token, 'carol', 'config.set', { a: 1 });
  });
});
