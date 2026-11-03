/**
 * @file test/unit/notification-sweeps-claim.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The two notification sweeps claim before they send (services/notification-sweeps.ts),
 *   against SqliteStorage(':memory:'): two processes running the digest sweep at once send one
 *   email, and two running the held-push sweep at once send one push. One sweep alone sends as
 *   before and not twice for one batch, and a digest that could not be sent gives its batch back so
 *   the next run mails it.
 * @usage cd aimeat && pnpm exec vitest run test/unit/notification-sweeps-claim.test.ts
 * @version-history
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
    mails = []; mailOk = true;
    setActiveEmailService({
        enabled: true,
        sendRaw: async (_to: string, subject: string) => { await slow(); if (!mailOk) return false; mails.push(subject); return true; },
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
