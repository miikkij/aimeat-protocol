/**
 * @file test/unit/registration-invite-no-mail.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The registration invite on a node without mail (feature-list audit #23).
 *
 *   A node whose email service is disabled answered POST /v1/registration-invites with "sent" and
 *   told the AI to say "Check your email", while nothing went out; GET / offered the invite on such
 *   a node too. Now the service writes no invitation and reports mailUnavailable, and the
 *   getting_started narrative offers the invite only when the node can send mail.
 * @usage cd aimeat && pnpm exec vitest run test/unit/registration-invite-no-mail.test.ts
 * @version-history
 *   2026-10-16 — A send that fails cancels the invitation and a retry sends again (QA audit F02a-04).
 *   2026-10-15 — Initial (feature-list audit #23).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { createRegistrationInvitation } from '../../src/services/invitations-agent-door.js';
import { buildGettingStarted } from '../../src/data/getting-started.js';
import { setActiveEmailService, type EmailService } from '../../src/services/email.js';
import type { Storage } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';

const config = { baseUrl: 'https://node.example', nodeId: 'test-node' } as unknown as AimeatConfig;
const input = {
    email: 'person@example.org',
    agent: { model: 'claude-opus-5' },
    observed: { ip: '127.0.0.1', userAgent: 'test', at: new Date().toISOString() },
};

function recordingStorage(): { storage: Storage; created: Array<{ id: string; status: string }> } {
    const created: Array<{ id: string; status: string }> = [];
    const storage = {
        // The per-address cap reads what is still pending, as the real repository does.
        listInvitationsByEmailHash: async () => created.filter(r => r.status === 'pending'),
        createInvitation: async (rec: { id: string; status: string }) => { created.push(rec); return rec; },
        updateInvitation: async (id: string, updates: { status?: string }) => {
            const rec = created.find(r => r.id === id);
            if (rec && updates.status) rec.status = updates.status;
            return rec ?? null;
        },
    } as unknown as Storage;
    return { storage, created };
}

function mailService(enabled: boolean, sent: string[], delivers = true): EmailService {
    return {
        enabled,
        sendRaw: async (to: string) => { sent.push(to); return delivers; },
    } as unknown as EmailService;
}

afterEach(() => { setActiveEmailService(null as unknown as EmailService); });

describe('createRegistrationInvitation without mail', () => {
    it('writes no invitation and reports mailUnavailable when the email service is disabled', async () => {
        const sent: string[] = [];
        setActiveEmailService(mailService(false, sent));
        const { storage, created } = recordingStorage();
        const result = await createRegistrationInvitation(storage, config, input);
        expect(result.mailUnavailable).toBe(true);
        expect(result.emailSent).toBe(false);
        expect(result.invitation).toBeNull();
        expect(created).toHaveLength(0);
        expect(sent).toHaveLength(0);
    });

    it('reports mailUnavailable when no email service is active at all', async () => {
        const { storage, created } = recordingStorage();
        const result = await createRegistrationInvitation(storage, config, input);
        expect(result.mailUnavailable).toBe(true);
        expect(created).toHaveLength(0);
    });

    it('still refuses a malformed address before the mail check', async () => {
        const { storage } = recordingStorage();
        await expect(createRegistrationInvitation(storage, config, { ...input, email: 'nope' }))
            .rejects.toMatchObject({ code: 'INVALID_INPUT' });
    });

    it('writes and sends the invitation when the email service is enabled', async () => {
        const sent: string[] = [];
        setActiveEmailService(mailService(true, sent));
        const { storage, created } = recordingStorage();
        const result = await createRegistrationInvitation(storage, config, input);
        expect(result.mailUnavailable).toBe(false);
        expect(result.emailSent).toBe(true);
        expect(created).toHaveLength(1);
        expect(sent).toEqual(['person@example.org']);
        expect(result.sendFailed).toBe(false);
    });

    // QA audit F02a-04: a failed send answered "sent" and left a pending row that suppressed every
    // retry for the address for 24 hours.
    it('a send that fails reports sendFailed, cancels the invitation, and a retry sends again', async () => {
        const sent: string[] = [];
        setActiveEmailService(mailService(true, sent, false));
        const { storage, created } = recordingStorage();
        const first = await createRegistrationInvitation(storage, config, input);
        expect(first.sendFailed).toBe(true);
        expect(first.emailSent).toBe(false);
        expect(first.invitation).toBeNull();
        expect(created.map(r => r.status)).toEqual(['cancelled']);

        setActiveEmailService(mailService(true, sent, true));
        const retry = await createRegistrationInvitation(storage, config, input);
        expect(retry.suppressed).toBeNull();
        expect(retry.emailSent).toBe(true);
        expect(sent).toEqual(['person@example.org', 'person@example.org']);
    });
});

describe('buildGettingStarted', () => {
    const noAccount = (canSendMail: boolean) => JSON.stringify(
        (buildGettingStarted('https://node.example', 'hi', false, canSendMail) as any)
            .step_2_connect_to_user.paths.no_account);

    it('offers the registration invite only when the node can send mail', () => {
        expect(noAccount(true)).toContain('/v1/registration-invites');
        expect(noAccount(false)).not.toContain('/v1/registration-invites');
    });

    it('gives the portal link on a node without mail', () => {
        expect(noAccount(false)).toContain('https://node.example/v1/portal');
    });
});
