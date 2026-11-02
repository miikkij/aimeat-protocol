/**
 * @file test/unit/content-profile-labels.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The fingerprint's two ways (src/services/content/profile.ts, profile-labels.ts): the
 *   decision model labels and the text model writes when the node lets it; a refusal from the
 *   decision service, or content_class.profile_labels 'model', gives the text model all of it; a
 *   long document's questions are split across decisions of at most 200 questions.
 * @structure labelQuestions · chunkSections · profileItem (decide, refused, model)
 * @usage cd aimeat && pnpm exec vitest run test/unit/content-profile-labels.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-02 — Initial.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const decide = vi.fn();
const complete = vi.fn();
vi.mock('../../src/services/decide/service.js', () => ({ decideForOwner: (...a: unknown[]) => decide(...a) }));
vi.mock('../../src/services/ai/completion.js', () => ({ completeForOwner: (...a: unknown[]) => complete(...a) }));

const { profileItem, PROFILE_PROMPT, PROFILE_TEXT_PROMPT } = await import('../../src/services/content/profile.js');
const { labelQuestions, chunkSections } = await import('../../src/services/content/profile-labels.js');
const { DEFAULT_SETTINGS } = await import('../../src/services/content/types.js');

const words = (n: number) => Array.from({ length: n }, (_, i) => `sana${i}`).join(' ');
const text = `# Raportti\n\n## Hinnat\n${words(60)}\n\n## Päätös\n${words(60)}`;

function ctx(labels: 'auto' | 'model' = 'auto', decideEnabled = true) {
  return {
    deps: { storage: {} as never, config: { decideEnabled, contentClassProfileLabels: labels, contentClassProfileModel: 'test/model', decideMaxRequestTokens: 32000 } as never },
    ownerGhii: 'o@n', principal: 'o@n', isOwner: true, ai: { caller: 'owner' } as never,
    settings: { ...DEFAULT_SETTINGS, models: { ...DEFAULT_SETTINGS.models } },
  };
}
const item = { sourceId: 'memory:o@n:k', kind: 'text' as const, mimeType: 'text/plain', text, filename: 'k', technical: {} as never };

beforeEach(() => {
  decide.mockReset();
  complete.mockReset();
  complete.mockImplementation(async (_s: unknown, _c: unknown, _o: unknown, opts: { prompt: string; model?: string }) => {
    const sections = [1, 2].map((n) => ({ n, heading: `H${n}`, claim: `C${n}`, topic: n - 1, genre: 'A', trust: '~', certainty: 0.5,
      axes: { fakta: 0.1, konkr: 0.1, aika: 0.1, toim: 0.1, yks: 0.1, varm: 0.1 } }));
    return { content: JSON.stringify({ kind: 'raportti', topics: ['Hinnat', 'Päätös'], sections }), model: opts.model ?? 'default' };
  });
});

describe('labelQuestions and chunkSections', () => {
  it('asks nine questions a section and splits past 22 sections', () => {
    const secs = Array.from({ length: 30 }, (_, i) => ({ n: i + 1, heading: `h${i}`, text: 'x', words: 1 }));
    expect(Object.keys(labelQuestions(secs.slice(0, 2)))).toHaveLength(18);
    const chunks = chunkSections('t', secs, 32000);
    expect(chunks.map((c) => c.length)).toEqual([22, 8]);
  });
});

describe('profileItem', () => {
  it('lets the decision model label and the text model write', async () => {
    const answers: Record<string, unknown> = {};
    for (const n of [1, 2]) {
      answers[`s${n}_genre`] = { type: 'choice', value: 'fact' };
      answers[`s${n}_mark`] = { type: 'choice', value: n === 1 ? 'checkable_source' : 'nothing' };
      answers[`s${n}_cert`] = { type: 'score', value: 4 };
      for (const ax of ['fakta', 'konkr', 'aika', 'toim', 'yks', 'varm']) answers[`s${n}_${ax}`] = { type: 'score', value: 0 };
    }
    decide.mockResolvedValue({ decision_id: 'd1', model: 'jev-test', answers });
    const { profile, sections } = await profileItem(ctx() as never, item as never, 'k');
    expect(profile.labels).toBe('decide');
    expect(profile.prompt).toBe(PROFILE_TEXT_PROMPT);
    expect(profile.labelModel).toBe('jev-test');
    expect(profile.decisionIds).toEqual(['d1']);
    expect(profile.model).toBe('test/model');
    expect(sections.map((s) => [s.genre, s.mark, s.certainty, s.axes.fakta, s.heading])).toEqual([['F', '+', 0.9, -1, 'H1'], ['F', '?', 0.9, -1, 'H2']]);
    expect(String(complete.mock.calls[0][3].prompt)).toMatch(/^You write the headings/);
  });

  it('gives the text model all of it when the decision service refuses', async () => {
    decide.mockRejectedValue(Object.assign(new Error('off'), { code: 'DECIDE_DISABLED' }));
    const { profile, sections } = await profileItem(ctx() as never, item as never, 'k');
    expect(profile.labels).toBe('model');
    expect(profile.prompt).toBe(PROFILE_PROMPT);
    expect(sections.map((s) => s.mark)).toEqual(['~', '~']);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(String(complete.mock.calls[0][3].prompt)).toMatch(/^You profile a document/);
  });

  it('never asks the decision model when the node says model, or the decision service is off', async () => {
    await profileItem(ctx('model') as never, item as never, 'k');
    await profileItem(ctx('auto', false) as never, item as never, 'k');
    expect(decide).not.toHaveBeenCalled();
  });
});
