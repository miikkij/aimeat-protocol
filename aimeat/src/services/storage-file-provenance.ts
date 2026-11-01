/**
 * @file src/services/storage-file-provenance.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The AI-provenance decision for one stored file: which record the file carries, decided
 *   with its writer before any byte is stored. Moved by pure extraction out of
 *   services/storage-file-write.ts (800-line limit), which re-exports every exported name here, so its
 *   importers are unchanged.
 * @structure StorageProvenanceInput · ProvenanceRefusalCode · ProvenanceRefusal · provenanceForStoredBytes ·
 *   storageProvenanceMintRefusal
 * @usage
 *   const decided = await provenanceForStoredBytes(deps, input.provenance, data, visibility, held);
 * @version-history
 *   v1.0.0 — 2026-11-01 — Pure extraction from storage-file-write.ts v1.11.0 (secaudit2026oct31w2 round 11
 *     needed the room for the page-key fence).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, StorageFileRecord, AiProvenanceRecordRow } from '../storage/interface.js';
import {
    provenanceForWrite, provenanceDeclarationRefusal, contentHashOf,
    ProvenanceScopeError, type DeclaredProvenance,
} from './ai-provenance.js';
import { ownerGhiiOf } from '../utils/gaii.js';

type Deps = { storage: Storage; config: AimeatConfig };

/** The writer and its statement, for StorageFileInput.provenance (storage-file-write.ts). */
export interface StorageProvenanceInput {
    /** The resolved identity that wrote the bytes: GHII, GAII or GEAI. Never a client-sent value. */
    actor: string;
    /** The session's own words, when the door has them: a declaration needs the word there too. */
    scopes?: readonly string[];
    /** An existing record to attach. */
    declaredId?: string;
    /** A statement about how the bytes were made. */
    declared?: DeclaredProvenance;
    /** The route or tool that wrote, for the record's generator.pipeline. */
    pipeline?: string;
}

/** The refusals the provenance step of a write can produce, each before any byte is stored. */
export type ProvenanceRefusalCode = 'SCOPE_DENIED' | 'NOT_FOUND' | 'PROVENANCE_HASH_MISMATCH';

export type ProvenanceRefusal = { ok: false; status: number; code: ProvenanceRefusalCode; message: string };

/**
 * The record an attached id names, when it may be attached by this writer: one answer for "no such
 * record" and "somebody else's record", so the refusal tells nobody which ids exist on this node.
 * Attaching is what makes a record public when the file is public, so the ownership test is the
 * whole gate (resolveAttachableProvenanceId says the same for memory).
 */
async function attachableRecord(
    storage: Storage, actor: string, id: string,
): Promise<AiProvenanceRecordRow | ProvenanceRefusal> {
    const row = await storage.getAiProvenance(id);
    if (row && row.ownerGhii === ownerGhiiOf(actor)) return row;
    return {
        ok: false, status: 404, code: 'NOT_FOUND',
        message: `No AI-provenance record of yours has the id "${id}". Attach the id the node returned `
            + 'when it made this content for you, or describe how it was made in ai_provenance instead.',
    };
}

/**
 * The provenance decision for one stored file (provenanceForWrite, with the two checks that only a
 * door holding the bytes can make). Returns the id to store on the file, or the refusal.
 *
 * THE HASH CHECK (B12). A record that names a content hash is a statement about exact bytes, and a
 * file that carries it says "this record is about me". When the two differ the attach is refused:
 * the by-hash lookup would never find the file, and the public label would describe other bytes.
 */
export async function provenanceForStoredBytes(
    deps: Deps, p: StorageProvenanceInput, data: Buffer | undefined,
    visibility: StorageFileRecord['visibility'], held: AiProvenanceRecordRow[],
): Promise<{ ok: true; id: string | undefined } | ProvenanceRefusal> {
    const { storage, config } = deps;
    if (config.aiProvenance === false) return { ok: true, id: undefined };
    if (p.declaredId) {
        const row = await attachableRecord(storage, p.actor, p.declaredId);
        if ('ok' in row) return row;
        // A file that went straight to its store never passed through the node, so a record about exact
        // bytes cannot be checked against it, and is not attached unchecked.
        if (!data) {
            if (!row.contentHash) return { ok: true, id: row.id };
            return {
                ok: false, status: 400, code: 'PROVENANCE_HASH_MISMATCH',
                message: `Record ${row.id} is about exact bytes, and this file went straight to its store, so the node `
                    + 'cannot compare them. Describe the file in ai_provenance instead, or upload it through the node.',
            };
        }
        const bytesHash = contentHashOf(data);
        if (row.contentHash && row.contentHash !== bytesHash) {
            return {
                ok: false, status: 400, code: 'PROVENANCE_HASH_MISMATCH',
                message: `Record ${row.id} is about other bytes: it names ${row.contentHash}, and this file `
                    + `is ${bytesHash}. Upload the exact bytes the record was made for, or describe this `
                    + 'file in ai_provenance instead.',
            };
        }
        return { ok: true, id: row.id };
    }
    try {
        const id = await provenanceForWrite(storage, {
            principal: p.actor, ...(p.scopes ? { scopes: p.scopes } : {}),
            content: data, declared: p.declared, pipeline: p.pipeline ?? 'storage.upload',
            surface: { visibility, humanAudience: true },
            labelPolicy: config.aiLabelPublic, nodeId: config.nodeId, baseUrl: config.baseUrl,
            enabled: config.aiProvenance, held,
        });
        return { ok: true, id };
    } catch (err) {
        if (err instanceof ProvenanceScopeError) return { ok: false, status: 403, code: 'SCOPE_DENIED', message: err.message };
        throw err;
    }
}

/**
 * The refusal a presigned mint can give before any byte arrives: an attached id that is not the
 * caller's own, or a declaration without provenance:write. The hash is checked when the bytes land.
 */
export async function storageProvenanceMintRefusal(
    deps: Deps, p: StorageProvenanceInput,
): Promise<ProvenanceRefusal | null> {
    if (deps.config.aiProvenance === false) return null;
    if (p.declaredId) {
        const row = await attachableRecord(deps.storage, p.actor, p.declaredId);
        return 'ok' in row ? row : null;
    }
    const refused = await provenanceDeclarationRefusal(deps.storage, {
        principal: p.actor, declared: p.declared, ...(p.scopes ? { scopes: p.scopes } : {}),
    });
    return refused ? { ok: false, status: 403, code: 'SCOPE_DENIED', message: refused.message } : null;
}
