/**
 * @file src/mcp/themes.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The node MCP half of Themes & Styles: aimeat_theme_list, aimeat_theme_get and
 *   aimeat_theme_save. They call ThemeService, the same service as the /v1/themes routes, so a theme
 *   made in a chat is the theme the admin view shows and the pill offers.
 *
 *   Reading is open, as the routes are: a theme is CSS every visitor downloads. Saving is the
 *   operator's (Jouni, 2026-09-24): the scope word site:theme-write says "this agent may make
 *   themes", and the handler asks the service whether the account it acts for runs this node,
 *   which is the question that stops the word from working when an ordinary owner is granted it.
 * @structure registerThemeTools(mcp, storage, config, getAgentGaii)
 * @usage registerThemeTools(mcp, storage, config, agentGaii);
 * @version-history
 *   v1.0.0 — 2026-09-24 — Initial (UI consolidation phase 4).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { parseGAII } from '../utils/gaii.js';
import { ThemeService, ThemeError, type ThemeInput } from '../services/themes/service.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';
import { toolError } from './tool-error.js';

const out = (payload: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }] });

/** Every refusal from the service is already worded for a person, with the code the route answers. */
function refusal(err: unknown) {
    if (err instanceof ThemeError) return toolError(err.code, err.message);
    throw err;
}

const tokenMap = z.record(z.string(), z.string());

export function registerThemeTools(mcp: McpServer, storage: Storage, config: AimeatConfig, getAgentGaii: () => string): void {
    const svc = new ThemeService(config, storage);

    mcp.tool(
        'aimeat_theme_list',
        descriptionFor('aimeat_theme_list'),
        {},
        annotationsFor('aimeat_theme_list'),
        async () => {
            try { return out(await svc.catalogue(true)); } catch (err) { return refusal(err); }
        },
    );

    mcp.tool(
        'aimeat_theme_get',
        descriptionFor('aimeat_theme_get'),
        { id: z.string().min(1).max(40).describe("The theme's id, from aimeat_theme_list (for example 'aimeat' or 'paper').") },
        annotationsFor('aimeat_theme_get'),
        async ({ id }) => {
            try {
                const theme = await svc.get(id);
                if (!theme) return toolError('NOT_FOUND', `There is no theme "${id}". aimeat_theme_list names them all.`);
                return out({ ...theme, contrast: svc.contrastOf(theme.light, theme.dark) });
            } catch (err) { return refusal(err); }
        },
    );

    mcp.tool(
        'aimeat_theme_save',
        descriptionFor('aimeat_theme_save'),
        {
            id: z.string().max(40).optional().describe('The theme to edit. Leave it out to make a new one.'),
            name: z.string().max(60).optional().describe('What people see in the pill. 1 to 60 characters.'),
            basedOn: z.string().max(40).optional().describe("For a new theme: the theme it starts from (default 'aimeat')."),
            light: tokenMap.optional().describe('Token → colour for light mode, only the ones you change.'),
            dark: tokenMap.optional().describe('Token → colour for dark mode, only the ones you change.'),
            faces: z.object({ headline: z.string().optional(), body: z.string().optional(), mono: z.string().optional() }).optional()
                .describe('{ headline, body, mono }, each a face this node serves.'),
            css: z.string().max(8000).optional().describe('Rules that set component hooks only; empty removes it.'),
            onlyMode: z.string().optional().describe("'light' or 'dark' when the theme has one mode only; empty for both."),
            retired: z.boolean().optional().describe('true takes it out of the pill; false brings it back.'),
            dryRun: z.boolean().optional().describe('Check everything and save nothing.'),
        },
        annotationsFor('aimeat_theme_save'),
        async (args) => {
            const gaii = getAgentGaii();
            if (!await svc.callerIsOperator(parseGAII(gaii)?.owner)) {
                return toolError('ACCESS_DENIED', 'Only the person who runs this installation can make or change its themes.');
            }
            const input: ThemeInput = {
                ...(args.name !== undefined ? { name: args.name } : {}),
                ...(args.basedOn !== undefined ? { basedOn: args.basedOn } : {}),
                ...(args.light !== undefined ? { light: args.light } : {}),
                ...(args.dark !== undefined ? { dark: args.dark } : {}),
                ...(args.faces !== undefined ? { faces: args.faces } : {}),
                ...(args.css !== undefined ? { css: args.css || null } : {}),
                ...(args.onlyMode !== undefined ? { onlyMode: (args.onlyMode || null) as ThemeInput['onlyMode'] } : {}),
                ...(args.retired !== undefined ? { retired: args.retired } : {}),
            };
            try {
                if (args.dryRun) {
                    // The same answer as POST /v1/themes/check: a draft that fails is an answer, not an error.
                    try {
                        const draft = await svc.draft(input, args.id ?? null);
                        return out({ ok: true, saved: false, contrast: svc.contrastOf(draft.light, draft.dark) });
                    } catch (err) {
                        if (err instanceof ThemeError && (err.code === 'INVALID_THEME' || err.code === 'CONTRAST')) return out({ ok: false, saved: false, code: err.code, message: err.message, details: err.details });
                        throw err;
                    }
                }
                const theme = args.id ? await svc.update(args.id, input, gaii) : await svc.create(input, gaii);
                return out({ ok: true, saved: true, theme, next: 'To offer it in the pill, add its id to themes.offered with aimeat_admin_config.' });
            } catch (err) { return refusal(err); }
        },
    );
}
