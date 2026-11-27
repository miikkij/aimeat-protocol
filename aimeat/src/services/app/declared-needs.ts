/**
 * @file src/services/app/declared-needs.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What a published page SAYS it needs, and the proof that follows from saying it.
 *   A page built on the Atelier kit can declare an area's needs with
 *   `AIMEAT.atelier.requires({ needs: ['session', …] })` (static/sdk-libs/atelier/requires.js)
 *   instead of checking them by hand. The kit then stamps the area's state on its root element
 *   (`data-ak-state`: the stop that stands, or `ready`), which a playtest scenario can assert on.
 *   So a declared need comes with its own acceptance criterion and scenario, and this module words
 *   them for the publish answer: ready to write, never written for the builder.
 *
 *   Only `session` gets a pair today, because it is the one need whose two sides the playtest can
 *   always reach: its signed-out visitor and its signed-in member. `ai` and `member:<cap>` depend on
 *   a setting or a role the playtest account does not choose.
 *
 *   The read is a text match on the page source, like the scope and register reads beside it
 *   (artifact-lint.ts). A page that builds its `needs` list at run time declares nothing here and
 *   is offered nothing, which is the honest answer.
 * @structure declaredNeedsOf(html) · needsProof(owner, filename, html, criteria)
 * @usage import { needsProof } from './declared-needs.js';
 * @version-history
 *   v1.0.0 — 2026-11-27 — Initial (wish-atelier-contextual-templates-pyynt-lohko-ask).
 */
import type { AppCriterion } from './acceptance-criteria.js';

/** The needs the kit knows; `member:<cap>` is matched by its prefix. */
const KNOWN = new Set(['session', 'ai', 'online']);

/** The ids of the ready-made pair, so a publish that already has them offers nothing twice. */
export const NEEDS_SIGNED_OUT = 'needs-signed-out';
export const NEEDS_SIGNED_IN = 'needs-signed-in';

/**
 * The needs a page declares in literal `requires({ … needs: [ … ] … })` calls, in the order first
 * seen, without repeats. Unknown words are left out: the kit says those on the page itself.
 */
export function declaredNeedsOf(html: string): string[] {
  const found: string[] = [];
  const call = /\brequires\s*\(\s*\{[\s\S]{0,2000}?\bneeds\s*:\s*\[([^\]]{0,400})\]/g;
  for (let m = call.exec(html); m; m = call.exec(html)) {
    for (const item of m[1].split(',')) {
      const word = item.trim().replace(/^['"`]|['"`]$/g, '');
      const ok = KNOWN.has(word) || /^member:[A-Za-z0-9_.-]{1,40}$/.test(word);
      if (ok && !found.includes(word)) found.push(word);
    }
  }
  return found;
}

/**
 * The publish answer's line about declared needs: empty when the page declares none, when it
 * does not declare `session`, or when both ready-made criteria are already in the spec.
 */
export function needsProof(
  ownerName: string, filename: string, html: string, criteria?: readonly AppCriterion[],
): Record<string, unknown> {
  const needs = declaredNeedsOf(html);
  if (!needs.includes('session')) return {};
  const have = new Set((criteria ?? []).map(c => c.id));
  if (have.has(NEEDS_SIGNED_OUT) && have.has(NEEDS_SIGNED_IN)) return {};
  const ready = {
    criteria: [
      { id: NEEDS_SIGNED_OUT, text: 'A visitor who is not signed in sees the sign-in stop in place of the area.', check: 'scenario' },
      { id: NEEDS_SIGNED_IN, text: 'A signed-in person sees the area\'s own content.', check: 'scenario' },
    ],
    scenarios: [
      {
        id: NEEDS_SIGNED_OUT, name: 'A visitor who is not signed in sees the sign-in stop.',
        criteria: [NEEDS_SIGNED_OUT], signed_in: false,
        steps: [{ do: 'expect_visible', target: '[data-ak-requires][data-ak-state="signIn"]' }],
      },
      {
        id: NEEDS_SIGNED_IN, name: 'A signed-in person sees the area\'s own content.',
        criteria: [NEEDS_SIGNED_IN], signed_in: true,
        steps: [{ do: 'expect_visible', target: '[data-ak-requires][data-ak-state="ready"]' }],
      },
    ],
  };
  return {
    declared_needs: needs,
    needs_proof: `This page declares what it needs with AIMEAT.atelier.requires (${needs.join(', ')}), and the kit stamps the area's state on its element, so the proof is ready-made. Add the two criteria in \`needs_proof_ready.criteria\` to this app's list with aimeat_app_manage { action: "criteria_set", owner: "${ownerName}", filename: "${filename}" } and the two scenarios in \`needs_proof_ready.scenarios\` with { action: "scenarios_set" }, as they are. The playtest (audit { playtest: true }) then runs both at four sizes in both themes and evidences the two lines.`,
    needs_proof_ready: ready,
  };
}
