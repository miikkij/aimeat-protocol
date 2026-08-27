/**
 * @file src/mcp/catalog/definitions/designbook.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Design Book tools (TARGET-074 phase 5): the shared library of PROVEN screen
 *   arrangements. Search it, read one part whole, propose one (the bench runs before anything
 *   lands), adopt one into your own app. This is the answer to the measured problem that the
 *   same brief produced a great screen or a confusing one depending on choices one builder
 *   happened to make: a good arrangement becomes an address, and the first move of a build is to
 *   pick from the Book rather than compose from nothing.
 * @structure designbookTools
 * @usage import { designbookTools } from './designbook.js';
 * @version-history
 *   v1.0.0 — 2026-08-28 — Initial (TARGET-074 phase 5, slice 1).
 */
import type { AimeatToolDefinition } from './types.js';
import { AI_PROVENANCE_TOOL_NOTE, aiProvenanceCatalogInput } from './ai-provenance-note.js';

export const designbookTools: AimeatToolDefinition[] = [
    {
        name: 'aimeat_designbook_search',
        description: "Browse the Design Book: the node's shared library of proven screen arrangements. Each row is a part — `layout` (a complete Atelier mosaic arrangement) or `fill` (the same shape with <placeholder> slots, a starting shape) — with its title, what it is for, lifecycle status and how many builds have adopted it. Published parts are what everyone builds from; proposed ones are still earning it. Filter by kind, status or a word.",
        caller: 'agent',
        visibility: { publicMcp: true, connectorMcp: true, cliFallback: true },
        input: {
            kind: { type: 'string', description: 'Only this part kind: "layout" or "fill".' },
            status: { type: 'string', description: 'Only this lifecycle state: proposed, published, aging or retired. Omit for all.' },
            q: { type: 'string', description: 'A word matched against id, title, summary and tags.' },
            limit: { type: 'number', description: 'Rows to return, 1-200. Default 50.' },
        },
    },
    {
        name: 'aimeat_designbook_get',
        description: 'Read one Design Book part whole: its body is exactly what an adopt writes into an app, so reading it IS the preview. The answer carries the part, its record version (its evolution is the version history) and its adoption count.',
        caller: 'agent',
        visibility: { publicMcp: true, connectorMcp: true, cliFallback: true },
        input: {
            id: { type: 'string', required: true, description: 'The part id, from the search.' },
        },
    },
    {
        name: 'aimeat_designbook_propose',
        description: "Propose a part into the Design Book, or update one you already proposed. The bench runs BEFORE anything lands: the body goes through the same layout validator every app layout passes, and a refusal carries the validator's words with the nearest real name. A new part lands as `proposed` — publishing it into the shared catalogue is the node operator's call. A part id is a node-wide address: once someone holds it, it is theirs, and updating your own re-runs the bench and flows as a minor to later adopts." + AI_PROVENANCE_TOOL_NOTE,
        caller: 'agent',
        visibility: { publicMcp: true, connectorMcp: true, cliFallback: true },
        input: {
            part: { type: 'object', required: true, description: 'The part: { id, kind: "layout"|"fill", title, summary, body, tags? } — body is a whole mosaic layout, the vocabulary aimeat_app_ui_get hands you.' },
            ...aiProvenanceCatalogInput,
        },
    },
    {
        name: 'aimeat_designbook_adopt',
        description: "Adopt one part into one of your own published Atelier apps: the part's body becomes the app's stored layout through the same validated, versioned write every layout takes, and the app renders it on its next open. The replaced layout is archived, so putting it back is one restore. Published parts are adoptable by anyone; a proposed one only by its own proposer. Adopting counts as usage — it is the signal that keeps a part alive." + AI_PROVENANCE_TOOL_NOTE,
        caller: 'agent',
        visibility: { publicMcp: true, connectorMcp: true, cliFallback: true },
        input: {
            id: { type: 'string', required: true, description: 'The part to adopt.' },
            filename: { type: 'string', required: true, description: 'Your published app file the layout lands in, e.g. "errands.html".' },
            ...aiProvenanceCatalogInput,
        },
    },
];
