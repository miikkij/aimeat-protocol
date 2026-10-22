/**
 * @file workspace-spaces.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The catalog definitions for the two workspace surfaces that are not "write the whole
 *   object": in-place DOCUMENT edits (append, section replace) and ROW spaces (append, read, stats,
 *   delete). Extracted from organisms-workspaces-apps.ts at the max-file-lines boundary and spread
 *   back into that array in the same position, so this is a move and the catalog order is unchanged.
 * @structure workspaceSpaceTools — six definitions, documents first, then rows
 * @usage import { workspaceSpaceTools } from './workspace-spaces.js';  // spread in place
 * @version-history
 *   2026-10-05 — The group is declared `as const satisfies`, its exact field schemas are here, and each
 *     definition carries its annotations, scope and surfaces (secaudit 2026-10, M3).
 *   v1.0.0 — 2026-09-02 — Initial: the extraction, plus the two document tools that caused it.
 *   v1.1.0 — 2026-10-02 — aimeat_workspace_rows_delete names memory:purge and organism:write.
 *   v1.2.0 — 2026-10-22 — aimeat_workspace_rows_revisions and aimeat_workspace_rows_restore, on the
 *     delete's two words; the append's description says what it keeps when it replaces another
 *     writer's row (secaudit 2026-10, v80; developer ruling 2026-10-22).
 */

import { z } from 'zod';
import type { AimeatToolDefinition } from './types.js';
import { agentEverywhere } from './types.js';

