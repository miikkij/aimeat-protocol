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
 *   v1.1.0 — 2026-09-07 — Reads `created`, not only `muted`. The try/catch below was correct and
 *     unreachable: the service had already turned a storage failure into a result. Measured against
 *     a storage that refuses every write, this was the ONE tool of 318 on this surface that
 *     answered without an error. Held by test/unit/node-mcp-error-flag.test.ts.
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
                if (r.muted) {
                    // Not a failure: the owner said "nothing from you" and the node honoured it. The
                    // sender is told plainly, and told what to do instead.
                    return { content: [{ type: 'text' as const, text: 'The owner has muted notifications from you: nothing was delivered. Tell them in a message if it matters.' }] };
                }
                // `created`, NOT just the catch below. notify() is best-effort by design and swallows
                // a storage failure so the action that triggered a notification still succeeds —
                // right for the four call sites where notifying is a side effect, wrong for this
                // tool, whose whole purpose is that a person hears about something. The catch is
                // correct and was unreachable: the service had already turned the failure into a
                // result, and `created` was the literal `true`. So this answered `status: notified`
                // having stored nothing, and the agent had no way to know. Measured 2026-09-07: the
                // only tool of 318 on this surface that reached broken storage and said nothing.
                if (!r.created) {
                    return {
                        content: [{ type: 'text' as const, text: JSON.stringify({ status: 'not_delivered', reason: 'The node could not store the notification, so the owner was not told.', retry: 'Try again; if it keeps failing, send them a message instead.' }, null, 2) }],
                        isError: true,
                    };
                }
                return { content: [{ type: 'text' as const, text: JSON.stringify({ status: 'notified', link: r.link }, null, 2) }] };
            } catch (e) {
                const text = e instanceof NotificationCreateError ? e.message : ((e as Error)?.message || 'Notification failed');
                return { content: [{ type: 'text' as const, text }], isError: true };
            }
        },
    );
}
