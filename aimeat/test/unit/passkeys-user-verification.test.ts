/**
 * @file test/unit/passkeys-user-verification.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A passkey enters an account that armed two-step sign-in only when the device checked
 *   the person: a PIN, a fingerprint or a face. The user-verification (UV) flag says it did.
 *
 *   THE HOLE THIS PINS (audit A3-2). Both ceremonies asked for UV as 'preferred' and verified with
 *   requireUserVerification:false, and the passkey door completes an owner login with no code step.
 *   So a security key with no PIN, which proves possession and nothing else, opened an account whose
 *   owner had armed password plus a code: one factor where the owner asked for two.
 *
 *   THE LIBRARY IS STUBBED, ONLY ITS TWO VERIFY CALLS. What is under test is the decision made on
 *   the verify result's `userVerified` flag, so the test hands that flag in directly. The real
 *   library, a software authenticator and the real routes are in test/e2e-passkeys.ts.
 * @usage cd aimeat && pnpm exec vitest run test/unit/passkeys-user-verification.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-24 — Initial.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@simplewebauthn/server', async (importOriginal) => {
    const real = await importOriginal<typeof import('@simplewebauthn/server')>();
    return { ...real, verifyAuthenticationResponse: vi.fn(), verifyRegistrationResponse: vi.fn() };
});

import { verifyAuthenticationResponse, verifyRegistrationResponse } from '@simplewebauthn/server';
import {
    beginLogin, finishLogin, beginRegistration, finishRegistration, _resetPasskeyCeremonies,
} from '../../src/services/passkeys.js';
import type { AimeatConfig } from '../../src/config.js';
import type { Storage } from '../../src/storage/interface.js';
import type { PasskeyRecord } from '../../src/storage/types/passkeys.js';

const NODE = 'aimeat-unit-001-test';
const CONFIG = {
    passkeyEnabled: true, passkeyRpId: 'localhost', passkeyRpName: 'AIMEAT test',
    baseUrl: 'http://localhost:40251', passkeyExtraOrigins: [],
} as unknown as AimeatConfig;

/** Two-step sign-in, in the three states the password door tells apart. */
const ARMED = { totpEnabled: true, totpSecret: 'sealed-secret' };
const OFF = { totpEnabled: false };
const STARTED_NOT_CONFIRMED = { totpEnabled: false, totpSecret: 'sealed-secret' };

/** Alice, one registered passkey, and the calls the passkey service makes, recorded. */
function world(twoStep: { totpEnabled: boolean; totpSecret?: string }) {
    const key: PasskeyRecord = {
        id: 'cred-alice', ghii: `alice@${NODE}`, owner: 'alice', publicKey: 'AQID', counter: 0,
        transports: ['internal'], label: 'Laptop', aaguid: '', backedUp: false,
        createdAt: '2026-09-24T00:00:00.000Z', lastUsedAt: null,
    };
    const account = {
        ghii: `alice@${NODE}`, ownerName: 'alice', username: 'alice', nodeId: NODE, displayName: 'Alice',
        verificationLevel: 0, morselBalance: 0, loginCount: 0, createdAt: '', updatedAt: '', ...twoStep,
    };
    const touched: string[] = [];
    const created: PasskeyRecord[] = [];
    const storage = {
        listPasskeysByOwner: async (owner: string) => (owner === 'alice' ? [key] : []),
        getPasskey: async (id: string) => (id === key.id ? key : null),
        getGHIIByOwner: async (owner: string) => (owner === 'alice' ? account : null),
        getOwner: async (owner: string) => ({ name: owner, disabledAt: null }),
        touchPasskey: async (id: string) => { touched.push(id); },
        createPasskey: async (record: PasskeyRecord) => { created.push(record); },
    } as unknown as Storage;
    return { storage, touched, created };
}

/** One whole sign-in, the device answering with the UV flag the test chooses. */
async function signIn(storage: Storage, userVerified: boolean, username?: string) {
    const begun = await beginLogin(CONFIG, storage, username);
    if (!begun.ok) throw new Error(`beginLogin: ${begun.code}`);
    vi.mocked(verifyAuthenticationResponse).mockResolvedValueOnce({
        verified: true,
        authenticationInfo: {
            newCounter: 1, credentialID: 'cred-alice', userVerified, credentialDeviceType: 'singleDevice',
            credentialBackedUp: false, origin: CONFIG.baseUrl, rpID: 'localhost',
        },
    } as never);
    return finishLogin(CONFIG, storage, { ceremonyId: begun.data.ceremony_id, response: { id: 'cred-alice' } });
}

