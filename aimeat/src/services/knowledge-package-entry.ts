/**
 * @file src/services/knowledge-package-entry.ts
 * @description Adding one entry to a knowledge package, once, for every surface that can add one.
 *
 *   WHY THIS FILE EXISTS. `aimeat_knowledge_contribute` did the work itself: it normalised the entry
 *   key, decided whether the content was JSON or a string, folded the `model:` tag, chose the
 *   visibility to inherit, and appended the manifest's index line. Under the rule in CLAUDE.md a
 *   tool declares its own name and parameters because the protocol requires that, and then calls the
 *   same service a route would. This file is that service.
 *
 *   WHAT THE AUDIT FOUND HERE. There is no REST twin, and the name is already taken: `POST
 *   /v1/knowledge/:id/contribute` is a DIFFERENT capability (share a whole package with an organism,
 *   `organism_id` required). So adding an entry to an existing package was reachable over MCP only,
 *   and the connector's proxy tool of the same name posts to that organism route with `entry_key` and
 *   `content` in the body, which that route answers 400 MISSING_FIELDS. Putting the work here is what
 *   lets a second door be a door rather than a third implementation.
 *
 *   THE MANIFEST IS A MEMORY RECORD TOO. The entry already went through services/memory-write.ts; the
 *   manifest did not. It was `storage.setMemory` straight from the tool, so the index line an agent
 *   appends carried no schema lock, no archive guard, no value-size or key ceiling, no byte budget,
 *   and nothing announced it. The knowledge views read the MANIFEST, so the one write the screen
 *   depends on was the one write with no event behind it.
 *
 *   One consequence to know about: the manifest now takes a provenance stamp naming the principal
 *   that appended the line, and the id it carried before is not inherited. That is the rule stated on
 *   `MemoryRecord.aiProvenanceId` — a new value is new content, and carrying the old id forward would
 *   make the record assert something about bytes that no longer exist. The previous behaviour left
 *   the import-time record attached to a manifest it no longer described.
 * @structure
 *   - KnowledgeEntryRef / KnowledgeManifestValue — the stored manifest shape, read by several surfaces
 *   - KnowledgePackageEntryInput / KnowledgePackageEntryResult — the contract
 *   - addKnowledgePackageEntry() — reserved-package guard, manifest lookup, entry write, index line
 * @usage
 *   const out = await addKnowledgePackageEntry({ storage, config }, caller, input);
 *   if (!out.ok) return renderRefusal(out);   // each door renders its own way
 * @version-history
 *   v1.0.0 — 2026-08-11 — Initial (August 2026 audit step 8, unit: knowledge). The entry build, the
 *     reserved-package guard and the manifest index line move out of src/mcp/knowledge.ts, and the
 *     manifest write joins the entry write inside services/memory-write.ts.
 */
import type { MemoryRecord } from '../storage/interface.js';
import { emitChange } from './event-bus.js';
import { writeMemoryRecord, type MemoryWriteCaller, type MemoryWriteFanout } from './memory-write.js';
import type { DeclaredProvenance } from './ai-provenance.js';
import { PITFALL_PACKAGE_ID } from './appdev-kb.js';

/** An entry reference stored in a knowledge-package manifest's `entries` list. */
export interface KnowledgeEntryRef {
    key: string;
    title?: string;
    visibility?: string;
}

/** Shape of a stored knowledge-package manifest value (memory record `value`). */
export interface KnowledgeManifestValue {
    name?: string;
    content_type?: string;
    tags?: string[];
    sharing?: { catalog_listed?: boolean };
    entries?: KnowledgeEntryRef[];
    created?: string;
    updated?: string;
}

export interface KnowledgePackageEntryInput {
    packageId: string;
    /** Short name ("summary") or the full path; normalised to the full path here. */
    entryKey: string;
    /** The entry as a string. Stored as JSON when it parses as JSON, as the string when it does not. */
    content: string;
    /**
     * The LLM this knowledge came from, kept as a `model:` tag. It has meant that on the contribute
     * surface since long before provenance existed, so a caller that names it has said something
     * real, and it doubles as a fallback declaration when no explicit one arrives.
     */
    model?: string;
    declaredProvenance?: DeclaredProvenance;
    declaredProvenanceId?: string;
    /** Which road this came down, for the provenance record: 'mcp.knowledge_contribute', … */
    pipeline: string;
}

export type KnowledgePackageEntryResult =
    | {
        ok: true;
        /** The full path the entry landed on. */
        entryKey: string;
        record: MemoryRecord;
        /** True when the manifest gained an index line for this entry on this call. */
        manifestUpdated: boolean;
        /**
         * Set when the entry stored but its index line did not, because the manifest write was
         * refused (an archived package, a schema lock, a quota). The entry exists either way, so
         * this travels as a warning rather than turning a completed write into a refusal.
         */
        manifestWarning?: string;
    }
    | { ok: false; status: number; code: string; message: string };

