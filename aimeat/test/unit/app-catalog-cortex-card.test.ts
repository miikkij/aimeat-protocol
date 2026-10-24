/**
 * @file app-catalog-cortex-card.test.ts
 * @description The cortex bar card of the app catalogue (src/static/app-catalog/js/cortex-card.js).
 *   A card puts the cortex name, which any installing owner chooses, into an inline onclick on
 *   /app-catalog.html, an apex page whose CSP allows inline script. The name must reach
 *   showCortexPopup as one string argument and never run as code; ordinary names keep opening
 *   the popup with the value showCortexPopup already decodes (secaudit2026oct22).
 * @structure
 *   - runOnclick(html) → the card's onclick attribute, HTML-decoded and run with spies
 *   - a crafted name stays one argument; bundled and owner/thing names still open the popup
 * @usage cd aimeat && pnpm exec vitest run test/unit/app-catalog-cortex-card.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-24 — Created (secaudit2026oct22).
 */
import { describe, it, expect } from 'vitest';
import { cortexCardHtml } from '../../src/static/app-catalog/js/cortex-card.js';

/** HTML attribute decoding for the entities the catalogue's escapers emit. */
function decodeAttr(v: string): string {
    return v.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

/**
 * Run the card's onclick the way a browser does: read the double-quoted attribute, decode it, and
 * evaluate it as a function body. `showCortexPopup` and `pwn` are spies, so code that escapes the
 * string argument shows up as a call to `pwn`.
 */
function runOnclick(html: string): { popupArgs: unknown[][]; pwned: number } {
    const m = /onclick="([^"]*)"/.exec(html);
    if (!m) throw new Error('no onclick attribute in ' + html);
    const popupArgs: unknown[][] = [];
    let pwned = 0;
    const body = decodeAttr(m[1]);
    new Function('showCortexPopup', 'pwn', body)(
        (...args: unknown[]) => { popupArgs.push(args); },
        () => { pwned++; },
    );
    return { popupArgs, pwned };
}

describe('cortex bar card', () => {
    it('passes a name with an apostrophe and parentheses as one string argument', () => {
        // encodeURIComponent leaves ' ( ) - unchanged, so this name ends the argument string
        // unless the JS-level escaping runs too.
        const name = "x'-pwn()-'";
        const { popupArgs, pwned } = runOnclick(cortexCardHtml({ name, component_types: [] }));
        expect(pwned).toBe(0);
        expect(popupArgs).toHaveLength(1);
        expect(popupArgs[0]).toHaveLength(1);
        expect(decodeURIComponent(String(popupArgs[0][0]))).toBe(name);
    });

    it('still opens the popup for a bundled aimeat-* name', () => {
        const { popupArgs } = runOnclick(cortexCardHtml({ name: 'aimeat-charts', short_name: 'Charts', component_types: ['lib', 'lib', 'schema'] }));
        expect(popupArgs).toEqual([['aimeat-charts']]);
    });

    it('still opens the popup for an owner/thing name, encoded as before', () => {
        const { popupArgs } = runOnclick(cortexCardHtml({ name: 'alice/garden-tools', component_types: ['lib'] }));
        expect(popupArgs).toEqual([['alice%2Fgarden-tools']]);
    });

    it('shows the short name as text and counts the libs and schemas', () => {
        const html = cortexCardHtml({ name: 'aimeat-charts', short_name: 'Charts <b>', component_types: ['lib', 'lib', 'schema'] });
        expect(html).toContain('Charts &lt;b&gt;');
        expect(html).toContain('2 lib &middot; 1 schema');
    });
});
