/**
 * @file src/mcp/ecosystem-apps.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The MCP tools for the outside applications (ecosystem apps) connected to the owner's
 *   account: aimeat_ecosystem_app_list (GET /v1/ecosystem-apps) and aimeat_ecosystem_app_revoke
 *   (DELETE /v1/ecosystem-apps/:app). Each calls the service function its route calls
 *   (services/ecosystem/owner-apps.ts); this file decides nothing and reads no storage. The catalog
 *   gives both the word account:security, so a session without it is not offered them, and the
 *   caller must be an agent, as the routes refuse an app grant and an ecosystem app.
 * @structure registerEcosystemAppTools()
 * @usage registerEcosystemAppTools(mcp, storage, config, caller) — from mcp/register-all.ts
 * @version-history
 *   v1.0.0 — 2026-11-19 — Initial (feature audit 2026-11-19, 4.4 item 2).
 */
import { McpServer } from '@modelcontextprotocol/server';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { CallerContext } from '../services/caller-context.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from '../tool-catalog/shape.js';
import { zodShapeFor } from '../tool-catalog/zod-shape.js';
import { toolError } from './tool-error.js';
import { listOwnerEcosystemApps, revokeOwnerEcosystemApp } from '../services/ecosystem/owner-apps.js';
import { nodeContext } from '../services/node/context.js';
import { emitChange } from '../services/event-bus.js';

const json = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] });
const NOT_OWN = 'This is for the account holder and their own agents.';

export function registerEcosystemAppTools(
    mcp: McpServer,
    storage: Storage,
    config: AimeatConfig,
    /** The session's caller: `owner` is whose apps they are, `kind` who may ask. */
    caller: () => CallerContext,
): void {
    // ── Tool: aimeat_ecosystem_app_list ── Mirrors GET /v1/ecosystem-apps.
    mcp.registerTool(
        'aimeat_ecosystem_app_list',
        {
            description: descriptionFor('aimeat_ecosystem_app_list'),
            inputSchema: zodShapeFor('aimeat_ecosystem_app_list'),
            annotations: annotationsFor('aimeat_ecosystem_app_list'),
        },
        async () => {
            const who = caller();
            if (who.kind !== 'owner' && who.kind !== 'agent') return toolError('ACCESS_DENIED', NOT_OWN);
            const apps = await listOwnerEcosystemApps(storage, who.owner);
            return json({ ecosystem_apps: apps, total: apps.length });
        },
    );

    // ── Tool: aimeat_ecosystem_app_revoke ── Mirrors DELETE /v1/ecosystem-apps/:app.
    mcp.registerTool(
        'aimeat_ecosystem_app_revoke',
        {
            description: descriptionFor('aimeat_ecosystem_app_revoke'),
            inputSchema: zodShapeFor('aimeat_ecosystem_app_revoke'),
            annotations: annotationsFor('aimeat_ecosystem_app_revoke'),
        },
        async ({ app }) => {
            const who = caller();
            if (who.kind !== 'owner' && who.kind !== 'agent') return toolError('ACCESS_DENIED', NOT_OWN);
            const out = await revokeOwnerEcosystemApp({ storage, config, scheduler: nodeContext().scheduler }, who.owner, app);
            if (!out.ok) return toolError(out.code, out.message);
            emitChange('ecosystem-apps');
            return json(out.data);
        },
    );
}
