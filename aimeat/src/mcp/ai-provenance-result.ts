/**
 * @file src/mcp/ai-provenance-result.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The `ai_provenance` block on an MCP tool RESULT — defined once, so every read tool
 *   that carries it carries the same shape (TARGET-058 Phase 4).
 *
 *   WHY READS CARRY IT AT ALL. An agent asked to summarise three records for a person has to be able
 *   to say, correctly, that two of them were model-written. It cannot do that from content alone,
 *   and there is no second request it could make that would be reliable — a record the agent already
 *   read is a record whose origin it should already hold. This is the read half of "nothing is lost
 *   at the MCP hop"; the write half is ./ai-provenance-input.ts.
 *
 *   AUTHORIZATION IS THE CALLER'S READ, NOT A SECOND TEST. These helpers are called by a tool that
 *   has ALREADY decided the caller may read the item. Provenance travels with the content it
 *   describes: whoever may read a members-only record may know how it was made. The strict
 *   derived-visibility rule belongs to `/v1/provenance/:id`, where a bare id arrives with no content
 *   to justify it.
 *
 *   ABSENCE MEANS UNSTATED. A result with no `ai_provenance` key says nothing about origin — it is
 *   never a claim that a person wrote the content. That default is stated in the `ai-transparency`
 *   skill and in the agent directive rather than repeated on every tool description.
 * @structure
 *   - provenanceResultBlock(prov)              — the wire shape, or {} to spread away
 *   - writeProvenanceEcho(storage, config, id) — what a WRITE tool returns about what it recorded
 *   - readProvenance(storage, config, id)      — one item's block, for a single-record read tool
 *   - readProvenanceMany(storage, config, ids) — the batch form, so a list read costs one query
 * @usage
 *   return jsonContent({ ...payload, ...(await readProvenance(storage, config, rec.aiProvenanceId)) });
 * @version-history
 *   v1.1.0 — 2026-08-01 — TARGET-058 Phase 9 step 0. The block's SHAPE moved to
 *     services/ai-provenance-marks.ts as provenanceItemBlock(), because Phase 9 gave the REST board
 *     and agent-message reads the same per-item block and a second declaration of it is how the two
 *     surfaces drift. The three loader helpers below stay here — they are the MCP calling convention.
 *   v1.0.0 — 2026-08-01 — TARGET-058 Phase 4.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import {
  loadServedProvenance, loadServedProvenanceMany, provenanceItemBlock,
  type AiProvenanceItemBlock,
} from '../services/ai-provenance-marks.js';

/** The `ai_provenance` value on a tool result: the id, the document, and where it resolves. */
export type AiProvenanceResultBlock = AiProvenanceItemBlock;

/**
 * The wire shape, or an empty object so a caller can spread it away unconditionally.
 *
 * ONE SHAPE, DEFINED ONCE. An MCP tool result and a REST list item carry the identical block, so it
 * lives in services/ai-provenance-marks.ts beside every other "what does this look like on a wire"
 * decision and this is the MCP-facing name for it. Two near-identical spellings of a compliance
 * artefact is exactly how the two surfaces end up disagreeing about a field name.
 */
export const provenanceResultBlock = provenanceItemBlock;

/**
 * What a WRITE tool returns about the record it just attached.
 *
 * Returned rather than left silent because the most consequential case is the one where the agent
 * declared nothing: it should be able to see that the node recorded its write as model-written, at
 * the moment of writing, instead of finding out when a person reads the label.
 */
export async function writeProvenanceEcho(
  storage: Storage, config: AimeatConfig, provenanceId: string | undefined,
): Promise<AiProvenanceResultBlock | Record<string, never>> {
  // `full: true` — this is the writer's own record, being handed back to the writer.
  return provenanceResultBlock(await loadServedProvenance(storage, config, provenanceId, { full: true }));
}

/** One item's block, for a tool that returns a single record. */
export async function readProvenance(
  storage: Storage, config: AimeatConfig, provenanceId: string | null | undefined,
): Promise<AiProvenanceResultBlock | Record<string, never>> {
  return provenanceResultBlock(await loadServedProvenance(storage, config, provenanceId));
}

/**
 * The batch form for a list-returning tool: ids in, a lookup map out, ONE query.
 *
 * The singular form in a loop is an N+1 that grows with the content rather than with the traffic,
 * which is precisely the shape a read tool over a busy workspace produces.
 */
export async function readProvenanceMany(
  storage: Storage, config: AimeatConfig, provenanceIds: readonly (string | null | undefined)[],
): Promise<(id: string | null | undefined) => AiProvenanceResultBlock | Record<string, never>> {
  const byId = await loadServedProvenanceMany(storage, config, provenanceIds);
  return (id) => provenanceResultBlock(id ? byId.get(id) : undefined);
}
