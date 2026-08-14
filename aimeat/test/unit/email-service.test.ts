import { describe, it, expect } from 'vitest';
import { createEmailService } from '../../src/services/email.js';
import type { AimeatConfig } from '../../src/config.js';

function makeConfig(overrides: Partial<AimeatConfig> = {}): AimeatConfig {
    return {
        emailEnabled: false,
        smtpHost: null,
        smtpPort: 587,
        smtpUser: null,
        smtpPass: null,
        smtpFrom: 'AIMEAT <noreply@localhost>',
        smtpSecure: false,
        ...overrides,
    } as AimeatConfig;
}

describe('createEmailService (disabled)', () => {
    it('returns a disabled service when emailEnabled is false', () => {
        const service = createEmailService(makeConfig({ emailEnabled: false }));
        expect(service.enabled).toBe(false);
    });

    it('returns a disabled service when no SMTP host is configured', () => {
        const service = createEmailService(makeConfig({ emailEnabled: false, smtpHost: null }));
        expect(service.enabled).toBe(false);
    });

    it('sendVerificationCode returns false when disabled', async () => {
        const service = createEmailService(makeConfig({ emailEnabled: false }));
        const result = await service.sendVerificationCode('test@example.com', '123456');
        expect(result).toBe(false);
    });

    it('sendMagicLink returns false when disabled', async () => {
        const service = createEmailService(makeConfig({ emailEnabled: false }));
        const result = await service.sendMagicLink('test@example.com', 'https://example.com/login');
        expect(result).toBe(false);
    });

    it('sendNotification returns false when disabled', async () => {
        const service = createEmailService(makeConfig({ emailEnabled: false }));
        const result = await service.sendNotification('test@example.com', 'Test', 'Body');
        expect(result).toBe(false);
    });

    it('sendMatchSuggestion returns false when disabled', async () => {
        const service = createEmailService(makeConfig({ emailEnabled: false }));
        const result = await service.sendMatchSuggestion('test@example.com', [
            { ghii: 'alice@node1', displayName: 'Alice', sharedInterests: ['AI'] },
        ]);
        expect(result).toBe(false);
    });
});

describe('createEmailService (enabled)', () => {
    it('returns an enabled service when SMTP is configured', () => {
        const service = createEmailService(makeConfig({
            emailEnabled: true,
            smtpHost: 'smtp.example.com',
            smtpPort: 587,
            smtpUser: 'user',
            smtpPass: 'pass',
            smtpFrom: 'test@example.com',
            smtpSecure: false,
        }));
        expect(service.enabled).toBe(true);
    });

    it('creates transport without auth when no user provided', () => {
        const service = createEmailService(makeConfig({
            emailEnabled: true,
            smtpHost: 'smtp.example.com',
            smtpPort: 25,
            smtpUser: null,
            smtpPass: null,
            smtpFrom: 'test@example.com',
            smtpSecure: false,
        }));
        expect(service.enabled).toBe(true);
    });
});
