/**
 * @file src/services/app/scenarios.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The builder's own playtest scenarios for an app: steps a headless browser runs on the
 *   published app, signed in, at every size of the one size matrix and in both themes
 *   (services/app/playtest-scenarios.ts runs them). Kept in the app's design spec record (field
 *   `scenarios`, services/app/design-spec.ts) beside the acceptance criteria they prove.
 *
 *   WHY. The node's playtest opened an app signed out and ran fixed checks, so a builder could not
 *   check the app's own logic as a member meets it, and a builder with no browser of its own (a Codex
 *   cloud task, a chat AI) published with nothing checked. The node has the browser for every
 *   builder; the scenario is what tells it what to look at.
 *
 *   ONE SCENARIO IS a name, the criteria it proves, whether it runs signed in (the default), and up to
 *   SCENARIO_STEPS_MAX steps. A step does one thing: click, fill, press, wait, or expect (a text on
 *   the page, an element visible, an element absent). A target is a CSS selector, or `text=` and the
 *   words a person sees. Steps run in order; the first that fails stops the scenario at that size.
 * @structure AppScenario · ScenarioStep · checkScenarios(input) · SCENARIO_SIZES · SCENARIO_THEMES
 * @version-history
 *   v1.0.0 — 2026-11-26 — Initial (wish-builder-scenarios-in-the-playtest-signed-in-four-widths-both).
 */

export const SCENARIO_STEP_KINDS = ['click', 'fill', 'press', 'wait', 'expect_text', 'expect_visible', 'expect_absent'] as const;
export type ScenarioStepKind = typeof SCENARIO_STEP_KINDS[number];

/** At most this many scenarios per app, and steps per scenario: a run is bounded in time. */
export const SCENARIOS_MAX = 10;
export const SCENARIO_STEPS_MAX = 25;
const TEXT_MAX = 400;
const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** The one size matrix (publish-finish.ts) and both themes: every scenario runs at each pair. */
export const SCENARIO_SIZES: ReadonlyArray<{ width: number; height: number }> = [
  { width: 390, height: 844 }, { width: 1280, height: 900 }, { width: 1280, height: 460 }, { width: 1920, height: 1080 },
];
export const SCENARIO_THEMES = ['light', 'dark'] as const;

export interface ScenarioStep {
  do: ScenarioStepKind;
  /** A CSS selector, or `text=` and the words a person sees. Not for `wait` and `expect_text`. */
  target?: string;
  /** For fill: the text typed. For press: the key ("Enter"). For expect_text: the words that must show. */
  value?: string;
  /** For wait: milliseconds, at most 5000. For the others: how long to wait for the target, at most 5000. */
  ms?: number;
}

export interface AppScenario {
  id: string;
  name: string;
  /** The acceptance criteria this scenario proves when it passes at every size and theme. */
  criteria: string[];
  /** Runs as a member who is signed in (a throwaway account the run makes and erases). Default true. */
  signed_in: boolean;
  steps: ScenarioStep[];
}

type Checked = { ok: true; scenarios: AppScenario[] } | { ok: false; message: string };

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** Read a written list of scenarios: shapes, bounds, unique ids, and each step's own fields. */
export function checkScenarios(input: unknown, criteriaIds: ReadonlySet<string>): Checked {
  if (!Array.isArray(input)) return { ok: false, message: 'scenarios is the whole list: an array of { id, name, criteria?, signed_in?, steps }.' };
  if (input.length > SCENARIOS_MAX) return { ok: false, message: `At most ${SCENARIOS_MAX} scenarios: a run opens each at ${SCENARIO_SIZES.length} sizes and ${SCENARIO_THEMES.length} themes.` };
  const seen = new Set<string>();
  const out: AppScenario[] = [];
  for (const [i, raw] of input.entries()) {
    const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const at = `scenarios[${i}]`;
    const id = str(r.id);
    if (!ID_RE.test(id)) return { ok: false, message: `${at}.id is a short lowercase name (letters, digits, hyphens, at most 40).` };
    if (seen.has(id)) return { ok: false, message: `${at}.id "${id}" is used twice.` };
    seen.add(id);
    const name = str(r.name);
    if (!name || name.length > TEXT_MAX) return { ok: false, message: `${at}.name says what the scenario does, in one sentence, at most ${TEXT_MAX} characters.` };
    const criteria = Array.isArray(r.criteria) ? r.criteria.map(str).filter(Boolean) : [];
    const unknown = criteria.filter(c => !criteriaIds.has(c));
    if (unknown.length) return { ok: false, message: `${at}.criteria names ${unknown.join(', ')}, which the design spec has no criterion for: write the criterion first with criteria_set.` };
    const steps = Array.isArray(r.steps) ? r.steps : [];
    if (steps.length === 0 || steps.length > SCENARIO_STEPS_MAX) return { ok: false, message: `${at}.steps is 1 to ${SCENARIO_STEPS_MAX} steps.` };
    const checkedSteps: ScenarioStep[] = [];
    for (const [j, sraw] of steps.entries()) {
      const s = (sraw && typeof sraw === 'object' ? sraw : {}) as Record<string, unknown>;
      const sat = `${at}.steps[${j}]`;
      const kind = s.do as ScenarioStepKind;
      if (!SCENARIO_STEP_KINDS.includes(kind)) return { ok: false, message: `${sat}.do is one of ${SCENARIO_STEP_KINDS.join(', ')}.` };
      const target = str(s.target);
      const value = typeof s.value === 'string' ? s.value : undefined;
      const ms = typeof s.ms === 'number' && Number.isFinite(s.ms) ? Math.max(0, Math.min(5000, Math.floor(s.ms))) : undefined;
      const needsTarget = kind !== 'wait' && kind !== 'expect_text';
      if (needsTarget && (!target || target.length > TEXT_MAX)) return { ok: false, message: `${sat}.target is a CSS selector or text= and the words a person sees, at most ${TEXT_MAX} characters.` };
      if ((kind === 'fill' || kind === 'press' || kind === 'expect_text') && (value === undefined || value.length > TEXT_MAX)) {
        return { ok: false, message: `${sat}.value is required for ${kind}, at most ${TEXT_MAX} characters.` };
      }
      checkedSteps.push({ do: kind, ...(target ? { target } : {}), ...(value !== undefined ? { value } : {}), ...(ms !== undefined ? { ms } : {}) });
    }
    out.push({ id, name, criteria, signed_in: r.signed_in !== false, steps: checkedSteps });
  }
  return { ok: true, scenarios: out };
}
