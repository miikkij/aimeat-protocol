/**
 * @file src/services/workspace-doc-edit.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Editing a workspace DOCUMENT in place: adding markdown to the end or under a named
 *   section, and replacing one section, without sending the rest of the document back.
 *
 *   WHY IT EXISTS. `aimeat_workspace_write` takes `{ title, markdown }` and replaces the whole
 *   document. So a session amending a 57,723-character design spec had two choices: retype all of it
 *   through a hand-authored tool parameter, whose failure mode is silent corruption, or record its
 *   finding in a separate document. Two sessions chose the second, correctly — and that is exactly
 *   how a decision record rots, because the questions drift away from the document they belong to.
 *
 *   CONCURRENCY IS WHERE THIS EITHER WORKS OR DESTROYS QUIETLY. Read, compute, then compare-and-swap;
 *   a losing writer re-reads and recomputes on top of what the winner stored. Two sessions appending
 *   to one spec both survive. DO NOT simplify the loop into a read followed by a write: the read and
 *   the write are two round trips, everything that matters happens between them, and the damage a
 *   blind write does is invisible — the losing text is simply not there, and nobody knows to look.
 *
 *   IT IS NOT A NEW BACKING. A document is a memory record at
 *   `organism.{org}.w.{ws}.{namespace}.{id}.draft` and stays one. This is a write operation on that
 *   record, going through the same guards, the same ceilings and the same fan-out as every other
 *   workspace write, which is why the whole file is gates plus a string edit.
 *
 *   THE EDIT TARGETS THE DRAFT, and seeds it from `.latest` when a published document has none —
 *   which is what "add this to the document" means for a document that is currently published. The
 *   live `.latest` stays live until somebody publishes, exactly as after `aimeat_workspace_write`.
 * @structure
 *   - WorkspaceDocError — one refusal type, one status code per failure, for every door
 *   - appendToDocument() — markdown at the end, or at the end of one named section
 *   - replaceDocumentSection() — one heading and its body, everything else byte-identical
 *   - editDocument() — the gates and the compare-and-swap retry both operations share
 * @usage
 *   const res = await appendToDocument({ storage, config }, caller,
 *     { organismId, wsId, space: 'notes', id: 'doc-x', markdown: '## Found\n\n…' });
 * @version-history
 *   v1.0.0 — 2026-09-02 — Initial (wish-workspace-append-ja-osiomuokkaus).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { checkOrganismNamespaceAccess } from './organism-namespace-access.js';
import { readWorkspaceManifest } from './workspace-meta.js';
import { resolveSpace, type WriteObjectType } from './workspace-write-items.js';
import { archivedRefusal } from './workspace-write-guards.js';
import { memoryCeilings } from './memory-ceilings.js';
import { validateMemoryWrite } from './schema-validator.js';
import { findWorkspaceRecord, writeWorkspaceRecord } from './workspace-write.js';
import { provenanceForWrite } from './ai-provenance.js';
import { memoryContentBytes } from '../routes/memory/shared.js';
import { emitChange } from './event-bus.js';
import { insertAt, isHeadingLine, locateSection, replaceRange } from './workspace-doc-markdown.js';

/**
 * How many times a losing writer re-reads and recomputes before answering 409.
 *
 * Six, the same number PATCH /v1/memory chose and for the same reason: with six writers contending,
 * each one only has to lose to the others once. A caller that genuinely exceeds this is not
 * contending, it is hammering, and a conflict that says so is more useful than a loop that hides it.
 */
const MAX_ATTEMPTS = 6;

/** A refusal, with the status code every door should answer with. */
export class WorkspaceDocError extends Error {
    constructor(
        public readonly code: string,
        public readonly statusCode: number,
        message: string,
        public readonly details?: Record<string, unknown>,
    ) {
        super(message);
        this.name = 'WorkspaceDocError';
    }
}

export interface DocEditDeps {
    storage: Storage;
    config: AimeatConfig;
}

/**
 * The session asking.
 *
 * `principal` is the raw session subject, because that is exactly what the memory door hands the
 * shared access rule — a gate fed a different value than the gate it is supposed to match is a gate
 * that has quietly diverged. `owner` is the bare account name, which is what the record's namespace
 * is built from: one owner per key, and workspace content belongs to the member's GHII.
 */
export interface DocEditCaller {
    principal: string;
    owner: string;
    roles: string[];
}

export interface DocEditResult {
    key: string;
    space: string;
    namespace: string;
    id: string;
    /** The document's version after this edit. */
    version: number;
    /** Size of the whole stored value, so a caller can watch a long document approach the ceiling. */
    bytes: number;
    /** The document had no draft and this edit started one from the published `.latest`. */
    seededFromPublished: boolean;
    /** The heading this edit landed under or replaced, when it named one. */
    section?: string;
    /** How many compare-and-swap attempts it took. More than one means somebody else was writing. */
    attempts: number;
}

