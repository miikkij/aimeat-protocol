/**
 * @file src/mcp/teams.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description aimeat_team_setup and aimeat_team_status on the node's MCP endpoint. Both call the
 *   functions POST /v1/teams/setup and GET /v1/teams/status call (services/team/for-caller.ts), with
 *   the session's caller, and only turn the answer into a tool result.
 * @structure registerTeamTools
 * @usage registerTeamTools(mcp, storage, config, caller);
 * @version-history
 *   v1.1.0 — 2026-11-14 — aimeat_team_waiting (T6).
 *   v1.0.0 — 2026-11-14 — Initial (wish-tiimipaketti-viisi-syyt-valita-aimeat-nopeasti-k-ytt-n).
 */
import { McpServer } from '@modelcontextprotocol/server';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { CallerContext } from '../services/caller-context.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from '../tool-catalog/shape.js';
import { zodShapeFor } from '../tool-catalog/zod-shape.js';
import { toolError } from './tool-error.js';
import { teamSetupForCaller, teamStatusForCaller, teamWaitingForCaller } from '../services/team/for-caller.js';

const text = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] });

export function registerTeamTools(mcp: McpServer, storage: Storage, config: AimeatConfig, caller: () => CallerContext): void {
    mcp.registerTool(
        'aimeat_team_setup',
        { description: descriptionFor('aimeat_team_setup'), inputSchema: zodShapeFor('aimeat_team_setup'), annotations: annotationsFor('aimeat_team_setup') },
        async (input) => {
            const out = await teamSetupForCaller({ storage, config }, caller(), input);
            return out.ok ? text({ dry_run: out.dryRun, teams: out.teams }) : toolError(out.code, out.message);
        },
    );

    mcp.registerTool(
        'aimeat_team_waiting',
        { description: descriptionFor('aimeat_team_waiting'), inputSchema: zodShapeFor('aimeat_team_waiting'), annotations: annotationsFor('aimeat_team_waiting') },
        async () => {
            const out = await teamWaitingForCaller({ storage, config }, caller());
            return out.ok ? text({ items: out.items, approvals: out.approvals }) : toolError(out.code, out.message);
        },
    );

    mcp.registerTool(
        'aimeat_team_status',
        { description: descriptionFor('aimeat_team_status'), inputSchema: zodShapeFor('aimeat_team_status'), annotations: annotationsFor('aimeat_team_status') },
        async ({ organism_id }) => {
            const out = await teamStatusForCaller({ storage, config }, caller(), typeof organism_id === 'string' && organism_id ? organism_id : null);
            return out.ok ? text({ teams: out.teams }) : toolError(out.code, out.message);
        },
    );
}
