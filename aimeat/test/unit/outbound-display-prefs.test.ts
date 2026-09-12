/**
 * @file test/unit/outbound-display-prefs.test.ts
 * @description What the node writes TO a person carries that person's own format and clock.
 *
 *   WHY THIS EXISTS. `region` and `timezone` were added to the GHII record on 2026-09-12 for one
 *   stated reason: a browser can tell you its own zone, and it can tell the node nothing at three
 *   in the morning when an hourly sweep is writing an email. The fields shipped, the service that
 *   reads them shipped, and nothing called it — so every date the node sent out was still either a
 *   bare `2026-09-19` sliced off an ISO string or, in the digest, no time at all.
 *
 *   The digest is the case worth pinning. It says "these arrived while you were away" and listed
 *   them with no clock, although the timestamp was passed into the template and dropped on the
 *   floor, and the caller was holding the recipient's whole record while it happened.
 *
 *   THE FALLBACK IS PART OF THE CONTRACT. A recipient who has chosen no zone gets UTC with the
 *   word UTC in the line. An unmarked time in an unknown zone is worse than an ISO string: it
 *   looks local and is not.
 * @usage cd aimeat && pnpm exec vitest run test/unit/outbound-display-prefs.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-12 — Written with the wiring it describes.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage, GHIIRecord } from '../../src/storage/interface.js';
import { setActiveEmailService, type EmailService } from '../../src/services/email.js';
import { sweepNotificationDigests } from '../../src/services/notification-sweeps.js';
import { NOTIF_SETTINGS_KEY } from '../../src/services/notification-settings.js';
import { NOTIF_PREFIX } from '../../src/services/notify.js';
import { formatForPerson } from '../../src/services/display-prefs.js';
import { createEmailInvitation, inviteEmailHash } from '../../src/services/invitations.js';
import type { AimeatConfig } from '../../src/config.js';

const NODE = 'pn-display-prefs';
const WHEN = '2026-09-10T21:30:00.000Z';

let storage: Storage;
/** Every message the node tried to send during one test, in order. */
let sent: Array<{ to: string; subject: string; html: string; text: string }>;
/** What `sendInvite` was handed, which is where the organism invitation's expiry label lives. */
let invites: Array<{ to: string; expiresLabel?: string }>;

/** An email service that sends nothing and remembers everything. */
function recorder(): EmailService {
    const no = async () => true;
    return {
        enabled: true,
        sendVerificationCode: no, sendMagicLink: no, sendNotification: no,
        sendKeyInvite: no, sendKeyCredentials: no, sendWithAttachments: no,
        async sendInvite(to: string, args: { expiresLabel?: string }) {
            invites.push({ to, expiresLabel: args?.expiresLabel });
            return true;
        },
        async sendRaw(to: string, subject: string, html: string, text: string) {
            sent.push({ to, subject, html, text });
            return true;
        },
    } as unknown as EmailService;
}

function ghiiRecord(name: string, over: Partial<GHIIRecord> = {}): GHIIRecord {
    const now = new Date().toISOString();
    return {
        username: name, nodeId: NODE, ghii: `${name}@${NODE}`, displayName: name,
        verificationLevel: 1, ownerName: name, createdAt: now, updatedAt: now,
        totpEnabled: false, publicKey: '',
        notificationEmail: `${name}@example.test`, emailVerifiedAt: now,
        ...over,
    } as GHIIRecord;
}

/** One owner who wants the digest, with one unread notification old enough to be due. */
async function seedOwnerWithDueDigest(name: string, over: Partial<GHIIRecord> = {}): Promise<string> {
    const ghii = `${name}@${NODE}`;
    await storage.createGHII(ghiiRecord(name, over));
    const now = new Date().toISOString();
    await storage.setMemory({
        key: NOTIF_SETTINGS_KEY, ownerGaii: ghii,
        value: { emailDigest: { enabled: true, afterHours: 1 } },
        visibility: 'private', tags: ['notif'], version: 1, createdAt: now, updatedAt: now,
    });
    await storage.setMemory({
        key: `${NOTIF_PREFIX}${WHEN}.aaaaaaaa`, ownerGaii: ghii,
        value: { id: 'n1', type: 'message', title: 'Kalle sent you a file', body: '', read: false, createdAt: WHEN },
        visibility: 'private', tags: ['notif'], version: 1, createdAt: now, updatedAt: now,
    });
    return ghii;
}

