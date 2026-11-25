/**
 * @file src/services/knowledge/manifest-write.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A knowledge package manifest written as plain memory is checked against the manifest
 *   schema, the one POST /v1/knowledge/import and aimeat_knowledge_create apply.
 *
 *   WHY. A manifest is a memory record (`packages/{id}/manifest`), so aimeat_memory_write and
 *   POST /v1/memory could store one the import would refuse: no entries, a content type outside the
 *   list, no sharing block. The knowledge list, the catalogue and the export read such a record as a
 *   package all the same, and a reader then met a package with no name or no entries. The check now
 *   runs on the shared write (services/memory/write.ts) and on the bulk, patch and copy routes, so
 *   every memory surface refuses it as the import does, naming the first schema error. The answer is
 *   memory's own for a value its schema refuses, 422 SCHEMA_VALIDATION_FAILED (a schema lock answers
 *   it too); the import answers 400 SCHEMA_VALIDATION.
 *
 *   WHICH RECORD. The key alone does not say it: a data package's catalogue manifest has the same
 *   key shape. A record is a knowledge package manifest when its value says `type: knowledge-package`
 *   or its tags hold `knowledge-package`, which is what the knowledge list asks for.
 *
 *   WHAT STAYS WRITABLE. A manifest already stored that fails the schema stays writable, as an
 *   ODPS listing source already stored keeps publishing (services/exchange/odps-write.ts): adding an
 *   entry rewrites the manifest's index line through the same write, and a package an older node or
 *   an operator import stored must not lose that. Only a write that would turn a valid or absent
 *   manifest into an invalid one is refused.
 * @structure isPackageManifestKey(key) · isKnowledgeManifestWrite(key, value, tags) ·
 *   knowledgeManifestWriteRefusal(key, value, tags, stored)
 * @usage
 *   const refused = knowledgeManifestWriteRefusal(input.key, input.value, input.tags ?? existing?.tags, existing?.value);
 *   if (refused) return refused;
 * @version-history
 *   v1.0.0 — 2026-11-25 — Initial (wish-tietopaketin-manifesti-tarkistetaan-muistin-kirjoituksessa-j).
 */
import { validateManifest } from './manifest-validator.js';

const MANIFEST_KEY = /^packages\/[^/]+\/manifest$/;
const TAG = 'knowledge-package';

export interface KnowledgeManifestWriteRefusal {
    ok: false;
    status: 422;
    code: 'SCHEMA_VALIDATION_FAILED';
    message: string;
    details: unknown;
}

/** True for a package manifest's key, `packages/{id}/manifest`, whichever kind of package it is. */
export function isPackageManifestKey(key: string): boolean {
    return MANIFEST_KEY.test(key);
}

/** True when this write stores a knowledge package manifest. */
export function isKnowledgeManifestWrite(key: string, value: unknown, tags: readonly string[] | undefined): boolean {
    if (!isPackageManifestKey(key)) return false;
    const type = value && typeof value === 'object' && !Array.isArray(value) ? (value as { type?: unknown }).type : undefined;
    return type === TAG || (tags ?? []).includes(TAG);
}

/**
 * The refusal for writing `value` as a knowledge package manifest the schema refuses, or null. Null
 * for any other key, for a valid manifest, and when the stored value already fails the schema.
 */
export function knowledgeManifestWriteRefusal(
    key: string, value: unknown, tags: readonly string[] | undefined, stored: unknown,
): KnowledgeManifestWriteRefusal | null {
    if (!isKnowledgeManifestWrite(key, value, tags)) return null;
    if (validateManifest(value)) return null;
    const errors = validateManifest.errors;
    if (stored !== undefined && stored !== null && !validateManifest(stored)) return null;
    const first = errors?.[0];
    const where = first ? `${first.instancePath || '(the manifest)'} ${first.message ?? ''}`.trim() : 'the manifest';
    return {
        ok: false, status: 422, code: 'SCHEMA_VALIDATION_FAILED',
        message: `This is a knowledge package manifest, and it does not match the manifest schema: ${where}. `
            + 'Create a package with aimeat_knowledge_create (POST /v1/knowledge/import), which builds a valid manifest, '
            + 'and add entries with aimeat_knowledge_contribute.',
        details: errors,
    };
}
