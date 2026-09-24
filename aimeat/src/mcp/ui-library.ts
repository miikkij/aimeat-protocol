/**
 * @file src/mcp/ui-library.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The node MCP half of reading the component catalogue of this node's own interface:
 *   aimeat_ui_component_list and aimeat_ui_component_get. Both call the same service as
 *   GET /v1/ui/components, so what an agent reads here is what the route answers.
 *
 *   No identity and no scope: the catalogue describes code this node ships to every browser, and
 *   the route behind it is public.
 *   One part also names the themes that carry CSS for it, as the route does.
 * @structure registerUiLibraryTools(mcp, storage, config)
 * @usage registerUiLibraryTools(mcp, storage, config);
 * @version-history
 *   v1.1.0 — 2026-09-24 — aimeat_ui_component_get names the themes that carry CSS for the part.
 *   v1.0.0 — 2026-09-23 — Initial (UI consolidation phase 1).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';
import { toolError } from './tool-error.js';
import { getUiComponent, listUiComponents } from '../services/ui-library/catalogue.js';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { ThemeService } from '../services/themes/service.js';

const out = (payload: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }] });

export function registerUiLibraryTools(mcp: McpServer, storage: Storage, config: AimeatConfig): void {
    const themes = new ThemeService(config, storage);
    mcp.tool(
        'aimeat_ui_component_list',
        descriptionFor('aimeat_ui_component_list'),
        {
            kind: z.enum(['component', 'shape']).optional().describe("'component' or 'shape'."),
            status: z.enum(['active', 'unused']).optional().describe("'active' or 'unused'."),
            q: z.string().max(200).optional().describe('Words to find; every word must match.'),
        },
        annotationsFor('aimeat_ui_component_list'),
        async ({ kind, status, q }) => {
            const components = listUiComponents({ kind, status, q });
            return out({ components, total: components.length });
        },
    );

    mcp.tool(
        'aimeat_ui_component_get',
        descriptionFor('aimeat_ui_component_get'),
        {
            id: z.string().min(1).max(80).describe("The part's id or name, from aimeat_ui_component_list."),
        },
        annotationsFor('aimeat_ui_component_get'),
        async ({ id }) => {
            const entry = getUiComponent(id);
            if (!entry) return toolError('NOT_FOUND', `This node's interface has no part called "${id}". aimeat_ui_component_list names them all.`);
            return out({ ...entry, themes: await themes.themesWithCss(entry.id) });
        },
    );
}
