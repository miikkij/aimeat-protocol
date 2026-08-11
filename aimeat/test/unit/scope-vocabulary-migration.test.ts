/**
 * @file test/unit/scope-vocabulary-migration.test.ts
 * @description What the boot-time scope migration hands to which agent.
 *
 *   Two rules, and they are different on purpose. GRANDFATHERED_SCOPES go to every non-wildcard
 *   agent, because those words gate tools that used to need no permission at all — silence read as
 *   yes, so naming the word without granting it would delete the tool from every agent that had it.
 *   CONDITIONAL_SCOPES go only to an agent that already holds the word being replaced: the four
 *   beneficiary tools moved from commerce:sell to exchange:beneficiary, the word the HTTP door
 *   always required, and that must preserve the reach a selling agent had without handing a
 *   money-moving permission to an agent that never had one.
 * @usage pnpm test -- scope-vocabulary-migration
 * @version-history
 *   v1.0.0 — 2026-08-11 — Initial, with the conditional grant it was written to hold in place.
 */
import { describe, it, expect } from 'vitest';
import {
    migrateAgentScopeVocabulary, GRANDFATHERED_SCOPES, CONDITIONAL_SCOPES,
} from '../../src/services/scope-vocabulary-migration.js';
import type { Storage } from '../../src/storage/interface.js';

/** Just enough Storage for the migration: list the agents, record what it writes back. */
function stubStorage(agents: Array<{ gaii: string; defaultScopes?: string[] }>) {
    const written = new Map<string, string[]>();
    const storage = {
        listAgents: async () => agents,
        updateAgent: async (gaii: string, patch: { defaultScopes?: string[] }) => {
            if (patch.defaultScopes) written.set(gaii, patch.defaultScopes);
            return undefined;
        },
    } as unknown as Storage;
    return { storage, written };
}

describe('migrateAgentScopeVocabulary', () => {
    it('hands every grandfathered word to a narrow agent, and none of them to a wildcard', async () => {
        const { storage, written } = stubStorage([
            { gaii: 'narrow#a@node', defaultScopes: ['memory:read'] },
            { gaii: 'wide#a@node', defaultScopes: ['*'] },
        ]);
        await migrateAgentScopeVocabulary(storage);

        for (const s of GRANDFATHERED_SCOPES) {
            expect(written.get('narrow#a@node')).toContain(s);
            // A wildcard already carries these, so writing them out would be noise.
            expect(written.get('wide#a@node') ?? []).not.toContain(s);
        }
        expect(written.get('narrow#a@node')).toContain('memory:read');
    });

    /**
     * The wildcard case that matters. The conditional words are deliberately OUTSIDE every wildcard,
     * so a '*' agent does not carry them — and would silently lose tools it uses today unless they
     * are written out for it. Coverage is asked of the 'when' word, which '*' does carry.
     */
    it('writes the out-of-wildcard words out for a wildcard agent, so it keeps its tools', async () => {
        const { storage, written } = stubStorage([{ gaii: 'wide#a@node', defaultScopes: ['*'] }]);
        await migrateAgentScopeVocabulary(storage);

        const got = written.get('wide#a@node') ?? [];
        for (const c of CONDITIONAL_SCOPES) expect(got).toContain(c.grant);
        expect(got).toContain('*');
    });

    it('grants a conditional word ONLY to an agent already holding the word it depends on', async () => {
        expect(CONDITIONAL_SCOPES[0]).toEqual(
            expect.objectContaining({ grant: 'exchange:beneficiary', when: 'commerce:sell' }));

        const { storage, written } = stubStorage([
            { gaii: 'seller#a@node', defaultScopes: ['commerce:sell'] },
            { gaii: 'reader#a@node', defaultScopes: ['memory:read'] },
        ]);
        await migrateAgentScopeVocabulary(storage);

        // A seller keeps every door it could already open, now under its own word.
        expect(written.get('seller#a@node')).toContain('exchange:beneficiary');
        expect(written.get('seller#a@node')).toContain('commerce:psp');
        // And an agent that never held commerce:sell gains neither.
        expect(written.get('reader#a@node') ?? []).not.toContain('exchange:beneficiary');
        expect(written.get('reader#a@node') ?? []).not.toContain('commerce:psp');
    });

    it('is idempotent — a second run over the migrated agents changes nothing', async () => {
        const held = ['commerce:sell', ...CONDITIONAL_SCOPES.map(c => c.grant), ...GRANDFATHERED_SCOPES];
        const { storage, written } = stubStorage([{ gaii: 'done#a@node', defaultScopes: held }]);
        const changed = await migrateAgentScopeVocabulary(storage);

        expect(changed).toBe(0);
        expect(written.size).toBe(0);
    });
});
