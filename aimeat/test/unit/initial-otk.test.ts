import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { OtkRecord } from '../../src/storage/interface.js';

function makeInitialOtk(key: string, ownerGaii: string): OtkRecord {
    return {
        key,
        ownerGaii,
        action: 'initial',
        params: {},
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60_000).toISOString(), // far future
        initial: true,
        used: false,
        usedAt: null,
        sessionId: null,
        createdAt: new Date().toISOString(),
    };
}

function makeRegularOtk(key: string, ownerGaii: string, ttlMs: number = 60_000): OtkRecord {
    return {
        key,
        ownerGaii,
        action: 'session',
        params: {},
        expiresAt: new Date(Date.now() + ttlMs).toISOString(),
        initial: false,
        used: false,
        usedAt: null,
        sessionId: null,
        createdAt: new Date().toISOString(),
    };
}

describe('Initial OTK — consumeOtk behavior', () => {
    let storage: SqliteStorage;

    beforeEach(() => {
        storage = new SqliteStorage(':memory:');
    });

    it('activates timer on first use of initial OTK', async () => {
        const otk = makeInitialOtk('otk-init1', 'agent#owner@node');
        await storage.createOtk(otk);

        const result = await storage.consumeOtk('otk-init1', 5_000);
        expect(result).not.toBeNull();
        expect(result!.used).toBe(true);
        expect(result!.usedAt).not.toBeNull();
        // expiresAt should now be ~5 seconds in the future, not far future
        const expires = new Date(result!.expiresAt).getTime();
        const now = Date.now();
        expect(expires - now).toBeLessThan(6_000);
        expect(expires - now).toBeGreaterThan(3_000);
    });

    it('allows reuse within grace period after activation', async () => {
        const otk = makeInitialOtk('otk-init2', 'agent#owner@node');
        await storage.createOtk(otk);

        // First use activates
        const first = await storage.consumeOtk('otk-init2', 60_000);
        expect(first).not.toBeNull();

        // Second use within grace should succeed
        const second = await storage.consumeOtk('otk-init2', 60_000);
        expect(second).not.toBeNull();
        expect(second!.key).toBe('otk-init2');
    });

    it('initial OTK stays usable before first use (dormant)', async () => {
        const otk = makeInitialOtk('otk-dormant', 'agent#owner@node');
        await storage.createOtk(otk);

        // Simulate time passing — the OTK has far-future expiry, should still work
        const result = await storage.consumeOtk('otk-dormant', 60_000);
        expect(result).not.toBeNull();
        expect(result!.initial).toBe(true);
    });

    it('expires initial OTK after grace period post first use', async () => {
        const otk = makeInitialOtk('otk-expire', 'agent#owner@node');
        await storage.createOtk(otk);

        // First use with very short grace (1ms)
        const first = await storage.consumeOtk('otk-expire', 1);
        expect(first).not.toBeNull();

        // Wait for grace to expire
        await new Promise(r => setTimeout(r, 10));

        // Should now be expired
        const second = await storage.consumeOtk('otk-expire', 1);
        expect(second).toBeNull();
    });

    it('regular OTK is not treated as initial', async () => {
        const otk = makeRegularOtk('otk-reg1', 'agent#owner@node');
        await storage.createOtk(otk);

        const result = await storage.consumeOtk('otk-reg1', 60_000);
        expect(result).not.toBeNull();
        expect(result!.initial).toBe(false);
        expect(result!.used).toBe(true);
    });

    it('returns null for non-existent OTK', async () => {
        const result = await storage.consumeOtk('otk-nonexistent', 60_000);
        expect(result).toBeNull();
    });

    it('preserves ownerGaii on initial OTK consumption', async () => {
        const otk = makeInitialOtk('otk-owner', 'myagent#myowner@mynode');
        await storage.createOtk(otk);

        const result = await storage.consumeOtk('otk-owner', 60_000);
        expect(result).not.toBeNull();
        expect(result!.ownerGaii).toBe('myagent#myowner@mynode');
    });
});
