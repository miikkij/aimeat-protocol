/**
 * @file test/unit/email-templates-notification.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The node's notification mail (EmailService.sendNotification) carries text that a
 *   principal other than the node supplies: an extension's ctx.email subject and body, an agent's
 *   completion message in the automation report, a workflow's title. That text is escaped before it
 *   enters the node's branded HTML, and its line breaks show as line breaks (secaudit2026oct22,
 *   email-templates.ts:notificationEmailHtml:unescaped-subject-body). The operator's group mail keeps
 *   notificationEmailHtml, which writes the operator's own text as given.
 * @usage pnpm exec vitest run test/unit/email-templates-notification.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial (secaudit2026oct22).
 */
import { describe, it, expect, vi } from 'vitest';

/** What the stubbed SMTP transport was handed. */
const sent: Array<{ html: string; text: string }> = [];
vi.mock('nodemailer', () => ({
    createTransport: () => ({
        sendMail: async (msg: { html: string; text: string }) => { sent.push({ html: msg.html, text: msg.text }); return {}; },
    }),
}));

const { createEmailService } = await import('../../src/services/email.js');
const { notificationEmailHtml } = await import('../../src/services/email-templates.js');
type AimeatConfig = import('../../src/config.js').AimeatConfig;

/** Send one notification through an EmailService whose transport records the message. */
async function capture(subject: string, body: string): Promise<{ html: string; text: string }> {
    sent.length = 0;
    const service = createEmailService({
        nodeId: 'aimeat-local-001-dev', emailEnabled: true, smtpHost: 'smtp.invalid', smtpPort: 25, smtpFrom: 'node@example.test',
    } as unknown as AimeatConfig);
    const ok = await service.sendNotification('owner@example.test', subject, body);
    expect(ok).toBe(true);
    expect(sent.length).toBe(1);
    return sent[0];
}

describe('sendNotification writes caller text into the branded mail as text', () => {
    it('escapes a tag in the subject and the body', async () => {
        const { html, text } = await capture('Hi <b>there</b>', 'Press <a href="https://evil.example/">Sign in</a>');
        expect(html).not.toContain('<a href="https://evil.example/">');
        expect(html).not.toContain('<b>there</b>');
        expect(html).toContain('&lt;a href=&quot;https://evil.example/&quot;&gt;Sign in&lt;/a&gt;');
        expect(html).toContain('<title>Hi &lt;b&gt;there&lt;/b&gt;</title>');
        // The plain-text part is the text as written.
        expect(text).toContain('Press <a href="https://evil.example/">Sign in</a>');
    });

    it('keeps a plain-text body readable: its line breaks show as line breaks', async () => {
        const { html, text } = await capture('Your automation finished', 'Agent: crewbot\nTask: Weekly digest\n\nSummary: done');
        expect(html).toContain('Agent: crewbot<br>Task: Weekly digest<br><br>Summary: done');
        expect(text).toContain('Agent: crewbot\nTask: Weekly digest\n\nSummary: done');
    });

    it("leaves the operator's group mail template as it was", () => {
        const { html } = notificationEmailHtml('Maintenance', 'Read <a href="https://status.example/">the status page</a>.');
        expect(html).toContain('<a href="https://status.example/">the status page</a>');
    });
});