/** What the calling surface asked for, minus the operation itself. */
interface EditTarget {
    organismId: string;
    wsId: string;
    space: string;
    id: string;
    /** Which door this came down, for the provenance record. */
    pipeline: string;
}

/**
 * Add markdown to the end of a document, or to the end of one named section.
 *
 * The insert never removes an existing character — see services/workspace-doc-markdown.ts — so an
 * append cannot damage text it did not write, whichever half of the document it lands in.
 */
export async function appendToDocument(
    deps: DocEditDeps, caller: DocEditCaller,
    input: EditTarget & { markdown: string; section?: string },
): Promise<DocEditResult> {
    const block = requireMarkdown(input.markdown);
    const section = input.section?.trim();
    return editDocument(deps, caller, input, (current) => {
        if (!section) return { markdown: insertAt(current, current.length, block) };
        const found = locateSection(current, section);
        if ('error' in found) throw new WorkspaceDocError(found.error, 404, found.message, { ...found });
        return { markdown: insertAt(current, found.section.end, block), section: found.section.heading };
    });
}

/**
 * Replace one heading and its body, leaving every other byte of the document exactly as it was.
 *
 * THE REPLACEMENT CARRIES ITS OWN HEADING, and a block that does not start with one is refused
 * rather than guessed at. The alternative — keeping the old heading when the caller omits it — makes
 * the same call mean two different things depending on what the caller typed, and the failure is
 * silent: a section loses its title and the document quietly grows a headless paragraph. Carrying
 * the heading also makes renaming a section free, which is otherwise a whole-document rewrite.
 */
export async function replaceDocumentSection(
    deps: DocEditDeps, caller: DocEditCaller,
    input: EditTarget & { markdown: string; section: string },
): Promise<DocEditResult> {
    const block = requireMarkdown(input.markdown);
    const section = input.section?.trim();
    if (!section) {
        throw new WorkspaceDocError('INVALID_INPUT', 400, 'Name the section to replace with `section` — its heading text, exactly as the document spells it.');
    }
    if (!isHeadingLine(block)) {
        throw new WorkspaceDocError('INVALID_INPUT', 400,
            'The replacement must begin with the section\'s heading line (for example "## Concurrency"), because it replaces the heading as well as the body. Put the heading back at the top of `markdown` — changing it there is how a section gets renamed.');
    }
    return editDocument(deps, caller, input, (current) => {
        const found = locateSection(current, section);
        if ('error' in found) throw new WorkspaceDocError(found.error, 404, found.message, { ...found });
        return {
            markdown: replaceRange(current, found.section.start, found.section.end, block),
            section: found.section.heading,
        };
    });
}

/** The markdown a caller sent, or a refusal. Empty is a mistake, never a no-op that reports success. */
function requireMarkdown(markdown: unknown): string {
    if (typeof markdown !== 'string' || markdown.trim() === '') {
        throw new WorkspaceDocError('INVALID_INPUT', 400, 'Pass `markdown` — the text to add. An empty string would write nothing and report success.');
    }
    return markdown;
}

/**
 * The gates, the read, the compute and the compare-and-swap that both operations share.
 *
 * THE ORDER IS THE DESIGN, and it is "refuse before you write":
 *   1. the space exists in the manifest, is memory-backed, and holds documents
 *   2. the caller may write this organism namespace at all — the SAME rule the memory door runs,
 *      reached with the record's own key
 *   3. the workspace is not archived
 *   4. the document exists, its value is a document, and the record is not archived
 *   5. the edit is computed, and a section that is missing or ambiguous refuses here
 *   6. the schema accepts the result, and it fits inside the memory ceilings
 *   7. only then the swap — and if somebody else got there first, back to 4 with their text
 */
