/**
 * @file test/unit/schema-lock-rule.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The pattern half of the schema lock rule (services/schema-lock-rule.ts) and the
 *   per-kind scope on editing and running a schedule (services/schedule-gate.ts), without a node.
 * @version-history
 *   2026-11-08 — Cases for rule 4 over the keys a wildcard reaches (wildcardTakesOver) and rule 5, the
 *     csm. family (secaudit2026nov08 round 14).
 *   2026-10-20 — The `extension` kind asks ext:invoke, so the "kind with no word" example is `core`,
 *     and a case covers ext:invoke on create, edit and run (secaudit 2026-10,
 *     SCHEDULE_KIND_SCOPE:extension-kind-asks-no-ext-invoke).
 *   2026-10-16 — Initial (QA audit S2-04, F05a-01, F08a-02).
 */
import { describe, it, expect } from 'vitest';
import { schemaPatternRefusal, schemaLockRefusal, wildcardTakesOver } from '../../src/services/schema-lock-rule.js';
import { scheduleKindScopeRefusal } from '../../src/services/schedule-gate.js';
import type { AimeatConfig } from '../../src/config.js';
import type { Storage, SchemaRecord } from '../../src/storage/interface.js';

const config = { nodeId: 'node-1' } as AimeatConfig;
const plain = { principal: 'alice@node-1', owner: 'alice', roles: ['owner'], isOperator: false };
const operator = { ...plain, isOperator: true };

function storageWith(locks: SchemaRecord[]): Storage {
    return {
        async getSchema(keyPattern: string, applyTo?: 'exact' | 'prefix') {
            return locks.find(l => l.keyPattern === keyPattern && (!applyTo || l.applyTo === applyTo)) ?? null;
        },
        async findApplicableSchema(key: string) {
            const exact = locks.find(l => l.applyTo === 'exact' && l.keyPattern === key);
            if (exact) return exact;
            const parts = key.split('.');
            for (let i = parts.length - 1; i >= 1; i--) {
                const row = locks.find(l => l.applyTo === 'prefix' && l.keyPattern === parts.slice(0, i).join('.'));
                if (row) return row;
            }
            return null;
        },
    } as unknown as Storage;
}
const row = (keyPattern: string, applyTo: 'exact' | 'prefix', lockedBy: string): SchemaRecord =>
    ({ keyPattern, applyTo, lockedBy, schemaJson: {}, schemaMode: 'strict', setAt: '', updatedAt: '' });

describe('schemaPatternRefusal', () => {
    const deps = { storage: storageWith([]), config };
    it.each(['**', '*', '**.a.b', '*.x', 's*', 'organism*', ':*'])('refuses the node-wide pattern %s for a plain owner', async (p) => {
        expect((await schemaPatternRefusal(deps, plain, p))?.code).toBe('SCHEMA_PATTERN_NODE_WIDE');
    });
    it.each(['notes', 'recipe:*', 'chart:*', 'profile.*.interests'])('admits %s for a plain owner', async (p) => {
        expect(await schemaPatternRefusal(deps, plain, p)).toBeNull();
    });
    it.each(['organism.*.shared', 'organism', 'organism.*'])('refuses the every-organism pattern %s', async (p) => {
        expect((await schemaPatternRefusal(deps, plain, p))?.code).toBe('SCHEMA_PATTERN_NODE_WIDE');
    });
    it('admits every pattern for the operator', async () => {
        expect(await schemaPatternRefusal(deps, operator, '**')).toBeNull();
    });
});

describe('schemaLockRefusal', () => {
    it('refuses a lock beside another account\'s lock on the same pattern', async () => {
        const deps = { storage: storageWith([row('notes', 'prefix', 'bob')]), config };
        const r = await schemaLockRefusal(deps, plain, 'notes', 'exact', async () => false);
        expect(r?.code).toBe('SCHEMA_LOCKED_BY_OTHER');
    });
    it('refuses a more specific lock under another account\'s lock', async () => {
        const deps = { storage: storageWith([row('notes', 'prefix', 'system@node-1')]), config };
        expect((await schemaLockRefusal(deps, plain, 'notes.mine', 'prefix', async () => false))?.code).toBe('SCHEMA_LOCKED_BY_OTHER');
    });
    it('admits a lock beside or under the account\'s own lock, its agent\'s included', async () => {
        const deps = { storage: storageWith([row('notes', 'prefix', 'bot#alice@node-1')]), config };
        expect(await schemaLockRefusal(deps, plain, 'notes', 'exact', async () => false)).toBeNull();
        expect(await schemaLockRefusal(deps, plain, 'notes.mine', 'prefix', async () => false)).toBeNull();
    });
    it('lets the operator override, asking with the holder of the lock in the way', async () => {
        const asked: string[] = [];
        const deps = { storage: storageWith([row('notes', 'prefix', 'bob')]), config };
        expect(await schemaLockRefusal(deps, plain, 'notes', 'exact', async (who) => { asked.push(who); return true; })).toBeNull();
        expect(asked).toEqual(['bob']);
    });
});

