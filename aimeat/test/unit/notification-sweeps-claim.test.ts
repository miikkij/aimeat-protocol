/**
 * @file test/unit/notification-sweeps-claim.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The two notification sweeps claim before they send (services/notification-sweeps.ts),
 *   against SqliteStorage(':memory:'): two processes running the digest sweep at once send one
 *   email, and two running the held-push sweep at once send one push. One sweep alone sends as
 *   before and not twice for one batch, and a digest that could not be sent gives its batch back so
 *   the next run mails it. The digest windows meet end to end: a notification that arrived after one
 *   digest's cutoff and before its send time goes in the next digest, and none goes in two.
 * @usage cd aimeat && pnpm exec vitest run test/unit/notification-sweeps-claim.test.ts
 * @version-history
 *   v1.1.0 -- 2026-11-08 -- The digest windows meet end to end: the bookmark is the cutoff, not the send time.
 *   v1.0.0 -- 2026-11-04 -- Initial (codebase analysis 2026-11-03, HA stage 1, run-once sweeps that send).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { AimeatConfig } from '../../src/config.js';
import type { Storage, GHIIRecord } from '../../src/storage/interface.js';
import type { PushService } from '../../src/services/push.js';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import { setActiveEmailService, type EmailService } from '../../src/services/email.js';
import { sweepNotificationDigests, sweepHeldPushes } from '../../src/services/notification-sweeps.js';
import { NOTIF_SETTINGS_KEY } from '../../src/services/notification-settings.js';
import { NOTIF_PREFIX } from '../../src/services/notify.js';

const NODE = 'sweep-claim-node';
const NAME = 'alice';
const OWNER = `${NAME}@${NODE}`;
const config = { nodeId: NODE, baseUrl: 'https://node.example.test' } as unknown as AimeatConfig;

let storage: Storage;
let mails: string[];
let texts: string[];
let mailOk: boolean;

async function seed(settings: Record<string, unknown>, notifs: Array<Record<string, unknown>>): Promise<void> {
    const now = new Date().toISOString();
    await storage.createGHII({
        username: NAME, nodeId: NODE, ghii: OWNER, displayName: NAME, verificationLevel: 1, ownerName: NAME,
        createdAt: now, updatedAt: now, totpEnabled: false, publicKey: '',
        notificationEmail: `${NAME}@example.test`, emailVerifiedAt: now,
    } as GHIIRecord);
    await storage.setMemory({ key: NOTIF_SETTINGS_KEY, ownerGaii: OWNER, value: settings, visibility: 'private', tags: ['notif'], version: 1, createdAt: now, updatedAt: now });
    for (const n of notifs) {
        await storage.setMemory({ key: `${NOTIF_PREFIX}${n.createdAt}.${n.id}`, ownerGaii: OWNER, value: n, visibility: 'private', tags: ['notif'], version: 1, createdAt: now, updatedAt: now });
    }
}

const twoHoursAgo = () => new Date(Date.now() - 2 * 3_600_000).toISOString();
const notif = (id: string, over: Record<string, unknown> = {}) => ({ id, type: 'report', title: `T ${id}`, body: 'b', link: '', read: false, createdAt: twoHoursAgo(), ...over });
const slow = () => new Promise(r => setTimeout(r, 10));

beforeEach(() => {
    storage = new SqliteStorage(':memory:') as unknown as Storage;
    mails = []; texts = []; mailOk = true;
    setActiveEmailService({
        enabled: true,
        sendRaw: async (_to: string, subject: string, _html: string, text: string) => { await slow(); if (!mailOk) return false; mails.push(subject); texts.push(text); return true; },
    } as unknown as EmailService);
});
afterEach(() => {
    setActiveEmailService(null as unknown as EmailService);
    (storage as unknown as { close(): void }).close();
});

describe('the digest sweep', () => {
    const settings = { emailDigest: { enabled: true, afterHours: 1 } };

    it('sends one email when two processes sweep at once', async () => {
        await seed(settings, [notif('n1')]);
        const [a, b] = await Promise.all([sweepNotificationDigests(storage, config), sweepNotificationDigests(storage, config)]);
        expect(a.sent + b.sent).toBe(1);
        expect(mails).toHaveLength(1);
    });

    it('sends as before from one sweep, and not again for the same batch', async () => {
        await seed(settings, [notif('n1')]);
        expect((await sweepNotificationDigests(storage, config)).sent).toBe(1);
        expect((await sweepNotificationDigests(storage, config)).sent).toBe(0);
        expect(mails).toHaveLength(1);
    });

    it('gives the batch back when the email could not be sent, so the next run mails it', async () => {
        await seed(settings, [notif('n1')]);
        mailOk = false;
        expect((await sweepNotificationDigests(storage, config)).sent).toBe(0);
        mailOk = true;
        expect((await sweepNotificationDigests(storage, config)).sent).toBe(1);
        expect(mails).toHaveLength(1);
    });
});

describe('the digest windows meet end to end', () => {
    // afterHours 1. The first run at T mails what is at least an hour old; "late" arrived 30 minutes
    // before T, after that run's cutoff (T - 1 h) and before its send time (T).
    const settings = { emailDigest: { enabled: true, afterHours: 1 } };
    const H = 3_600_000;
    const T = Date.parse('2026-11-08T12:00:00.000Z');
    const at = (ms: number) => new Date(ms).toISOString();

    it('a notification created after one digest\'s cutoff but before its send time appears in the next digest', async () => {
        await seed(settings, [notif('early', { createdAt: at(T - 2 * H) }), notif('late', { createdAt: at(T - 0.5 * H) })]);
        expect((await sweepNotificationDigests(storage, config, T)).sent).toBe(1);
        expect(texts[0]).toContain('T early');
        expect(texts[0]).not.toContain('T late');
        // An hour later "late" is 1.5 h old. With the send time as the bookmark it was older than the
        // bookmark and never mailed: this run sent 0.
        expect((await sweepNotificationDigests(storage, config, T + H)).sent).toBe(1);
        expect(texts[1]).toContain('T late');
    });

    it('nothing appears in two digests, over runs an hour apart', async () => {
        await seed(settings, [
            notif('a1', { createdAt: at(T - 3 * H) }), notif('a2', { createdAt: at(T - 0.9 * H) }),
            notif('a3', { createdAt: at(T - 0.1 * H) }), notif('a4', { createdAt: at(T + 0.5 * H) }),
        ]);
        for (let i = 0; i < 4; i++) await sweepNotificationDigests(storage, config, T + i * H);
        const all = texts.join('\n');
        for (const id of ['a1', 'a2', 'a3', 'a4']) {
            expect(all.split(`T ${id}`).length - 1, `${id} is mailed exactly once`).toBe(1);
        }
        // A run with nothing new past the bookmark sends nothing.
        expect((await sweepNotificationDigests(storage, config, T + 4 * H)).sent).toBe(0);
    });
});

describe('the held-push sweep', () => {
    /** Quiet hours that ended a minute ago, in UTC. */
    function quietJustEnded() {
        const end = new Date(Date.now() - 60_000);
        const hhmm = (d: Date) => `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
        return { quiet: { start: hhmm(new Date(end.getTime() - 3_600_000)), end: hhmm(end), tz: 'UTC', breakthrough: [] } };
    }
    let pushes: string[];
    const push = {
        enabled: true,
        sendNotification: async (_owner: string, p: { title: string }) => { await slow(); pushes.push(p.title); return true; },
    } as unknown as PushService;

    it('sends one push when two processes sweep at once, and clears every mark', async () => {
        pushes = [];
        await seed(quietJustEnded(), [notif('n1', { held: true }), notif('n2', { held: true })]);
        const [a, b] = await Promise.all([sweepHeldPushes(storage, config, push, 6), sweepHeldPushes(storage, config, push, 6)]);
        expect(a.pushed + b.pushed).toBe(1);
        expect(pushes).toEqual(['2 notifications while you were quiet']);
        const stillHeld = (await storage.listMemory(OWNER, { prefix: NOTIF_PREFIX })).filter(r => (r.value as { held?: boolean }).held);
        expect(stillHeld).toHaveLength(0);
    });

    it('sends as before from one sweep, and nothing on the next', async () => {
        pushes = [];
        await seed(quietJustEnded(), [notif('n1', { held: true })]);
        expect((await sweepHeldPushes(storage, config, push, 6)).pushed).toBe(1);
        expect((await sweepHeldPushes(storage, config, push, 6)).pushed).toBe(0);
        expect(pushes).toEqual(['T n1']);
    });
});