async function editDocument(
    deps: DocEditDeps, caller: DocEditCaller, target: EditTarget,
    apply: (current: string) => { markdown: string; section?: string },
): Promise<DocEditResult> {
    const { storage, config } = deps;
    const root = `organism.${target.organismId}.w.${target.wsId}`;

    // 1. The space.
    const manifest = await readWorkspaceManifest(storage, target.organismId, target.wsId);
    if (!manifest) {
        throw new WorkspaceDocError('WS_NOT_FOUND', 404,
            `No manifest for workspace ${target.wsId} — an empty workspace, the wrong id, or no access to it.`);
    }
    const space = resolveSpace(target.space, (manifest.objectTypes ?? []) as WriteObjectType[]);
    if ('error' in space) throw new WorkspaceDocError('NO_SPACE', 404, space.error);
    if (!space.isDoc) {
        throw new WorkspaceDocError('NOT_A_DOCUMENT_SPACE', 400,
            `Space "${space.name}" holds records, not documents, and a record has no markdown to append to. Write the whole record with aimeat_workspace_write.`);
    }

    const base = `${root}.${space.namespace}.${target.id}`;
    const draftKey = `${base}.draft`;
    const latestKey = `${base}.latest`;

    // 2. May this caller write here? The one rule the HTTP memory door answers to, asked with the
    //    key that is actually about to be written rather than with a stand-in.
    const refusal = await checkOrganismNamespaceAccess(deps,
        { principal: caller.principal, owner: caller.owner, roles: caller.roles }, draftKey, 'write');
    if (refusal) throw new WorkspaceDocError(refusal.code, refusal.status, refusal.message);

    // 3. Archived is read-only, and it means it on every surface.
    const wsArchived = await archivedRefusal(storage, `${root}.`);
    if (wsArchived) throw new WorkspaceDocError('ARCHIVED', 409, wsArchived);

    const ownerGhii = `${caller.owner}@${config.nodeId}`;
    let lastVersion = 0;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        // 4. Re-read on EVERY attempt. This is the whole point of the loop: a writer that lost the
        //    swap must apply its edit to what the winner actually stored, not to the stale copy it
        //    started from.
        const draft = await findWorkspaceRecord(storage, draftKey);
        const published = draft ? null : await findWorkspaceRecord(storage, latestKey);
        const source = draft ?? published;
        if (!source) {
            throw new WorkspaceDocError('NOT_FOUND', 404,
                `No document "${target.id}" in space "${space.name}". Read the workspace index (aimeat_workspace_read) for the ids it holds, or create it with aimeat_workspace_write.`);
        }
        if (source.archived) {
            throw new WorkspaceDocError('ARCHIVED', 409, 'This document is archived (read-only). Unarchive it before writing.');
        }

        const value = source.value;
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            throw new WorkspaceDocError('NOT_A_DOCUMENT', 422,
                `"${target.id}" is not stored as a document object, so it has no markdown to edit. Rewrite it with aimeat_workspace_write as { title, markdown }.`);
        }
        const doc = value as Record<string, unknown>;
        const current = doc.markdown;
        if (typeof current !== 'string') {
            throw new WorkspaceDocError('NOT_A_DOCUMENT', 422,
                `"${target.id}" has no \`markdown\` field, so there is nothing to append to. Rewrite it with aimeat_workspace_write as { title, markdown }.`);
        }

        // 5. The edit. A missing or ambiguous section throws from here and is NOT retried: reading
        //    the document again would not make the heading appear or the collision go away.
        const edited = apply(current);
        const next = { ...doc, id: target.id, markdown: edited.markdown };

        // 6. The schema and the ceilings, on the value that would be stored.
        const valid = await validateMemoryWrite(draftKey, next, storage);
        if (!valid.valid) {
            throw new WorkspaceDocError('SCHEMA_VALIDATION_FAILED', 422,
                'The edited document does not match the schema locked on this space: ' + JSON.stringify(valid.errors),
                { key: draftKey, violations: valid.errors });
        }
        const ceiling = await memoryCeilings(deps, ownerGhii, [{ key: draftKey, value: next }]);
        if (!ceiling.ok) {
            throw new WorkspaceDocError(ceiling.refusal.code, ceiling.refusal.status, ceiling.refusal.message);
        }

        // Provenance is stamped against the bytes that end up stored, the way PATCH /v1/memory does
        // it: the merged document is what a reader gets, and a statement about only the added block
        // would describe something nobody can read back. No caller declaration is accepted here —
        // see the note on these tools in scripts/check-ai-disclosure.ts.
        const aiProvenanceId = await provenanceForWrite(storage, {
            principal: caller.principal,
            content: memoryContentBytes(next),
            pipeline: target.pipeline,
            surface: { visibility: 'private', humanAudience: true },
            labelPolicy: config.aiLabelPublic,
            nodeId: config.nodeId,
            baseUrl: config.baseUrl,
            enabled: config.aiProvenance,
        });

        // 7. The swap. The draft keeps whatever identity already holds it — an append is not the act
        //    that should move a record between owners, and moving it is not something a
        //    compare-and-swap against the OTHER owner's row could do atomically anyway.
        const outcome = await writeWorkspaceRecord(deps, {
            key: draftKey,
            value: next,
            owner: draft?.ownerGaii ?? ownerGhii,
            prev: draft ?? null,
            ifVersion: draft ? draft.version : null,
            principal: caller.principal,
            ...(aiProvenanceId ? { aiProvenanceId } : {}),
        });
        if (!outcome.written) { lastVersion = outcome.version; continue; }

        emitChange('organisms');
        return {
            key: draftKey,
            space: space.name,
            namespace: space.namespace,
            id: target.id,
            version: outcome.version,
            bytes: Buffer.byteLength(JSON.stringify(next), 'utf8'),
            seededFromPublished: !draft && !!published,
            ...(edited.section ? { section: edited.section } : {}),
            attempts: attempt,
        };
    }

    throw new WorkspaceDocError('VERSION_CONFLICT', 409,
        `This document changed under ${MAX_ATTEMPTS} attempts in a row — somebody else is writing to it right now. It is at version ${lastVersion}; try again in a moment.`,
        { key: draftKey, currentVersion: lastVersion });
}
