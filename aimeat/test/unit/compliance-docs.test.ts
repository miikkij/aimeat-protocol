/**
 * @file test/unit/compliance-docs.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The pure parts of plan doc-mvlftkh9zmc9: the catalog's list of compliance documents
 *   is the service's list; a document key goes to its scope and back; an unanswered framework is
 *   unclassified, never "does not apply"; the TL and NATO markings are recognised in upper case only
 *   and not inside one another; a label that refuses an outside model stays refused through a lower
 *   level, and allowing it again is a weaker field; a model reference is local only as `local:`.
 * @usage cd aimeat && pnpm exec vitest run test/unit/compliance-docs.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-23 — Initial (plan doc-mvlftkh9zmc9).
 */
import { describe, it, expect } from 'vitest';
import { COMPLIANCE_DOC_KINDS } from '../../src/services/compliance-docs-schemas.js';
import { COMPLIANCE_DOC_KINDS as CATALOG_KINDS } from '../../src/tool-catalog/definitions/compliance.js';
import { docKey, scopeOfKey } from '../../src/services/compliance-docs.js';
import { frameworkVerdicts } from '../../src/services/compliance-derived.js';
import { CLASSIFICATION_PACKS } from '../../src/data/classification-packs.js';
import { COMPLIANCE_DOMAINS } from '../../src/data/compliance-domains.js';
import { DEFAULT_LABELS } from '../../src/services/classification/defaults.js';
import { mergePolicy, weakerFields, validateNodePolicy } from '../../src/services/classification/levels.js';
import { defaultPolicy } from '../../src/services/classification/defaults.js';
import { modelRefuses, isLocalModelRef } from '../../src/services/classification/external-ai.js';

describe('compliance documents', () => {
    it('the catalog names the same documents as the service', () => {
        expect([...CATALOG_KINDS]).toEqual([...COMPLIANCE_DOC_KINDS]);
    });

    it('a key goes to its scope and back, and an id that could reach another key has none', () => {
        const scopes = [{ kind: 'node' as const }, { kind: 'organism' as const, organismId: 'abc-123' }, { kind: 'app' as const, ownerName: 'alice', app: 'crm' }];
        for (const s of scopes) expect(scopeOfKey(docKey('registers', s)!)).toEqual({ kind: 'registers', scope: s });
        expect(docKey('registers', { kind: 'organism', organismId: 'a.b' })).toBeNull();
        expect(scopeOfKey('compliance.report.2026-08')).toBeNull();
    });

    it('every domain names a default label as its floor', () => {
        const ids = new Set(DEFAULT_LABELS.map(l => l.id));
        for (const d of COMPLIANCE_DOMAINS) expect(ids.has(d.minLabel)).toBe(true);
    });
});

describe('frameworks', () => {
    it('an unanswered framework is unclassified; an answered one has its verdict and obligations', () => {
        const v = frameworkVerdicts({ answers: { gdpr: { 'q-personal-data': true, 'q-public-authority': false, 'q-large-scale-monitoring': true, 'q-large-scale-special': false } } }, 'node');
        const gdpr = v.find(x => x.id === 'gdpr')!;
        expect(gdpr.verdict.class).toBe('dpo-required');
        expect(gdpr.obligations.length).toBeGreaterThan(0);
        expect(v.find(x => x.id === 'nis2')!.verdict.class).toBe('unclassified');
    });
});

describe('TL and NATO markings', () => {
    const rules = CLASSIFICATION_PACKS.flatMap(p => p.rules);
    const hit = (text: string) => rules.filter(r => new RegExp(r.pattern, r.flags).test(text)).map(r => r.minLabel);

    it('finds each class and not one inside another', () => {
        expect(hit('TL IV')).toEqual(['tl-iv']);
        expect(hit('TL III')).toEqual(['tl-iii']);
        expect(hit('ST II')).toEqual(['tl-ii']);
        expect(hit('TL I')).toEqual(['tl-i']);
        expect(hit('KÄYTTÖ RAJOITETTU')).toEqual(['tl-iv']);
        expect(hit('NATO SECRET')).toEqual(['nato-secret']);
        expect(hit('COSMIC TOP SECRET')).toEqual(['cosmic-top-secret']);
        expect(hit('NATO UNCLASSIFIED')).toEqual(['sisainen']);
    });

    it('finds nothing in lower case, in ordinary words, or in a business label', () => {
        for (const t of ['tl iii', 'salainen', 'LUOTTAMUKSELLINEN', 'FIRST IV', 'nato secret', 'STILL']) expect(hit(t)).toEqual([]);
    });

    it('a node policy with both packs on validates: one label per rank', () => {
        const p = defaultPolicy();
        p.labels.push(...CLASSIFICATION_PACKS.flatMap(pk => pk.labels.map(({ top: _t, ...l }) => l)));
        p.rules.push(...rules);
        expect(() => validateNodePolicy(p)).not.toThrow();
    });
});

describe('externalAi', () => {
    const tl = CLASSIFICATION_PACKS[0]!.labels[0]!;
    const { top: _t, ...label } = tl;

    it('a lower level cannot allow what the node refuses, and allowing it is a weaker field', () => {
        const node = defaultPolicy();
        node.labels.push(label);
        const merged = mergePolicy(node, { labels: [{ ...label, externalAi: 'allowed' }] });
        expect(merged.labels.find(l => l.id === label.id)!.externalAi).toBe('refused');
        expect(weakerFields({ ...label, externalAi: 'allowed' }, label)).toContain('externalAi');
        expect(weakerFields(label, { ...label, externalAi: 'allowed' })).not.toContain('externalAi');
    });

    it('only a local: model reads it', () => {
        expect(isLocalModelRef('local:llama3')).toBe(true);
        expect(modelRefuses(label, 'openrouter:anthropic/claude')).toBe(true);
        expect(modelRefuses(label, undefined)).toBe(true);
        expect(modelRefuses(label, 'local:llama3')).toBe(false);
        expect(modelRefuses(DEFAULT_LABELS[3]!, 'openrouter:x')).toBe(false);
    });
});
