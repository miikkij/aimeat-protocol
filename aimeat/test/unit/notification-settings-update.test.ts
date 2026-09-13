/**
 * @file test/unit/notification-settings-update.test.ts
 * @description The notification settings record cannot be replaced with an older or a default copy of
 *   itself (docs/pitfalls.md §84). Three shapes, each with the storage behaviour that produced it:
 *   a failed read followed by a working write, the digest bookmark kept from a forgiving read, and the
 *   digest sweep writing back a snapshot it took before the owner saved something. The delivery read
 *   stays forgiving, because a failed read must not swallow a notification.
 * @usage cd aimeat && pnpm exec vitest run test/unit/notification-settings-update.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-13 — Initial.
 */
import { describe, it, expect } from 'vitest';
import {
    NOTIF_SETTINGS_KEY, defaultSettings, readNotificationSettings, readNotificationSettingsStrict,
    updateNotificationSettings, type NotificationSettings,
} from '../../src/services/notification-settings.js';
import type { Storage } from '../../src/storage/interface.js';

const OWNER = 'alice@n1';

/** An in-memory settings store whose reads can be made to fail a given number of times. */
function store(initial?: Partial<NotificationSettings>) {
    let value: unknown = initial ? { ...defaultSettings(), ...initial } : undefined;
    let version = initial ? 1 : 0;
    let failReads = 0;
    let writes = 0;
    const storage = {
        getMemory: async (owner: string, key: string) => {
            if (failReads > 0) { failReads--; throw new Error('storage refused: getMemory'); }
            return owner === OWNER && key === NOTIF_SETTINGS_KEY && value !== undefined ? { key, value, version, createdAt: 'c', updatedAt: 'u' } : null;
        },
        setMemory: async (r: { value: unknown; version: number }) => { writes++; value = r.value; version = r.version; return r; },
    } as unknown as Storage;
    return {
        storage,
        failNextReads: (n: number) => { failReads = n; },
        get record() { return value as NotificationSettings; },
        get writes() { return writes; },
    };
}

describe('updateNotificationSettings', () => {
    it('writes nothing when the read before the write fails, so the owner\'s record survives', async () => {
        const s = store({ senders: { 'app:x/y.html': { muted: true } }, quiet: { start: '22:00', end: '07:00', tz: 'UTC', breakthrough: [] } });
        s.failNextReads(1);
        await expect(updateNotificationSettings(s.storage, OWNER, cur => ({ ...cur, throttleMinutes: 5 }))).rejects.toThrow('getMemory');
        expect(s.writes).toBe(0);
        expect(s.record.senders['app:x/y.html']).toEqual({ muted: true });
    });

    it('keeps the digest bookmark from the record as it is, whatever the client sent', async () => {
        const s = store({ lastDigestAt: '2026-09-10T08:00:00.000Z' });
        const incoming = { ...defaultSettings(), throttleMinutes: 30, lastDigestAt: null };
        await updateNotificationSettings(s.storage, OWNER, cur => ({ ...incoming, lastDigestAt: cur.lastDigestAt }));
        expect(s.record.lastDigestAt).toBe('2026-09-10T08:00:00.000Z');
        expect(s.record.throttleMinutes).toBe(30);
    });

    it('lets the sweep write its bookmark without undoing what the owner saved after the sweep read', async () => {
        const s = store({ emailDigest: { enabled: true, afterHours: 8 } });
        const snapshot = await readNotificationSettingsStrict(s.storage, OWNER);   // the sweep reads every owner first
        // …the email goes out, and meanwhile the owner sets quiet hours.
        await updateNotificationSettings(s.storage, OWNER, cur => ({ ...cur, quiet: { start: '23:00', end: '06:00', tz: 'Europe/Helsinki', breakthrough: ['messages'] } }));
        const lastDigestAt = '2026-09-13T09:00:00.000Z';
        await updateNotificationSettings(s.storage, OWNER, cur => ({ ...cur, lastDigestAt }));
        expect(snapshot.quiet).toBeNull();
        expect(s.record.quiet?.start).toBe('23:00');
        expect(s.record.lastDigestAt).toBe(lastDigestAt);
    });

    it('runs one owner\'s writes one after another, so two quick saves keep both', async () => {
        const s = store();
        await Promise.all([
            updateNotificationSettings(s.storage, OWNER, cur => ({ ...cur, senders: { ...cur.senders, 'agent:a': { muted: true } } })),
            updateNotificationSettings(s.storage, OWNER, cur => ({ ...cur, senders: { ...cur.senders, 'agent:b': { push: false } } })),
        ]);
        expect(Object.keys(s.record.senders).sort()).toEqual(['agent:a', 'agent:b']);
    });
});

describe('the two reads', () => {
    it('the strict read throws; the delivery read answers defaults, which deliver everything', async () => {
        const s = store({ groups: { messages: { muted: true } } });
        s.failNextReads(2);
        await expect(readNotificationSettingsStrict(s.storage, OWNER)).rejects.toThrow('getMemory');
        const forgiving = await readNotificationSettings(s.storage, OWNER);
        expect(forgiving.groups).toEqual({});
    });
});
