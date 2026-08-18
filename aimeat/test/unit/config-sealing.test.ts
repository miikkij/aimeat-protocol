/**
 * @file test/unit/config-sealing.test.ts
 * @description The parts of sealed configuration that are decidable without a running node: what
 *   the boot variable accepts and refuses, and the two writers that reach a config value without
 *   passing an HTTP door.
 *
 *   The Consul case is the one worth stating out loud. `applyConsulValues` is called from three
 *   places — the boot-time load, POST /v1/admin/consul/import, and the LIVE WATCH LOOP that fires
 *   on its own whenever the KV store changes — so a rule enforced at the import route only would
 *   have been enforced on one of the three roads in. Testing the function tests all three.
 * @usage pnpm test -- config-sealing
 * @version-history
 *   v1.0.0 — 2026-08-18 — Initial. docs/plans/sealed-config-plan.md
 */
import { describe, it, expect } from 'vitest';
import { sealedKeysFromEnv, isSealed, sealRefusal, sealedView, hasSealedKeys } from '../../src/services/config-sealing.js';
import { applyConsulValues } from '../../src/services/consul-config.js';
import { classifyValues } from '../../src/cli/config-import.js';
import type { AimeatConfig } from '../../src/config-types.js';

/** Just enough config for the functions under test; each one reads at most three fields. */
function fakeConfig(sealedConfigKeys: string[], values: Record<string, unknown> = {}): AimeatConfig {
    return { sealedConfigKeys, memoryQuotaMb: 10, rlGlobal: 100, metricsEnabled: false, ...values } as unknown as AimeatConfig;
}

describe('sealedKeysFromEnv', () => {
    it('is empty when the variable is unset, which is every self-hosted node', () => {
        expect(sealedKeysFromEnv(undefined)).toEqual([]);
        expect(sealedKeysFromEnv('')).toEqual([]);
        expect(sealedKeysFromEnv('  ,  ,')).toEqual([]);
    });

    it('parses a comma list, trimming and de-duplicating', () => {
        expect(sealedKeysFromEnv(' quota.memory_mb , rate_limits.global,quota.memory_mb '))
            .toEqual(['quota.memory_mb', 'rate_limits.global']);
    });

    it('REFUSES THE BOOT on a path this node does not have', () => {
        // The failure this prevents is silent: a node that starts up looking sealed and is not.
        expect(() => sealedKeysFromEnv('quota.memory_mb,quota.memory')).toThrowError(/quota\.memory\b/);
        expect(() => sealedKeysFromEnv('quota.memory_mb,quota.memory')).toThrowError(/Refusing to start/);
    });

    it('drops a path that is already immutable, and the seal list itself, rather than refusing', () => {
        // So a host can hand the same list to every node it runs without tailoring it per node.
        expect(sealedKeysFromEnv('node.id,node.sealed_config_keys,quota.memory_mb'))
            .toEqual(['quota.memory_mb']);
    });
});

describe('isSealed / sealRefusal / sealedView', () => {
    it('a node that seals nothing seals nothing', () => {
        const config = fakeConfig([]);
        expect(hasSealedKeys(config)).toBe(false);
        expect(isSealed(config, 'quota.memory_mb')).toBe(false);
        expect(sealedView(config)).toEqual([]);
    });

    it('names the setting and says who set it, rather than refusing blankly', () => {
        const refusal = sealRefusal('quota.memory_mb');
        expect(refusal.code).toBe('SEALED_CONFIG');
        expect(refusal.message).toContain('quota.memory_mb');
        expect(refusal.message).toMatch(/runs this node/);
        // The value stays visible; the refusal has to say so, or it reads as data being hidden.
        expect(refusal.message).toMatch(/see what it is/);
    });

    it('carries the VALUE, because the operator is entitled to see what their limits are', () => {
        const config = fakeConfig(['quota.memory_mb'], { memoryQuotaMb: 1024 });
        expect(sealedView(config)).toEqual([
            { path: 'quota.memory_mb', value: 1024, description: expect.stringContaining('Memory quota') },
        ]);
    });
});

describe('applyConsulValues — the boot load, the import route and the watch loop', () => {
    it('applies a mutable path when nothing is sealed', () => {
        const config = fakeConfig([]);
        const out = applyConsulValues(config, { 'quota.memory_mb': '4096' });
        expect(out.applied).toEqual(['quota.memory_mb']);
        expect(out.sealed).toEqual([]);
        expect(config.memoryQuotaMb).toBe(4096);
    });

    it('does not move a sealed value, and reports it apart from a skip', () => {
        const config = fakeConfig(['quota.memory_mb'], { memoryQuotaMb: 1024 });
        const out = applyConsulValues(config, { 'quota.memory_mb': '4096', 'rate_limits.global': '9999' });
        expect(config.memoryQuotaMb).toBe(1024);
        expect(out.sealed).toEqual(['quota.memory_mb']);
        expect(out.applied).toEqual(['rate_limits.global']);
    });
});

describe('aimeat config import', () => {
    it('does not write a sealed path to the database', () => {
        const config = fakeConfig(['quota.memory_mb']);
        const stats = classifyValues({ 'quota.memory_mb': '4096', 'quota.storage_mb': '200', 'node.id': 'x' }, config);
        expect(stats.sealed).toEqual(['quota.memory_mb']);
        expect(stats.mutable).toEqual(['quota.storage_mb']);
        expect(stats.immutable).toEqual(['node.id']);
    });
});
