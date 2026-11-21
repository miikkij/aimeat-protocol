/**
 * @file test/unit/css-facts.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The three stylesheet facts of scripts/check-css-facts.ts, on fixture sheets: a var()
 *   that names nothing (§4), the root of one .ak- family in two kit sheets (§36), and a full-screen
 *   phone view pinned to the page instead of the visual viewport (§125). And the shared dialog's root
 *   sets the body's text values, so a dialog called inside a label does not take its capitals (§109).
 * @version-history
 *   v1.0.0 — 2026-11-21 — Initial.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { akRootsTwice, definedProperties, fixedPhoneViews, undefinedVars } from '../../scripts/check-css-facts.js';

describe('a var() that names nothing', () => {
    const sheets = [{ file: 'a.css', text: ':root { --text: #000; }\n.x { gap: var(--space-3); color: var(--text); margin: var(--space-4, 1rem); }\n.y { background: var(--ok-bg, var(--nope)); }\n.z { width: var(--ap-width); border: var(--set-by-js); }' }];
    const defined = definedProperties(sheets, [{ text: "el.style.setProperty('--ap-' + key, v); const vars = { '--set-by-js': 1 };" }]);
    const keys = undefinedVars(sheets, defined).map(f => f.key);
    it('is found without a fallback, and through a fallback chain that ends in one', () => {
        expect(keys).toContain('undefined-var:a.css:--space-3');
        expect(keys).toContain('undefined-var:a.css:--nope');
    });
    it('is not found with a plain fallback, a declared name, a script-set name or a script-set prefix', () => {
        expect(keys).not.toContain('undefined-var:a.css:--space-4');
        expect(keys).not.toContain('undefined-var:a.css:--text');
        expect(keys).not.toContain('undefined-var:a.css:--set-by-js');
        expect(keys).not.toContain('undefined-var:a.css:--ap-width');
        expect(keys).toHaveLength(2);
    });
});

describe('one .ak- family opened in two kit sheets', () => {
    it('is found for the bare root in two module sheets', () => {
        const f = akRootsTwice([
            { file: 'public/lib/aimeat-atelier/content.css', text: '.ak-reveal { display: flex; }' },
            { file: 'public/lib/aimeat-atelier/motion.css', text: '.ak-reveal, .ak-other { opacity: 0; }' },
        ]);
        expect(f.map(x => x.key)).toEqual(['ak-root-twice:.ak-reveal']);
    });
    it('is not found for a modifier, a descendant, one sheet, or a sheet outside the kit', () => {
        expect(akRootsTwice([
            { file: 'public/lib/aimeat-atelier/content.css', text: '.ak-card { a: b; } .ak-card { c: d; }' },
            { file: 'public/lib/aimeat-atelier/looks.css', text: '.ak-card--x { a: b; } .ak-app .ak-card { c: d; }' },
            { file: 'public/css/x.css', text: '.ak-card { a: b; }' },
        ])).toEqual([]);
    });
});

describe('a full-screen phone view', () => {
    it('is found pinned to the page inside a max-width rule', () => {
        const f = fixedPhoneViews([{ file: 'v.css', text: '@media (max-width: 760px) { .pane { position: fixed; inset: 0; z-index: 9; } }' }]);
        expect(f.map(x => x.key)).toEqual(['fixed-phone-view:v.css:.pane']);
    });
    it('is not found when it reads the visual viewport, outside a phone rule, or not at the top edge', () => {
        expect(fixedPhoneViews([{ file: 'v.css', text: [
            '@media (max-width: 760px) { .a { position: fixed; inset: var(--vv-top, 0px) 0 auto 0; height: var(--vv-height, 100dvh); } }',
            '.b { position: fixed; inset: 0; }',
            '@media (max-width: 760px) { .c { position: fixed; bottom: 0; } }',
        ].join('\n') }])).toEqual([]);
    });
});

describe('the shared dialog takes no text styles from where it is called', () => {
    const css = readFileSync(new URL('../../public/css/components/dialog.css', import.meta.url), 'utf8');
    const root = /dialog\.dlg\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    it.each(['color', 'font-family', 'font-size', 'font-weight', 'font-style', 'letter-spacing', 'text-transform', 'text-align'])('sets %s on its root', prop => {
        expect(root).toMatch(new RegExp(`(?:^|[;\\s])${prop}\\s*:`));
    });
});
