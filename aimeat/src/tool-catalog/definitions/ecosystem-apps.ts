/**
 * @file src/tool-catalog/definitions/ecosystem-apps.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description aimeat_ecosystem_app_list and aimeat_ecosystem_app_revoke: the outside applications
 *   (ecosystem apps) connected to the owner's account, for the owner's own AI. On all three
 *   surfaces: the node's MCP endpoint (src/mcp/ecosystem-apps.ts), the connector MCP and the CLI
 *   dispatch (src/tool-dispatch/tool-call-defs-ecosystem.ts), the last two over GET
 *   /v1/ecosystem-apps and DELETE /v1/ecosystem-apps/:app. One implementation:
 *   services/ecosystem/owner-apps.ts. Both ask account:security, the word GET /v1/access/overview
 *   asks, which no wildcard carries: an outside app is a key to the account.
 * @structure ecosystemAppTools
 * @usage imported by tool-catalog/definitions.ts
 * @version-history
 *   v1.0.0 — 2026-11-19 — Initial: an AI could not say which outside apps read the owner's data, nor
 *     remove one (feature audit 2026-11-19, 4.4 item 2).
 */
import { agentEverywhere, type AimeatToolDefinition } from './types.js';

export const ecosystemAppTools = [
    {
        name: 'aimeat_ecosystem_app_list',
        description: 'List the outside applications (ecosystem apps) connected to your owner\'s account: programs outside this node that your owner approved to read or write their data, such as a help desk or a CRM. Each has `app` (its name), `display_name`, `scopes` (what it may do), `data_areas` (the organisms and other areas it may reach), `status`, `created_at` and `last_seen` (when it last called). Use it when the person asks which outside apps can read their data. Remove one with aimeat_ecosystem_app_revoke. Needs account:security, which your owner gives you on its own.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'List Outside Apps', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        // The word GET /v1/ecosystem-apps admits an agent with, as GET /v1/access/overview does.
        scope: 'account:security',
        surfaces: ['agent', 'admin'],
        input: {},
    },
    {
        name: 'aimeat_ecosystem_app_revoke',
        description: 'Remove one outside application (ecosystem app) from your owner\'s account, when the person tells you to. The app is told first, every sign-in it holds ends at once, and its record, its automation rule, its schedules and its waiting advisories are deleted. What it already wrote into your owner\'s data stays, and so do the incoming webhooks it made, which keep working: the answer names them in `receivers_kept`; say so to the person. Connecting the app again starts from the beginning. Refusals: NOT_FOUND (no such app on this account). Needs account:security.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Remove an Outside App', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
        // The word DELETE /v1/ecosystem-apps/:app admits an agent with.
        scope: 'account:security',
        surfaces: ['agent', 'admin'],
        input: {
            app: { type: 'string', required: true, description: 'The app\'s name (`app` from aimeat_ecosystem_app_list).' },
        },
    },
] as const satisfies readonly AimeatToolDefinition[];
