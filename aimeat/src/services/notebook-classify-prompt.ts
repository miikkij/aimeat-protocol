/**
 * @file notebook-classify-prompt.ts
 * @description Single source of truth for the notebook placement-classifier prompt. Imported BOTH by
 *   the classifier service (as the fallback when the managed prompt is missing) and by
 *   prompt-defaults.ts (as the seed content), so the operator-editable managed prompt
 *   `notebook-classify` and the code fallback never drift. Placeholders: {{structure}} (the user's
 *   organism/workspace/document-space JSON) and {{note}} (the raw note text).
 * @version-history
 *   v1.0.0 — 2026-06-19 — Initial: extracted so the classify prompt is operator-managed like others.
 */

/** System/behavioural framing for the classifier model. */
export const NOTEBOOK_CLASSIFY_SYSTEM =
  'You are a librarian that files a user\'s note into the right place in their knowledge structure. You only ever choose ids that appear in the provided structure. You always answer with a single JSON object and nothing else.';

/** Instruction template. `{{structure}}` and `{{note}}` are substituted at call time. */
export const NOTEBOOK_CLASSIFY_TEMPLATE = [
  'Here is the user\'s knowledge structure (organisms, each with workspaces, each with document spaces). Use ONLY these exact ids:',
  '',
  '```json',
  '{{structure}}',
  '```',
  '',
  'Here is the user\'s note to file:',
  '',
  '"""',
  '{{note}}',
  '"""',
  '',
  'Decide the single BEST place to file this note as a DOCUMENT, and draft a clean document from it.',
  'Rules:',
  '- organismId / workspaceId / space MUST be ids/namespaces that exist above, or null.',
  '- "space" is the document-space "namespace" value of the chosen workspace.',
  '- If a workspace has no document space but is otherwise the right place, still pick it and set space=null (the app will create a document space).',
  '- If NOTHING fits well (your confidence below 0.4), set suggestion to your best guess anyway but set createNew.suggest=true and propose an organismName and/or workspaceName.',
  '- "title": a short title for the document. "markdown": the note rewritten as a clean, self-contained markdown document (keep the user\'s meaning; do not invent facts).',
  '- "confidence": 0..1. Give up to 2 "alternatives".',
  '',
  'Answer with EXACTLY this JSON shape:',
  '{"suggestion":{"organismId":string|null,"workspaceId":string|null,"space":string|null,"title":string,"markdown":string,"confidence":number,"reason":string},"alternatives":[{"organismId":string|null,"workspaceId":string|null,"space":string|null,"reason":string}],"createNew":{"suggest":boolean,"organismName":string,"workspaceName":string,"reason":string}}',
].join('\n');
