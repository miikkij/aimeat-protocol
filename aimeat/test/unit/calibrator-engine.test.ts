/**
 * @file test/unit/calibrator-engine.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The pure half of the calibrator page: the weighted score, the JSON a model wraps in
 *   prose, which proposals an option selects, what a pasted answer writes into the run, how the
 *   synthesis prompt is composed, and the frame's reading of runs (empty or not, in order and
 *   numbered, the judge a calibration actually uses). These are the parts a wrong number on the
 *   page would come from; the model calls themselves are E2E territory.
 * @version-history
 *   v1.0.0 — 2026-09-04 — Initial.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('/js/i18n.js', () => ({ t: (k: string) => k, getLocale: () => 'en' }));
vi.mock('/js/swallowed.js', () => ({ swallowed: () => {} }));
vi.mock('/js/services/auth.js', () => ({ authHeaders: () => ({}) }));
vi.mock('/js/services/calibrator.js', () => ({ updateBatch: async () => null, createVersion: async () => null }));
vi.mock('preact', () => ({ h: () => null }));
vi.mock('htm', () => ({ default: { bind: () => () => null } }));

const engine = await import('../../public/views/profile/calibrator/engine.js');
const frame = await import('../../public/views/profile/calibrator/frame.js');

describe('computeWeightedScore', () => {
  it('weighs critical 3, major 2, minor 1', () => {
    const dims = [
      { severity: 'critical', pass: true }, { severity: 'critical', pass: true },
      { severity: 'major', pass: false }, { severity: 'minor', pass: true }, { severity: 'minor', pass: true },
    ];
    // passed 3+3+1+1 = 8 of 3+3+2+1+1 = 10
    expect(engine.computeWeightedScore(dims)).toBe(80);
  });
  it('is null with nothing to weigh, and treats an unknown severity as minor', () => {
    expect(engine.computeWeightedScore([])).toBeNull();
    expect(engine.computeWeightedScore(null)).toBeNull();
    expect(engine.computeWeightedScore([{ severity: 'odd', pass: true }, { severity: 'critical', pass: false }])).toBe(25);
  });
});

describe('extractJson', () => {
  it('reads the object a model wrapped in prose or a code fence', () => {
    expect(engine.extractJson('Here you go:\n```json\n{"a": 1, "b": [2]}\n```\nDone.')).toEqual({ a: 1, b: [2] });
  });
  it('answers null for no object or a broken one', () => {
    expect(engine.extractJson('no braces here')).toBeNull();
    expect(engine.extractJson('{"a": ')).toBeNull();
  });
});

describe('optionProposals', () => {
  const synth = {
    groupedProposals: [{ proposal: 'one' }, { text: 'two' }, { proposal: 'three', id: 'p3' }],
    options: { A: { proposalIds: [0] }, B: { proposalIds: [0, 2] }, C: { proposals: ['p3', 1] } },
  };
  it('selects by index, and by id when the option names ids', () => {
    expect(engine.optionProposals(synth, 'A')).toEqual(['one']);
    expect(engine.optionProposals(synth, 'B')).toEqual(['one', 'three']);
    expect(engine.optionProposals(synth, 'C')).toEqual(['three', 'two']);
  });
  it('is empty for a missing option or synthesis', () => {
    expect(engine.optionProposals(synth, 'D')).toEqual([]);
    expect(engine.optionProposals(null, 'A')).toEqual([]);
  });
});

describe('pasteInto', () => {
  const batch = { models: [{ modelId: 'llm-1', modelLabel: 'M1' }, { modelId: 'llm-2', modelLabel: 'M2' }] };
  it('writes an answer as step 1 done, on the right model only', () => {
    const patch = engine.pasteInto('generate', batch, 1, 'the answer');
    expect(patch.models[1].step1_generation).toMatchObject({ status: 'done', output: 'the answer' });
    expect(patch.models[0].step1_generation).toBeUndefined();
  });
  it('scores a pasted comparison the way the model call would', () => {
    const text = 'Sure. {"dimensions":[{"name":"a","severity":"critical","pass":true},{"name":"b","severity":"minor","pass":false}],"analysis":"ok"}';
    const patch = engine.pasteInto('analyze', batch, 0, text);
    expect(patch.models[0].step2_analysis).toMatchObject({ status: 'done', overallScore: 75, analysis: 'ok' });
  });
  it('marks the reflection done only once both halves are in', () => {
    const judge = engine.pasteInto('reflect', batch, 0, '{"proposals":["j"]}', 'judge');
    expect(judge.models[0].step3_reflection.status).toBe('pending');
    const both = engine.pasteInto('reflect', judge, 0, '{"proposals":["s"]}', 'self');
    expect(both.models[0].step3_reflection.status).toBe('done');
    expect(both.models[0].step3_reflection.judgeProposals.proposals).toEqual(['j']);
    expect(both.models[0].step3_reflection.selfProposals.proposals).toEqual(['s']);
  });
  it('writes a pasted summary as the synthesis and marks the run synthesized', () => {
    const patch = engine.pasteInto('synthesize', batch, 0, '{"groupedProposals":[{"proposal":"x"}],"options":{"A":{"proposalIds":[0]}},"recommendation":"A"}');
    expect(patch.status).toBe('synthesized');
    expect(patch.step4_synthesis.status).toBe('done');
    expect(patch.step4_synthesis.options.A.proposalIds).toEqual([0]);
  });
});

describe('composeSynthesis', () => {
  it('fills the judge and self proposals per model and says (none) when a side is empty', () => {
    const project = { synthesisPromptTemplate: 'P:{PROMPT_USED}\nJ:{JUDGE_PROPOSALS}\nS:{CANDIDATE_PROPOSALS}' };
    const batch = { models: [
      { modelLabel: 'M1', step3_reflection: { status: 'done', judgeProposals: { proposals: ['a', { text: 'b' }] }, selfProposals: { proposals: [] } } },
      { modelLabel: 'M2', step3_reflection: { status: 'pending' } },
    ] };
    const out = engine.composeSynthesis(project, { prompt: 'the prompt' }, batch);
    expect(out).toBe('P:the prompt\nJ:[M1]\n1. a\n2. b\nS:(none)');
  });
});

describe('frame: runs', () => {
  const runs = [
    { batchId: 'b3', createdAt: '2026-05-22T15:31:00Z', status: 'synthesized', scores: [{ modelId: 'm', overallScore: 90 }] },
    { batchId: 'b0', createdAt: '2026-05-22T15:29:00Z', status: 'created', scores: [{ modelId: 'm', overallScore: null }] },
    { batchId: 'b1', createdAt: '2026-05-22T15:14:00Z', status: 'synthesized', scores: [{ modelId: 'm', overallScore: 0 }] },
  ];
  it('tells an empty run from a scored one, including a run that scored 0', () => {
    expect(frame.isEmptyRun(runs[1])).toBe(true);
    expect(frame.isEmptyRun(runs[2])).toBe(false);
    expect(frame.isEmptyRun({ status: 'generated', scores: [] })).toBe(false);
  });
  it('numbers the real runs oldest first and leaves the empty ones out', () => {
    const ordered = frame.runsInOrder(runs);
    expect(ordered.map((r) => [r.batchId, r.number])).toEqual([['b1', 1], ['b3', 2]]);
  });
  it('averages the scored models of a run', () => {
    expect(frame.runAverage({ scores: [{ overallScore: 87 }, { overallScore: 82 }, { overallScore: 100 }] })).toBe(90);
    expect(frame.runAverage({ scores: [{ overallScore: null }] })).toBeNull();
  });
  it('names the checkpoints that did not pass, in words', () => {
    expect(frame.failedWords({ step2_analysis: { dimensions: [{ name: 'top_level_structure', pass: false }, { name: 'ok', pass: true }] } })).toEqual(['top level structure']);
  });
});

describe('frame: the judge', () => {
  it('keeps a calibration\'s own judge, else the AI page\'s reasoning model, else its default', () => {
    expect(frame.judgeOf({ reasoningLlm: { modelId: 'x/own', label: 'Own' } }, { reasoningModel: 'y/r' })).toMatchObject({ modelId: 'x/own', own: true });
    expect(frame.judgeOf({ reasoningLlm: null }, { reasoningModel: 'y/r', model: 'y/d' })).toMatchObject({ modelId: 'y/r', own: false, source: 'reasoning' });
    expect(frame.judgeOf({}, { model: 'y/d' })).toMatchObject({ modelId: 'y/d', source: 'default' });
    expect(frame.judgeOf({}, {})).toMatchObject({ modelId: '', source: 'server' });
  });
});
