/**
 * @file notify.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The aimeat_notify MCP tool: an agent tells its OWN owner something (the bell, and
 *   their devices if they turned push on). The same call as POST /v1/notifications
 *   (services/notification-create.ts), so the owner's settings, the name in front of the title and
 *   the same-node link rule hold on both doors. Self-targeted only.
 * @structure registerNotifyTools(mcp, storage, config, getAgentGaii)
 * @usage import { registerNotifyTools } from './notify.js';
 * @version-history
 *   v1.0.0 — 2026-08-30 — Initial (design canvas "AIMEAT Ilmoitusten sivu", direction A).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';
import { parseGaiiLoose } from '../utils/gaii.js';
import { createPrincipalNotification, NotificationCreateError } from '../services/notification-create.js';

export function registerNotifyTools(mcp: McpServer, storage: Storage, config: AimeatConfig, getAgentGaii: () => string): void {
    mcp.tool(
        'aimeat_notify',
        descriptionFor('aimeat_notify'),
        {
            title: z.string().max(200).describe('What happened, in one line; your name is put in front of it'),
            body: z.string().max(10_000).optional().describe('The detail, a few lines at most'),
            link: z.string().max(500).optional().describe('Where a click leads: a path on this AIMEAT starting with "/" (default: the Agents page)'),
            type: z.string().max(64).optional().describe('A short machine word for the kind of event, e.g. report_ready'),
        },
        annotationsFor('aimeat_notify'),
        async ({ title, body, link, type }) => {
            const gaii = getAgentGaii();
            const owner = parseGaiiLoose(gaii).owner || gaii.split('@')[0];
            try {
                const r = await createPrincipalNotification(storage, config, { owner, sub: gaii, roles: ['agent'] }, { title, body, link, type });
                const text = r.muted
                    ? 'The owner has muted notifications from you: nothing was delivered. Tell them in a message if it matters.'
                    : JSON.stringify({ status: 'notified', link: r.link }, null, 2);
                return { content: [{ type: 'text' as const, text }] };
            } catch (e) {
                const text = e instanceof NotificationCreateError ? e.message : ((e as Error)?.message || 'Notification failed');
                return { content: [{ type: 'text' as const, text }], isError: true };
            }
        },
    );
}
