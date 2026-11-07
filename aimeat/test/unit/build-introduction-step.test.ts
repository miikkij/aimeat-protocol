/**
 * @file test/unit/build-introduction-step.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Atelier build specification asks about an introduction and offers three to five
 *   designs with the clean look always among them (services/build-introduction-step.ts): the
 *   question sits in the interview after the data map, names diagrams and pictures without naming a
 *   library, and says a landing page usually takes none; the proposal states the designs and the
 *   introduction; the build section is in the body (so in the spec token) and served in part
 *   `libraries`; every part still fits one result; and the questions that were there are kept.
 * @usage cd aimeat && pnpm exec vitest run test/unit/build-introduction-step.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-07 — Initial.
 */
import { describe, it, expect } from 'vitest';
import type { AimeatConfig } from '../../src/config.js';
import { buildAtelierPrompt } from '../../src/services/build-atelier-prompt.js';
import { atelierPiece, atelierPieceIds, MAX_PART_CHARS, splitAtelierSpec } from '../../src/services/build-atelier-layers.js';
import { lookById } from '../../src/data/atelier-looks.js';
import { CLEAN_LOOK_ID, INTRODUCTION_QUESTION } from '../../src/services/build-introduction-step.js';

const config = { baseUrl: 'https://node.example', nodeId: 'node-test' } as unknown as AimeatConfig;
const full = buildAtelierPrompt(config, { mode: 'new', lang: 'en' }).full;
const body = buildAtelierPrompt(config, { mode: 'improve' }).body;
const proposal = full.slice(full.indexOf('## Then propose, and wait for the answer'), full.indexOf('## The Atelier track'));

describe('the introduction question', () => {
  it('comes after the data map scenario and before the proposal', () => {
    const scenario = full.indexOf('Build only after they say yes.');
    const intro = full.indexOf('**Then the introduction: one more question.**');
    const propose = full.indexOf('## Then propose, and wait for the answer');
    expect(scenario).toBeGreaterThan(-1);
    expect(intro).toBeGreaterThan(scenario);
    expect(propose).toBeGreaterThan(intro);
  });

  it('asks the scope, diagrams or pictures and prompts for their AI, without naming a library', () => {
    expect(INTRODUCTION_QUESTION).toContain('none, short (a few paragraphs on one screen) or full');
    expect(INTRODUCTION_QUESTION).toContain('diagrams or pictures');
    expect(INTRODUCTION_QUESTION).toContain('with their own AI');
    expect(INTRODUCTION_QUESTION).toContain('such as a landing page');
    expect(INTRODUCTION_QUESTION.toLowerCase()).not.toContain('mermaid');
  });

  it('is served in part start', () => {
    expect(atelierPiece(full, 'start', config.baseUrl)!.text).toContain('**Then the introduction: one more question.**');
  });

  it('keeps the interview\'s questions word for word', () => {
    expect(full).toContain('2. Who uses it — just you, or others too (shared data)?\n');
    expect(full).toContain('5. Anything it must NOT do?\n');
    expect(full).toContain('**Then the data map: three more questions, before any code.**');
  });

  it('leaves the improve-mode body without the interview question', () => {
    expect(body).not.toContain('**Then the introduction: one more question.**');
  });
});

describe('the proposal', () => {
  it('offers three to five designs, one always the clean look, and the look exists', () => {
    expect(proposal).toContain('**Three to five designs, named, each with one sentence on why it fits THIS app**');
    expect(proposal).toContain('ONE IS ALWAYS THE CLEAN ONE');
    expect(proposal).toContain('`app({ look: \'clean\' })`');
    expect(proposal).toContain('content="custom:clean"');
    expect(proposal).not.toContain('Two or three genres');
    expect(lookById(CLEAN_LOOK_ID)).toBeDefined();
  });

  it('states the introduction, and on plain keeps the designs and the introduction', () => {
    expect(proposal).toContain('- **The introduction, or none**');
    expect(proposal).toContain('on `plain` to those, the designs as looks and the introduction');
    expect(proposal).toContain('which design and which languages you are taking');
  });
});

describe('the build section', () => {
  it('is in the body, so the spec token carries it', () => {
    const section = body.slice(body.indexOf('## An introduction, when the owner asked for one'), body.indexOf('## Finishing'));
    expect(section).toContain('```mermaid');
    expect(section).toContain('AIMEAT.atelier.doc({ target, title, markdown, rich: true })');
    expect(section).toContain('aimeat-markdown.js');
    expect(section).toContain('AIMEAT.atelier.promptPanel({ target, prompt })');
    expect(section).toContain('its bound skill');
    expect(section).toContain('at most one without asking');
  });

  it('is served in part libraries, and the customising section in part book', () => {
    const placed = splitAtelierSpec(full);
    expect(placed.find((s) => s.title === 'An introduction, when the owner asked for one')!.part).toBe('libraries');
    expect(placed.find((s) => s.title === 'A COMPONENT THAT IS NEARLY RIGHT IS CUSTOMISED, NEVER COPIED')!.part).toBe('book');
    expect(placed.every((s) => s.placed)).toBe(true);
  });

  it('leaves every part inside one result', () => {
    for (const id of atelierPieceIds()) {
      expect(atelierPiece(full, id, config.baseUrl)!.text.length, id).toBeLessThanOrEqual(MAX_PART_CHARS);
    }
  });
});
