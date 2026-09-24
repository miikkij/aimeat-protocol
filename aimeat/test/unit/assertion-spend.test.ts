/**
 * @file test/unit/assertion-spend.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One signed assertion is worth one spend, however its bytes are spelled.
 *
 *   THE HOLE THIS PINS (audit A4-3). An Ed25519 signature is 64 bytes, and the 86 base64url
 *   characters that carry it hold 516 bits, so the last character has four bits nobody reads. That
 *   gives sixteen spellings of one signature, and the node's own verifier accepts every one of them.
 *   The spend was keyed on the raw string, so each spelling counted as a new assertion and one
 *   captured assertion bought sixteen calls at /v1/agents/v2/token and at the A2A door.
 *
 *   The first case proves the attack is real before it proves the refusal: every re-spelling goes
 *   through verifyCardJws, the function both doors verify with. The other cases prove the refusal
 *   is about THIS assertion and not wider.
 * @usage cd aimeat && pnpm exec vitest run test/unit/assertion-spend.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-24 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { generateKeyPair, exportJWK, CompactSign } from 'jose';
import { spendAssertion } from '../../src/services/assertion-spend.js';
import { verifyCardJws } from '../../src/services/agent-card.js';
import type { Storage } from '../../src/storage/interface.js';

const NODE = 'aimeat-unit-001-test';
const B64U = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** The two storage calls the spender makes, over a Map: the revoked-token table in miniature. */
function spendStore(): Storage {
    const spent = new Map<string, number>();
    return {
        isTokenRevoked: async (hash: string) => spent.has(hash),
        revokeToken: async (hash: string, expiresAt: number) => { spent.set(hash, expiresAt); },
    } as unknown as Storage;
}

/** A fresh Ed25519 key, its public `x` and a signer of compact JWS assertions with it. */
async function signer(): Promise<{ x: string; sign: (claims: Record<string, unknown>) => Promise<string> }> {
    const { privateKey, publicKey } = await generateKeyPair('EdDSA', { crv: 'Ed25519' });
    const x = (await exportJWK(publicKey)).x as string;
    const sign = (claims: Record<string, unknown>) =>
        new CompactSign(new TextEncoder().encode(JSON.stringify(claims))).setProtectedHeader({ alg: 'EdDSA' }).sign(privateKey);
    return { x, sign };
}

/** Every other spelling of the same signature: the last character with only its unread bits changed. */
function respellings(jws: string): string[] {
    const [header, payload, sig] = jws.split('.');
    const last = B64U.indexOf(sig[sig.length - 1]);
    const out: string[] = [];
    for (let i = 0; i < 64; i++) {
        // The top two of the character's six bits carry the signature; the low four are padding.
        if ((i & 0x30) !== (last & 0x30) || i === last) continue;
        out.push(`${header}.${payload}.${sig.slice(0, -1)}${B64U[i]}`);
    }
    return out;
}

const claimsFor = (sub: string, over: Record<string, unknown> = {}) => {
    const now = Math.floor(Date.now() / 1000);
    return { sub, aud: NODE, iat: now, exp: now + 60, jti: randomUUID(), ...over };
};

describe('an assertion is spent by what it is, not by how its bytes are spelled', () => {
    it('every re-spelling of a spent assertion verifies, and is refused as the same spend', async () => {
        const storage = spendStore();
        const { x, sign } = await signer();
        const claims = claimsFor(`bot#alice@${NODE}`);
        const jws = await sign(claims);

        const variants = respellings(jws);
        expect(variants).toHaveLength(15);
        // What makes this an attack and not a curiosity: the doors' own verifier accepts each one.
        for (const v of variants) expect(await verifyCardJws(v, { x }), `verifies as ...${v.slice(-3)}`).toBe(true);

        expect((await spendAssertion(storage, jws, claims.exp)).ok).toBe(true);
        for (const v of variants) {
            expect((await spendAssertion(storage, v, claims.exp)).ok, `re-spelled as ...${v.slice(-3)}`).toBe(false);
        }
    });

    it('the original is refused after a re-spelling was spent first', async () => {
        // The order an attacker controls: the captured copy may reach the door before the real one.
        const storage = spendStore();
        const { sign } = await signer();
        const claims = claimsFor(`bot#alice@${NODE}`);
        const jws = await sign(claims);
        expect((await spendAssertion(storage, respellings(jws)[0], claims.exp)).ok).toBe(true);
        expect((await spendAssertion(storage, jws, claims.exp)).ok).toBe(false);
    });

    it('a fresh assertion from the same signer still spends', async () => {
        const storage = spendStore();
        const { sign } = await signer();
        const first = claimsFor(`bot#alice@${NODE}`);
        const second = claimsFor(`bot#alice@${NODE}`);
        expect((await spendAssertion(storage, await sign(first), first.exp)).ok).toBe(true);
        expect((await spendAssertion(storage, await sign(second), second.exp)).ok).toBe(true);
    });

    it('the same jti from another agent, or for another node, is a different assertion', async () => {
        const storage = spendStore();
        const { sign } = await signer();
        const jti = randomUUID();
        const mine = claimsFor(`bot#alice@${NODE}`, { jti });
        const theirs = claimsFor(`bot#bob@${NODE}`, { jti });
        const elsewhere = claimsFor(`bot#alice@${NODE}`, { jti, aud: 'aimeat-unit-002-test' });
        expect((await spendAssertion(storage, await sign(mine), mine.exp)).ok).toBe(true);
        expect((await spendAssertion(storage, await sign(theirs), theirs.exp)).ok).toBe(true);
        expect((await spendAssertion(storage, await sign(elsewhere), elsewhere.exp)).ok).toBe(true);
    });

    it('an assertion that does not name its signer, its node and itself is refused, not filed', async () => {
        const storage = spendStore();
        const { sign } = await signer();
        const now = Math.floor(Date.now() / 1000);
        for (const missing of ['sub', 'aud', 'jti']) {
            const claims: Record<string, unknown> = claimsFor(`bot#alice@${NODE}`);
            delete claims[missing];
            const r = await spendAssertion(storage, await sign(claims), now + 60);
            expect(r.ok, `without ${missing}`).toBe(false);
        }
        expect((await spendAssertion(storage, 'not-a-jws', now + 60)).ok).toBe(false);
    });
});