describe('wildcardTakesOver (rule 4 for the keys a wildcard reaches)', () => {
    it.each([
        ['recipes.*.*', 'recipes.italian'],
        ['recipes.**', 'recipes.italian'],
        ['csm.alice.**', 'csm.alice.weather'],
        ['recipes.*.x', 'recipes.italian'],
        ['chart:*', 'chart:sales'],
        ['profile.*.*', 'profile.*.interests'],
    ])('%s outranks the prefix lock %s on a key both reach', (pattern, other) => {
        expect(wildcardTakesOver(pattern, { keyPattern: other, applyTo: 'prefix' })).toBe(true);
    });
    it.each([
        ['recipes.*.*', 'notes.italian', 'prefix'],
        ['recipes.*', 'recipes.*.x', 'prefix'],
        ['recipes.*.*', 'recipes.italian', 'exact'],
        ['recipes.*.*', 'recipes.*.*', 'prefix'],
        ['recipes.italian', 'recipes.italian.x', 'prefix'],
        ['chart:*', 'drawing:x', 'prefix'],
    ] as const)('%s does not take over %s (%s)', (pattern, other, applyTo) => {
        expect(wildcardTakesOver(pattern, { keyPattern: other, applyTo })).toBe(false);
    });
});

describe('schemaLockRefusal: a wildcard over another account\'s deeper lock, and the csm. family', () => {
    function withCsms(locks: SchemaRecord[], csms: Array<{ name: string; registeredBy: string }>): Storage {
        return { ...storageWith(locks), async listSchemas() { return locks; }, async listCsms() { return csms; } } as unknown as Storage;
    }
    it('refuses a wildcard that outranks another account\'s two-segment lock, and admits it over the account\'s own', async () => {
        const theirs = { storage: withCsms([row('recipes.italian', 'prefix', 'bob')], []), config };
        expect((await schemaLockRefusal(theirs, plain, 'recipes.*.*', 'prefix', async () => false))?.code).toBe('SCHEMA_LOCKED_BY_OTHER');
        const own = { storage: withCsms([row('recipes.italian', 'prefix', 'bot#alice@node-1')], []), config };
        expect(await schemaLockRefusal(own, plain, 'recipes.*.*', 'prefix', async () => false)).toBeNull();
        expect(await schemaLockRefusal(theirs, plain, 'recipes.*.*', 'prefix', async () => true)).toBeNull();
    });
    it('reserves csm.<name> to the registering account, and an unregistered name to the account it starts with', async () => {
        const deps = { storage: withCsms([], [{ name: 'bob.sensor', registeredBy: 'bob' }, { name: 'legacy', registeredBy: 'alice' }]), config };
        expect((await schemaPatternRefusal(deps, plain, 'csm.bob.sensor'))?.code).toBe('SCHEMA_PATTERN_NOT_YOURS');
        expect((await schemaPatternRefusal(deps, plain, 'csm.bob.later'))?.code).toBe('SCHEMA_PATTERN_NOT_YOURS');
        expect((await schemaPatternRefusal(deps, plain, 'csm.**'))?.code).toBe('SCHEMA_PATTERN_NOT_YOURS');
        expect((await schemaPatternRefusal(deps, plain, 'csm'))?.code).toBe('SCHEMA_PATTERN_NOT_YOURS');
        expect(await schemaPatternRefusal(deps, plain, 'csm.alice.later')).toBeNull();
        expect(await schemaPatternRefusal(deps, plain, 'csm.legacy.detail')).toBeNull();
        expect(await schemaPatternRefusal(deps, { ...plain, principal: 'bot#alice@node-1', roles: ['agent'] }, 'csm.alice.**')).toBeNull();
        expect(await schemaPatternRefusal(deps, operator, 'csm.bob.sensor')).toBeNull();
        expect(await schemaPatternRefusal(deps, plain, 'csmnotes.x')).toBeNull();
    });
});

