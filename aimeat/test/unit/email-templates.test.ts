import { describe, it, expect } from 'vitest';
import {
    verificationEmailHtml,
    magicLinkEmailHtml,
    notificationEmailHtml,
} from '../../src/services/email-templates.js';

describe('verificationEmailHtml', () => {
    it('produces HTML containing the verification code', () => {
        const { html, text } = verificationEmailHtml('123456');
        expect(html).toContain('123456');
        expect(text).toContain('123456');
    });

    it('produces valid HTML structure', () => {
        const { html } = verificationEmailHtml('999999');
        expect(html).toContain('<!DOCTYPE html>');
        expect(html).toContain('<html');
        expect(html).toContain('<body>');
        expect(html).toContain('</body>');
        expect(html).toContain('</html>');
        expect(html).toContain('AIMEAT');
    });

    it('uses English text by default', () => {
        const { html, text } = verificationEmailHtml('123456');
        expect(html).toContain('Email Verification');
        expect(text).toContain('Email Verification');
        expect(html).toContain('expires in 15 minutes');
    });

    it('uses Finnish text when locale is fi', () => {
        const { html, text } = verificationEmailHtml('123456', 'fi');
        expect(html).toContain('Sähköpostivahvistus');
        expect(text).toContain('Sähköpostivahvistus');
        expect(html).toContain('lang="fi"');
    });
});

describe('magicLinkEmailHtml', () => {
    const testUrl = 'https://example.com/login?token=abc123';

    it('produces HTML containing the login URL', () => {
        const { html, text } = magicLinkEmailHtml(testUrl);
        expect(html).toContain(testUrl);
        expect(text).toContain(testUrl);
    });

    it('includes a sign-in button link', () => {
        const { html } = magicLinkEmailHtml(testUrl);
        expect(html).toContain(`href="${testUrl}"`);
        expect(html).toContain('Sign In');
    });

    it('uses Finnish button text when locale is fi', () => {
        const { html } = magicLinkEmailHtml(testUrl, 'fi');
        expect(html).toContain('Kirjaudu');
        expect(html).toContain('lang="fi"');
    });
});

describe('notificationEmailHtml', () => {
    it('produces HTML with custom subject and body', () => {
        const { html, text } = notificationEmailHtml('Test Subject', 'Test body content');
        expect(html).toContain('Test Subject');
        expect(html).toContain('Test body content');
        expect(text).toContain('Test Subject');
        expect(text).toContain('Test body content');
    });

    it('includes AIMEAT footer', () => {
        const { html, text } = notificationEmailHtml('Subject', 'Body');
        expect(html).toContain('Sent by AIMEAT Protocol');
        expect(text).toContain('Sent by AIMEAT Protocol');
    });
});
