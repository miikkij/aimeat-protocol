/**
 * @file inactivity-nudge.test.ts
 * @description Unit tests for the fortnight-of-silence nudge.
 *
 *   The failure modes here are not "it did not send" — they are "it sent, to the wrong person, or
 *   every night". So the tests that matter most are the ones asserting SILENCE: an active user, a
 *   user whose AI has been working, a user who turned notifications off, a user already nudged
 *   this month, and the whole feature switched off.
 * @usage cd aimeat && pnpm exec vitest run test/unit/inactivity-nudge.test.ts
 * @version-history
 *   v1.0.0 — 2026-08-07 — Initial.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sendRaw = vi.hoisted(() => vi.fn(async () => true));
const getActiveEmailService = vi.hoisted(() => vi.fn(() => ({ enabled: true, sendRaw })));
vi.mock('../../src/services/email.js', () => ({ getActiveEmailService }));

const {
    runInactivityNudgeJob, lastSeenAt, mayEmailOwner, INACTIVITY_DAYS, NUDGE_COOLDOWN_DAYS,
} = await import('../../src/services/inactivity-nudge.js');

const DAY = 24 * 3600 * 1000;
const NOW = Date.parse('2026-09-01T12:00:00Z');
const EPOCH = Date.parse('2026-08-01T00:00:00Z');
const iso = (t: number) => new Date(t).toISOString();

const config = {
    nodeId: 'node-1', baseUrl: 'https://example.test', inactivityNudge: true,
} as never as import('../../src/config.js').AimeatConfig;

function ghii(over: Record<string, unknown> = {}) {
    return {
        ghii: 'quiet@node-1', username: 'quiet', ownerName: 'quiet', displayName: 'Quiet Person',
        notificationEmail: 'quiet@example.test', verificationLevel: 1, locale: 'en',
        createdAt: iso(NOW - 200 * DAY), lastLoginAt: iso(NOW - 30 * DAY),
        ...over,
    };
}

/**
 * Only what the job reads. `getMemory` answers the consent key with an explicit opt-in, because
 * that is now the precondition for any send at all — a fake that returned null everywhere would
 * make every "it sends" test pass for the wrong reason.
 */
function fakeStorage(over: Record<string, unknown> = {}) {
    return {
        listGHIIs: async () => [ghii()],
        listActiveSessions: async () => [],
        listChatInstances: async () => [],
        getMemory: async (_g: string, key: string) =>
            key === 'settings.email_notifications' ? { value: { enabled: true } } : null,
        setMemory: vi.fn(async () => undefined),
        ...over,
    } as never;
}

const run = (storage: unknown, cfg = config) =>
    runInactivityNudgeJob(cfg, storage as never, { now: NOW, epoch: EPOCH });

describe('lastSeenAt — the largest of the signals that already exist', () => {
    it('prefers a browser session over a stale lastLoginAt', async () => {
        const t = await lastSeenAt(fakeStorage({
            listActiveSessions: async () => [{ lastUsedAt: iso(NOW - 2 * DAY) }],
        }), ghii() as never);
        expect(t).toBe(NOW - 2 * DAY);
    });

    it('counts the AI connector calling as the person being alive', async () => {
        const t = await lastSeenAt(fakeStorage({
            listChatInstances: async () => [{ lastSeen: iso(NOW - 1 * DAY) }],
        }), ghii() as never);
        expect(t).toBe(NOW - 1 * DAY);
    });

    it('survives a storage failure instead of taking the job down', async () => {
        const t = await lastSeenAt(fakeStorage({
            listActiveSessions: async () => { throw new Error('db down'); },
        }), ghii() as never);
        expect(t).toBe(NOW - 30 * DAY);   // falls back to what it could read
    });
});

describe('mayEmailOwner — the switch the profile has always written', () => {
    const noKey = () => fakeStorage({ getMemory: async () => null });

    it('absent means NO by default — the toggle renders unchecked, so sending would contradict it', async () => {
        expect(await mayEmailOwner(noKey(), 'x@node-1')).toBe(false);
    });

    it('...but the caller can ask for the opposite, which is how the older rescue keeps working', async () => {
        expect(await mayEmailOwner(noKey(), 'x@node-1', true)).toBe(true);
    });

    it('honours {enabled:false}', async () => {
        const s = fakeStorage({ getMemory: async () => ({ value: { enabled: false } }) });
        expect(await mayEmailOwner(s, 'x@node-1')).toBe(false);
    });

    it('honours a bare boolean false', async () => {
        const s = fakeStorage({ getMemory: async () => ({ value: false }) });
        expect(await mayEmailOwner(s, 'x@node-1')).toBe(false);
    });

    it('a read failure means DO NOT SEND — silence is recoverable, an unwanted email is not', async () => {
        const s = fakeStorage({ getMemory: async () => { throw new Error('db down'); } });
        expect(await mayEmailOwner(s, 'x@node-1')).toBe(false);
    });
});

