/**
 * @file test/unit/scope-vocabulary-app-grants.test.ts
 * @description Which app grants the boot-time scope migration may still widen.
 *
 *   The eight words named on 2026-08-10 go onto a grant made BEFORE that day, because the consent
 *   screen of the time could not show them and the app was already doing what they name. They do
 *   not go onto a grant made after it (its owner saw the list and answered), and never onto a grant
 *   the owner has narrowed by hand (scopesFixedAt). Measured on aimeat.io on 2026-09-04: 122 of 123
 *   grants carried the package, none of the apps had asked for it, and a "take this away" door would
 *   have been undone at the next restart.
 * @usage pnpm test -- scope-vocabulary-app-grants
 * @version-history
 *   v1.0.0 — 2026-09-05 — Initial, with the two exclusions it was written to hold in place.
 */
import { describe, it, expect } from 'vitest';
import {
    migrateAppGrantScopeVocabulary, appGrantPredatesVocabulary, GRANDFATHERED_SCOPES, VOCABULARY_NAMED_AT,
} from '../../src/services/scope-vocabulary-migration.js';
import type { Storage } from '../../src/storage/interface.js';

type Grant = { grantId: string; scopes: string[]; createdAt: string; scopesFixedAt?: string | null };

function stubStorage(grants: Grant[]) {
    const written = new Map<string, string[]>();
    const storage = {
        listAppGrants: async () => grants,
        updateAppGrant: async (grantId: string, patch: { scopes?: string[] }) => {
            if (patch.scopes) written.set(grantId, patch.scopes);
            return null;
        },
    } as unknown as Storage;
    return { storage, written };
}

describe('appGrantPredatesVocabulary', () => {
    it('is true for a grant made before the words had names, false on and after that day', () => {
        expect(appGrantPredatesVocabulary({ createdAt: '2026-07-01T10:00:00.000Z' })).toBe(true);
        expect(appGrantPredatesVocabulary({ createdAt: VOCABULARY_NAMED_AT })).toBe(false);
        expect(appGrantPredatesVocabulary({ createdAt: '2026-09-04T18:10:33.899Z' })).toBe(false);
    });

    it('is false the moment the owner has narrowed the grant by hand, whatever its age', () => {
        expect(appGrantPredatesVocabulary({ createdAt: '2026-07-01T10:00:00.000Z', scopesFixedAt: '2026-09-05T00:00:00.000Z' })).toBe(false);
    });
});

describe('migrateAppGrantScopeVocabulary', () => {
    it('widens only the old, untouched grant; the new one and the narrowed one keep what they have', async () => {
        const { storage, written } = stubStorage([
            { grantId: 'old', scopes: ['memory:read'], createdAt: '2026-07-01T00:00:00.000Z' },
            { grantId: 'new', scopes: ['memory:read'], createdAt: '2026-08-24T00:00:00.000Z' },
            { grantId: 'fixed', scopes: ['memory:read'], createdAt: '2026-07-01T00:00:00.000Z', scopesFixedAt: '2026-09-05T00:00:00.000Z' },
            { grantId: 'wide', scopes: ['*'], createdAt: '2026-07-01T00:00:00.000Z' },
        ]);
        const changed = await migrateAppGrantScopeVocabulary(storage);

        expect(changed).toBe(1);
        for (const s of GRANDFATHERED_SCOPES) expect(written.get('old')).toContain(s);
        expect(written.get('old')).toContain('memory:read');
        expect(written.has('new')).toBe(false);
        expect(written.has('fixed')).toBe(false);
        expect(written.has('wide')).toBe(false);
    });

    it('is idempotent over an old grant that already carries the words', async () => {
        const { storage, written } = stubStorage([
            { grantId: 'done', scopes: ['memory:read', ...GRANDFATHERED_SCOPES], createdAt: '2026-07-01T00:00:00.000Z' },
        ]);
        expect(await migrateAppGrantScopeVocabulary(storage)).toBe(0);
        expect(written.size).toBe(0);
    });
});
