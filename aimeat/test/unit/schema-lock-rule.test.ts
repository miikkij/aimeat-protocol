/**
 * @file test/unit/schema-lock-rule.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The pattern half of the schema lock rule (services/schema-lock-rule.ts) and the
 *   per-kind scope on editing and running a schedule (services/schedule-gate.ts), without a node.
 * @version-history
 *   2026-10-20 — The `extension` kind asks ext:invoke, so the "kind with no word" example is `core`,
 *     and a case covers ext:invoke on create, edit and run (secaudit 2026-10,
 *     SCHEDULE_KIND_SCOPE:extension-kind-asks-no-ext-invoke).
 *   2026-10-16 — Initial (QA audit S2-04, F05a-01, F08a-02).
 */
import { describe, it, expect } from 'vitest';
import { schemaPatternRefusal, schemaLockRefusal } from '../../src/services/schema-lock-rule.js';
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
