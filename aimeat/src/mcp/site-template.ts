/**
 * @file src/mcp/site-template.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The MCP tool aimeat_site_template: the operator's own front page and its language
 *   versions (GET, POST and DELETE /v1/site/template). It runs the code the routes run
 *   (services/site/template-ops.ts) on the node's one SiteService (services/site.ts
 *   nodeSiteService), so storing a page here drops the cached page GET / serves, as the Portal page
 *   does. The operator test is the route's: the operator, or their agent holding operator:admin.
 * @structure registerSiteTemplateTools()
 * @usage registerSiteTemplateTools(mcp, storage, config, caller) — from mcp/register-all.ts
 * @version-history
 *   v1.0.0 — 2026-11-19 — Initial (feature audit 2026-11-19, 4.4 item 5).
 */
import { McpServer } from '@modelcontextprotocol/server';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { CallerContext } from '../services/caller-context.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from '../tool-catalog/shape.js';
import { zodShapeFor } from '../tool-catalog/zod-shape.js';
import { toolError } from './tool-error.js';
import { emitChange } from '../services/event-bus.js';
import { OPERATOR_AGENT_REFUSAL } from '../services/operator/principal.js';
import { nodeSiteService } from '../services/site.js';
import { readTemplateOp, storeTemplateOp, removeTemplateOp } from '../services/site/template-ops.js';

const json = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] });

export function registerSiteTemplateTools(
    mcp: McpServer,
    storage: Storage,
    config: AimeatConfig,
    /** The session's caller: the operator test and the name the site change log records. */
    caller: () => CallerContext,
): void {
    mcp.registerTool('aimeat_site_template', {
        description: descriptionFor('aimeat_site_template'),
        inputSchema: zodShapeFor('aimeat_site_template'),
        annotations: annotationsFor('aimeat_site_template'),
    }, async ({ action, lang, template }) => {
        const who = caller();
        // The routes ask requireOperator: the operator, or their agent holding operator:admin.
        if (!(await who.operator('operator:admin'))) return toolError('FORBIDDEN', OPERATOR_AGENT_REFUSAL);
        const site = nodeSiteService(config, storage);
        // The routes record req.auth.sub; the session's sub is the agent's GAII.
        const changedBy = who.auth.sub;
        if (action === 'get') {
            const out = await readTemplateOp(site, lang);
            return out.ok ? json(out.data) : toolError(out.code, out.message);
        }
        if (action === 'set') {
            const out = await storeTemplateOp(site, config, { template, lang, changedBy });
            if (!out.ok) return toolError(out.code, out.message);
            emitChange('site');
            return json(out.data);
        }
        if (action === 'delete') {
            const out = await removeTemplateOp(site, config, { lang, changedBy });
            if (!out.ok) return toolError(out.code, out.message);
            emitChange('site');
            return json(out.data);
        }
        return toolError('INVALID_INPUT', 'action must be "get", "set" or "delete".');
    });
}