const config = { nodeId: NODE, baseUrl: 'https://node.example.test' } as unknown as AimeatConfig;

beforeEach(() => {
    storage = new SqliteStorage(':memory:') as unknown as Storage;
    sent = [];
    invites = [];
    setActiveEmailService(recorder());
});

afterEach(() => {
    setActiveEmailService(null as unknown as EmailService);
});

describe('the digest email is written in the recipient\'s own format and clock', () => {
    it('a Finnish format on a Tokyo clock says 11.9.2026, not 10.9. and not a US date', async () => {
        await seedOwnerWithDueDigest('tokyo', { locale: 'fi', region: 'fi-FI', timezone: 'Asia/Tokyo' });

        const result = await sweepNotificationDigests(storage, config);

        expect(result.sent, 'one digest went out').toBe(1);
        // 21:30 UTC is 06:30 the NEXT DAY in Tokyo: the zone decides the date, not only the clock.
        expect(sent[0].html).toContain('11.9.2026 klo 6.30');
        expect(sent[0].text).toContain('11.9.2026 klo 6.30');
    });

    it('the same moment for a British reader in Helsinki is a different string entirely', async () => {
        await seedOwnerWithDueDigest('brit', { locale: 'en', region: 'en-GB', timezone: 'Europe/Helsinki' });

        await sweepNotificationDigests(storage, config);

        expect(sent[0].html).toContain('11/09/2026, 00:30');
    });

    it('a recipient who chose no zone is told the zone, because an unmarked time reads as local', async () => {
        await seedOwnerWithDueDigest('nopref');

        await sweepNotificationDigests(storage, config);

        // The format follows the runtime, which is the host's business; the ZONE is ours to state.
        expect(sent[0].html).toMatch(/UTC/);
        expect(sent[0].text).toMatch(/UTC/);
    });

    it('and the time is in the message at all, which it was not before', async () => {
        await seedOwnerWithDueDigest('any', { region: 'fi-FI', timezone: 'Europe/Helsinki' });

        await sweepNotificationDigests(storage, config);

        expect(sent[0].text).toContain('11.9.2026');
    });
});

describe('an organism invitation to somebody who already has an account here', () => {
    /** An organism record the invitation code reads but never stores. */
    const organism = {
        id: 'org-1', name: 'Kuoro', slug: 'kuoro', ownerGhii: `host@${NODE}`,
        createdAt: new Date().toISOString(),
    } as unknown as Parameters<typeof createEmailInvitation>[2]['organism'];

    it('writes the expiry in that person\'s regional format, not as an ISO date', async () => {
        const email = 'member@example.test';
        await storage.createGHII(ghiiRecord('member', {
            region: 'fi-FI', timezone: 'Europe/Helsinki',
            emailHash: inviteEmailHash(email), notificationEmail: email,
        }));

        await createEmailInvitation(storage, config, {
            organism, inviterGhii: 'host', email, orgRole: 'member', workspaces: [],
        });

        expect(invites).toHaveLength(1);
        // A Finnish long date, not 2026-09-19. The day itself is whatever the expiry lands on, so
        // the assertion is on the SHAPE: Finnish months are spelled, and the ISO form has no words.
        expect(invites[0].expiresLabel).toMatch(/kuuta \d{4}$/);
    });

    it('and as an ISO date for an address with no account, which has expressed nothing', async () => {
        await createEmailInvitation(storage, config, {
            organism, inviterGhii: 'host', email: 'stranger@example.test', orgRole: 'member', workspaces: [],
        });

        expect(invites[0].expiresLabel).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
});

describe('formatForPerson', () => {
    it('names the zone when the person chose none, and stays quiet when they did', () => {
        const unset = formatForPerson({ locale: null, region: 'fi-FI', timezone: null }, WHEN);
        const set = formatForPerson({ locale: null, region: 'fi-FI', timezone: 'Asia/Tokyo' }, WHEN);
        expect(unset).toMatch(/UTC$/);
        expect(set).not.toMatch(/UTC/);
    });

    it('a stored zone the runtime refuses does not take the message down', () => {
        const out = formatForPerson({ locale: null, region: 'fi-FI', timezone: 'Mars/Olympus' }, WHEN);
        expect(out).toBeTruthy();
        expect(out).not.toBe('');
    });

    it('a value that is not a timestamp comes back as itself rather than as Invalid Date', () => {
        expect(formatForPerson({ locale: null, region: null, timezone: null }, 'not a date')).toBe('not a date');
    });
});
