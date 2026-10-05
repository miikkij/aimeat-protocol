/**
 * @file src/mcp/themes.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The node MCP half of Themes & Styles: aimeat_theme_list, aimeat_theme_get,
 *   aimeat_theme_save, aimeat_theme_style_save, aimeat_theme_component_css_set and
 *   aimeat_theme_font_save (the font manager, services/themes/fonts.ts). They call
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
 *   2026-10-05 — The input schemas are the catalog's: zodShapeFor(name) (secaudit 2026-10, M3).
 *   v2.3.0 — 2026-10-03 — aimeat_theme_font_save (add, change or remove a face the operator adds);
 *     aimeat_theme_list carries `fonts`, the owners' fonts in storage for the operator's agent only.
 *   v2.2.0 — 2026-09-24 — SECURITY (audit A8-1): the operator test at call time is asked of the
 *     agent and its scopes (the service's callerIsOperator, through services/operator-principal.ts),
 *     so site:theme-write is checked at call time as well as at registration.
 *   v2.1.0 — 2026-09-24 — aimeat_theme_policy_set: who chooses, which themes are available, the default.
 *   v2.0.0 — 2026-09-24 — The two-level model of 07: styles and component CSS have their own tools;
 *     theme CSS is free and answered with warnings; restoreVersion.
 *   v1.0.0 — 2026-09-24 — Initial (UI consolidation phase 4).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { ThemeService, ThemeError, type ThemeInput } from '../services/themes/service.js';
import type { StyleInput } from '../services/themes/styles.js';
import { FontError } from '../services/themes/fonts.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from '../tool-catalog/shape.js';
import { toolError } from './tool-error.js';
import { zodShapeFor } from '../tool-catalog/zod-shape.js';

const out = (payload: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }] });

/** Every refusal from the service is already worded for a person, with the code the route answers. */
function refusal(err: unknown) {
    if (err instanceof ThemeError || err instanceof FontError) return toolError(err.code, err.message);
    throw err;
}

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
        zodShapeFor('aimeat_theme_list'),
        annotationsFor('aimeat_theme_list'),
        async () => {
            // `fonts` carries the owners' fonts in storage only for the operator's own agent.
            try { return out(await svc.catalogue(true, !!(await operatorGaii()))); } catch (err) { return refusal(err); }
        },
    );

    mcp.tool(
        'aimeat_theme_font_save',
        descriptionFor('aimeat_theme_font_save'),
        zodShapeFor('aimeat_theme_font_save'),
        annotationsFor('aimeat_theme_font_save'),
        async (args) => {
            const gaii = await operatorGaii();
            if (!gaii) return toolError('ACCESS_DENIED', NOT_OPERATOR);
            try {
                if (args.remove) return out({ ok: true, ...(await svc.fonts.remove(args.family)) });
                const r = await svc.fonts.save('', {
                    family: args.family,
                    ...(args.kind !== undefined ? { kind: args.kind } : {}),
                    ...(args.files !== undefined ? { files: args.files } : {}),
                    ...(args.licence !== undefined ? { licence: args.licence } : {}),
                    ...(args.copyright !== undefined ? { copyright: args.copyright } : {}),
                    ...(args.source !== undefined ? { source: args.source } : {}),
                }, gaii);
                return out({ ok: true, saved: true, font: r.font, uploads: r.uploads,
                    next: 'PUT each file\'s woff2 bytes to its upload_url (curl -X PUT --data-binary @file.woff2). The face is served, and a style may choose it, once a file has arrived.' });
            } catch (err) { return refusal(err); }
        },
    );

    mcp.tool(
        'aimeat_theme_get',
        descriptionFor('aimeat_theme_get'),
        zodShapeFor('aimeat_theme_get'),
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
        zodShapeFor('aimeat_theme_save'),
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
        zodShapeFor('aimeat_theme_style_save'),
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
        zodShapeFor('aimeat_theme_policy_set'),
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
        zodShapeFor('aimeat_theme_component_css_set'),
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
