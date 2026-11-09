/**
 * @file test/unit/memory-value-text.test.ts
 * @description memoryValueText: the words a memory value holds, as the content steps (the fingerprint
 *   among them) read it.
 * @version-history
 *   v1.0.0 — 2026-11-09 — Initial: a person's context is read as its text, not as JSON.
 */
import { describe, it, expect } from 'vitest';
import { memoryValueText } from '../../src/services/content/pipeline.js';

describe('memoryValueText', () => {
    it('reads a context as its name, summary, core and material, never its field names', () => {
        const text = memoryValueText({
            type: 'aimeat.context/v1', name: 'Cabin', summary: 'The cabin repair.', kind: 'mixed',
            core: '## Roof\n\nThe roofer quoted 8 400 €.', material: 'Notes from the call.',
            references: [{ ref: 'memory:x', what: 'w', openWhen: 'o' }], lifecycle: { shapedAt: 't' },
        });
        expect(text).toBe('# Cabin\n\nThe cabin repair.\n\n## Roof\n\nThe roofer quoted 8 400 €.\n\nNotes from the call.');
        expect(text).not.toContain('openWhen');
    });

    it('leaves out the parts a context does not have', () => {
        expect(memoryValueText({ type: 'aimeat.context/v1', name: 'N', core: 'C' })).toBe('# N\n\nC');
    });

    it('keeps the other shapes as they were', () => {
        expect(memoryValueText('plain')).toBe('plain');
        expect(memoryValueText({ title: 'T', markdown: 'M' })).toBe('T\n\nM');
        expect(memoryValueText({ a: 1 })).toBe('{"a":1}');
        expect(memoryValueText({ type: 'aimeat.context/v1', name: 'no core' })).toBe('{"type":"aimeat.context/v1","name":"no core"}');
    });
});
