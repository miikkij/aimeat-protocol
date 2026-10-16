/**
 * @file test/unit/librarian-title.test.ts
 * @description The name a search hit is shown by (services/librarian.ts titleOf). A record with no
 *   title field was named by its key's last segment, so a workspace draft read "draft" and a meta
 *   record a bare UUID in the Search everything dialog (Jouni, 2026-10-16).
 * @version-history v1.0.0 -- 2026-10-16 -- Initial.
 */
import { describe, expect, it } from 'vitest';
import { titleOf } from '../../src/services/librarian.js';

const DRAFT = 'organism.o1.w.ws-mv9cpw4nh6l.ura.barona-ai-transformation-lead.draft';

describe('titleOf', () => {
    it('a named field wins', () => {
        expect(titleOf({ title: 'Barona: AI transformation lead', id: 'x' }, DRAFT)).toBe('Barona: AI transformation lead');
        expect(titleOf({ company: 'Barona', status: 'kiinnostaa' }, DRAFT)).toBe('Barona');
    });

    it('without one, the record\'s own id, never the key\'s draft ending', () => {
        expect(titleOf({ id: 'barona-ai-transformation-lead', url: 'https://www.linkedin.com/jobs/x', status: 'kiinnostaa' }, DRAFT))
            .toBe('barona-ai-transformation-lead');
    });

    it('then the first short text, skipping addresses, timestamps and identities', () => {
        expect(titleOf({ url: 'https://example.com/a', at: '2026-10-15T09:45:51.279Z', by: 'happydude500001@aimeat-finland-001-genesis', note: 'Hakemus lähetetty' }, 'organism.o1.meta.c061bf42'))
            .toBe('Hakemus lähetetty');
    });

    it('the key names it last, without .draft, .latest or .version.N', () => {
        expect(titleOf({ n: 3 }, DRAFT)).toBe('barona-ai-transformation-lead');
        expect(titleOf({ n: 3 }, 'organism.o1.w.ws.ura.item-7.version.4')).toBe('item-7');
        expect(titleOf({ n: 3 }, 'notes.plain')).toBe('plain');
    });
});
