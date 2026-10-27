/**
 * @file input-limits-browser.test.ts
 * @description The browser's copy of the input limits (public/js/input-limits.js) equals the
 *   server's (src/models/input-limits.ts), class by class, so a form's maxLength is the length the
 *   server refuses past.
 * @usage cd aimeat && pnpm exec vitest run test/unit/input-limits-browser.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-27 — Initial (wish wish-sy-tteiden-validointi-pituusrajat-ja-roskan-torjunta-palveli).
 */
import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { INPUT_LIMITS } from '../../src/models/input-limits.js';

describe('browser input limits', () => {
    it('are the server\'s, class by class', () => {
        const source = readFileSync(fileURLToPath(new URL('../../public/js/input-limits.js', import.meta.url)), 'utf-8');
        const body = source.slice(source.indexOf('Object.freeze({'));
        const browser = Object.fromEntries([...body.matchAll(/^\s*([a-z]+):\s*([\d_]+),/gm)].map(m => [m[1], Number(m[2].replace(/_/g, ''))]));
        assert.deepEqual(browser, { ...INPUT_LIMITS });
    });
});
