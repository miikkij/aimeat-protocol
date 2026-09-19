/**
 * @file test/unit/living-decide-sheet.test.ts
 * @description THE SENTENCE AROUND A JUDGEMENT READS RIGHT BEFORE ANY JUDGEMENT EXISTS. A decide
 *   node's answers are empty until the model has answered, and a template that compares an empty
 *   answer with a number (`{{ if triage.angry >= 0.8 }}`) must read as "no" rather than print a
 *   refusal into the middle of the sentence. This is the shape the Työkirja support-ticket sheet
 *   writes, so it is checked here against the engine rather than found on the screen.
 * @usage cd aimeat && pnpm vitest run test/unit/living-decide-sheet.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-19 — Initial (living 0.8.0).
 */
import { describe, it, expect } from 'vitest';

(globalThis as unknown as { window: unknown }).window = globalThis;
(globalThis as unknown as { document: unknown }).document = {
  documentElement: { getAttribute: () => null },
  querySelector: () => null,
};
(globalThis as unknown as { location: unknown }).location = { protocol: 'file:', origin: '' };

const { createGraph } = await import('../../src/static/sdk-libs/living/graph.js');

function doc() {
  return {
    v: 1,
    model: {
      nodes: {
        message: { type: 'value', value: '' },
        stage: { type: 'value', value: 'New.' },
        ticket: { type: 'machine', initial: 'new', states: { new: { on: { URGENT: 'urgent' } }, urgent: {} } },
        triage: {
          type: 'decide', input: 'message', machine: 'ticket', event: 'next', gates: 'the next step',
          questions: {
            next: { pickOne: 'Which step?', options: { URGENT: 'urgent', NONE: 'none' } },
            angry: { yesNo: 'The writer is angry.' },
          },
          thresholds: { next: 0.7 },
        },
        line: {
          type: 'text',
          template: '{{ stage }}{{ if triage = "person" }} You decide.{{ end }}{{ if triage.angry >= 0.8 }} Angry.{{ end }}',
        },
      },
    },
  };
}

describe('a sentence that reads a decide node', () => {
  it('reads an empty answer as "no" before anything was asked', () => {
    const g = createGraph(doc());
    g.refresh();
    expect(g.errors).toEqual([]);
    expect(g.valueOf('line')).toBe('New.');
  });

  it('reads the answers once they are there', () => {
    const g = createGraph(doc());
    g.refresh();
    g.set('triage', { status: 'person', pending: 'URGENT', answers: { next: { type: 'choice', value: 'URGENT', confidence: 0.5 }, angry: { type: 'noul', value: 0.9 } } });
    expect(g.valueOf('line')).toBe('New. You decide. Angry.');
  });
});
