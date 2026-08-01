/**
 * @file src/mcp/ai-provenance-result.ts
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
 *   v1.0.0 — 2026-08-01 — TARGET-058 Phase 4.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import {
  loadServedProvenance, loadServedProvenanceMany, type ServedProvenance,
} from '../services/ai-provenance-marks.js';

/** The `ai_provenance` value on a tool result: the id, the document, and where it resolves. */
export interface AiProvenanceResultBlock {
  ai_provenance: {
    id: string;
    /** The `aimeat.provenance/v1` document, in its own camelCase spelling — one spelling everywhere. */
    record: ServedProvenance['record'];
    record_url: string;
  };
}

/**
 * The wire shape, or an empty object so a caller can spread it away unconditionally.
 *
 * snake_case keys around a camelCase document is not an inconsistency to apologise for: the keys are
 * a result DTO and follow the MCP surface's convention, while the document is self-describing and
 * keeps one spelling on every carrier it travels on.
 */
export function provenanceResultBlock(
  prov: ServedProvenance | undefined,
): AiProvenanceResultBlock | Record<string, never> {
  if (!prov) return {};
  return { ai_provenance: { id: prov.id, record: prov.record, record_url: prov.recordUrl } };
}

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
