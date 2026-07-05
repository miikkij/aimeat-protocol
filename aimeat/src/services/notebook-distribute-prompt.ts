/**
 * @file notebook-distribute-prompt.ts
 * @description Single source of truth for the notebook DISTRIBUTE prompt. Imported BOTH by the
 *   distribute service (as the fallback when the managed prompt is missing) and by prompt-defaults.ts
 *   (as the seed content), so the operator-editable managed prompt `notebook-distribute` and the code
 *   fallback never drift. Unlike the classifier (one note → one home), the distributor SPLITS an
 *   (often already enriched) note into self-contained chunks and places EACH into its own best home.
 *   Placeholders: {{structure}} (organism/workspace/document-space JSON) and {{note}} (the note text).
 * @version-history
 *   v1.0.0 — 2026-06-21 — Initial (Phase 3): split a note into placed chunks.
 *   v1.1.0 — 2026-07-05 — B3: raise the split ceiling from 6 to 12 chunks (a real 12-item note was
 *     being truncated); the over-split guard is unchanged. Paired with MAX_CHUNKS=12 in notebook-classify.ts.
 */

/** System/behavioural framing for the distributor model. */
export const NOTEBOOK_DISTRIBUTE_SYSTEM =
  'You split a user\'s note into self-contained pieces and file each piece into the right place in their knowledge structure. You only ever choose ids that appear in the provided structure. You always answer with a single JSON object and nothing else.';

/** Instruction template. `{{structure}}` and `{{note}}` are substituted at call time. */
export const NOTEBOOK_DISTRIBUTE_TEMPLATE = [
  'Here is the user\'s knowledge structure (organisms, each with workspaces, each with document spaces). Use ONLY these exact ids:',
  '',
  '```json',
  '{{structure}}',
  '```',
  '',
  'Here is the user\'s note (it may already contain enrichment sections and a Sources/References list):',
  '',
  '"""',
  '{{note}}',
  '"""',
  '',
  'Split this note into 1 to 12 SELF-CONTAINED chunks, each covering one coherent topic/sub-topic, and decide the best place to FILE EACH chunk as its own DOCUMENT.',
  'Rules:',
  '- A note about a single thing may be ONE chunk — do not over-split. Split only when the note genuinely covers distinct topics that belong in different places.',
  '- Each chunk must stand on its own: give it a clear "title" and a clean, self-contained "markdown" body (preserve the user\'s meaning and any relevant sources; do not invent facts).',
  '- organismId / workspaceId / space MUST be ids/namespaces that exist above, or null.',
  '- "space" is the document-space "namespace" value of the chosen workspace.',
  '- If a chunk fits a workspace that has no document space, pick it and set space=null (the app creates one).',
  '- If a chunk fits nowhere well, set its ids to null and set createNew.suggest=true with a proposed organismName and/or workspaceName.',
  '',
  'Answer with EXACTLY this JSON shape:',
  '{"chunks":[{"organismId":string|null,"workspaceId":string|null,"space":string|null,"title":string,"markdown":string,"reason":string,"createNew":{"suggest":boolean,"organismName":string,"workspaceName":string}}]}',
].join('\n');
