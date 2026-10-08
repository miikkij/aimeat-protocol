/**
 * @file src/routes/storage-provenance-input.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The `ai_provenance` / `ai_provenance_id` fields of a storage upload body, read once for
 *   every REST door that stores a file (POST /v1/storage inline and presigned, the chunked complete,
 *   POST /v1/memory/files), and the `ai_provenance` block every upload answer carries.
 *
 *   The decision itself is services/storage-file-write.ts; this file only turns a request body into
 *   its input, with the same schema the MCP tools validate against (mcp/ai-provenance-input.ts), and
 *   refuses a block that does not validate rather than storing the file without it.
 * @structure storageProvenanceFromBody() · uploadProvenanceBlock()
 * @usage
 *   const p = storageProvenanceFromBody(req.body, resolve(req), 'storage.upload');
 *   if (!p.ok) return res.status(400).json(error(nodeId, 'INVALID_PROVENANCE', ..., { violations: p.violations }));
 * @version-history
 *   v1.0.0 — 2026-10-08 — Initial (AI provenance for stored files).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { StorageProvenanceInput } from '../services/storage-file-write.js';
import { parseDeclaredProvenanceInput } from '../mcp/ai-provenance-input.js';
import { loadServedProvenance, provenanceItemBlock } from '../services/ai-provenance-marks.js';

/** The writer's statement, read from a JSON body, or the violations of a block that does not validate. */
export function storageProvenanceFromBody(
    body: unknown, actor: string, pipeline: string, scopes?: readonly string[],
): { ok: true; provenance: StorageProvenanceInput & { wireBlock?: unknown } }
    | { ok: false; violations: Array<{ path: string; message: string }> } {
    const b = (body && typeof body === 'object' ? body : {}) as { ai_provenance?: unknown; ai_provenance_id?: unknown };
    const parsed = parseDeclaredProvenanceInput(b.ai_provenance);
    if (!parsed.ok) return { ok: false, violations: parsed.violations };
    const declaredId = typeof b.ai_provenance_id === 'string' && b.ai_provenance_id ? b.ai_provenance_id : undefined;
    return {
        ok: true,
        provenance: {
            actor, pipeline, ...(scopes ? { scopes } : {}),
            ...(declaredId ? { declaredId } : {}),
            ...(parsed.declared ? { declared: parsed.declared, wireBlock: b.ai_provenance } : {}),
        },
    };
}

/**
 * The `ai_provenance` block an upload answer carries, `{}` when the file has no record: the same
 * per-item shape the read surfaces use (`{ id, record, record_url }`), so a connector echo and a
 * reader parse one shape. The writer sees the whole record; it is its own statement.
 */
export async function uploadProvenanceBlock(
    storage: Storage, config: AimeatConfig, aiProvenanceId: string | undefined,
): Promise<ReturnType<typeof provenanceItemBlock>> {
    return provenanceItemBlock(await loadServedProvenance(storage, config, aiProvenanceId, { full: true }));
}
