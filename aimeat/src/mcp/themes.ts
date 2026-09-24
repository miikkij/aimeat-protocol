/**
 * @file src/mcp/themes.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The node MCP half of Themes & Styles: aimeat_theme_list, aimeat_theme_get,
 *   aimeat_theme_save, aimeat_theme_style_save and aimeat_theme_component_css_set. They call
 *   ThemeService, the same service as the /v1/themes routes, so a theme made in a chat is the theme
 *   the admin view shows and the pill offers.
 *
 *   Reading is open, as the routes are: a theme is CSS every visitor downloads. Saving is the
 *   operator's (Jouni, 2026-09-24): the scope word site:theme-write says "this agent may make
 *   themes", and the handler asks the service two things of THIS AGENT: the account it acts for runs
 *   this node, which stops the word from working when an ordinary owner is granted it, and the agent
 *   holds site:theme-write, which the registration filter also asks and a node run with
 *   AIMEAT_MCP_ENFORCE_SCOPES=false does not.
 * @structure registerThemeTools(mcp, storage, config, getAgentGaii, scopes)
 * @usage registerThemeTools(mcp, storage, config, agentGaii, scopes);
 * @version-history
 *   v2.2.0 — 2026-09-24 — SECURITY (audit A8-1): the operator test at call time is asked of the
 *     agent and its scopes (the service's callerIsOperator, through services/operator-principal.ts),
 *     so site:theme-write is checked at call time as well as at registration.
 *   v2.1.0 — 2026-09-24 — aimeat_theme_policy_set: who chooses, which themes are available, the default.
 *   v2.0.0 — 2026-09-24 — The two-level model of 07: styles and component CSS have their own tools;
 *     theme CSS is free and answered with warnings; restoreVersion.
 *   v1.0.0 — 2026-09-24 — Initial (UI consolidation phase 4).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { ThemeService, ThemeError, type ThemeInput } from '../services/themes/service.js';
import type { StyleInput } from '../services/themes/styles.js';
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
const NOT_OPERATOR = 'Only the person who runs this installation can make or change its themes.';

export function registerThemeTools(
    mcp: McpServer, storage: Storage, config: AimeatConfig, getAgentGaii: () => string,
    /** This session's granted scopes: the operator test asks site:theme-write of them. */
    scopes: readonly string[] = [],
): void {
    const svc = new ThemeService(config, storage);
    /** The acting identity when it is an operator's agent holding site:theme-write, else null. */
    const operatorGaii = async (): Promise<string | null> => {
        const gaii = getAgentGaii();
        return (await svc.callerIsOperator({ sub: gaii, roles: ['agent'], scopes })) ? gaii : null;
    };

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
        { id: z.string().min(1).max(40).describe("The theme's id, from aimeat_theme_list (for example 'aimeat').") },
        annotationsFor('aimeat_theme_get'),
        async ({ id }) => {
            try {
                const theme = await svc.get(id);
                if (!theme) return toolError('NOT_FOUND', `There is no theme "${id}". aimeat_theme_list names them all.`);
                return out({ theme, warnings: svc.warningsOf(theme), versions: await svc.versions(theme.id) });
            } catch (err) { return refusal(err); }
        },
    );

    mcp.tool(
        'aimeat_theme_save',
        descriptionFor('aimeat_theme_save'),
        {
            id: z.string().max(40).optional().describe('The theme to change. Leave it out to make a new one.'),
            name: z.string().max(60).optional().describe('What people see in the pill. 1 to 60 characters, and no other theme may have it (retired ones included).'),
            basedOn: z.string().max(40).optional().describe("For a new theme: the theme it copies (default 'aimeat')."),
            css: z.string().max(64000).optional().describe('Theme CSS for the whole theme; empty removes it.'),
            shapes: z.record(z.string(), z.string().max(200)).optional().describe("The theme's shape values (corners, frames, shadows, letter case), only the ones you change; an empty value puts the built-in one back. aimeat_theme_list names them."),
            defaultStyle: z.string().max(40).optional().describe('The style a person sees first in this theme.'),
            offeredStyles: z.array(z.string().max(40)).max(40).optional().describe('The style ids of this theme the pill offers.'),
            retired: z.boolean().optional().describe('true takes the theme out of the pill; false brings it back.'),
            restoreVersion: z.number().int().min(1).optional().describe('Put back this saved version (from aimeat_theme_get).'),
            dryRun: z.boolean().optional().describe('Check everything and save nothing.'),
        },
        annotationsFor('aimeat_theme_save'),
        async (args) => {
            const gaii = await operatorGaii();
            if (!gaii) return toolError('ACCESS_DENIED', NOT_OPERATOR);
            try {
                if (args.restoreVersion !== undefined) {
                    if (!args.id) return toolError('INVALID_INPUT', 'restoreVersion needs the id of the theme.');
                    return out({ ok: true, saved: true, ...(await svc.restore(args.id, args.restoreVersion, gaii)) });
                }
                if (!args.id) {
                    if (args.dryRun) return toolError('INVALID_INPUT', 'dryRun checks a change to a theme that exists; making a copy has nothing to check.');
                    // A copy takes its CSS and choices from basedOn; what else is sent lands on the copy, in one save.
                    const made = await svc.create({ ...pick(args), name: args.name, basedOn: args.basedOn }, gaii);
                    return out({ ok: true, saved: true, ...made, next: 'To make it available to people, add its id to `offered` with aimeat_theme_policy_set.' });
                }
                const result = await svc.update(args.id, pick(args), gaii, !!args.dryRun);
                return out({ ok: true, saved: !args.dryRun, ...result });
            } catch (err) { return refusal(err); }
        },
    );

    mcp.tool(
        'aimeat_theme_style_save',
        descriptionFor('aimeat_theme_style_save'),
        {
            theme: z.string().min(1).max(40).describe('The theme the style belongs to.'),
            style: z.string().max(40).optional().describe('The style to change. Leave it out to make a new one.'),
            name: z.string().max(60).optional().describe('What people see in the pill. 1 to 60 characters.'),
            basedOn: z.string().max(40).optional().describe('For a new style: the style of this theme it copies.'),
            light: tokenMap.optional().describe('Token → colour for light mode, only the ones you change.'),
            dark: tokenMap.optional().describe('Token → colour for dark mode, only the ones you change.'),
            faces: z.object({ headline: z.string().optional(), body: z.string().optional(), mono: z.string().optional() }).optional()
                .describe('{ headline, body, mono }, each a face this server serves.'),
            onlyMode: z.string().optional().describe("'light' or 'dark' for a style with one mode; empty for both."),
            retired: z.boolean().optional().describe('true takes the style out of the pill; false brings it back.'),
            dryRun: z.boolean().optional().describe('Check everything and save nothing.'),
        },
        annotationsFor('aimeat_theme_style_save'),
        async (args) => {
            const gaii = await operatorGaii();
            if (!gaii) return toolError('ACCESS_DENIED', NOT_OPERATOR);
            const input: StyleInput & { basedOn?: string } = {
                ...(args.name !== undefined ? { name: args.name } : {}),
                ...(args.basedOn !== undefined ? { basedOn: args.basedOn } : {}),
                ...(args.light !== undefined ? { light: args.light } : {}),
                ...(args.dark !== undefined ? { dark: args.dark } : {}),
                ...(args.faces !== undefined ? { faces: args.faces } : {}),
                ...(args.onlyMode !== undefined ? { onlyMode: (args.onlyMode || null) as StyleInput['onlyMode'] } : {}),
                ...(args.retired !== undefined ? { retired: args.retired } : {}),
            };
            try {
                const r = await svc.saveStyle(args.theme, args.style ?? null, input, gaii, !!args.dryRun);
                return out({ ok: true, saved: !args.dryRun, style: r.style, contrast: r.warnings.contrast[r.style.id] ?? [] });
            } catch (err) { return refusal(err); }
        },
    );

    mcp.tool(
        'aimeat_theme_policy_set',
        descriptionFor('aimeat_theme_policy_set'),
        {
            personalChoice: z.boolean().optional().describe('People choose in the look picker (true), or everybody sees the default (false).'),
            offered: z.array(z.string().max(40)).min(1).max(40).optional().describe("The theme ids people can choose, for example ['aimeat', 'pebble']."),
            default: z.string().max(40).optional().describe('The default theme: one of the offered.'),
        },
        annotationsFor('aimeat_theme_policy_set'),
        async (args) => {
            if (!await operatorGaii()) return toolError('ACCESS_DENIED', NOT_OPERATOR);
            try {
                const snap = await svc.setPolicy({ personalChoice: args.personalChoice, offered: args.offered, default: args.default });
                return out({ ok: true, saved: true, policy: snap.policy, themes: snap.themes.map((t) => ({ id: t.id, name: t.name, styles: t.styles.map((s) => s.id) })) });
            } catch (err) { return refusal(err); }
        },
    );

    mcp.tool(
        'aimeat_theme_component_css_set',
        descriptionFor('aimeat_theme_component_css_set'),
        {
            theme: z.string().min(1).max(40).describe('The theme the CSS belongs to.'),
            component: z.string().min(1).max(60).describe("The component's id, from aimeat_ui_component_list (for example 'slab')."),
            css: z.string().max(64000).optional().describe('The CSS; empty removes it.'),
            dryRun: z.boolean().optional().describe('Check and save nothing.'),
        },
        annotationsFor('aimeat_theme_component_css_set'),
        async (args) => {
            const gaii = await operatorGaii();
            if (!gaii) return toolError('ACCESS_DENIED', NOT_OPERATOR);
            try {
                const r = await svc.setComponentCss(args.theme, args.component, args.css ?? null, gaii, !!args.dryRun);
                return out({ ok: true, saved: !args.dryRun, ...r.state });
            } catch (err) { return refusal(err); }
        },
    );
}

/** The theme's own fields out of the tool's arguments; only what the caller sent. */
function pick(args: { name?: string; css?: string; shapes?: Record<string, string>; defaultStyle?: string; offeredStyles?: string[]; retired?: boolean; id?: string }): ThemeInput {
    return {
        // A new theme took its name at creation; only a change to an existing theme renames.
        ...(args.id && args.name !== undefined ? { name: args.name } : {}),
        ...(args.css !== undefined ? { css: args.css || null } : {}),
        ...(args.shapes !== undefined ? { shapes: args.shapes } : {}),
        ...(args.defaultStyle !== undefined ? { defaultStyle: args.defaultStyle } : {}),
        ...(args.offeredStyles !== undefined ? { offeredStyles: args.offeredStyles } : {}),
        ...(args.retired !== undefined ? { retired: args.retired } : {}),
    };
}
