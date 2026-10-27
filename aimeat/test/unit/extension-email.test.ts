/**
 * @file test/unit/extension-email.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description ctx.email (services/extension-email.ts) sends one message to one recipient and draws on
 *   a per-account allowance the operator sets (secaudit2026oct22, lead 325, decided 2026-10-25):
 *     - a `to` naming several addresses is refused with a sentence telling the extension to send one
 *       message per recipient, and nothing is sent, on every tier;
 *     - one recipient still goes out on each tier: the operator's unrestricted grant, the owner's own
 *       verified address, the owner's consent;
 *     - past extensions.email_per_hour the next send is refused with a sentence naming the setting,
 *       counted per account, so another account still sends; 0 is no limit.
 *   FIRST FAIL: before the change a `to` of two addresses went to the mail service as one string, and
 *   the allowance did not exist.
 * @usage cd aimeat && pnpm exec vitest run test/unit/extension-email.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial (secaudit2026oct22, lead 325).
 */
import { describe, it, expect, vi } from 'vitest';
import type { AimeatConfig } from '../../src/config.js';
import type { Storage } from '../../src/storage/interface.js';
import type { EmailService } from '../../src/services/email.js';

vi.mock('../../src/services/extension-consent.js', () => ({
    extensionConsentHolds: vi.fn(async (_s: unknown, ownerGhii: string) => ownerGhii === 'consenting@node-1'),
}));

const { buildExtensionEmail } = await import('../../src/services/extension-email.js');

function mailer() {
    const sent: string[] = [];
    const svc = { enabled: true, sendNotification: vi.fn(async (to: string) => { sent.push(to); return true; }) } as unknown as EmailService;
    return { svc, sent };
}
const storage = {
    getGHII: async (ghii: string) => (ghii === 'alice@node-1' || ghii === 'bob@node-1'
        ? { notificationEmail: `${ghii.split('@')[0]}@example.test`, emailVerifiedAt: '2026-10-01T00:00:00.000Z' } : null),
} as unknown as Storage;
const cfg = (perHour?: number) => ({ nodeId: 'node-1', ...(perHour === undefined ? {} : { extensionEmailPerHour: perHour }) }) as unknown as AimeatConfig;
let n = 0;
const email = (ownerName: string, svc: EmailService, opts: { unrestricted?: boolean; perHour?: number } = {}) => buildExtensionEmail({
    storage, config: cfg(opts.perHour), extName: `mailer${n++}`, ownerName, emailService: svc,
    extConfig: opts.unrestricted ? { emailPolicy: 'unrestricted' } : {},
});

describe('ctx.email names one recipient per message', () => {
    for (const to of ['a@example.test, b@example.test', 'a@example.test;b@example.test', 'Team: a@example.test, b@example.test;',
        // A double quote inside a comment is comment text to the mail library, so this is three
        // recipients to the transport (secaudit2026oct26, isSingleRecipient:quote-inside-comment).
        '(a") x@example.test, y@example.test (") z@example.test']) {
        it(`refuses "${to}" with a sentence, and sends nothing`, async () => {
            const { svc, sent } = mailer();
            await expect(email('ops', svc, { unrestricted: true })(to, 'Hello', 'Body')).rejects.toThrow(/one message per recipient/);
            expect(sent).toEqual([]);
        });
    }

    it('refuses the owner\'s own address with a stranger beside it', async () => {
        const { svc, sent } = mailer();
        await expect(email('alice', svc)('alice@example.test, stranger@example.test', 'Hi', 'Body')).rejects.toThrow(/one message per recipient/);
        expect(sent).toEqual([]);
    });

    it('sends one recipient on each tier: the operator grant, the owner\'s own address, the owner\'s consent', async () => {
        const { svc, sent } = mailer();
        expect(await email('ops', svc, { unrestricted: true })('"Smith, John" <john@example.test>', 'Hi', 'Body')).toBe(true);
        expect(await email('alice', svc)('alice@example.test', 'Hi', 'Body')).toBe(true);
        expect(await email('consenting', svc)('customer@example.test', 'Hi', 'Body')).toBe(true);
        expect(sent).toEqual(['"Smith, John" <john@example.test>', 'alice@example.test', 'customer@example.test']);
    });

    it('a recipient with no tier is still refused as before (false, nothing sent)', async () => {
        const { svc, sent } = mailer();
        expect(await email('alice', svc)('stranger@example.test', 'Hi', 'Body')).toBe(false);
        expect(sent).toEqual([]);
    });
});

describe('the per-account allowance extensions.email_per_hour', () => {
    it('refuses the send past the allowance with a sentence naming the setting, per account', async () => {
        const { svc, sent } = mailer();
        const send = email('quota-a', svc, { unrestricted: true, perHour: 2 });
        expect(await send('one@example.test', 's', 'b')).toBe(true);
        expect(await send('two@example.test', 's', 'b')).toBe(true);
        await expect(send('three@example.test', 's', 'b')).rejects.toThrow(/extensions\.email_per_hour/);
        expect(sent).toEqual(['one@example.test', 'two@example.test']);
        // Another account has its own allowance.
        expect(await email('quota-b', svc, { unrestricted: true, perHour: 2 })('four@example.test', 's', 'b')).toBe(true);
    });

    it('a refused recipient does not use the allowance', async () => {
        const { svc } = mailer();
        const send = email('bob', svc, { perHour: 1 });
        expect(await send('stranger@example.test', 's', 'b')).toBe(false);
        expect(await send('bob@example.test', 's', 'b')).toBe(true);
    });

    it('0 is no limit', async () => {
        const { svc, sent } = mailer();
        const send = email('quota-c', svc, { unrestricted: true, perHour: 0 });
        for (let i = 0; i < 300; i++) expect(await send(`r${i}@example.test`, 's', 'b')).toBe(true);
        expect(sent).toHaveLength(300);
    });
});
