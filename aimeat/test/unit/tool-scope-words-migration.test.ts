/**
 * @file test/unit/tool-scope-words-migration.test.ts
 * @description What the one-time migration for the 2026-10-06 tool scope words hands to which agent.
 *   The workspace read tools started asking organism:read and aimeat_dm_send_as_owner started asking
 *   messages:send as well (secaudit 2026-10 follow-up, A4). An agent approved before that keeps the
 *   tools it had; an agent approved after, a wildcard agent and an agent with no scope list are left
 *   alone, and organism:write is never handed out.
 * @usage pnpm test -- tool-scope-words-migration
 * @version-history
 *   v1.0.0 — 2026-10-06 — Initial (secaudit 2026-10 follow-up audit, finding 1).
 */
import { describe, it, expect } from 'vitest';
import {
    migrateToolScopeWordsOnce, carriedForwardWords, TOOL_SCOPE_WORDS_SHIPPED_AT, TOOL_SCOPE_WORDS_KEY,
} from '../../src/services/tool-scope-words-migration.js';
import type { Storage } from '../../src/storage/interface.js';

const BEFORE = '2026-10-01T00:00:00.000Z';
const AFTER = '2026-10-07T00:00:00.000Z';

/** Just enough Storage: list the agents, record what is written back, keep the done record. */
function stubStorage(agents: Array<{ gaii: string; createdAt?: string; defaultScopes?: string[] }>) {
    const written = new Map<string, string[]>();
    const memory = new Map<string, unknown>();
    const storage = {
        listAgents: async () => agents,
        updateAgent: async (gaii: string, patch: { defaultScopes?: string[] }) => {
            if (patch.defaultScopes) written.set(gaii, patch.defaultScopes);
            return undefined;
        },
        getMemory: async (owner: string, key: string) => memory.get(`${owner}/${key}`) ?? null,
        setMemory: async (record: { ownerGaii: string; key: string; value: unknown }) => {
            memory.set(`${record.ownerGaii}/${record.key}`, record);
            return record;
        },
    } as unknown as Storage;
    return { storage, written, memory };
}

describe('carriedForwardWords', () => {
    it('gives organism:read to an agent holding memory:read, and messages:send beside send-as-owner', () => {
        expect(carriedForwardWords(['memory:read', 'memory:write'])).toEqual(['organism:read']);
        expect(carriedForwardWords(['messages:send-as-owner'])).toEqual(['messages:send']);
    });

    it('never gives organism:write, even to an agent holding memory:write', () => {
        expect(carriedForwardWords(['memory:read', 'memory:write'])).not.toContain('organism:write');
        expect(carriedForwardWords(['memory:write'])).toEqual([]);
    });

    it('gives nothing to a wildcard agent or to one that already holds the word', () => {
        expect(carriedForwardWords(['*'])).toEqual([]);
        expect(carriedForwardWords(['memory:read', 'organism:read'])).toEqual([]);
        expect(carriedForwardWords(['memory:read', 'organism:*'])).toEqual([]);
    });
});

describe('migrateToolScopeWordsOnce', () => {
    it('widens only agents approved before the words shipped, and writes the done record', async () => {
        const { storage, written, memory } = stubStorage([
            { gaii: 'old#a@node', createdAt: BEFORE, defaultScopes: ['memory:read', 'memory:write', 'catalogue:read'] },
            { gaii: 'new#a@node', createdAt: AFTER, defaultScopes: ['memory:read'] },
            { gaii: 'star#a@node', createdAt: BEFORE, defaultScopes: ['*'] },
            { gaii: 'none#a@node', createdAt: BEFORE },
        ]);
        expect(new Date(BEFORE).getTime()).toBeLessThan(new Date(TOOL_SCOPE_WORDS_SHIPPED_AT).getTime());
        expect(new Date(AFTER).getTime()).toBeGreaterThan(new Date(TOOL_SCOPE_WORDS_SHIPPED_AT).getTime());

        const first = await migrateToolScopeWordsOnce(storage, 'node');

        expect(first).toEqual({ ran: true, agents: 1 });
        expect(written.get('old#a@node')).toEqual(['memory:read', 'memory:write', 'catalogue:read', 'organism:read']);
        expect(written.has('new#a@node')).toBe(false);
        expect(written.has('star#a@node')).toBe(false);
        expect(written.has('none#a@node')).toBe(false);
        expect(memory.has(`system@node/${TOOL_SCOPE_WORDS_KEY}`)).toBe(true);
    });

    it('runs once per node, so an owner who takes the word away keeps it away', async () => {
        const { storage, written } = stubStorage([
            { gaii: 'old#a@node', createdAt: BEFORE, defaultScopes: ['memory:read'] },
        ]);
        await migrateToolScopeWordsOnce(storage, 'node');
        written.clear();

        const second = await migrateToolScopeWordsOnce(storage, 'node');

        expect(second).toEqual({ ran: false, agents: 0 });
        expect(written.size).toBe(0);
    });
});
