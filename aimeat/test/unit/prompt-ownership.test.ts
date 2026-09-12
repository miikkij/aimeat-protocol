/**
 * @file test/unit/prompt-ownership.test.ts
 * @description The rule the System Prompts page and the boot-time seeder both read: which prompts
 *   are rewritten from source, which are the operator's, and which the software no longer ships.
 *
 *   The third one is the case no other test covers and the one an operator meets on a node that has
 *   been running for a year: the seeder only inserts and updates, so a prompt whose seed was deleted
 *   is served forever with no factory text to go back to.
 */
import { describe, it, expect } from 'vitest';
import { promptSourceKind, promptDiffersFromDefault, PROMPT_SYNC_GROUPS, PROMPT_SYNC_IDS } from '../../src/services/prompt-ownership.js';
import { PROMPT_SEEDS } from '../../src/services/prompt-defaults.js';

describe('promptSourceKind', () => {
    it('calls a prompt in a synced group code-owned', () => {
        const seed = PROMPT_SEEDS.find(s => PROMPT_SYNC_GROUPS.includes(s.group));
        expect(seed, 'the seeds declare at least one synced group').toBeTruthy();
        expect(promptSourceKind(seed!.id, seed!.group)).toBe('code');
    });

    it('calls a named prompt code-owned even in a group that is otherwise the operator\'s', () => {
        for (const id of PROMPT_SYNC_IDS) {
            const seed = PROMPT_SEEDS.find(s => s.id === id);
            if (!seed) continue;   // a named id whose seed has moved on is covered by the orphan case
            expect(promptSourceKind(seed.id, seed.group), `${id} is synced by name`).toBe('code');
        }
    });

    it('calls everything else the operator\'s to keep', () => {
        const seed = PROMPT_SEEDS.find(s => !PROMPT_SYNC_GROUPS.includes(s.group) && !PROMPT_SYNC_IDS.includes(s.id));
        expect(seed, 'the seeds declare at least one operator-owned prompt').toBeTruthy();
        expect(promptSourceKind(seed!.id, seed!.group)).toBe('yours');
    });

    it('calls a prompt with no seed an orphan, whatever group it claims', () => {
        expect(promptSourceKind('seeded-by-a-version-that-is-gone', 'generator')).toBe('orphan');
        expect(promptSourceKind('seeded-by-a-version-that-is-gone', 'portal')).toBe('orphan');
    });
});

describe('promptDiffersFromDefault', () => {
    const seed = PROMPT_SEEDS[0];

    it('is false for the text the software ships', () => {
        expect(promptDiffersFromDefault({ id: seed.id, content: seed.content, locales: seed.locales })).toBe(false);
    });

    it('is true when the text was changed here', () => {
        expect(promptDiffersFromDefault({ id: seed.id, content: seed.content + ' one more line', locales: seed.locales })).toBe(true);
    });

    it('is true when a translation was written that the software does not ship', () => {
        const withFi = { ...(seed.locales ?? {}), fi: 'Tämä on operaattorin oma käännös.' };
        expect(promptDiffersFromDefault({ id: seed.id, content: seed.content, locales: withFi })).toBe(true);
    });

    it('ignores an empty translation, which is how the store spells "no override"', () => {
        expect(promptDiffersFromDefault({ id: seed.id, content: seed.content, locales: { ...(seed.locales ?? {}), fi: '' } })).toBe(false);
    });

    it('is false for a prompt the software no longer ships: there is nothing to compare against', () => {
        expect(promptDiffersFromDefault({ id: 'seeded-by-a-version-that-is-gone', content: 'anything at all', locales: {} })).toBe(false);
    });
});
