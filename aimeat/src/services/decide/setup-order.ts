/**
 * @file src/services/decide/setup-order.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description THE ONE ORDER in which the decision model is set up, written once so the places that
 *   say it cannot drift apart: the settings answer (GET /v1/ai/decide/settings, aimeat_decide_settings),
 *   the appdev overview, and the refusals that name what is missing. The skill `node:aimeat-decide`,
 *   the agent handbook and the Crew tab's refusal text say the same six steps in their own medium
 *   (Markdown, a handbook section, a locale string); test/unit/decide-setup-order.test.ts holds them
 *   to the same six verbs in the same order.
 *
 *   WHY AN ORDER AT ALL. Each step needs the one before it: a rule cannot be tried without a provider, an
 *   agent cannot be given a rule that does not exist, and a gate on a rule nobody tried stops an
 *   agent on numbers nobody looked at. An owner told only "set a key" sets a key and is no nearer.
 * @structure DECIDE_SETUP_ORDER · decideSetupOrderText
 * @usage import { DECIDE_SETUP_ORDER } from './setup-order.js';
 * @version-history
 *   v1.1.0 — 2026-09-23 — Step 1 is choosing a decision provider, with the key as the TypeSafe
 *     branch; step 2 tests only a provider that takes a key. Ids `provider` and `test` (were `key`
 *     and `test-key`; nothing read them).
 *   v1.0.0 — 2026-09-20 — Initial.
 */

export interface SetupStep { step: number; id: string; what: string; where: string }

export const DECIDE_SETUP_ORDER: readonly SetupStep[] = Object.freeze([
  { step: 1, id: 'provider', what: 'Choose a decision provider. A local decision model on this machine needs no key; for TypeSafe, set a key: the owner\'s own, or one for a single agent.',
    where: 'Settings, AI, Decision model, Decision providers; the key under the same card, or Profile, Agents, the agent, AI keys.' },
  { step: 2, id: 'test', what: 'Test it when it takes a key: one tiny real call that says which key paid. A provider without a key needs no test.',
    where: 'The Test button beside the key.' },
  { step: 3, id: 'rule', what: 'Write a decision rule and try it on its sample.',
    where: 'Settings, AI, Decision model, Rules. An agent may propose one with aimeat_decide_rule_propose; the owner approves it.' },
  { step: 4, id: 'give', what: 'Give the rule to an agent.',
    where: 'The Crew tab\'s tool picker: the row decide:<rule>. The rule\'s `use` must allow agents.' },
  { step: 5, id: 'gate', what: 'Decide about the gate: off, the agent acts and every decision is still recorded; on, an answer under the act band becomes a task for the owner.',
    where: 'Profile, Agents, the agent, AI keys. Off by default, so a comparison run can run unguarded.' },
  { step: 6, id: 'tune', what: 'Read the decisions and tune the thresholds.',
    where: 'The rule\'s quality numbers: decisions, gate stops, overrides, cost. aimeat_decision_list { rule } reads them one by one.' },
]);

/** The order as one paragraph, for a tool answer or a refusal. */
export function decideSetupOrderText(): string {
  return DECIDE_SETUP_ORDER.map(s => `${s.step}. ${s.what}`).join(' ');
}
