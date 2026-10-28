/**
 * @file data-map-ai-act.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The maker's EU AI Act answers in an app's data map: what a write keeps of them, and
 *   when a map is told they are missing.
 *
 *   The maker knows what the app does to people, so the maker answers (Jouni, 2026-10-28). The map
 *   keeps an answer of a usable shape and a reason of a usable length, and drops the rest rather than
 *   refusing the whole map; an AI app with no answer at all gets DATAMAP_AI_ACT_UNANSWERED, which is
 *   what the building AI reads back from its own write.
 * @usage cd aimeat && pnpm exec vitest run test/unit/data-map-ai-act.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-28 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { readAiAct } from '../../src/services/data-map/data-map-access.js';
import { checkMap } from '../../src/services/data-map/data-map-check.js';
import type { DataMap } from '../../src/services/data-map/data-map-types.js';

const AT = '2026-10-28T00:00:00.000Z';
const map = (over: Partial<DataMap>): DataMap => ({
  spec: 'aimeat.datamap/2', what: 'A tool', usedFor: 'Work', form: 'one-person', arrangement: 'One key.',
  machinery: [], leaves: [], held: [], elsewhere: [], source: 'declared', at: AT, ...over,
});
const codes = (m: DataMap) => checkMap(m, AT).findings.map(f => f.code);

describe('readAiAct', () => {
  it('keeps yes/no and option answers and the reasons, trimmed', () => {
    expect(readAiAct({
      answers: { 'q-annex3-area': ' none ', 'q-interacts-with-people': true },
      notes: { 'q-annex3-area': '  Nobody is hired by it.  ' },
    })).toEqual({ answers: { 'q-annex3-area': 'none', 'q-interacts-with-people': true }, notes: { 'q-annex3-area': 'Nobody is hired by it.' } });
  });

  it('drops an id that cannot be a question id, an answer of no usable shape, and an empty reason', () => {
    expect(readAiAct({
      answers: { 'Q BAD': true, 'q-x': 3, 'q-y': '', 'q-z': false },
      notes: { 'q-z': '   ', '../etc': 'x' },
    })).toEqual({ answers: { 'q-z': false } });
  });

  it('answers null for nothing usable, so the map carries no empty statement', () => {
    expect(readAiAct(null)).toBeNull();
    expect(readAiAct(['q-x'])).toBeNull();
    expect(readAiAct({ answers: {}, notes: {} })).toBeNull();
  });

  it('caps a reason at 2000 characters', () => {
    expect(readAiAct({ answers: { 'q-a': true }, notes: { 'q-a': 'x'.repeat(5000) } })?.notes?.['q-a']).toHaveLength(2000);
  });
});

describe('DATAMAP_AI_ACT_UNANSWERED', () => {
  it('an AI app with no answers is told', () => {
    expect(codes(map({ machinery: ['ai-generation'] }))).toContain('DATAMAP_AI_ACT_UNANSWERED');
  });

  it('an AI app that answered anything is not', () => {
    expect(codes(map({ machinery: ['ai-generation'], aiAct: { answers: { 'q-annex3-area': 'none' } } })))
      .not.toContain('DATAMAP_AI_ACT_UNANSWERED');
  });

  it('an app that does not use AI is never asked', () => {
    expect(codes(map({}))).not.toContain('DATAMAP_AI_ACT_UNANSWERED');
  });

  it('it is the last finding, so it never hides a worse one in the stamp', () => {
    const f = checkMap(map({ machinery: ['ai-generation'], what: '' }), AT);
    expect(f.gap?.code).toBe('DATAMAP_NO_PURPOSE');
    expect(f.findings.at(-1)?.code).toBe('DATAMAP_AI_ACT_UNANSWERED');
  });
});
