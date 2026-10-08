/**
 * @file src/tool-catalog/ai-provenance-schema.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The `ai_provenance` block every write tool accepts, as one zod schema (TARGET-058).
 *   It is the exact schema of the catalog's `ai_provenance` field (definitions/ai-provenance-note.ts),
 *   so both MCP surfaces register it through zodShapeFor(), and the connector's shell dispatch and the
 *   REST doors validate against it through src/mcp/ai-provenance-input.ts, which re-exports it.
 *
 *   `level` is required once the block is present, because a block that says nothing about level says
 *   nothing at all; everything else is optional detail the node records if offered and works out for
 *   itself if not. Identity is never in this shape: the node fills in who wrote it, which node and
 *   when.
 *
 *   Moved here unchanged from src/mcp/ai-provenance-input.ts on 2026-10-05 (secaudit 2026-10, M3): the
 *   catalog imports nothing above utils/ and models/, and the catalog is now where a field's exact
 *   schema lives.
 * @structure AiProvenanceBlockSchema · AiProvenanceBodyFields
 * @usage import { AiProvenanceBlockSchema } from '../ai-provenance-schema.js';
 * @version-history
 *   v1.1.0 — 2026-10-08 — AiProvenanceBodyFields: ai_provenance and ai_provenance_id for a REST body
 *     schema to spread (aiprov D5).
 *   v1.0.0 — 2026-10-05 — Moved from src/mcp/ai-provenance-input.ts v1.2.1 (secaudit 2026-10, M3).
 */
import { z } from 'zod';
import {
  AI_PROVENANCE_LEVELS, AI_PROVENANCE_METHODS, AI_HUMAN_INVOLVEMENT, AiSourceUrlSchema,
} from '../models/ai-provenance-schemas.js';

const sourceInput = z.object({
  // The SAME scheme rule the stored record enforces, applied at the door. This field used to be a
  // bare `z.string()`: a declaration could carry `javascript:…`, the mint would then throw deep in
  // the service, and an author publishing an app got an opaque failure for an input the tool had
  // just accepted. One rule, stated once, refused where the caller can see it.
  url: AiSourceUrlSchema.describe('Where the material came from. Must be an http or https address.'),
  title: z.string().optional(),
  retrieved_at: z.string().optional().describe('ISO 8601 timestamp of when you fetched it.'),
  role: z.string().optional().describe("How it was used, e.g. 'primary' or 'background'."),
});

/** The declaration block. */
export const AiProvenanceBlockSchema = z.object({
  level: z.enum(AI_PROVENANCE_LEVELS).describe(
    "How much of this a model made. 'original' = a person wrote it, no model involved. "
    + "'assisted' = a person wrote it and a model edited or refined it. 'synthesized' = a model "
    + "combined real sources into new content at someone's direction. 'ai-generated' = a model "
    + 'produced it.'),
  method: z.enum(AI_PROVENANCE_METHODS).optional().describe(
    'Optional detail under level: how the content was produced.'),
  human_involvement: z.enum(AI_HUMAN_INVOLVEMENT).optional().describe(
    'Whether a person examined what the model produced. Only a step where someone reads the '
    + 'SUBSTANCE and can reject it counts: a skim, a spell-check or clicking publish is '
    + "'light-review' at most. Omitted means 'none'."),
  model: z.string().optional().describe(
    "The model that produced it, as the provider names it, e.g. 'anthropic/claude-opus-5'. "
    + 'When you made it, this is YOUR OWN model id: self-identify from your own configuration, never '
    + 'ask the person. Without it the record says only who served the model, never which one.'),
  provider: z.string().optional().describe(
    "Who served the model, when that is not obvious from its name — e.g. 'openrouter' in front of "
    + "someone else's model. Say it when you route through an intermediary, because 'which model' "
    + 'and "who ran it" are different questions and a reader chasing an output needs both.'),
  sources: z.array(sourceInput).max(100).optional().describe(
    'For synthesized content: where the material came from.'),
  notes: z.string().max(1_000).optional().describe(
    'Anything a reader would need to interpret the above. Never prompt text or anything private — '
    + 'the record is publishable alongside the content.'),
});

/**
 * The two optional fields a REST write body spreads into its own zod object, so the routes that take
 * a declaration (the DM send and broadcast, board post and reply, agent messages, task completion)
 * validate it against the same block the MCP tools register. A zod object strips unknown keys, so a
 * body schema without these fields dropped a declaration in silence.
 */
export const AiProvenanceBodyFields = {
  ai_provenance: AiProvenanceBlockSchema.optional(),
  ai_provenance_id: z.string().min(1).max(200).optional(),
};
