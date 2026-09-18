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
 *   names and the menu paths in services/ai-tool-setup.ts, never the day this file was edited.
 *   `pnpm check:prompt-refs` fails once it is older than MODEL_REVIEW_MAX_AGE_DAYS: the same rule,
 *   and the same 90 days, as the protocol version ledger.
 *
 *   NOT covered, on purpose: the conversation skill aimeat-first-conversation names the same two
 *   models in its text. It is kept byte for byte equal to the copy on aimeat.io and a digest test
 *   holds that, so it is changed there first. check:prompt-refs lists it as a place to update.
 * @structure MODEL_RECOMMENDATION · MODEL_REVIEW_MAX_AGE_DAYS · modelReviewAgeDays()
 * @usage import { MODEL_RECOMMENDATION as M } from './model-recommendation.js';   // M.claude → 'Opus 5'
 * @version-history
 *   v1.0.0 — 2026-09-18 — Initial. The date is the one ai-tool-setup.ts already carried for its
 *     sources; nothing was re-checked against the vendors today, so it was not moved.
 */

export const MODEL_RECOMMENDATION = {
  /** The weakest Claude model the setup steps recommend; read as "<name> or better". */
  claude: 'Opus 5',
  /** The ChatGPT model the setup steps recommend, used with thinking on. */
  chatgpt: 'GPT-5.6',
  /** ISO date the names and the vendors' menu paths were last checked at the source. */
  reviewedOn: '2026-07-31',
} as const;

export const MODEL_REVIEW_MAX_AGE_DAYS = 90;

/** Whole days since the review, against `now` (a parameter so a test can hold the clock). */
export function modelReviewAgeDays(now: Date = new Date()): number {
  const reviewed = Date.parse(MODEL_RECOMMENDATION.reviewedOn + 'T00:00:00Z');
  return Math.floor((now.getTime() - reviewed) / 86_400_000);
}
