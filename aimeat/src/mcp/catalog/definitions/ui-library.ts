/**
 * @file src/mcp/catalog/definitions/ui-library.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The two tools that read the component catalogue of this node's own interface: the
 *   list, and one component whole. An AI asked to change a page reads which component draws what,
 *   what data it takes and which theme tokens it follows, before it writes a line.
 * @structure uiLibraryTools
 * @usage import { uiLibraryTools } from './ui-library.js';
 * @version-history
 *   v1.2.0 — 2026-09-24 — "component" for every catalogue entry, as the lab and the language
 *     context say it (Jouni's ruling); a shape is a component drawn by a class in poster.css.
 *   v1.1.0 — 2026-09-24 — aimeat_ui_component_get names the themes that carry CSS for the component.
 *   v1.0.0 — 2026-09-23 — Initial (UI consolidation phase 1).
 */
import type { AimeatToolDefinition } from './types.js';

export const uiLibraryTools: AimeatToolDefinition[] = [
    {
        name: 'aimeat_ui_component_list',
        description: "List the components this node's own web interface is built from: each one with a module (in /components/ with its own stylesheet, kind 'component') and each shape of the design language (a class in poster.css, kind 'shape'). Every row says what the component is, how it is called, and which pages draw it. `kind` narrows to 'component' or 'shape', `status` to 'active' or 'unused' (a component no page draws today), and `q` finds words in the name, summary, use or classes. Read one component whole with aimeat_ui_component_get before you change a page or build a new one: reuse the component that exists rather than writing a second copy.",
        caller: 'agent',
        visibility: { publicMcp: true, connectorMcp: true, cliFallback: true },
        input: {
            kind: { type: 'string', description: "'component' or 'shape'." },
            status: { type: 'string', description: "'active' or 'unused'." },
            q: { type: 'string', description: 'Words to find; every word must match.' },
        },
    },
    {
        name: 'aimeat_ui_component_get',
        description: "Read one component of this node's own web interface whole: its data shape and every field, when to use it, its variants and the class or prop that selects each, one example data set, the theme tokens its stylesheet reads, the names its module exports, the files and pages that use it, and the themes of this node that carry CSS for it (with whether that CSS is served; aimeat_theme_component_css_set changes it). `id` is the id from aimeat_ui_component_list (for example 'step-card' or 'slab') or the module's name ('StepCard').",
        caller: 'agent',
        visibility: { publicMcp: true, connectorMcp: true, cliFallback: true },
        input: {
            id: { type: 'string', required: true, description: "The component's id or name, from aimeat_ui_component_list." },
        },
    },
];
