/**
 * @file living-author-prompt.ts
 * @description Single source of truth for the Living Document AUTHOR prompt. Imported by the author
 *   service (fallback when the managed prompt is missing) and by prompt-defaults.ts (seed), so the
 *   operator-editable managed prompt `living-author` and the code fallback never drift. Turns a user's
 *   plain-language need into a reusable living-document TEMPLATE (title + description + charter +
 *   sections), grounded by the owner's agent-offer catalogue so it can suggest which agent fills each
 *   section. Placeholders: {{need}} and {{capabilities}}.
 * @version-history
 *   v1.0.0 — 2026-06-21 — Phase 1: author a living-document template from a description.
 */

export const LIVING_AUTHOR_SYSTEM =
  'You design self-maintaining "living document" templates. Given a user\'s need, you produce a clean, focused template: a title, a scope, and 2–6 well-scoped sections, each with a short description of what belongs there. You suggest which of the user\'s AI agents could keep each section current. You always answer with a single JSON object and nothing else.';

export const LIVING_AUTHOR_TEMPLATE = [
  'The user wants a living document — a document that keeps itself current over time. Design a reusable TEMPLATE for it.',
  '',
  'User\'s need:',
  '"""',
  '{{need}}',
  '"""',
  '',
  'The user\'s AI-agent offers you may assign to sections (each: agent, offerId, title, ask). Only ever reference an "agent/offerId" pair that appears here; use null when a section is best written by reasoning alone:',
  '',
  '```json',
  '{{capabilities}}',
  '```',
  '',
  'Design rules:',
  '- 2 to 6 sections. Each section is ONE coherent topic with a clear "desc" describing exactly what belongs there (this is what keeps it scoped).',
  '- "kind": "derived" (AI-refined prose — the default), "aggregate" (a table/series built from data points over time, e.g. daily values), or "static" (fixed prose, no refresh).',
  '- "agent": "agent/offerId" from the catalogue when a section needs live/external data (web research, prices, images, …); otherwise null.',
  '- "slot": a short stable lowercase id, unique within the template.',
  '- "scope": one sentence describing what the whole document covers (and implicitly what it does NOT).',
  '- "tracks": the specific questions the document keeps answered.',
  '- Keep it focused — do not invent sections the need does not imply.',
  '',
  'Also write "charterReadable": a short plain-language paragraph a non-technical user can understand, describing what this living document does and how it stays current.',
  '',
  'Answer with EXACTLY this JSON shape:',
  '{"title":string,"description":string,"charter":{"scope":string,"tracks":string[],"include":string[],"exclude":string[],"trust":{"derive":"gated"|"auto"}},"template":[{"section":string,"desc":string,"slot":string,"kind":"derived"|"aggregate"|"static","rules":{"max_words":number},"agent":string|null}],"charterReadable":string}',
].join('\n');
