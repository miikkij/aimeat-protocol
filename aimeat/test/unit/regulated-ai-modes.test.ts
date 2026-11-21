/**
 * @file test/unit/regulated-ai-modes.test.ts
 * @description The pure parts of a regulated data domain's mode for an outside AI model (feature audit
 *   item 1.3): the operator's entries, the strictest mode of a piece of content, the rule that an AI may
 *   only tighten the setting, and the stand-ins of protect mode.
 * @usage cd aimeat && pnpm exec vitest run test/unit/regulated-ai-modes.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-21 — Initial (plan doc-mwnnp9xz9814, feature audit item 1.3).
 */
import { describe, it, expect } from 'vitest';
import { aiModesOf, parseAiModeEntry, stricterAiMode } from '../../src/data/compliance-domains.js';
import { parseRegulatedAiModes } from '../../src/config/data-access.js';
import { modeOfDomains } from '../../src/services/compliance/regulated-ai.js';
import { protectValue } from '../../src/services/compliance/pseudonymise.js';
import { settingLoosens } from '../../src/services/config/strictness.js';

const KEY = Buffer.alloc(32, 7);
const PATH = 'compliance.regulated_ai_modes';

describe('the operator\'s entries', () => {
    it('read domain=mode, and drop an unknown domain or mode', () => {
        expect(parseAiModeEntry('health=local')).toEqual({ domain: 'health', mode: 'local' });
        expect(parseAiModeEntry('health=nothing')).toBeNull();
        expect(parseAiModeEntry('nowhere=block')).toBeNull();
        expect(parseRegulatedAiModes(' health=block, nowhere=local ,children=protect')).toEqual(['health=block', 'children=protect']);
        expect(aiModesOf(['health=block'])).toEqual({ health: 'block' });
    });
});

describe('the mode of a piece of content', () => {
    it('is notify for a domain nobody named, and the strictest of the operator\'s and the registers\'', () => {
        expect(modeOfDomains(['health'], [], [])).toBe('notify');
        expect(modeOfDomains(['health', 'children'], [], ['health=protect', 'children=local'])).toBe('local');
        expect(modeOfDomains(['health'], ['block'], ['health=notify'])).toBe('block');
        expect(modeOfDomains(['health'], ['notify'], ['health=block'])).toBe('block');
        expect(stricterAiMode('protect', 'local')).toBe('local');
    });
});

describe('an AI may only tighten the setting', () => {
    it('a change that leaves any domain more open loosens; a stricter or equal one does not', () => {
        expect(settingLoosens(PATH, ['health=local'], ['health=block'])).toBe(false);
        expect(settingLoosens(PATH, ['health=local'], ['health=protect'])).toBe(true);
        expect(settingLoosens(PATH, ['health=local'], [])).toBe(true);
        expect(settingLoosens(PATH, [], ['children=protect'])).toBe(false);
        expect(settingLoosens(PATH, ['health=local', 'children=block'], ['health=block', 'children=local'])).toBe(true);
    });
});

describe('protect mode', () => {
    const record = {
        key: 'organism.o1.w.ws-1.shared.items.r1', ownerGaii: 'alice@node-1', name: 'Maija Meikäläinen',
        value: { etunimi: 'Maija', note: 'Soita 040 123 4567 tai +358 40 765 4321, hetu 010190-123A, maija@example.com, FI21 1234 5600 0007 85, Mannerheimintie 12 A 5. Käynti 2026-11-21.' },
    };
    const { value: out, counts } = protectValue(record, KEY, 'workspace\u0000organism:o1\u0000ws-1');

    it('replaces the details and leaves the rest of the text and the record\'s structure', () => {
        const note = (out.value as { note: string }).note;
        for (const detail of ['040 123 4567', '+358 40 765 4321', '010190-123A', 'maija@example.com', 'FI21 1234 5600 0007 85', 'Mannerheimintie 12 A 5']) expect(note).not.toContain(detail);
        expect(note).toContain('Soita ');
        expect(note).toContain('2026-11-21');
        expect(out.key).toBe(record.key);
        expect(out.ownerGaii).toBe(record.ownerGaii);
        expect(out.name).toMatch(/^\[name-[0-9a-f]{8}\]$/);
        expect((out.value as { etunimi: string }).etunimi).toMatch(/^\[name-[0-9a-f]{8}\]$/);
        expect(counts).toEqual({ name: 2, email: 1, 'person-id': 1, iban: 1, address: 1, phone: 2 });
    });

    it('gives the same stand-in to the same value in one container, another in another, and does not protect a stand-in again', () => {
        const again = protectValue(record, KEY, 'workspace\u0000organism:o1\u0000ws-1').value;
        expect(again).toEqual(out);
        const elsewhere = protectValue(record, KEY, 'workspace\u0000organism:o2\u0000ws-9').value;
        expect(elsewhere.name).not.toBe(out.name);
        expect(protectValue(out, KEY, 'workspace\u0000organism:o1\u0000ws-1').value).toEqual(out);
    });
});