describe('rule 5 asks for the registering account, and answers alike for a CSM the caller may not read (round 15)', () => {
    const CSM_AT = '2026-03-01T00:00:00.000Z';
    function nodeWith(csms: Array<Record<string, unknown>>, owners: Record<string, string>): Storage {
        return {
            ...storageWith([]),
            async listSchemas() { return []; },
            async listCsms() { return csms; },
            async getCsm(name: string) { return csms.find(c => c.name === name) ?? null; },
            async getOwner(name: string) { return owners[name] ? { name, createdAt: owners[name] } : null; },
        } as unknown as Storage;
    }
    const sensor = { name: 'alice.sensor', registeredBy: 'alice', registeredAt: CSM_AT, jsonSchemaKey: 'csm.alice.sensor', visibility: 'public' };
    it('refuses a later account of the registering account\'s name, and admits the registering account and its agent', async () => {
        const later = { storage: nodeWith([sensor], { alice: '2026-06-01T00:00:00.000Z' }), config };
        expect((await schemaPatternRefusal(later, plain, 'csm.alice.sensor'))?.code).toBe('SCHEMA_PATTERN_NOT_YOURS');
        expect((await schemaPatternRefusal(later, plain, 'csm.alice.sensor.detail'))?.code).toBe('SCHEMA_PATTERN_NOT_YOURS');
        const same = { storage: nodeWith([sensor], { alice: '2026-01-01T00:00:00.000Z' }), config };
        expect(await schemaPatternRefusal(same, plain, 'csm.alice.sensor')).toBeNull();
        expect(await schemaPatternRefusal(same, { ...plain, principal: 'bot#alice@node-1', roles: ['agent'] }, 'csm.alice.sensor')).toBeNull();
        expect(await schemaPatternRefusal(later, operator, 'csm.alice.sensor')).toBeNull();
    });
    it('gives the same reason for another account\'s private CSM as for a name nobody registered', async () => {
        const bob = { ...plain, principal: 'bob@node-1', owner: 'bob' };
        const deps = { storage: nodeWith([{ ...sensor, name: 'alice.secret', jsonSchemaKey: 'csm.alice.secret', visibility: 'private' }, sensor], { alice: '2026-01-01T00:00:00.000Z', bob: '2026-01-01T00:00:00.000Z' }), config };
        const hidden = await schemaPatternRefusal(deps, bob, 'csm.alice.secret');
        const missing = await schemaPatternRefusal(deps, bob, 'csm.alice.nothing');
        expect(hidden?.code).toBe('SCHEMA_PATTERN_NOT_YOURS');
        expect(hidden?.details?.reason).toBe(missing?.details?.reason);
        // A CSM bob may read is still named as another account's.
        expect((await schemaPatternRefusal(deps, bob, 'csm.alice.sensor'))?.details?.reason).toBe('registered_by_other');
    });
});

describe('scheduleKindScopeRefusal', () => {
    const agent = { isOwnerSession: false, scopes: ['task:write', 'workflow:write'] };
    it('refuses editing and running an ai schedule without ai:use', () => {
        expect(scheduleKindScopeRefusal('ai', agent, 'edit')?.code).toBe('SCOPE_DENIED');
        expect(scheduleKindScopeRefusal('ai', agent, 'run')?.message).toMatch(/^Running a "ai" schedule requires the "ai:use" scope/);
    });
    it('admits a caller holding the word, the owner in person, and a kind with no word', () => {
        expect(scheduleKindScopeRefusal('ai', { isOwnerSession: false, scopes: ['ai:use'] }, 'run')).toBeNull();
        expect(scheduleKindScopeRefusal('ai', { isOwnerSession: true, scopes: [] }, 'edit')).toBeNull();
        // Every user kind has a word since 2026-10-20; `core` (a node job, not in SCHEDULE_KIND_SCOPE)
        // stands for a kind with none.
        expect(scheduleKindScopeRefusal('core', agent, 'run')).toBeNull();
    });
    it('refuses creating, editing and running an extension schedule without ext:invoke, and admits it with the word', () => {
        expect(scheduleKindScopeRefusal('extension', agent, 'create')?.code).toBe('SCOPE_DENIED');
        expect(scheduleKindScopeRefusal('extension', agent, 'edit')?.code).toBe('SCOPE_DENIED');
        expect(scheduleKindScopeRefusal('extension', agent, 'run')?.message).toMatch(/^Running a "extension" schedule requires the "ext:invoke" scope/);
        expect(scheduleKindScopeRefusal('extension', { isOwnerSession: false, scopes: [...agent.scopes, 'ext:invoke'] }, 'run')).toBeNull();
        expect(scheduleKindScopeRefusal('extension', { isOwnerSession: true, scopes: [] }, 'run')).toBeNull();
    });
});