/** One whole registration of a new device, answering with the UV flag the test chooses. */
async function register(storage: Storage, userVerified: boolean) {
    const begun = await beginRegistration(CONFIG, storage, 'alice', 'Alice');
    if (!begun.ok) throw new Error(`beginRegistration: ${begun.code}`);
    vi.mocked(verifyRegistrationResponse).mockResolvedValueOnce({
        verified: true,
        registrationInfo: {
            fmt: 'none', aaguid: '00000000-0000-0000-0000-000000000000',
            credential: { id: 'cred-new', publicKey: new Uint8Array([1, 2, 3]), counter: 0, transports: ['usb'] },
            credentialType: 'public-key', attestationObject: new Uint8Array(), userVerified,
            credentialDeviceType: 'singleDevice', credentialBackedUp: false, origin: CONFIG.baseUrl, rpID: 'localhost',
        },
    } as never);
    return finishRegistration(CONFIG, storage, {
        ceremonyId: begun.data.ceremony_id, owner: 'alice', ghii: `alice@${NODE}`, label: 'Key', response: {},
    });
}

beforeEach(() => {
    _resetPasskeyCeremonies();
    vi.mocked(verifyAuthenticationResponse).mockReset();
    vi.mocked(verifyRegistrationResponse).mockReset();
});

describe('signing in with a passkey, on an account that armed two-step sign-in', () => {
    it('refuses a device that did not verify the person, and leaves no trace of a sign-in', async () => {
        for (const username of ['alice', undefined]) {
            const { storage, touched } = world(ARMED);
            const r = await signIn(storage, false, username);
            expect(r.ok, `${username ? 'named' : 'discoverable'} sign-in`).toBe(false);
            if (r.ok) continue;
            expect(r.status).toBe(401);
            expect(r.code).toBe('PASSKEY_USER_NOT_VERIFIED');
            // Refused before the write: the device's "last used" must not show a sign-in that failed.
            expect(touched).toEqual([]);
        }
    });

    it('accepts a device that verified the person', async () => {
        const { storage, touched } = world(ARMED);
        const r = await signIn(storage, true, 'alice');
        expect(r.ok).toBe(true);
        expect(touched).toEqual(['cred-alice']);
    });

    it('asks the device to verify the person, when the account has a passkey to offer', async () => {
        const r = await beginLogin(CONFIG, world(ARMED).storage, 'alice');
        expect(r.ok && r.data.options.userVerification).toBe('required');
    });
});

describe('signing in with a passkey, everywhere else: unchanged', () => {
    it('an account without two-step sign-in accepts presence alone, as before', async () => {
        const { storage } = world(OFF);
        expect((await signIn(storage, false, 'alice')).ok).toBe(true);
        expect((await signIn(storage, false)).ok).toBe(true);
    });

    it('a two-step setup that was started and never confirmed does not arm it', async () => {
        // The password door asks for a code only when the setup is confirmed; so does this one.
        expect((await signIn(world(STARTED_NOT_CONFIRMED).storage, false, 'alice')).ok).toBe(true);
    });

    it('the sign-in options still prefer, and do not require, for every other name', async () => {
        const plain = await beginLogin(CONFIG, world(OFF).storage, 'alice');
        expect(plain.ok && plain.data.options.userVerification).toBe('preferred');
        // A name with no account, and the discoverable flow, answer exactly as before.
        const nobody = await beginLogin(CONFIG, world(ARMED).storage, 'nobody');
        expect(nobody.ok && nobody.data.options.userVerification).toBe('preferred');
        const discoverable = await beginLogin(CONFIG, world(ARMED).storage);
        expect(discoverable.ok && discoverable.data.options.userVerification).toBe('preferred');
    });
});

describe('adding a passkey', () => {
    it('on an armed account, asks for user verification and refuses a device without it', async () => {
        const begun = await beginRegistration(CONFIG, world(ARMED).storage, 'alice', 'Alice');
        expect(begun.ok && begun.data.options.authenticatorSelection?.userVerification).toBe('required');

        const { storage, created } = world(ARMED);
        const r = await register(storage, false);
        expect(r.ok).toBe(false);
        if (!r.ok) {
            expect(r.status).toBe(400);
            expect(r.code).toBe('PASSKEY_USER_NOT_VERIFIED');
        }
        // A device that could never satisfy the sign-in is not stored as a way in.
        expect(created).toEqual([]);

        const ok = world(ARMED);
        expect((await register(ok.storage, true)).ok).toBe(true);
        expect(ok.created).toHaveLength(1);
    });

    it('on an account without two-step sign-in, is unchanged', async () => {
        const begun = await beginRegistration(CONFIG, world(OFF).storage, 'alice', 'Alice');
        expect(begun.ok && begun.data.options.authenticatorSelection?.userVerification).toBe('preferred');
        const { storage, created } = world(OFF);
        expect((await register(storage, false)).ok).toBe(true);
        expect(created).toHaveLength(1);
    });
});
