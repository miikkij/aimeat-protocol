/**
 * @file test/unit/core-open-requirements.test.ts
 * @description The profiles the node claims and the evidence it publishes say the same thing.
 *   Core §0.3 lets a node claim a profile while a requirement of it is open only when discovery and
 *   the evidence file both list that requirement. Discovery's list is CORE_OPEN_REQUIREMENTS
 *   (src/services/core-discovery.ts); the evidence file's is its numbered list of gaps less the items
 *   it names as closed. Until 2026-10-16 the node claimed every profile from a constant while the
 *   evidence file, written against 3.26.1, still counted 31 gaps.
 * @usage pnpm exec vitest run test/unit/core-open-requirements.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-16 — Initial (QA audit D3-06).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CORE_OPEN_REQUIREMENTS, coreDiscoveryFields } from '../../src/services/core-discovery.js';

const EVIDENCE = readFileSync(join(process.cwd(), '..', 'docs', 'AIMEAT-Core-2026-11-evidence.md'), 'utf8');

/** The item numbers a sentence like "Items 1 to 9, 12 to 14, 16 and 28 are closed" names. */
function closedItems(text: string): Set<number> {
    const m = /Items ([\d ,and to]+) are closed/.exec(text);
    if (!m) throw new Error('the evidence file has no "Items … are closed" sentence');
    const out = new Set<number>();
    for (const part of m[1].split(/,|\band\b/).map(s => s.trim()).filter(Boolean)) {
        const range = /^(\d+) to (\d+)$/.exec(part);
        if (range) for (let i = Number(range[1]); i <= Number(range[2]); i++) out.add(i);
        else out.add(Number(part));
    }
    return out;
}

/** The open requirement ids the evidence file's list of gaps leaves after its closed items. */
function openInEvidence(): string[] {
    const section = EVIDENCE.slice(EVIDENCE.indexOf('gaps in one list'));
    const closed = closedItems(section);
    const open: string[] = [];
    for (const m of section.matchAll(/^\| (\d+) \| ([A-Z]+-\d+) \|/gm)) {
        if (!closed.has(Number(m[1]))) open.push(m[2]);
    }
    return open.sort();
}

describe('the Core claim and its evidence', () => {
    const declared = Object.values(CORE_OPEN_REQUIREMENTS).flat().sort();

    it('discovery lists exactly the requirements the evidence file leaves open', () => {
        expect(openInEvidence()).toEqual(declared);
    });

    it('each open requirement reads as a gap in the evidence table, and each prefix matches its profile', () => {
        for (const id of declared) {
            expect(EVIDENCE, id).toMatch(new RegExp(`^\\| ${id} \\| \\*\\*gap\\*\\* \\|`, 'm'));
        }
        for (const id of CORE_OPEN_REQUIREMENTS.Pacing ?? []) expect(id).toMatch(/^PACE-/);
        for (const id of CORE_OPEN_REQUIREMENTS.Federation ?? []) expect(id).toMatch(/^FED-/);
    });

    it('a 4.0 node publishes the open requirements beside the profiles it claims', () => {
        const fields = coreDiscoveryFields({ nodeType: 'full', personalNodesEnabled: false, commerceEnabled: false, x402Enabled: false }, '4.0.3');
        expect(fields.profiles).toContain('Base');
        expect(fields.profile_gaps?.Base).toEqual([...(CORE_OPEN_REQUIREMENTS.Base ?? [])]);
        for (const p of Object.keys(fields.profile_gaps ?? {})) expect(fields.profiles).toContain(p);
    });

    it('a 3.x node states neither', () => {
        const fields = coreDiscoveryFields({ nodeType: 'full', personalNodesEnabled: false, commerceEnabled: false, x402Enabled: false }, '3.26.1');
        expect(fields.profiles).toBeUndefined();
        expect(fields.profile_gaps).toBeUndefined();
    });
});
