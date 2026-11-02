/**
 * @file test/unit/refresh-session-check.test.ts
 * @description checkRefreshSession (services/owner-session.ts), the one read-only check of a refresh
 *   session that the refresh and the app-grant silent bridge share (secaudit 2026-10, AUTH-1). The
 *   bridge's own copy checked revocation and expiry only; these are the cases it let through.
 * @version-history
 *   2026-11-02 — The required two-step policy, which the check reads when the config is passed
 *     (secaudit2026nov02d round 13).
 *   v1.0.0 — 2026-10-05 — Initial.
 */
import { describe, it, expect } from 'vitest';
import type { Storage } from '../../src/storage/interface.js';
import { checkRefreshSession } from '../../src/services/owner-session.js';

const NOW = Date.parse('2026-10-05T12:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();

function storageWith(session: Record<string, unknown> | null, owner: Record<string, unknown> | null): Storage {
    return {
        getSessionByRefreshHash: async () => session,
        getOwner: async () => owner,
    } as unknown as Storage;
}

const baseSession = {
    sessionId: 's1', owner: 'alice', gaii: 'alice', revoked: false, refreshTokenHash: 'current',
    issuedAt: iso(NOW - 3_600_000), idleExpiresAt: iso(NOW + 3_600_000), absoluteExpiresAt: iso(NOW + 86_400_000),
};
const owner = { name: 'alice', roles: ['owner'], createdAt: iso(NOW - 86_400_000) };

describe('checkRefreshSession', () => {
    it('holds for a live session of a live account', async () => {
        const out = await checkRefreshSession(storageWith(baseSession, owner), 'current', NOW);
        expect(out.ok && out.previous).toBe(false);
    });

    it('refuses a session older than the account that now holds its name', async () => {
        const newer = { ...owner, createdAt: iso(NOW - 60_000) };
        const out = await checkRefreshSession(storageWith(baseSession, newer), 'current', NOW);
        expect(out.ok === false && out.reason).toBe('account-gone');
    });

    it('refuses a session whose account was deactivated, and one whose account is gone', async () => {
        expect(await checkRefreshSession(storageWith(baseSession, { ...owner, disabledAt: iso(NOW - 1000) }), 'current', NOW))
            .toMatchObject({ ok: false, reason: 'account-disabled' });
        expect(await checkRefreshSession(storageWith(baseSession, null), 'current', NOW)).toMatchObject({ ok: false, reason: 'account-gone' });
    });

    it('takes the previous token inside its grace window, and refuses it after', async () => {
        const rotated = { ...baseSession, prevTokenHash: 'previous', prevValidUntil: iso(NOW + 5000) };
        expect(await checkRefreshSession(storageWith(rotated, owner), 'previous', NOW)).toMatchObject({ ok: true, previous: true });
        const stale = { ...rotated, prevValidUntil: iso(NOW - 5000) };
        expect(await checkRefreshSession(storageWith(stale, owner), 'previous', NOW)).toMatchObject({ ok: false, reason: 'reused' });
    });

    it('refuses an unknown, a revoked and an expired session', async () => {
        expect(await checkRefreshSession(storageWith(null, owner), 'x', NOW)).toMatchObject({ ok: false, reason: 'unknown' });
        expect(await checkRefreshSession(storageWith({ ...baseSession, revoked: true }, owner), 'current', NOW)).toMatchObject({ ok: false, reason: 'revoked' });
        expect(await checkRefreshSession(storageWith({ ...baseSession, idleExpiresAt: iso(NOW - 1) }, owner), 'current', NOW)).toMatchObject({ ok: false, reason: 'expired' });
    });
});

describe('checkRefreshSession with the required two-step policy (secaudit2026nov02d round 13)', () => {
    const policy = (twoStepRequired: 'off' | 'operators' | 'everyone') => ({ twoStepRequired, passwordSignIn: 'on' as const, nodeId: 'n1' });
    function storageWithAccount(ghii: Record<string, unknown>, passkeys: unknown[] = []): Storage {
        return {
            getSessionByRefreshHash: async () => baseSession,
            getOwner: async () => owner,
            getGHII: async () => ghii,
            listPasskeysByOwner: async () => passkeys,
        } as unknown as Storage;
    }
    const passwordOnly = { ownerName: 'alice' };

    it('refuses a covered account with no TOTP, passkey or provider link', async () => {
        expect(await checkRefreshSession(storageWithAccount(passwordOnly), 'current', NOW, policy('everyone')))
            .toMatchObject({ ok: false, reason: 'two-step-setup-required' });
    });

    it('holds for an enrolled account, an account with a passkey, an uncovered account, and with the policy off', async () => {
        const armed = { ownerName: 'alice', totpEnabled: true, totpSecret: 'S' };
        expect(await checkRefreshSession(storageWithAccount(armed), 'current', NOW, policy('everyone'))).toMatchObject({ ok: true });
        expect(await checkRefreshSession(storageWithAccount(passwordOnly, [{ id: 'pk' }]), 'current', NOW, policy('everyone'))).toMatchObject({ ok: true });
        expect(await checkRefreshSession(storageWithAccount(passwordOnly), 'current', NOW, policy('operators'))).toMatchObject({ ok: true });
        expect(await checkRefreshSession(storageWithAccount(passwordOnly), 'current', NOW, policy('off'))).toMatchObject({ ok: true });
    });
});