/**
 * Add one entry to a knowledge package: store the record, then make sure the manifest indexes it.
 *
 * The order is the one the capability has always used, and it matters. The reserved-package guard
 * and the manifest lookup answer before anything is written, so a caller aimed at the wrong package
 * changes nothing. The entry is written before the index line, so a refused write never leaves the
 * manifest pointing at a record that does not exist.
 */
export async function addKnowledgePackageEntry(
    deps: MemoryWriteFanout,
    caller: MemoryWriteCaller,
    input: KnowledgePackageEntryInput,
): Promise<KnowledgePackageEntryResult> {
    const { storage } = deps;

    // The appdev-pitfalls package is schema-reserved — its entries need model/category/severity
    // structure, so raw contributions are redirected to the dedicated tool.
    if (input.packageId === PITFALL_PACKAGE_ID) {
        return {
            ok: false, status: 400, code: 'RESERVED_PACKAGE',
            message: 'The appdev-pitfalls package is reserved — report pitfalls with aimeat_appdev_pitfall_report (model attribution is required there).',
        };
    }

    const manifestKey = `packages/${input.packageId}/manifest`;
    const manifest = await storage.getMemory(caller.targetGaii, manifestKey);
    if (!manifest) {
        return {
            ok: false, status: 404, code: 'NOT_FOUND',
            message: `Package not found: ${input.packageId}`,
        };
    }

    const fullEntryKey = input.entryKey.startsWith(`packages/${input.packageId}/`)
        ? input.entryKey
        : `packages/${input.packageId}/${input.entryKey}`;

    // JSON when it parses as JSON, the plain string when it does not. Callers send both.
    let value: unknown = input.content;
    // eslint-disable-next-line aimeat/no-silent-catch -- store as string
    try { value = JSON.parse(input.content); } catch { /* store as string */ }

    // An entry that already exists keeps its tags and its visibility: contributing new text to an
    // entry someone published is an edit, not a re-classification.
    const existing = await storage.getMemory(caller.targetGaii, fullEntryKey);
    const normModel = input.model?.trim().toLowerCase();
    const baseTags = existing?.tags ?? ['knowledge-entry'];
    const tags = normModel
        ? [...baseTags.filter(t => !t.startsWith('model:')), `model:${normModel}`]
        : baseTags;
    const visibility = existing?.visibility ?? 'owner';

    const written = await writeMemoryRecord(deps, caller, {
        key: fullEntryKey,
        value,
        visibility,
        tags,
        declaredProvenanceId: input.declaredProvenanceId,
        declaredProvenance: input.declaredProvenance
            ?? (input.model?.trim() ? { level: 'ai-generated', model: input.model.trim() } : undefined),
        pipeline: input.pipeline,
        ownerScoped: true,
    });
    if (!written.ok) return written;

    // The manifest's entries list is what the knowledge views and the export, clone and visibility
    // routes read. An entry with no index line is an entry nobody finds.
    const manifestValue = (manifest.value ?? {}) as KnowledgeManifestValue;
    const manifestEntries: KnowledgeEntryRef[] = manifestValue.entries ?? [];
    const alreadyIndexed = manifestEntries.some(
        e => e.key === fullEntryKey || e.key === input.entryKey,
    );
    if (!alreadyIndexed) {
        manifestEntries.push({ key: fullEntryKey, title: input.entryKey, visibility: 'owner' });
        manifestValue.entries = manifestEntries;
        manifestValue.updated = new Date().toISOString();

        const indexed = await writeMemoryRecord(deps, caller, {
            key: manifestKey,
            value: manifestValue,
            visibility: manifest.visibility,
            tags: manifest.tags,
            ttlHours: manifest.ttlHours,
            ...(manifest.groupId ? { groupId: manifest.groupId } : {}),
            ...(manifest.workspaceRef ? { workspaceRef: manifest.workspaceRef } : {}),
            pipeline: input.pipeline,
            ownerScoped: true,
        });
        if (!indexed.ok) {
            return {
                ok: true,
                entryKey: fullEntryKey,
                record: written.record,
                manifestUpdated: false,
                manifestWarning: `${indexed.code}: ${indexed.message}`,
            };
        }
        // The knowledge routes emit this when a package changes. The entry's own write emits
        // 'memory' through memory-write; the manifest needs its own signal, and it fires AFTER the
        // write rather than before it, so a listener that re-reads immediately sees the index line.
        emitChange('knowledge');
    }

    return {
        ok: true,
        entryKey: fullEntryKey,
        record: written.record,
        manifestUpdated: !alreadyIndexed,
    };
}
