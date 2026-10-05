/**
 * @file src/mcp/ai-provenance-input.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
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
 *   - AiProvenanceBlockSchema — the block itself, exported so the connector's shell surface validates
 *                               against these enums rather than a second copy of them
 *   - aiProvenanceInput      — the optional zod fragment, spread into a write tool's input shape
 *   - aiProvenanceIdInput    — the sibling `ai_provenance_id` fragment (attach an existing record)
 *   - toDeclaredProvenance() — the snake→camel mapping into services/ai-provenance.ts's input type
 *   - parseDeclaredProvenanceInput() — validate + map for a surface with no zod layer (a REST body,
 *                               a presigned token's meta)
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
 *   v1.3.0 — 2026-10-05 — AiProvenanceBlockSchema moved unchanged to src/tool-catalog/ai-provenance-schema.ts,
 *     the catalog's exact schema of the field, and is re-exported here (secaudit 2026-10, M3).
 *   v1.2.1 — 2026-09-26 — `model` asks the declarer for its OWN model id. A GPT-6 build of
 *     material-lab declared `provider: "openai"` and no model, so its record could not say which one.
 *   v1.2.0 — 2026-08-01 — TARGET-058. parseDeclaredProvenanceInput(): the same validation + mapping
 *     for the doors that have no zod of their own. The app publish surface had four of them and only
 *     ONE carried a declaration, so the recommended presigned route published every app with
 *     `aiProvenanceId: null` while advertising the parameter.
 *   v1.1.0 — 2026-08-01 — TARGET-058 Phase 11. The block schema is exported. The connector's two
 *     surfaces carried NO provenance at all and stripped a caller's block as an unknown key; they now
 *     validate against this same object rather than a second, drifting copy of the enums.
 *   v1.0.0 — 2026-08-01 — TARGET-058 Phase 4.
 */
import { z } from 'zod';
import { AiProvenanceBlockSchema } from '../tool-catalog/ai-provenance-schema.js';
import type { DeclaredProvenance } from '../services/ai-provenance.js';

// The sentence appended to every write tool's description lives in the catalog and is re-exported
// here so there is exactly one copy of it.
export { AI_PROVENANCE_TOOL_NOTE } from '../tool-catalog/definitions/ai-provenance-note.js';

// The block itself is the catalog's exact schema of the `ai_provenance` field (moved there on
// 2026-10-05, secaudit 2026-10, M3), re-exported so the connector's shell dispatch and the REST
// routes validate against the same object.
export { AiProvenanceBlockSchema };

/** The optional `ai_provenance` parameter. Spread into a write tool's input shape. */
export const aiProvenanceInput = {
  ai_provenance: AiProvenanceBlockSchema.optional().describe(
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
export type AiProvenanceToolInput = z.infer<typeof AiProvenanceBlockSchema>;

/**
 * Validate + map a declaration that arrived on a surface with NO zod layer of its own — a REST JSON
 * body, or a presigned upload token's `meta`.
 *
 * It exists so those surfaces cannot grow a second, drifting idea of what a declaration may say.
 * That is not hypothetical: the app publish doors are how this function came to be written. The MCP
 * inline branch carried a declaration and the other three did not, so `POST /v1/apps`, the
 * publish-draft route and the whole presigned path — the one the tooling recommends for anything
 * over 1 KB — accepted `ai_provenance` and threw it away, and every app on the node published with
 * no record.
 *
 * `undefined` in, `{ ok: true, declared: undefined }` out: a caller that said nothing is not an
 * error, it is the ordinary case, and the mint path already knows what silence means.
 */
export function parseDeclaredProvenanceInput(
  raw: unknown,
): { ok: true; declared: DeclaredProvenance | undefined }
  | { ok: false; violations: { path: string; message: string }[] } {
  if (raw === undefined || raw === null) return { ok: true, declared: undefined };
  const parsed = AiProvenanceBlockSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      violations: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    };
  }
  return { ok: true, declared: toDeclaredProvenance(parsed.data) };
}

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
    provider: input.provider,
    sources: input.sources?.map((s) => ({
      url: s.url,
      ...(s.title ? { title: s.title } : {}),
      ...(s.retrieved_at ? { retrievedAt: s.retrieved_at } : {}),
      ...(s.role ? { role: s.role } : {}),
    })),
    notes: input.notes,
  };
}
