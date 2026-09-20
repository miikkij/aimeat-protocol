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
 *   v1.3.0 — 2026-09-20 — aimeat_designbook_keep, the search's view "reasons", and the reasons in
 *     what get answers: why a part was taken, why it was passed over, what was made by hand.
 *   v1.2.0 — 2026-09-19 — The search says what it answers when it is given nothing: the whole
 *     published Book on one page.
 *   v1.1.0 — 2026-09-05 — Seven kinds, said out loud (wish-atelier-ambient-visuals): the search,
 *     the read, the propose and the adopt name look, motion, illustration, genre and ambient
 *     beside layout and fill — this catalogue had said two kinds while six existed, so a fleet
 *     agent reading it could not know what the Book held. Adopt says which kinds replace and
 *     which merge, and that a genre is forked, never adopted.
 *   v1.0.0 — 2026-08-28 — Initial (TARGET-074 phase 5, slice 1).
 */
import type { AimeatToolDefinition } from './types.js';
import { AI_PROVENANCE_TOOL_NOTE, aiProvenanceCatalogInput } from './ai-provenance-note.js';

/** What the search's `view` parameter says, on both MCP doors. */
export const BOOK_VIEW_PARAM = '"reasons": what builders wrote down about the Book, as the list of what it should become next. "map": the whole published Book on one page (also what calling with nothing answers). Omit it to search rows.';

export const designbookTools: AimeatToolDefinition[] = [
    {
        name: 'aimeat_designbook_search',
        description: "Browse the Design Book: the node's shared library of proven parts. Each row is a part — `layout` (a complete Atelier mosaic arrangement), `fill` (the same shape with <placeholder> slots, a starting shape), `look` (a signature token sheet with an optional preset), `motion` (a motion-token recipe), `illustration` (art direction for the imagery pipeline), `genre` (one of the node's served page templates, shown and forked rather than adopted) or `ambient` (the one layer allowed to move at idle: a preset with its alpha and speed, proven on a look) — with its title, what it is for, lifecycle status and how many builds have adopted it. Published parts are what everyone builds from; proposed ones are still earning it. Filter by kind, status or a word. CALLED WITH NOTHING it answers the whole published Book on one page of text, every part on a line under its kind: start there when you do not know yet what the Book holds. With view \"reasons\" it answers what builders WROTE DOWN about the Book, as the list of what it should become next: the things made by hand because the Book had nothing for them, and the parts most often looked at and left, each with the reasons given.",
        caller: 'agent',
        visibility: { publicMcp: true, connectorMcp: true, cliFallback: true },
        input: {
            kind: { type: 'string', description: 'Only this part kind: layout, fill, look, motion, illustration, genre or ambient.' },
            status: { type: 'string', description: 'Only this lifecycle state: proposed, published, aging or retired. Omit for all.' },
            q: { type: 'string', description: 'A word matched against id, title, summary and tags.' },
            limit: { type: 'number', description: 'Rows to return, 1-200. Default 50.' },
            view: { type: 'string', description: BOOK_VIEW_PARAM },
        },
    },
    {
        name: 'aimeat_designbook_keep',
        description: "Record that the OWNER is satisfied with one of their apps: it turned out well and they mean to keep it. Call it when they say so, in whatever words, and never because a build finished: an app is often rebuilt before anybody likes it, and a finished build that gets thrown away must not teach the Design Book anything. It marks the reasons that app's live version wrote down (what it took from the Book, what it passed over, what it made by hand) as coming from an app somebody was satisfied with, which is the one number about a part that says more than \"an AI favoured it\". The answer lists what that version made by hand, which is what is now worth offering to the next builder. `kept: false` takes it back. The app must carry build notes (<script type=\"application/json\" id=\"aimeat-build-notes\">); one that carries none is answered with how to add them.",
        caller: 'agent',
        visibility: { publicMcp: true, connectorMcp: true, cliFallback: true },
        input: {
            filename: { type: 'string', required: true, description: 'The published app the owner is satisfied with, e.g. "habits.html". It must belong to your owner.' },
            kept: { type: 'boolean', description: 'false takes it back. Default true.' },
        },
    },
    {
        name: 'aimeat_designbook_get',
        description: "Read one Design Book part whole: its body is exactly what an adopt writes into an app — a layout or fill whole; a look's or motion's tokens and preset; an illustration's style; an ambient's preset, alpha, speed, the look it was proven on and its tokens; a genre's template id, which is forked rather than adopted — so reading it IS the preview. The answer carries the part, its record version (its evolution is the version history), its adoption count, and `reasons`: how often builders TOOK it, in how many apps an owner was then satisfied with (`kept`, the number to trust), how often it was passed over, and the reason each builder gave, the ones for leaving it included. Read those before you choose it, and read them as accounts, not measurements.",
        caller: 'agent',
        visibility: { publicMcp: true, connectorMcp: true, cliFallback: true },
        input: {
            id: { type: 'string', required: true, description: 'The part id, from the search.' },
        },
    },
    {
        name: 'aimeat_designbook_propose',
        description: "Propose a part into the Design Book, or update one you already proposed. The bench runs BEFORE anything lands, per kind: the layout validator every app layout passes (layout, fill), the signature-token bench with the contrast-matrix pair proof (look, motion), the imagery-style bench (illustration), the template registry (genre), and the ambient bench, which proves the preset on the part's look through the contrast matrix so a layer too loud for its ground refuses with numbers (ambient). A refusal carries the validator's words with the nearest real name. A new part lands as `proposed` — publishing it into the shared catalogue is the node operator's call. A part id is a node-wide address: once someone holds it, it is theirs, and updating your own re-runs the bench and flows as a minor to later adopts." + AI_PROVENANCE_TOOL_NOTE,
        caller: 'agent',
        visibility: { publicMcp: true, connectorMcp: true, cliFallback: true },
        input: {
            part: { type: 'object', required: true, description: 'The part: { id, kind: "layout"|"fill"|"look"|"motion"|"illustration"|"genre"|"ambient", title, summary, body, tags? }. The kind decides the body: a whole mosaic layout, the vocabulary aimeat_app_ui_get hands you (layout, fill); { tokens, look? } (look); { tokens } of motion tokens only (motion); { style, palette_words? } (illustration); { template } naming a served genre template (genre); { ambient: waves|aurora|dust|grid|static|ink, alpha?, speed?, look?, tokens? } (ambient — "none" is an arrangement\'s choice, never a part).' },
            ...aiProvenanceCatalogInput,
        },
    },
    {
        name: 'aimeat_designbook_adopt',
        description: "Adopt one part into one of your own published Atelier apps, through the same validated, versioned write every layout takes; the app renders it on its next open. A layout or fill REPLACES the app's stored arrangement (the replaced one is archived, so putting it back is one restore). A look, motion recipe, illustration style or ambient MERGES into the arrangement the app already has — an ambient lands as its `ambient` with its tokens beside the existing ones, never its look, and is proven again on the app's own look — and refuses with words when there is no arrangement to season. A genre is never adopted: it is forked from its template, and the refusal carries the address. Published parts are adoptable by anyone; a proposed one only by its own proposer. Adopting counts as usage — it is the signal that keeps a part alive." + AI_PROVENANCE_TOOL_NOTE,
        caller: 'agent',
        visibility: { publicMcp: true, connectorMcp: true, cliFallback: true },
        input: {
            id: { type: 'string', required: true, description: 'The part to adopt.' },
            filename: { type: 'string', required: true, description: 'Your published app file the layout lands in, e.g. "errands.html".' },
            ...aiProvenanceCatalogInput,
        },
    },
];
