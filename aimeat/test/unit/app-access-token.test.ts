/**
 * @file app-access-token.test.ts
 * @description Unit tests for the app-access grant (src/services/app-access-token.ts): the token
 *   the apex mints after it has checked an app's access code or licence, and the only thing the
 *   session-less app origin can check. Everything here is a "may this token open this app" question,
 *   so the interesting cases are the refusals: another app, another owner, an expired grant, a token
 *   of a different type, and no token at all. Each of those has to answer exactly like the others,
 *   because the caller turns any false into the same 404 an unknown app gets.
 * @structure One describe block; setup imports the node keypair the service signs with.
 * @usage cd aimeat && pnpm exec vitest run test/unit/app-access-token.test.ts
 * @version-history
 *   v1.0.0 — 2026-08-11 — Initial (audit H-19).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { initNodeKeys, getNodeCryptoKeys } from '../../src/auth/jwt.js';
import { generateKeyPair } from '../../src/auth/keypair.js';
import { initDraftTokenKeys, generateDraftToken } from '../../src/services/draft-token.js';
import { generateAppAccessToken, appAccessGranted } from '../../src/services/app-access-token.js';

const NODE = 'aimeat-local-001-dev';
const FILE = 'gated-demo.html';

beforeAll(async () => {
    const kp = await generateKeyPair();
    await initNodeKeys(kp.publicKey, kp.privateKey);
    const { privateKey, publicKey } = getNodeCryptoKeys();
    initDraftTokenKeys(privateKey, publicKey);
});

describe('app-access grant', () => {
    it('opens the app it was minted for', async () => {
        const grant = await generateAppAccessToken({ sub: `alice@${NODE}`, filename: FILE });
        expect(await appAccessGranted(grant, 'alice', FILE)).toBe(true);
    });

    it('accepts a bare owner name on either side of the comparison', async () => {
        // The apex mints with the GHII it holds; the app origin knows only the bare name off the
        // subdomain mapping. Neither side may care which form the other used.
        const grant = await generateAppAccessToken({ sub: 'alice', filename: FILE });
        expect(await appAccessGranted(grant, `alice@${NODE}`, FILE)).toBe(true);
    });

    it('does not open a DIFFERENT app of the same owner', async () => {
        const grant = await generateAppAccessToken({ sub: `alice@${NODE}`, filename: FILE });
        expect(await appAccessGranted(grant, 'alice', 'other-app.html')).toBe(false);
    });

    it('does not open ANOTHER OWNER\'s app of the same name', async () => {
        // Two owners may publish the same filename, so the filename alone is not an identity.
        const grant = await generateAppAccessToken({ sub: `alice@${NODE}`, filename: FILE });
        expect(await appAccessGranted(grant, 'bob', FILE)).toBe(false);
    });

    it('stops working once it has expired', async () => {
        const stale = await generateAppAccessToken({ sub: `alice@${NODE}`, filename: FILE }, -30);
        expect(await appAccessGranted(stale, 'alice', FILE)).toBe(false);
    });

    it('refuses a token of another type signed by the same node key', async () => {
        // Every short-lived token here is signed with the one node key, so the type claim is what
        // keeps a draft-preview grant from being spent as an access grant.
        const draft = await generateDraftToken({ sub: `alice@${NODE}`, filename: FILE });
        expect(await appAccessGranted(draft, 'alice', FILE)).toBe(false);
    });

    it('refuses garbage, an absent token, and a repeated query parameter', async () => {
        expect(await appAccessGranted('not-a-jwt', 'alice', FILE)).toBe(false);
        expect(await appAccessGranted(undefined, 'alice', FILE)).toBe(false);
        expect(await appAccessGranted('', 'alice', FILE)).toBe(false);
        // Express hands back an array for `?access=a&access=b`; it must not reach jwtVerify as one.
        expect(await appAccessGranted(['a', 'b'], 'alice', FILE)).toBe(false);
    });

    it('refuses a grant signed by a key that is not this node\'s', async () => {
        const grant = await generateAppAccessToken({ sub: `alice@${NODE}`, filename: FILE });
        const other = await generateKeyPair();
        await initNodeKeys(other.publicKey, other.privateKey);
        expect(await appAccessGranted(grant, 'alice', FILE)).toBe(false);
    });
});
