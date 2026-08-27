/**
 * @file src/mcp/catalog/definitions/app-ui.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The two tools an owner's AI needs to arrange one Atelier app's screen without
 *   republishing it (TARGET-074) — the surface-layout pair's discipline applied per app. "Move
 *   the numbers above the list" is the sentence this exists for, and it costs one read and one
 *   write instead of an edit-and-publish round.
 *
 *   THE READ CARRIES THE VOCABULARY: the get tool answers with the layout AND the component
 *   catalogue (every component, its settings, the navigation modes, the looks), so the first
 *   write is never a refusal. NO UNDO MACHINERY, because every write archives what it replaced
 *   and the set answers with that version number — putting it back is one call.
 * @structure appUiTools
 * @usage import { appUiTools } from './app-ui.js';
 * @version-history
 *   v1.0.0 — 2026-08-27 — Initial (TARGET-074 phase 2).
 */
import type { AimeatToolDefinition } from './types.js';
import { AI_PROVENANCE_TOOL_NOTE, aiProvenanceCatalogInput } from './ai-provenance-note.js';

export const appUiTools: AimeatToolDefinition[] = [
    {
        name: 'aimeat_app_ui_get',
        description: "Read how one of your Atelier apps arranges its screen, and what it could be arranged from. You get back the stored layout (or null when the app has never stored one — its own code then decides), its version, and the CATALOGUE: every mosaic component this node knows with the settings each takes, the navigation modes (tabs, bottom-bar, canvas, deck, flow) and the look presets. Read this before writing — the catalogue is the vocabulary, and a name it does not carry is refused with the nearest real one suggested.",
        caller: 'agent',
        visibility: { publicMcp: true, connectorMcp: true, cliFallback: true },
        input: {
            filename: { type: 'string', required: true, description: 'The published app file, e.g. "errands.html". The app must belong to your owner.' },
        },
    },
    {
        name: 'aimeat_app_ui_set',
        description: "Arrange one of your Atelier apps' screen: which blocks it shows, in what order, with what settings, under which look and navigation mode. Send the WHOLE layout — { v: 1, look?, nav?, blocks: [{ id, component, props }] } — this replaces what is there, it does not merge, so read it first with aimeat_app_ui_get and change what the owner asked you to change. The layout is validated before anything is stored: an unknown component or setting name is refused with the nearest real name suggested, a hero image data: URI is refused (upload to storage and pass the URL), and at most one hero per layout. Only the app's owner and the agents acting for that owner may write. The answer carries the version the write replaced, so putting it back is one restore call." + AI_PROVENANCE_TOOL_NOTE,
        caller: 'agent',
        visibility: { publicMcp: true, connectorMcp: true, cliFallback: true },
        input: {
            filename: { type: 'string', required: true, description: 'The published app file the layout belongs to.' },
            layout: { type: 'object', required: true, description: 'The whole layout: { v: 1, look?, nav?, blocks: [...] }. The get tool hands you the current one and the catalogue.' },
            note: { type: 'string', description: 'One line on what this change was for.' },
            ...aiProvenanceCatalogInput,
        },
    },
];
