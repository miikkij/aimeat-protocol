/**
 * @file test/unit/app-scenarios.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The rules of a playtest scenario list (src/services/app/scenarios.ts): ids, names,
 *   the criteria a scenario names must exist, each step's own fields, the bounds, and the defaults.
 * @version-history
 *   v1.0.0 — 2026-11-26 — Initial (wish-builder-scenarios-in-the-playtest-signed-in-four-widths-both).
 */
import { describe, expect, it } from 'vitest';
import { checkScenarios, SCENARIOS_MAX, SCENARIO_STEPS_MAX } from '../../src/services/app/scenarios.js';

const CRITERIA = new Set(['add-item', 'phone']);
const good = { id: 'add', name: 'A member adds an item and sees it in the list.', criteria: ['add-item'], steps: [
  { do: 'fill', target: '#new', value: 'Milk' },
  { do: 'click', target: 'text=Add' },
  { do: 'expect_text', value: 'Milk' },
] };

describe('checkScenarios', () => {
  it('takes a good scenario, signed in by default', () => {
    const out = checkScenarios([good], CRITERIA);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.scenarios[0]).toMatchObject({ id: 'add', signed_in: true, criteria: ['add-item'] });
  });

  it('keeps signed_in false when it is asked for', () => {
    const out = checkScenarios([{ ...good, signed_in: false }], CRITERIA);
    expect(out.ok && out.scenarios[0].signed_in).toBe(false);
  });

  it('refuses a criterion the spec does not have, naming it', () => {
    const out = checkScenarios([{ ...good, criteria: ['nope'] }], CRITERIA);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.message).toContain('nope');
  });

  it('refuses a step that lacks its own field', () => {
    expect(checkScenarios([{ ...good, steps: [{ do: 'click' }] }], CRITERIA).ok).toBe(false);
    expect(checkScenarios([{ ...good, steps: [{ do: 'fill', target: '#a' }] }], CRITERIA).ok).toBe(false);
    expect(checkScenarios([{ ...good, steps: [{ do: 'expect_text' }] }], CRITERIA).ok).toBe(false);
    expect(checkScenarios([{ ...good, steps: [{ do: 'teleport', target: '#a' }] }], CRITERIA).ok).toBe(false);
  });

  it('refuses a repeated id, an empty or long step list, and too many scenarios', () => {
    expect(checkScenarios([good, good], CRITERIA).ok).toBe(false);
    expect(checkScenarios([{ ...good, steps: [] }], CRITERIA).ok).toBe(false);
    expect(checkScenarios([{ ...good, steps: Array.from({ length: SCENARIO_STEPS_MAX + 1 }, () => ({ do: 'wait', ms: 10 })) }], CRITERIA).ok).toBe(false);
    expect(checkScenarios(Array.from({ length: SCENARIOS_MAX + 1 }, (_, i) => ({ ...good, id: `s${i}` })), CRITERIA).ok).toBe(false);
  });

  it('bounds a wait to five seconds', () => {
    const out = checkScenarios([{ ...good, steps: [{ do: 'wait', ms: 60_000 }] }], CRITERIA);
    expect(out.ok && out.scenarios[0].steps[0].ms).toBe(5000);
  });
});
