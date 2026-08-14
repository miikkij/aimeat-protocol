import { describe, it, expect } from 'vitest';
import {
    verificationEmailHtml,
    magicLinkEmailHtml,
    notificationEmailHtml,
    matchSuggestionEmailHtml,
} from '../../src/services/email-templates.js';
import type { MatchSuggestion } from '../../src/services/email-templates.js';

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

describe('matchSuggestionEmailHtml', () => {
    const singleMatch: MatchSuggestion[] = [
        {
            ghii: 'alice@node-1',
            displayName: 'Alice',
            sharedInterests: ['TypeScript', 'AI'],
            distance: '15 km',
        },
    ];

    it('produces HTML with match details', () => {
        const { html, text } = matchSuggestionEmailHtml(singleMatch);
        expect(html).toContain('Alice');
        expect(html).toContain('alice@node-1');
        expect(html).toContain('TypeScript');
        expect(html).toContain('AI');
        expect(html).toContain('15 km');
        expect(text).toContain('Alice');
        expect(text).toContain('alice@node-1');
    });

    it('renders multiple matches', () => {
        const matches: MatchSuggestion[] = [
            { ghii: 'alice@node-1', displayName: 'Alice', sharedInterests: ['AI'] },
            { ghii: 'bob@node-2', displayName: 'Bob', sharedInterests: ['Music'] },
            { ghii: 'carol@node-3', displayName: 'Carol', sharedInterests: ['Cooking'] },
        ];
        const { html, text } = matchSuggestionEmailHtml(matches);
        expect(html).toContain('Alice');
        expect(html).toContain('Bob');
        expect(html).toContain('Carol');
        expect(text).toContain('Alice');
        expect(text).toContain('Bob');
        expect(text).toContain('Carol');
    });

    it('omits distance when not provided', () => {
        const matches: MatchSuggestion[] = [
            { ghii: 'alice@node-1', displayName: 'Alice', sharedInterests: ['AI'] },
        ];
        const { html } = matchSuggestionEmailHtml(matches);
        expect(html).not.toContain('Distance:');
    });

    it('uses Finnish text when locale is fi', () => {
        const { html, text } = matchSuggestionEmailHtml(singleMatch, 'fi');
        expect(html).toContain('Ehdotukset');
        expect(html).toContain('Yhteiset kiinnostukset:');
        expect(html).toContain('Etäisyys:');
        expect(text).toContain('Ehdotukset');
    });
});