describe('runInactivityNudgeJob', () => {
    beforeEach(() => { sendRaw.mockClear(); sendRaw.mockResolvedValue(true); });

    it('sends to somebody quiet for longer than the window', async () => {
        const r = await run(fakeStorage());
        expect(r.sent).toBe(1);
        expect(sendRaw).toHaveBeenCalledTimes(1);
        const [to, subject, html, text] = sendRaw.mock.calls[0] as unknown as string[];
        expect(to).toBe('quiet@example.test');
        expect(subject).toBe('Your home is still here');
        // The prompt is IN the message — reading it and doing it are the same action.
        expect(html).toContain('<pre');
        expect(text.length).toBeGreaterThan(subject.length);
    });

    it('says nothing to somebody who was here yesterday', async () => {
        const r = await run(fakeStorage({
            listActiveSessions: async () => [{ lastUsedAt: iso(NOW - 1 * DAY) }],
        }));
        expect(r.sent).toBe(0);
        expect(sendRaw).not.toHaveBeenCalled();
    });

    it('THE ONE THAT MATTERS — an agent working all week means the person is not absent', async () => {
        const r = await run(fakeStorage({
            listChatInstances: async () => [{ lastSeen: iso(NOW - 3 * DAY) }],
        }));
        expect(r.sent).toBe(0);
    });

    it('does not mail the same person twice inside the cooldown', async () => {
        const r = await run(fakeStorage({
            getMemory: async (_g: string, key: string) => key.endsWith('inactivity_nudge')
                ? { value: { sentAt: iso(NOW - 10 * DAY), count: 1 } }
                : key === 'settings.email_notifications' ? { value: { enabled: true } } : null,
        }));
        expect(r.sent).toBe(0);
        expect(sendRaw).not.toHaveBeenCalled();
    });

    it('does mail again once the cooldown has passed, and counts it', async () => {
        const setMemory = vi.fn(async () => undefined);
        const r = await run(fakeStorage({
            setMemory,
            getMemory: async (_g: string, key: string) => key.endsWith('inactivity_nudge')
                ? { value: { sentAt: iso(NOW - (NUDGE_COOLDOWN_DAYS + 1) * DAY), count: 1 } }
                : key === 'settings.email_notifications' ? { value: { enabled: true } } : null,
        }));
        expect(r.sent).toBe(1);
        expect((setMemory.mock.calls[0][0] as never as { value: { count: number } }).value.count).toBe(2);
    });

    it('sends NOTHING to somebody who never touched the notification switch', async () => {
        const r = await run(fakeStorage({ getMemory: async () => null }));
        expect(r.sent).toBe(0);
        expect(sendRaw).not.toHaveBeenCalled();
    });

    it('respects the notification switch', async () => {
        const r = await run(fakeStorage({
            getMemory: async (_g: string, key: string) => key.endsWith('email_notifications')
                ? { value: { enabled: false } } : null,
        }));
        expect(r.sent).toBe(0);
        expect(sendRaw).not.toHaveBeenCalled();
    });

    it('leaves alone anyone whose silence began before the feature existed', async () => {
        const r = await run(fakeStorage({
            listGHIIs: async () => [ghii({ lastLoginAt: iso(EPOCH - 5 * DAY), createdAt: iso(EPOCH - 100 * DAY) })],
        }));
        expect(r.sent).toBe(0);
    });

    it('never mails an unverified address', async () => {
        const r = await run(fakeStorage({ listGHIIs: async () => [ghii({ verificationLevel: 0 })] }));
        expect(r.sent).toBe(0);
    });

    it('skips measurement accounts', async () => {
        const r = await run(fakeStorage({ listGHIIs: async () => [ghii({ username: 'uxtest-42' })] }));
        expect(r.sent).toBe(0);
    });

    it('DEFAULT OFF — does nothing at all unless the operator turned it on', async () => {
        const r = await run(fakeStorage(), { ...config, inactivityNudge: false } as never);
        expect(r).toEqual({ sent: 0, considered: 0 });
        expect(sendRaw).not.toHaveBeenCalled();
    });

    it('a bounced send still records the attempt, so it is not retried nightly', async () => {
        sendRaw.mockResolvedValue(false);
        const setMemory = vi.fn(async () => undefined);
        const r = await run(fakeStorage({ setMemory }));
        expect(r.sent).toBe(0);
        expect(setMemory).toHaveBeenCalledTimes(1);
        expect((setMemory.mock.calls[0][0] as never as { value: { delivered: boolean } }).value.delivered).toBe(false);
    });

    it('the marker never expires — a swept marker would restart the whole cycle', async () => {
        const setMemory = vi.fn(async () => undefined);
        await run(fakeStorage({ setMemory }));
        expect((setMemory.mock.calls[0][0] as never as { ttlHours: null }).ttlHours).toBeNull();
    });

    it('uses Finnish for a Finnish account', async () => {
        await run(fakeStorage({ listGHIIs: async () => [ghii({ locale: 'fi' })] }));
        const [, subject] = sendRaw.mock.calls[0] as unknown as string[];
        expect(subject).toBe('Kotisi odottaa sinua');
    });

    it('the window is exactly the documented fortnight', async () => {
        expect(INACTIVITY_DAYS).toBe(14);
        const justInside = await run(fakeStorage({
            listActiveSessions: async () => [{ lastUsedAt: iso(NOW - (INACTIVITY_DAYS - 1) * DAY) }],
        }));
        expect(justInside.sent).toBe(0);
        sendRaw.mockClear();
        const justOutside = await run(fakeStorage({
            listActiveSessions: async () => [{ lastUsedAt: iso(NOW - (INACTIVITY_DAYS + 1) * DAY) }],
        }));
        expect(justOutside.sent).toBe(1);
    });
});
