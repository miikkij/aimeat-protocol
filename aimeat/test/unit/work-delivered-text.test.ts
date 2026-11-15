/**
 * @file test/unit/work-delivered-text.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the Work tab's sent list says about a delivered output (public/views/profile/
 *   work-delivered.js): the portal's { text }, an empty text, an agent's other fields, and an old row
 *   whose output is text.
 * @usage cd aimeat && pnpm exec vitest run test/unit/work-delivered-text.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-15 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { deliveredText } from '../../public/views/profile/work-delivered.js';

describe('the delivered output as the Work tab shows it', () => {
    it('shows nothing when nothing was delivered', () => {
        expect(deliveredText(undefined)).toBeNull();
        expect(deliveredText(null)).toBeNull();
    });

    it('shows the text of a { text } delivery, and says when it is empty', () => {
        expect(deliveredText({ text: ' The summary ' })).toEqual({ text: 'The summary', empty: false });
        expect(deliveredText({ text: '' })).toEqual({ text: '', empty: true });
    });

    it('shows an object without text as its JSON, and an old text output as it was stored', () => {
        expect(deliveredText({ rows: 3 })).toEqual({ text: '{"rows":3}', empty: false });
        expect(deliveredText('old text')).toEqual({ text: 'old text', empty: false });
        expect(deliveredText([1, 2])).toEqual({ text: '[1,2]', empty: false });
    });
});
