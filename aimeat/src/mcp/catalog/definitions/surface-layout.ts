/**
 * @file src/mcp/catalog/definitions/surface-layout.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The two tools an operator's AI needs to arrange this node's front page and the page
 *   its members land on. "Take the shop off our home page" is the sentence this exists for.
 *
 *   READ AND WRITE, AND THE READ IS THE IMPORTANT ONE. The get tool returns the layout AND the
 *   catalogue of blocks this node can serve, with the settings each takes, so an AI asked to change
 *   the page has the vocabulary in the same answer rather than guessing at names. Without it the
 *   first write is always a refusal.
 *
 *   NO UNDO MACHINERY HERE, BECAUSE THERE IS ALREADY UNDO. Every write archives the layout it
 *   replaced and the set tool answers with the version number that went into history, so putting it
 *   back is one call. The propose-then-confirm dance the AI-config tools use exists because those
 *   settings have no history; these do.
 * @structure surfaceLayoutTools
 * @usage import { surfaceLayoutTools } from './surface-layout.js';
 * @version-history
 *   v1.0.0 — 2026-08-26 — Initial.
 */
import type { AimeatToolDefinition } from './types.js';

export const surfaceLayoutTools: AimeatToolDefinition[] = [
    {
        name: 'aimeat_surface_layout_get',
        description: "Read how one of this node's pages is arranged, and what it could be arranged from. `surface` is 'portal' for the public front page, 'home' for the page members land on, or 'home-onboarding' for what someone sees while they are still setting up. You get back the blocks in order with their settings, the operator's own passages, and the catalogue of every block this node can serve with the settings each one takes. Read this before writing: the catalogue is the vocabulary, and a block name this node does not have is refused. `source: \"default\"` means nobody has arranged this page yet and you are looking at what it ships as.",
        caller: 'agent',
        visibility: { publicMcp: true, connectorMcp: true, cliFallback: true },
        input: {
            surface: { type: 'string', required: true, description: "Which page: 'portal', 'home' or 'home-onboarding'." },
        },
    },
    {
        name: 'aimeat_surface_layout_set',
        description: "Arrange one of this node's pages: which blocks it shows, in what order, and the words between them. Send the WHOLE layout — this replaces what is there, it does not merge — so read it first with aimeat_surface_layout_get and change what they asked you to change. Each block is { id, key } plus optional `props` (only the settings that block declares), `titles` for your own heading per language, and `hidden` to park one without losing its settings. For a passage of your own, use the block id 'common.freeform' and put the words on it as `body`, in Markdown: script tags, iframes, inline event handlers and javascript: links are refused, and so is a passage over 64 KB. The whole layout is checked before anything is stored, and a refusal names the block and what was wrong. Only the node operator can do this, and only with the site:layout-write permission. The answer carries the version number of the layout you replaced, so putting it back is one call.",
        caller: 'agent',
        visibility: { publicMcp: true, connectorMcp: true, cliFallback: true },
        input: {
            surface: { type: 'string', required: true, description: "Which page: 'portal', 'home' or 'home-onboarding'." },
            blocks: { type: 'array', required: true, description: 'The blocks in the order they should appear. Each is { id, key } with optional props, titles, hidden, children and — on a free-form block — body.' },
            note: { type: 'string', description: 'One line on what this change was for. It shows in the node change log.' },
            ai_provenance: { type: 'object', description: 'What you did to produce the words in a free-form block, if you wrote them. Optional; saying nothing leaves it unstated rather than claiming a person wrote it.' },
            ai_provenance_id: { type: 'string', description: 'An existing provenance record of your own to attach instead of declaring a new one.' },
        },
    },
];
