/**
 * @file test/unit/decide-setup-order.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description THE ONE ORDER the decision model is set up in is said in four places: the settings
 *   answer (services/decide/setup-order.ts), the skill `aimeat-decide`, the agent handbook and the
 *   Crew tab's refusal text. This holds all four to the same six steps in the same order, so that a
 *   fifth step added to one of them fails here until the other three say it too.
 *
 *   Each step is recognised by the word every wording of it must carry. The words are deliberately
 *   plain (key, test, rule, agent, gate, threshold), so a rewording that keeps the meaning passes and
 *   one that drops or reorders a step does not.
 * @version-history
 *   v1.0.0 — 2026-09-20 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DECIDE_SETUP_ORDER, decideSetupOrderText } from '../../src/services/decide/setup-order.js';
import { DECIDE_SKILL_ENTRY } from '../../src/data/builtin-skills.decide.js';

const STEPS = [/\bkey\b/i, /\btest/i, /\brule\b/i, /\bagent\b/i, /\bgate\b/i, /\bthreshold/i];

/** The position of each step's word, searched from where the previous step was found. */
function positions(text: string): number[] {
  let from = 0;
  return STEPS.map((re) => {
    const m = re.exec(text.slice(from));
    if (!m) return -1;
    from += m.index + m[0].length;
    return from;
  });
}

function expectInOrder(name: string, text: string): void {
  const at = positions(text);
  expect(at.every(p => p > 0), `${name} names all six steps, in order (found at ${at.join(', ')})`).toBe(true);
}

describe('the one order the decision model is set up in', () => {
  it('the constant has six steps, numbered 1 to 6, whose ids are fixed', () => {
    expect(DECIDE_SETUP_ORDER.map(s => s.step)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(DECIDE_SETUP_ORDER.map(s => s.id)).toEqual(['key', 'test-key', 'rule', 'give', 'gate', 'tune']);
    expectInOrder('the settings answer', decideSetupOrderText());
  });

  it('the skill says the same six steps in the same order', () => {
    const md = DECIDE_SKILL_ENTRY.skillMd;
    const section = md.slice(md.indexOf('Everything is set up in one order'));
    expect(section.length).toBeGreaterThan(100);
    expectInOrder('skill aimeat-decide', section.slice(0, section.indexOf('How a rule reaches an outcome')));
  });

  it('the agent handbook says them too', () => {
    const src = readFileSync(join(__dirname, '../../src/services/handbooks/agent.ts'), 'utf8');
    const section = src.slice(src.indexOf('Everything is set up in one order'));
    expect(section.length).toBeGreaterThan(100);
    expectInOrder('the agent handbook', section.slice(0, 700));
  });

  it('the Crew tab\'s refusal text says them too, in English', () => {
    const en = JSON.parse(readFileSync(join(__dirname, '../../locales/en.json'), 'utf8'));
    const text = en.profile.agents.detail.crew.tools.decideNoKey as string;
    expectInOrder('the Crew tab refusal', text.slice(text.indexOf('The order is')));
  });

  it('a missing key is answered with an instruction, not a bare error', () => {
    const src = readFileSync(join(__dirname, '../../src/services/decide/service.ts'), 'utf8');
    const m = /'NO_API_KEY', 400, agent\s*\?\s*`([^`]+)`\s*:\s*'([^']+)'/.exec(src);
    expect(m, 'the NO_API_KEY refusal is still where this test reads it').not.toBeNull();
    for (const said of [m![1], m![2]]) {
      expect(said).toMatch(/Settings, AI, Decision model/);
      expect(said).toMatch(/\btest/i);
    }
  });
});
