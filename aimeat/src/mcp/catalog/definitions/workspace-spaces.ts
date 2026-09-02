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
 *   v1.0.0 — 2026-09-02 — Initial: the extraction, plus the two document tools that caused it.
 */

import type { AimeatToolDefinition } from './types.js';
import { agentEverywhere } from './types.js';

export const workspaceSpaceTools: AimeatToolDefinition[] = [
    {
        name: 'aimeat_workspace_doc_append',
        description: "Add markdown to a workspace DOCUMENT without sending the rest of it back — at the end, or at the end of one named section. This is how a long document is amended: aimeat_workspace_write replaces the whole thing, so amending a 57,000-character spec through it means retyping all of it, and what that fails at is silent. The insert never removes an existing character, so two sessions can append to the same document and both survive — the write is a compare-and-swap that re-reads and re-applies if somebody got there first. `section` names a heading by its exact TEXT ('Concurrency', not '## Concurrency' — either is accepted); the new text lands at the end of that section, before the next heading. Two headings with the same text is a refusal naming both, because guessing which one you meant is how an edit lands in the wrong half of a long document. Edits the DRAFT, seeding it from the published version when there is no draft yet; publish with aimeat_workspace_publish. Member-only.",
        caller: 'agent',
        visibility: agentEverywhere,
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
        description: "Add rows to a workspace ROW space — the shape for what a GROUP accumulates (received messages, events, readings, a log) rather than for records a person authors one by one. A row space is declared in the manifest with backing:'rows'; it is charged to the workspace and the organism instead of to whoever wrote the row, keeps no version history, and never appears row-by-row in a workspace index (the index shows a count). Send one row, or up to 500 in `rows`. Supplying `row_id` makes the append IDEMPOTENT: repeating it REPLACES that row and keeps its original createdAt, so re-running an ingest updates instead of duplicating. `occurred_at` is when the thing happened in the world (a message's own date, not now) and is what reads are ordered and bounded by. Refused before anything is written if the space is not a row space, the caller may not write it, a row is over the size ceiling, or the workspace/organism quota is reached.",
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            organism_id: { type: 'string', required: true, description: 'Organism identifier.' },
            ws: { type: 'string', required: true, description: 'Workspace id.' },
            space: { type: 'string', required: true, description: "The row space, by objectType name (e.g. 'mailmessage') or namespace." },
            body: { type: 'object', description: 'The row, for the single-row form. Use `rows` for many.' },
            row_id: { type: 'string', description: 'Optional caller id for the single-row form. Repeating one REPLACES that row.' },
            occurred_at: { type: 'string', description: 'ISO 8601: when it happened in the world. Defaults to now.' },
            rows: { type: 'array', description: 'Up to 500 rows, each { body, row_id?, occurred_at? }.' },
        },
    },
    {
        name: 'aimeat_workspace_rows_read',
        description: "Read one page of a workspace ROW space, newest first by occurred_at. Keyset-cursored: follow `cursor` for the next page, and a null cursor is the last one — a page boundary can neither skip nor repeat a row even when many share one instant. FILTERING WORKS ONLY ON THE FIELDS THE SPACE DECLARED in its manifest `indexOn` (at most three); pass them in `where`, and anything else is REFUSED with the list that does work rather than ignored, so a filtered page is always really filtered. The answer carries `indexed` so you learn that list from the response. `since`/`until` bound occurred_at inclusively; `changed_since` bounds updated_at exclusively and is what an incremental sync follows.",
        caller: 'agent',
        visibility: agentEverywhere,
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
            order: { type: 'string', description: "'desc' (default, newest first) or 'asc'." },
        },
    },
    {
        name: 'aimeat_workspace_rows_stats',
        description: 'What a workspace ROW space holds, without reading a row: how many, how many bytes, the oldest and newest occurred_at, and when anything last landed. This is what a workspace index shows for a row space instead of its rows, and it is one aggregate rather than a scan, so it stays honest at any size. Read it before a wide query to know what you are about to ask for.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            organism_id: { type: 'string', required: true, description: 'Organism identifier.' },
            ws: { type: 'string', required: true, description: 'Workspace id.' },
            space: { type: 'string', required: true, description: 'The row space, by objectType name or namespace.' },
        },
    },
    {
        name: 'aimeat_workspace_rows_delete',
        description: 'Remove rows from a workspace ROW space: one row by `row_id`, or everything that LANDED before `before` (retention by age). Retention keys on when the row was written to this node, never on when the event happened, so a five-year-old message ingested today is not swept on arrival. Pass exactly one of `row_id` or `before` — there is deliberately no "delete everything" form. Irreversible; a row space keeps no version history to restore from.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            organism_id: { type: 'string', required: true, description: 'Organism identifier.' },
            ws: { type: 'string', required: true, description: 'Workspace id.' },
            space: { type: 'string', required: true, description: 'The row space, by objectType name or namespace.' },
            row_id: { type: 'string', description: 'Remove this one row.' },
            before: { type: 'string', description: 'ISO 8601: remove every row created before this.' },
        },
    },
];
