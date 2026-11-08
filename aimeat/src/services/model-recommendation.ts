/**
 * @file model-recommendation.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Which model a person is told to pick, in ONE place, with the day somebody last
 *   checked it against the vendors' own pages.
 *
 *   A model name goes stale in months and nothing announces it. "Opus 5 or better" and "GPT-5.6
 *   with thinking" were written out in the setup steps for three tools in two languages and in the
 *   connect prompt the Agents tab shows, so the next model generation would have meant finding
 *   every copy by hand, and a missed one keeps recommending last year's model with full
 *   confidence. Approved in the instruction review of 2026-09-18 (item 11).
 *
 *   `reviewedOn` is the day a person or a session opened the vendors' pages and confirmed the
 *   names and the menu paths in services/ai/tool-setup.ts, never the day this file was edited.
 *   `pnpm check:prompt-refs` fails once it is older than MODEL_REVIEW_MAX_AGE_DAYS: the same rule,
 *   and the same 90 days, as the protocol version ledger.
 *
 *   The skills aimeat-first-conversation and aimeat-guided-journey read these names too (since
 *   2026-10-03; the first had been pinned to the aimeat.io copy by a digest until then).
 * @structure MODEL_RECOMMENDATION · MODEL_QUALITY_ADVICE · MODEL_REVIEW_MAX_AGE_DAYS · modelReviewAgeDays()
 * @usage import { MODEL_RECOMMENDATION as M } from './model-recommendation.js';   // M.claude → 'Opus 5'
 * @version-history
 *   v1.2.0 — 2026-11-08 — MODEL_QUALITY_ADVICE: the builder's own-model rule, by quality and never by
 *     name, read by the Atelier spec, the Classic skill and the full and appdev handbooks.
 *   v1.1.0 — 2026-10-30 — Checked at the vendors: GPT-6 replaced Latest in ChatGPT's model menu on
 *     2026-10-07 (help.openai.com/en/articles/20001354); Opus 5 is still the floor, Opus 5.5 the latest.
 *   v1.0.1 — 2026-10-03 — The comment names the two skills that read it now. No value changed.
 *   v1.0.0 — 2026-09-18 — Initial. The date is the one ai-tool-setup.ts already carried for its
 *     sources; nothing was re-checked against the vendors today, so it was not moved.
 */

export const MODEL_RECOMMENDATION = {
  /** The weakest Claude model the setup steps recommend; read as "<name> or better". */
  claude: 'Opus 5',
  /** The ChatGPT model the setup steps recommend, used with thinking on. */
  chatgpt: 'GPT-6',
  /** ISO date the names and the vendors' menu paths were last checked at the source. */
  reviewedOn: '2026-10-30',
} as const;

/**
 * What a builder is told about its own model, in every place that tells it. No model is named: names
 * change and there are good ones from more than one vendor, so the rule is the quality, and the
 * person hears it when the work shows it (Jouni, 2026-11-08). It replaced "Unless you are Claude
 * Opus or Claude Fable, say once…", which named two models and was skipped by the weaker ones.
 */
export const MODEL_QUALITY_ADVICE = 'This work needs a high-quality model. If errors keep coming (three you cannot explain, or one refusal twice), tell the person plainly that their model seems too weak to do this safely, and that a stronger one would do it better.';

export const MODEL_REVIEW_MAX_AGE_DAYS = 90;

/** Whole days since the review, against `now` (a parameter so a test can hold the clock). */
export function modelReviewAgeDays(now: Date = new Date()): number {
  const reviewed = Date.parse(MODEL_RECOMMENDATION.reviewedOn + 'T00:00:00Z');
  return Math.floor((now.getTime() - reviewed) / 86_400_000);
}
