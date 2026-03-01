import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { enableAnonymousAuth } from '../../src/auth/middleware.js';

// These tests validate the anonymous mode config integration
// The actual anonymous auth injection is tested via E2E

describe('anonymous mode config', () => {
    it('loadConfig reads AIMEAT_ANONYMOUS from env', async () => {
        const origVal = process.env.AIMEAT_ANONYMOUS;
        try {
            process.env.AIMEAT_ANONYMOUS = 'true';
            // Dynamically re-import to get fresh config
            const { loadConfig } = await import('../../src/config.js');
            const config = loadConfig();
            expect(config.anonymousMode).toBe(true);
        } finally {
            if (origVal === undefined) delete process.env.AIMEAT_ANONYMOUS;
            else process.env.AIMEAT_ANONYMOUS = origVal;
        }
    });

    it('loadConfig defaults anonymousMode to false', async () => {
        const origVal = process.env.AIMEAT_ANONYMOUS;
        try {
            delete process.env.AIMEAT_ANONYMOUS;
            const { loadConfig } = await import('../../src/config.js');
            const config = loadConfig();
            expect(config.anonymousMode).toBe(false);
        } finally {
            if (origVal !== undefined) process.env.AIMEAT_ANONYMOUS = origVal;
        }
    });

    it('enableAnonymousAuth is callable', () => {
        // Just verify the function exists and doesn't throw
        expect(() => enableAnonymousAuth('test#anon@node', 'anonymous')).not.toThrow();
    });
});
