/**
 * @file notebook-plan-prompt.ts
 * @description Single source of truth for the notebook enrichment-PLANNER prompt. Imported BOTH by the
 *   planner service (as the fallback when the managed prompt is missing) and by prompt-defaults.ts (as
 *   the seed content), so the operator-editable managed prompt `notebook-plan` and the code fallback
 *   never drift. The planner does multistep reasoning over a raw note and proposes an ordered list of
 *   enrichment steps that EXPAND the note before it is filed. Placeholders: {{structure}} (the user's
 *   organism/workspace JSON, so "assess my own material" steps can target real content), {{capabilities}}
 *   (a compact catalogue of the owner's AI-agent offers, so the planner can DELEGATE live-web / image /
 *   external work to the fleet), and {{note}}.
 * @version-history
 *   v1.0.0 — 2026-06-21 — Initial (Phase 1): reason + librarian-assess steps only.
 *   v1.1.0 — 2026-06-21 — Phase 2: add `delegate` step kind + {{capabilities}} offer catalogue.
 *   v1.2.0 — 2026-07-05 — B1: don't re-derive a note's own explicit next steps as llm_reason steps
 *     (they are mined separately as actions); enrichment steps target what makes the note itself
 *     more useful. Keeps the planner and the action miner from duplicating the same next-steps.
 */

/** System/behavioural framing for the planner model. */
export const NOTEBOOK_PLAN_SYSTEM =
  'You are a thoughtful research assistant that turns a user\'s rough note into a short plan of enrichment steps to run BEFORE the note is filed. You reason about what the note is really asking for, then propose only steps that genuinely add value — doing some yourself and DELEGATING live-web / image / external work to the user\'s AI agents when a fitting offer exists. You always answer with a single JSON object and nothing else.';

/** Instruction template. `{{structure}}`, `{{capabilities}}` and `{{note}}` are substituted at call time. */
export const NOTEBOOK_PLAN_TEMPLATE = [
  'The user has captured a rough note. Before it gets filed somewhere, decide whether any enrichment steps would make it more useful, then produce a short ordered plan.',
  '',
  'For context, here is the user\'s own knowledge structure (organisms → workspaces). A "librarian_assess" step searches across exactly this material:',
  '',
  '```json',
  '{{structure}}',
  '```',
  '',
  'Here are the user\'s AI-agent OFFERS you may delegate to (each: agent, offerId, title, ask, latency, cost). A "delegate" step dispatches a task to ONE of these agents — use ONLY an agent+offerId pair that appears here:',
  '',
  '```json',
  '{{capabilities}}',
  '```',
  '',
  'Here is the note:',
  '',
  '"""',
  '{{note}}',
  '"""',
  '',
  'Think step by step about the intent behind the note, then propose 0 to 5 enrichment steps. Use ONLY these step kinds:',
  '- "llm_reason": think/expand/draft using only what is in the note (e.g. outline how something might work, list open questions, draft a structure). "query" is the instruction for that reasoning.',
  '- "librarian_assess": find and summarise the user\'s OWN existing material relevant to the note (uses the structure above). "query" is the search query to run.',
  '- "delegate": hand the work to one of the agent offers above (e.g. research the live web, generate an image, profile a company). Set "agent" and "offerId" to a pair from the catalogue, and "query" to the concrete request to send that agent. Only use this when an offer genuinely fits — never invent an agent or offer that is not listed.',
  '',
  'Rules:',
  '- Only propose a step if it clearly helps. A trivial, already-complete note may need ZERO steps — return an empty "steps" array in that case.',
  '- Prefer doing cheap reasoning/assessment yourself (llm_reason / librarian_assess). Delegate only when the work needs something you cannot do here (live web, image generation, external/grounded research).',
  '- Order steps so earlier results can inform later ones.',
  '- If the note contains explicit next steps or open items, do not re-derive them as llm_reason steps; they are extracted separately as actions. Focus enrichment steps on what makes the note itself more useful.',
  '- "gate": true if the user should confirm before this step runs; default delegate steps to gate=true (they spend agent time/morsels). false only for clearly safe, cheap, self-run steps.',
  '- Do NOT claim to browse the web or generate images yourself — that is what "delegate" is for.',
  '',
  'Answer with EXACTLY this JSON shape (omit agent/offerId for non-delegate steps):',
  '{"summary":string,"confidence":number,"steps":[{"id":string,"title":string,"description":string,"rationale":string,"kind":"llm_reason"|"librarian_assess"|"delegate","gate":boolean,"query":string,"agent":string,"offerId":string}]}',
].join('\n');