export const workspaceSpaceTools = [
    {
        name: 'aimeat_workspace_doc_append',
        description: "Add markdown to a workspace DOCUMENT without sending the rest of it back — at the end, or at the end of one named section. This is how a long document is amended: aimeat_workspace_write replaces the whole thing, so amending a 57,000-character spec through it means retyping all of it, and what that fails at is silent. The insert never removes an existing character, so two sessions can append to the same document and both survive — the write is a compare-and-swap that re-reads and re-applies if somebody got there first. `section` names a heading by its exact TEXT ('Concurrency', not '## Concurrency' — either is accepted); the new text lands at the end of that section, before the next heading. Two headings with the same text is a refusal naming both, because guessing which one you meant is how an edit lands in the wrong half of a long document. Edits the DRAFT, seeding it from the published version when there is no draft yet; publish with aimeat_workspace_publish. Member-only.",
        caller: 'agent',
        visibility: agentEverywhere,
        // In-place document edits. The append is NOT idempotent — running it twice adds the text twice,
        // which is the honest answer for an operation that exists to accumulate. The section replace is:
        // the same block replacing the same heading leaves the same document.
        annotations: { title: 'Append To Workspace Document', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        // The in-place document edits write the SAME record aimeat_workspace_write writes — a workspace
        // draft — so they answer to the same word, and their REST routes enforce that word and not the
        // organism:write their neighbours on that router use.
        scope: 'memory:write',
        surfaces: ['appdev', 'agent', 'service'],
        input: {
            organism_id: { type: 'string', required: true, description: 'Organism identifier.' },
            ws: { type: 'string', required: true, description: 'Workspace id.' },
            space: { type: 'string', required: true, description: "The document space, by objectType name (e.g. 'notes') or namespace." },
            id: { type: 'string', required: true, description: 'The document id, from the workspace index (aimeat_workspace_read).' },
            markdown: { type: 'string', required: true, description: 'The markdown to add. Blank lines around it are worked out for you; nothing already in the document is touched.' },
            section: { type: 'string', description: "Add at the end of THIS section instead of the end of the document. The heading's exact text; an ambiguous one is refused." },
        },
    },
    {
        name: 'aimeat_workspace_doc_section_replace',
        description: "Replace one section of a workspace DOCUMENT — a heading and its body — leaving every other byte exactly as it was. Use it to correct or rewrite one part of a long document instead of resending the whole thing, which is both expensive and, for a document somebody else wrote, unsafe. `section` names the heading by its exact TEXT, and `markdown` is the WHOLE replacement INCLUDING its heading line: a block that does not start with a heading is refused rather than guessed at, and changing the heading there is how a section gets renamed. A section runs to the next heading at the same level or higher, so replacing '## Tests' takes its '### Unit' subsection with it. Two headings with the same text is a refusal naming both. Headings inside ```-fenced code are not headings. Concurrent edits are safe (compare-and-swap with re-apply). Edits the DRAFT; publish with aimeat_workspace_publish. Member-only.",
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Replace Workspace Document Section', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        scope: 'memory:write',
        surfaces: ['appdev', 'agent', 'service'],
        input: {
            organism_id: { type: 'string', required: true, description: 'Organism identifier.' },
            ws: { type: 'string', required: true, description: 'Workspace id.' },
            space: { type: 'string', required: true, description: 'The document space, by objectType name or namespace.' },
            id: { type: 'string', required: true, description: 'The document id, from the workspace index (aimeat_workspace_read).' },
            section: { type: 'string', required: true, description: "The heading text to replace, exactly as the document spells it (the leading #'s are optional)." },
            markdown: { type: 'string', required: true, description: 'The whole replacement section, starting with its heading line.' },
        },
    },
    {
        name: 'aimeat_workspace_rows_append',
        description: "Add rows to a workspace ROW space — the shape for what a GROUP accumulates (received messages, events, readings, a log) rather than for records a person authors one by one. A row space is declared in the manifest with backing:'rows'; it is charged to the workspace and the organism instead of to whoever wrote the row, keeps no version history, and never appears row-by-row in a workspace index (the index shows a count). Send one row, or up to 500 in `rows`. Supplying `row_id` makes the append IDEMPOTENT: repeating it REPLACES that row and keeps its original createdAt, so re-running an ingest updates instead of duplicating. When the row you replace was last written by somebody else, the node keeps its earlier content as a revision (aimeat_workspace_rows_revisions), the row keeps its first author in createdBy, and the answer names the row in `revisions_kept`. `occurred_at` is when the thing happened in the world (a message's own date, not now) and is what reads are ordered and bounded by. Refused before anything is written if the space is not a row space, the caller may not write it, a row is over the size ceiling, or the workspace/organism quota is reached.",
        caller: 'agent',
        visibility: agentEverywhere,
        // Row spaces. The append is idempotent BY THE CALLER'S CHOICE: supplying row_id makes a repeat
        // replace that row, omitting it makes every call a new row. Marked non-idempotent because the
        // hint has to describe the call a client might retry blindly, and that one has no row_id.
        annotations: { title: 'Append Workspace Rows', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        // Workspace ROW spaces. `organism:write` rather than `memory:write`, because these rows are NOT
        // memory records: they live in their own table, are charged to the organism rather than to the
        // member, and are governed by workspace membership. The word also matches what the REST routes
        // enforce for the same capability — a tool gated on one word while its route enforces another is
        // the drift invariant 15 exists for.
        scope: 'organism:write',
        surfaces: ['appdev', 'agent', 'service'],
        input: {
            organism_id: { type: 'string', required: true, description: 'Organism identifier.' },
            ws: { type: 'string', required: true, description: 'Workspace id.' },
            space: { type: 'string', required: true, description: "The row space, by objectType name (e.g. 'mailmessage') or namespace." },
            body: { type: 'object', description: 'The row, for the single-row form. Use `rows` for many.' },
            row_id: { type: 'string', description: 'Optional caller id for the single-row form. Repeating one REPLACES that row.' },
            occurred_at: { type: 'string', description: 'ISO 8601: when it happened in the world. Defaults to now.' },
            rows: { type: 'array', description: 'Up to 500 rows, each { body, row_id?, occurred_at? }.', zod: z.array(z.record(z.string(), z.unknown())) },
        },
    },
    {
        name: 'aimeat_workspace_rows_read',
        description: "Read one page of a workspace ROW space, newest first by occurred_at. Keyset-cursored: follow `cursor` for the next page, and a null cursor is the last one — a page boundary can neither skip nor repeat a row even when many share one instant. FILTERING WORKS ONLY ON THE FIELDS THE SPACE DECLARED in its manifest `indexOn` (at most three); pass them in `where`, and anything else is REFUSED with the list that does work rather than ignored, so a filtered page is always really filtered. The answer carries `indexed` so you learn that list from the response. `since`/`until` bound occurred_at inclusively; `changed_since` bounds updated_at exclusively and is what an incremental sync follows.",
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Read Workspace Rows', readOnlyHint: true },
        surfaces: ['appdev', 'agent', 'service'],
        input: {
            organism_id: { type: 'string', required: true, description: 'Organism identifier.' },
            ws: { type: 'string', required: true, description: 'Workspace id.' },
            space: { type: 'string', required: true, description: 'The row space, by objectType name or namespace.' },
            where: { type: 'object', description: 'Filter as { field: value }, using only fields the space declares in indexOn.' },
            since: { type: 'string', description: 'ISO 8601: occurred_at at or after this.' },
            until: { type: 'string', description: 'ISO 8601: occurred_at at or before this.' },
            changed_since: { type: 'string', description: 'ISO 8601: rows whose updated_at is strictly after this.' },
            limit: { type: 'number', description: 'Rows per page, default 100, max 500.' },
            cursor: { type: 'string', description: 'Opaque cursor from the previous page.' },
            order: { type: 'string', description: "'desc' (default, newest first) or 'asc'.", zod: z.enum(['asc', 'desc']) },
        },
    },
    {
        name: 'aimeat_workspace_rows_stats',
        description: 'What a workspace ROW space holds, without reading a row: how many, how many bytes, the oldest and newest occurred_at, and when anything last landed. This is what a workspace index shows for a row space instead of its rows, and it is one aggregate rather than a scan, so it stays honest at any size. Read it before a wide query to know what you are about to ask for.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Workspace Row Space Stats', readOnlyHint: true },
        surfaces: ['appdev', 'agent', 'service'],
        input: {
            organism_id: { type: 'string', required: true, description: 'Organism identifier.' },
            ws: { type: 'string', required: true, description: 'Workspace id.' },
            space: { type: 'string', required: true, description: 'The row space, by objectType name or namespace.' },
        },
    },
    {
        name: 'aimeat_workspace_rows_delete',
        description: 'Remove rows from a workspace ROW space: one row by `row_id`, or everything that LANDED before `before` (retention by age). Retention keys on when the row was written to this node, never on when the event happened, so a five-year-old message ingested today is not swept on arrival. Pass exactly one of `row_id` or `before` — there is deliberately no "delete everything" form. Irreversible; a row space keeps no version history to restore from. Needs memory:purge and organism:write.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Delete Workspace Rows', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
        // Removes rows for good: memory:purge since 2026-10-02, held on the task-start floor. The
        // handler also asks organism:write, as the REST DELETE routes do (mcp/workspace-rows.ts).
        // The words DELETE /v1/organisms/:id/workspace/rows/... asks (secaudit 2026-10 follow-up, A4).
        scope: ['memory:purge', 'organism:write'],
        surfaces: ['appdev', 'agent', 'service'],
        input: {
            organism_id: { type: 'string', required: true, description: 'Organism identifier.' },
            ws: { type: 'string', required: true, description: 'Workspace id.' },
            space: { type: 'string', required: true, description: 'The row space, by objectType name or namespace.' },
            row_id: { type: 'string', description: 'Remove this one row.' },
            before: { type: 'string', description: 'ISO 8601: remove every row created before this.' },
        },
    },
    {
        name: 'aimeat_workspace_rows_revisions',
        description: "List the earlier contents the node kept for one row of a workspace ROW space, newest first. When an append replaces a row whose last writer was somebody else (another person, or another person's agent, app or extension), the node keeps the content it replaced, for the space's retention window or 30 days and at most 20 per row; the row keeps its first author in createdBy and names the new writer in updatedBy. Each revision carries its revision_id, the body, who wrote it and who replaced it. Put one back with aimeat_workspace_rows_restore. For whoever may remove rows: needs memory:purge and organism:write.",
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'List Workspace Row Revisions', readOnlyHint: true },
        // The row delete's two words: whoever may remove a row may see and put back what it held
        // (secaudit 2026-10, v80; developer ruling 2026-10-22). The handler asks organism:write.
        scope: ['memory:purge', 'organism:write'],
        surfaces: ['appdev', 'agent', 'service'],
        input: {
            organism_id: { type: 'string', required: true, description: 'Organism identifier.' },
            ws: { type: 'string', required: true, description: 'Workspace id.' },
            space: { type: 'string', required: true, description: 'The row space, by objectType name or namespace.' },
            row_id: { type: 'string', required: true, description: 'The row whose kept revisions to list.' },
        },
    },
    {
        name: 'aimeat_workspace_rows_restore',
        description: "Put a kept revision back as a row's content in a workspace ROW space (list them with aimeat_workspace_rows_revisions). The content the restore replaces is kept as a revision in turn, so a restore can be undone the same way. The row keeps its first author in createdBy, and updatedBy names you. For whoever may remove rows: needs memory:purge and organism:write.",
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Restore Workspace Row Revision', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        scope: ['memory:purge', 'organism:write'],
        surfaces: ['appdev', 'agent', 'service'],
        input: {
            organism_id: { type: 'string', required: true, description: 'Organism identifier.' },
            ws: { type: 'string', required: true, description: 'Workspace id.' },
            space: { type: 'string', required: true, description: 'The row space, by objectType name or namespace.' },
            row_id: { type: 'string', required: true, description: 'The row to restore.' },
            revision_id: { type: 'string', required: true, description: 'The kept revision to put back, from aimeat_workspace_rows_revisions.' },
        },
    },
] as const satisfies readonly AimeatToolDefinition[];
