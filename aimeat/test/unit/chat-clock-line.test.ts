/**
 * @file test/unit/chat-clock-line.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description clockLine (src/services/chat-turn-guard.ts): the turn note's local date and time is
 *   written in the turn's language. On crew74 a fi account on an English page got "maanantai 2.
 *   marraskuuta 2026 klo 7.39" in the note, and the model answered the English question in Finnish.
 * @version-history
 *   v1.0.0 — 2026-11-02 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { clockLine } from '../../src/services/chat-turn-guard.js';

const at = '2026-11-02T05:39:00Z';
const finnishAccount = { locale: 'fi', region: 'fi', timezone: null };

describe('clockLine', () => {
    it('writes the date in the turn\'s language, not the account\'s region', () => {
        const en = clockLine(finnishAccount, 'Europe/Helsinki', 'en', at);
        expect(en).toContain('Monday, 2 November 2026 at 07:39');
        expect(en).not.toMatch(/maanantai|marraskuuta|klo/);
        const fi = clockLine(finnishAccount, 'Europe/Helsinki', 'fi', at);
        expect(fi).toContain('maanantai 2. marraskuuta 2026 klo 7.39');
        const es = clockLine(finnishAccount, 'Europe/Helsinki', 'es', at);
        expect(es).toMatch(/lunes, 2 de noviembre de 2026, 7:39/);
    });

    it('names the zone it used, and says UTC when it knows none', () => {
        expect(clockLine(finnishAccount, 'Europe/Helsinki', 'en', at)).toContain('(time zone Europe/Helsinki)');
        expect(clockLine(finnishAccount, 'Not/AZone', 'en', at)).toContain('time zone is not known');
    });
});
