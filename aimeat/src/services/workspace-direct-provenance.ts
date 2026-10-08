/**
 * @file src/services/workspace-direct-provenance.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The provenance of each DIRECT value the batch publish writes (publishRecordsBatchOp in
 *   services/workspace-tool-ops.ts): POST /v1/organisms/:id/workspace/records/publish with `records`,
 *   and ctx.workspace.publishRecords in the extension sandbox.
 *
 *   Until 2026-10-08 only the sandbox got a record (the node's own stamp, a script produced the
 *   bytes). The REST route wrote what an agent sent and recorded nothing, so a hundred records an
 *   agent published in one call read as a person's work, and a caller could not say how a record was
 *   made. Now the route takes each record's own `ai_provenance` or `ai_provenance_id`, and a record
 *   that says nothing gets provenanceForWrite's answer for the writer: the node's stamp for an agent,
 *   nothing for a person (aiprov E3).
 *
 *   A DOCUMENT space's record describes the markdown (documentContentBytes), the text a reader of
 *   the document is served, so the record can be found by the hash of what was read (aiprov E13).
 * @structure DirectValueDeclaration · DeclarationParser · directValueProvenance(deps, caller, args) → { declarationOf, stamp }
 * @usage
 *   const prov = directValueProvenance({ storage, config }, caller, { organismId, ws, namespace, nodeStamp });
 *   const own = prov.declarationOf(record, i);
 *   const stamped = await prov.stamp(record.value, visibility, own, held);
 * @version-history
 *   v1.0.0 — 2026-10-08 — Moved out of publishRecordsBatchOp with the sandbox stamp it held, and
 *     extended to the REST route's records (aiprov E3, E13).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, MemoryRecord, AiProvenanceRecordRow } from '../storage/interface.js';
import type { AiProvenanceLevel, AiProvenanceMethod } from '../models/ai-provenance-schemas.js';
import { provenanceForWrite, provenanceDeclarationRefusal, stampAutonomousOutput, type DeclaredProvenance } from './ai-provenance.js';
import { documentContentBytes, memoryContentBytes } from '../utils/memory-content.js';
import { readPublishSpace } from './workspace-write-items.js';

/** What one record said about how it was made. */
export interface DirectValueDeclaration { declared?: DeclaredProvenance; declaredId?: string }

/**
 * Validate and map a record's raw `ai_provenance` block. The door hands in
 * mcp/ai-provenance-input.ts parseDeclaredProvenanceInput, the one parser every REST declaration
 * goes through; a service may not import the MCP layer (check:deps), so it arrives as an argument.
 */
export type DeclarationParser = (raw: unknown) =>
  { ok: true; declared: DeclaredProvenance | undefined } | { ok: false; violations: { path: string; message: string }[] };

export function directValueProvenance(
  deps: { storage: Storage; config: AimeatConfig },
  caller: { principal: string; scopes?: readonly string[] },
  args: {
    organismId: string; ws?: string; namespace: string;
    /** The node's own statement, for bytes a script produced (the extension sandbox). */
    nodeStamp?: { pipeline: string; level?: AiProvenanceLevel; method?: AiProvenanceMethod };
    /** The door's declaration parser. Without one a record's block is not read (the sandbox). */
    parseDeclaration?: DeclarationParser;
  },
) {
  const { storage, config } = deps;
  // Whether the space holds documents, read once per batch and only when a record is stamped.
  let docSpace: Promise<boolean> | undefined;
  const isDocSpace = () => docSpace ??= readPublishSpace(storage, args.organismId, args.ws, args.namespace, { nodeId: config.nodeId })
    .then(({ ot }) => ot?.mode === 'document' || (!ot?.mode && ot?.kind === 'document'));

  return {
    /** A record's own declaration. A malformed block fails that record alone, named by its index. */
    declarationOf(record: { ai_provenance?: unknown; ai_provenance_id?: unknown }, index: number):
      { ok: true; own: DirectValueDeclaration } | { ok: false; violations: { path: string; message: string }[] } {
      // The sandbox's bytes come from a script, and the node states that itself: nothing a record
      // says is taken there (services/extension-workspace.ts).
      if (args.nodeStamp || !args.parseDeclaration) return { ok: true, own: {} };
      const parsed = args.parseDeclaration(record.ai_provenance);
      if (!parsed.ok) {
        return { ok: false, violations: parsed.violations.map(v => ({ ...v, path: `/records/${index}/ai_provenance${v.path ? `/${v.path}` : ''}` })) };
      }
      return {
        ok: true,
        own: {
          ...(parsed.declared ? { declared: parsed.declared } : {}),
          ...(typeof record.ai_provenance_id === 'string' && record.ai_provenance_id ? { declaredId: record.ai_provenance_id } : {}),
        },
      };
    },

    /**
     * The record for one value, HELD in `held` until the batch has written it. A declaration the
     * caller may not make answers `refused` before anything is built: the batch writes after the
     * loop, so a refusal here leaves nothing behind.
     */
    async stamp(
      value: unknown, visibility: MemoryRecord['visibility'] | undefined, own: DirectValueDeclaration, held: AiProvenanceRecordRow[],
    ): Promise<{ ok: true; id?: string } | { ok: false; message: string }> {
      const content = (await isDocSpace()) ? documentContentBytes(value) : memoryContentBytes(value);
      const surface = { visibility: visibility ?? 'owner', humanAudience: true } as const;
      const common = { surface, labelPolicy: config.aiLabelPublic, nodeId: config.nodeId, baseUrl: config.baseUrl, enabled: config.aiProvenance, held };
      if (args.nodeStamp) {
        return { ok: true, id: await stampAutonomousOutput(storage, {
          principal: caller.principal, content,
          level: args.nodeStamp.level, method: args.nodeStamp.method, pipeline: args.nodeStamp.pipeline, ...common,
        }) };
      }
      const refusal = await provenanceDeclarationRefusal(storage, {
        principal: caller.principal, declaredId: own.declaredId, declared: own.declared, enabled: config.aiProvenance, scopes: caller.scopes,
      });
      if (refusal) return { ok: false, message: refusal.message };
      return { ok: true, id: await provenanceForWrite(storage, {
        principal: caller.principal, scopes: caller.scopes, content,
        declaredId: own.declaredId, declared: own.declared, pipeline: 'workspace.records_publish', ...common,
      }) };
    },
  };
}
