/**
 * @file src/mcp/catalog/definitions/ai-provenance-note.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The AI-transparency sentence appended to every write tool's description, and the two
 *   catalog input fields that go with it (TARGET-058 Phase 4). One copy, imported by each tool-group
 *   module — nine hand-written variants of "declare your provenance" would teach nine slightly
 *   different conventions to the agents reading these schemas.
 *
 *   APPENDED, NEVER SUBSTITUTED. Every one of those descriptions is working prompt text an agent
 *   already behaves correctly on; this adds a sentence at the end and changes nothing before it.
 *
 *   A LEAF MODULE ON PURPOSE. The catalog is loaded by the CLI fallback path as well as the server,
 *   so it imports nothing but types. `src/mcp/ai-provenance-input.ts` (the zod side) re-exports the
 *   sentence from here rather than spelling it a second time.
 * @structure
 *   - AI_PROVENANCE_TOOL_NOTE   — the sentence, appended to a write tool's description
 *   - aiProvenanceCatalogInput  — the `ai_provenance` + `ai_provenance_id` input entries
 * @usage
 *   import { AI_PROVENANCE_TOOL_NOTE, aiProvenanceCatalogInput } from './ai-provenance-note.js';
 *   { name: 'aimeat_memory_write', description: 'Write a memory entry…' + AI_PROVENANCE_TOOL_NOTE,
 *     input: { key: {…}, ...aiProvenanceCatalogInput } }
 * @version-history
 *   v1.0.0 — 2026-08-01 — TARGET-058 Phase 4.
 */
import type { ToolInputField } from './types.js';

/**
 * The one sentence. Stated positively — what to DO — and it names the consequence of silence,
 * because that is the part an agent has to know: this node records an undeclared agent write as
 * model-written, so relaying a person's words is something you have to SAY, not something you get
 * by staying quiet.
 */
export const AI_PROVENANCE_TOOL_NOTE =
  ' If a model generated or substantially rewrote this content, declare it in `ai_provenance`'
  + ' (level, and human_involvement if a person reviewed the substance). If you are relaying text a'
  + ' person wrote, say so with level:"original" — silence is recorded as model-written.';

/** The two provenance inputs, for the catalog's documented input contract. */
export const aiProvenanceCatalogInput: Record<string, ToolInputField> = {
  ai_provenance: {
    type: 'object',
    description:
      'How this content was made: { level, method?, human_involvement?, model?, sources?, notes? }. '
      + '`level` is required when the block is present: original | assisted | synthesized | '
      + 'ai-generated. `human_involvement` (none | light-review | editorial-control | full-human) '
      + 'counts only a step where a person read the SUBSTANCE and could reject it; omitted means '
      + 'none. The node fills in who you are, which node, when, and a hash of the exact bytes — '
      + 'those are never taken from the caller.',
  },
  ai_provenance_id: {
    type: 'string',
    description:
      'Attach an EXISTING provenance record instead of declaring a new one — the id the node '
      + 'returned when it generated this content for you. Only your own records can be attached.',
  },
};
