/**
 * @file welcome-message.test.ts
 * @description Unit tests for the operator's welcome message.
 *
 *   The E2E suite proves the newcomer gets the message. It cannot prove the SELF-SEND GUARD,
 *   because "the operator's inbox is empty" is equally true when no operator resolved at all —
 *   two very different states with one observable. That guard is the one thing here that, if it
 *   regresses, takes a registration down with a primary-key violation rather than degrading, so
 *   it is tested directly against a fake storage where both branches are distinguishable.
 * @usage cd aimeat && pnpm exec vitest run test/unit/welcome-message.test.ts
 * @version-history
 *   v1.0.0 — 2026-08-07 — Initial.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { splitSubjectAndBody } from '../../src/services/welcome-message.js';

const sendDirectMessage = vi.hoisted(() => vi.fn(async () => ({ ok: true as const, message: {} as never })));
const resolveOperatorFeeGhii = vi.hoisted(() => vi.fn(async () => 'boss@node-1' as string | null));

vi.mock('../../src/services/message-send.js', () => ({ sendDirectMessage }));
vi.mock('../../src/services/marketplace-fee.js', () => ({ resolveOperatorFeeGhii }));

const { sendOperatorWelcome } = await import('../../src/services/welcome-message.js');

const config = { nodeId: 'node-1', baseUrl: 'https://example.test' } as never;

/** Only the three reads sendOperatorWelcome makes. */
function fakeStorage(over: Record<string, unknown> = {}) {
    return {
        getSystemPrompt: async () => ({
            id: 'operator-welcome', active: true,
            content: 'Welcome to your new home.\n\nHello {{display_name}}, this is {{node_url}}.',
            locales: { fi: 'Tervetuloa uuteen kotiisi.\n\nHei {{display_name}}.' },
        }),
        getGHII: async () => ({ displayName: 'Aino', locale: 'en' }),
        ...over,
    } as never;
}

describe('splitSubjectAndBody', () => {
    it('takes the first non-empty line as the subject and the rest as the body', () => {
        expect(splitSubjectAndBody('Subject here\n\nBody line one.\nBody line two.'))
            .toEqual({ subject: 'Subject here', body: 'Body line one.\nBody line two.' });
    });

    it('skips leading blank lines rather than producing an empty subject', () => {
        expect(splitSubjectAndBody('\n\n  Real subject\n\nBody.').subject).toBe('Real subject');
    });

    it('handles CRLF, because an operator pasting from Windows is the normal case', () => {
        expect(splitSubjectAndBody('Subject\r\n\r\nBody.')).toEqual({ subject: 'Subject', body: 'Body.' });
    });

    it('a one-line message becomes its own body instead of arriving empty', () => {
        expect(splitSubjectAndBody('Just one line')).toEqual({ subject: 'Just one line', body: 'Just one line' });
    });
});

describe('sendOperatorWelcome', () => {
    beforeEach(() => {
        sendDirectMessage.mockClear();
        resolveOperatorFeeGhii.mockReset();
        resolveOperatorFeeGhii.mockResolvedValue('boss@node-1');
    });

    it('sends to a newcomer, straight into the mailbox', async () => {
        await sendOperatorWelcome(fakeStorage(), config, 'aino');
        expect(sendDirectMessage).toHaveBeenCalledTimes(1);
        const input = sendDirectMessage.mock.calls[0][1] as never as Record<string, unknown>;
        expect(input.senderGhii).toBe('boss@node-1');
        expect(input.recipientGhii).toBe('aino@node-1');
        expect(input.subject).toBe('Welcome to your new home.');
        expect(input.body).toBe('Hello Aino, this is https://example.test.');
        // Without this the operator's first words sit in the first-contact requests bucket.
        expect(input.skipContactGate).toBe(true);
    });

    it('THE GUARD — never sends when the recipient IS the operator', async () => {
        resolveOperatorFeeGhii.mockResolvedValue('boss@node-1');
        await sendOperatorWelcome(fakeStorage(), config, 'boss');
        expect(sendDirectMessage).not.toHaveBeenCalled();
    });

    it('stays silent on a node with no operator yet', async () => {
        resolveOperatorFeeGhii.mockResolvedValue(null);
        await sendOperatorWelcome(fakeStorage(), config, 'aino');
        expect(sendDirectMessage).not.toHaveBeenCalled();
    });

    it('a deactivated prompt turns it off', async () => {
        await sendOperatorWelcome(
            fakeStorage({ getSystemPrompt: async () => ({ id: 'operator-welcome', active: false, content: 'x\n\ny' }) }),
            config, 'aino',
        );
        expect(sendDirectMessage).not.toHaveBeenCalled();
    });

    it('a deleted prompt turns it off rather than throwing into a registration', async () => {
        await expect(sendOperatorWelcome(
            fakeStorage({ getSystemPrompt: async () => null }), config, 'aino',
        )).resolves.toBeUndefined();
        expect(sendDirectMessage).not.toHaveBeenCalled();
    });

    it('serves the Finnish version to an account whose locale is fi', async () => {
        await sendOperatorWelcome(
            fakeStorage({ getGHII: async () => ({ displayName: 'Aino', locale: 'fi' }) }), config, 'aino',
        );
        const input = sendDirectMessage.mock.calls[0][1] as never as Record<string, unknown>;
        expect(input.subject).toBe('Tervetuloa uuteen kotiisi.');
        expect(input.body).toBe('Hei Aino.');
    });

    it('falls back to the owner name when the GHII record has no display name', async () => {
        await sendOperatorWelcome(
            fakeStorage({ getGHII: async () => null }), config, 'aino',
        );
        const input = sendDirectMessage.mock.calls[0][1] as never as Record<string, unknown>;
        expect(input.body).toContain('Hello aino,');
    });
});
