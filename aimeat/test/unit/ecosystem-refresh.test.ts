/**
 * @file test/unit/ecosystem-refresh.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The rule an ecosystem app's refresh answers to (services/ecosystem-refresh.ts).
 *
 *   WHAT THIS PINS (secrets audit 2026-10-09, S-2). The app pins an Ed25519 key at hello, and nothing
 *   ever checked it: a refresh took the bearer alone, so a stolen ninety-day credential renewed itself
 *   without end. A refresh now needs a fresh signature by the pinned key over `<geai><timestamp>`, and
 *   the chain of refreshes ends a fixed time after the owner approved the app (`auth_time`). After
 *   that the app says hello again and the owner approves it again.
 *
 *   The E2E (e2e-ecosystem-app-foundation) proves the route; this proves the clock, which an E2E
 *   cannot wait out: the chain's end, a token minted before `auth_time` existed, and the cap on the
 *   renewed token's lifetime.
 * @usage cd aimeat && pnpm exec vitest run test/unit/ecosystem-refresh.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-09 — Initial (secrets audit 2026-10-09, S-2).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { generateKeyPair, sign, type KeyPair } from '../../src/auth/keypair.js';
import { ecosystemRefreshDecision } from '../../src/services/ecosystem-refresh.js';

const GEAI = 'eco:drum#ada@node-1';
const DAY = 86_400;
const MAX = 365 * DAY;
const TTL = 90 * DAY;
let keys: KeyPair;

beforeAll(async () => { keys = await generateKeyPair(); });

const proof = async (at: Date, key = keys.privateKey) => {
    const timestamp = at.toISOString();
    return { timestamp, signature: await sign(key, GEAI + timestamp) };
};

describe('an ecosystem app refresh', () => {
    it('is refused without a proof, with a code that says what to send', async () => {
        const now = new Date();
        const d = await ecosystemRefreshDecision({ geai: GEAI, publicKey: keys.publicKey, authTime: undefined, iat: Math.floor(now.getTime() / 1000), now, maxChainSeconds: MAX, ttlSeconds: TTL });
        expect(d).toMatchObject({ ok: false, status: 401, code: 'ECO_KEY_PROOF_REQUIRED' });
        expect((d as { message: string }).message).toContain('timestamp');
    });

    it('is refused with a signature by another key, and with a stale timestamp', async () => {
        const now = new Date();
        const other = await generateKeyPair();
        const iat = Math.floor(now.getTime() / 1000);
        expect(await ecosystemRefreshDecision({ geai: GEAI, publicKey: keys.publicKey, iat, now, maxChainSeconds: MAX, ttlSeconds: TTL, ...(await proof(now, other.privateKey)) }))
            .toMatchObject({ ok: false, code: 'ECO_KEY_PROOF_INVALID' });
        expect(await ecosystemRefreshDecision({ geai: GEAI, publicKey: keys.publicKey, iat, now, maxChainSeconds: MAX, ttlSeconds: TTL, ...(await proof(new Date(now.getTime() - 3_600_000))) }))
            .toMatchObject({ ok: false, code: 'ECO_KEY_PROOF_INVALID' });
    });

    it('is refused for an app whose pinned key is not an Ed25519 key, and says to connect again', async () => {
        const now = new Date();
        const d = await ecosystemRefreshDecision({ geai: GEAI, publicKey: Buffer.from('placeholder').toString('base64'), iat: Math.floor(now.getTime() / 1000), now, maxChainSeconds: MAX, ttlSeconds: TTL, ...(await proof(now)) });
        expect(d).toMatchObject({ ok: false, code: 'ECO_KEY_PROOF_INVALID' });
    });

    it('is renewed with the pinned key, keeps the chain start, and the token ends no later than the chain', async () => {
        const now = new Date();
        const nowS = Math.floor(now.getTime() / 1000);
        const approved = nowS - (MAX - 10 * DAY); // ten days of the chain left
        const d = await ecosystemRefreshDecision({ geai: GEAI, publicKey: keys.publicKey, authTime: approved, iat: nowS - DAY, now, maxChainSeconds: MAX, ttlSeconds: TTL, ...(await proof(now)) });
        expect(d).toMatchObject({ ok: true, authTime: approved });
        const ok = d as { ttlSeconds: number; chainEndsAt: number };
        expect(ok.chainEndsAt).toBe(approved + MAX);
        expect(ok.ttlSeconds).toBeLessThanOrEqual(10 * DAY);
        expect(ok.ttlSeconds).toBeGreaterThan(10 * DAY - 5);
    });

    it('is refused once the chain is older than the maximum: the owner approves again', async () => {
        const now = new Date();
        const nowS = Math.floor(now.getTime() / 1000);
        const d = await ecosystemRefreshDecision({ geai: GEAI, publicKey: keys.publicKey, authTime: nowS - MAX - 1, iat: nowS - DAY, now, maxChainSeconds: MAX, ttlSeconds: TTL, ...(await proof(now)) });
        expect(d).toMatchObject({ ok: false, status: 401, code: 'ECO_REAPPROVAL_REQUIRED' });
        expect((d as { message: string }).message).toContain('/v1/ecosystem-apps/hello');
    });

    it('starts the chain of a token minted before auth_time existed at that token\'s issue time', async () => {
        const now = new Date();
        const nowS = Math.floor(now.getTime() / 1000);
        const d = await ecosystemRefreshDecision({ geai: GEAI, publicKey: keys.publicKey, authTime: undefined, iat: nowS - 30 * DAY, now, maxChainSeconds: MAX, ttlSeconds: TTL, ...(await proof(now)) });
        expect(d).toMatchObject({ ok: true, authTime: nowS - 30 * DAY });
    });
});
