/**
 * @file test/unit/public-pages-own-content.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Every registry page says whether its content is the node's own. An unmarked page was
 *   read as the software's and handed to the main node on every node that names one, so a new page
 *   could lose its own address by omission (docs/pitfalls.md §128). The type requires the field
 *   (RegistryPage); this holds the data the same way for a reader who does not typecheck.
 * @version-history
 *   v1.0.0 — 2026-11-21 — Initial.
 */
import { describe, expect, it } from 'vitest';
import { PUBLIC_PAGES, handedToPrimary } from '../../src/data/public-pages.js';

describe('a registry page decides ownContent', () => {
    it('every entry carries ownContent as true or false', () => {
        expect(PUBLIC_PAGES.filter(p => typeof (p as { ownContent?: unknown }).ownContent !== 'boolean').map(p => p.path)).toEqual([]);
    });
    it('the node\'s own pages stay its own', () => {
        const own = PUBLIC_PAGES.filter(p => p.ownContent).map(p => p.path).sort();
        expect(own).toEqual(['/', '/v1/app-store', '/v1/members']);
    });
    it('a software page is handed to a main node, an own page never', () => {
        const config = { seoPrimaryNodeUrl: 'https://main.example', baseUrl: 'https://second.example' };
        expect(handedToPrimary({ ownContent: false }, config)).toBe(true);
        expect(handedToPrimary({ ownContent: true }, config)).toBe(false);
    });
});
