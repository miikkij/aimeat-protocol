/**
 * @file src/mcp/ai-provenance-input.ts
 * @description The `ai_provenance` parameter every MCP write tool accepts, defined ONCE (TARGET-058
 *   Phase 4). One zod fragment, one description, one mapping to the internal shape — so the eight
 *   write tools that carry it cannot end up describing three slightly different parameters to the
 *   agents reading their schemas.
 *
 *   THE BOUNDARY THIS FILE IS. Article 50(1) does not reach agent-to-node traffic: an agent is not a
 *   natural person and machine-to-machine is outside the interaction duty. Carrying provenance here
 *   is an ENGINEERING requirement instead — the MCP hop is where the information either survives or
 *   is lost, and once it is lost no amount of labelling downstream can reconstruct the truth.
 *
 *   SNAKE ON THE WIRE, CAMEL INSIDE. The parameter name and its members are snake_case because every
 *   sibling parameter in the MCP catalogs is (`organism_id`, `include_archived`), and because this
 *   block is an INPUT DTO rather than the self-describing document: it carries no `spec`, and the
 *   node fills everything a caller has no business asserting. The document it becomes keeps one
 *   camelCase spelling on every carrier — see models/ai-provenance-schemas.ts. Mapping happens here,
 *   at the boundary, which is the house convention (22-frozen-vocabulary.md §B1).
 *
 *   WHAT THE NODE NEVER TAKES FROM THE CALLER: identity. There is no principal, no nodeId and no
 *   attestation in this shape, by construction rather than by validation — this is the one place an
 *   agent could otherwise attribute its writing to somebody else.
 * @structure
 *   - aiProvenanceInput      — the optional zod fragment, spread into a write tool's input shape
 *   - aiProvenanceIdInput    — the sibling `ai_provenance_id` fragment (attach an existing record)
 *   - toDeclaredProvenance() — the snake→camel mapping into services/ai-provenance.ts's input type
 * @usage
 *   import { aiProvenanceInput, toDeclaredProvenance } from './ai-provenance-input.js';
 *   mcp.tool('aimeat_memory_write', descriptionFor('aimeat_memory_write'),
 *     { key: z.string(), value: z.any(), ...aiProvenanceInput },
 *     annotationsFor('aimeat_memory_write'),
 *     async ({ key, value, ai_provenance, ai_provenance_id }) => {
 *       const id = await provenanceForWrite(storage, {
 *         principal: agentGaii, content: bytes,
 *         declared: toDeclaredProvenance(ai_provenance), declaredId: ai_provenance_id, ... });
 *     });
 * @version-history
 *   v1.0.0 — 2026-08-01 — TARGET-058 Phase 4.
 */
import { z } from 'zod';
import {
  AI_PROVENANCE_LEVELS, AI_PROVENANCE_METHODS, AI_HUMAN_INVOLVEMENT,
} from '../models/ai-provenance-schemas.js';
import type { DeclaredProvenance } from '../services/ai-provenance.js';

// The sentence appended to every write tool's description lives in the catalog (a leaf module the
// CLI fallback path can load without pulling in zod or the services layer) and is re-exported here
// so there is exactly one copy of it.
export { AI_PROVENANCE_TOOL_NOTE } from './catalog/definitions/ai-provenance-note.js';

const sourceInput = z.object({
  url: z.string().describe('Where the material came from.'),
  title: z.string().optional(),
  retrieved_at: z.string().optional().describe('ISO 8601 timestamp of when you fetched it.'),
  role: z.string().optional().describe("How it was used, e.g. 'primary' or 'background'."),
});

/**
 * The declaration block. `level` is required once the block is present, because a block that says
 * nothing about level says nothing at all; everything else is optional detail the node records if
 * offered and works out for itself if not.
 */
const aiProvenanceBlock = z.object({
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
    "The model that produced it, as the provider names it, e.g. 'anthropic/claude-opus-5'."),
  sources: z.array(sourceInput).max(100).optional().describe(
    'For synthesized content: where the material came from.'),
  notes: z.string().max(1_000).optional().describe(
    'Anything a reader would need to interpret the above. Never prompt text or anything private — '
    + 'the record is publishable alongside the content.'),
});

/** The optional `ai_provenance` parameter. Spread into a write tool's input shape. */
export const aiProvenanceInput = {
  ai_provenance: aiProvenanceBlock.optional().describe(
    'How this content was made. Declare it when a model generated or substantially rewrote what you '
    + 'are writing. The node fills in who you are, which node, when, and a hash of the exact bytes — '
    + 'those are never taken from the caller.'),
};

/** The optional `ai_provenance_id` parameter: attach a record the node already minted. */
export const aiProvenanceIdInput = {
  ai_provenance_id: z.string().optional().describe(
    'Attach an EXISTING provenance record instead of declaring a new one — the id the node returned '
    + 'when it generated this content for you. Only your own records can be attached.'),
};

/** Both parameters together, for a tool that accepts either form. */
export const aiProvenanceInputs = { ...aiProvenanceInput, ...aiProvenanceIdInput };

/** The declared block as it arrives over MCP, before the boundary mapping below. */
export type AiProvenanceToolInput = z.infer<typeof aiProvenanceBlock>;

/**
 * Map the wire block onto the internal shape. The only interesting line is `humanInvolvement`, which
 * is left undefined rather than defaulted here — the mint path owns that default, so there is one
 * place that decides silence means `none` rather than two that could disagree.
 */
export function toDeclaredProvenance(
  input: AiProvenanceToolInput | undefined,
): DeclaredProvenance | undefined {
  if (!input) return undefined;
  return {
    level: input.level,
    method: input.method,
    humanInvolvement: input.human_involvement,
    model: input.model,
    sources: input.sources?.map((s) => ({
      url: s.url,
      ...(s.title ? { title: s.title } : {}),
      ...(s.retrieved_at ? { retrievedAt: s.retrieved_at } : {}),
      ...(s.role ? { role: s.role } : {}),
    })),
    notes: input.notes,
  };
}
