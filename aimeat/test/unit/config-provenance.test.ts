/**
 * @file test/unit/config-provenance.test.ts
 * @description The provenance registry's answer to "is the node still running with a value whose
 *   database override was removed": true from the removal until something writes the running value
 *   again, and never for a path that had no override to remove.
 * @usage pnpm test -- config-provenance
 * @version-history
 *   v1.0.0 — 2026-10-11 — Initial (awaitsRestart).
 */
import { describe, it, expect } from 'vitest';
import { ConfigProvenance } from '../../src/services/config-provenance.js';

describe('ConfigProvenance.awaitsRestart', () => {
    it('is true after a database override is removed, with the source below it', () => {
        const p = new ConfigProvenance();
        p.initDefaults(['quota.memory_mb']);
        p.markEnv(['quota.memory_mb']);
        p.markDatabase(['quota.memory_mb']);
        expect(p.awaitsRestart('quota.memory_mb')).toBe(false);

        p.revertSource('quota.memory_mb', true, false, false);
        expect(p.getSource('quota.memory_mb')).toBe('env');
        expect(p.awaitsRestart('quota.memory_mb')).toBe(true);
    });

    it('ends when the setting is saved again, because that write changes the running value', () => {
        const p = new ConfigProvenance();
        p.markDatabase(['quota.storage_mb']);
        p.revertSource('quota.storage_mb', false, false, false);
        expect(p.awaitsRestart('quota.storage_mb')).toBe(true);

        p.markDatabase(['quota.storage_mb']);
        expect(p.awaitsRestart('quota.storage_mb')).toBe(false);
    });

    it('stays false for a path that had no database override to remove', () => {
        const p = new ConfigProvenance();
        p.initDefaults(['rate_limits.global']);
        p.revertSource('rate_limits.global', false, false, false);
        expect(p.getSource('rate_limits.global')).toBe('default');
        expect(p.awaitsRestart('rate_limits.global')).toBe(false);
    });
});
