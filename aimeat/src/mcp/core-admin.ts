/**
 * @file src/mcp/core-admin.ts
 * @description Operator-only core MCP admin tools (aimeat_admin_stats, aimeat_admin_agents,
 *   aimeat_admin_config, aimeat_admin_mint). Registered for all sessions but each checks the
 *   operator role at runtime. Extracted from src/mcp/core.ts to satisfy max-file-lines.
 * @structure
 *   - registerCoreAdminTools() — registers the four operator-only admin tools on an McpServer
 * @usage
 *   import { registerCoreAdminTools } from './core-admin.js';
 *   registerCoreAdminTools(mcp, storage, config, getAgentGaii, emitResourceUpdated, emitResourceListChanged);
 * @version-history
 *   v1.1.0 — 2026-08-11 — aimeat_admin_mint calls services/morsel.ts mintMorsels, the same function
 *     POST /v1/admin/mint calls. The two copies computed the daily cap, credited the balance and
 *     wrote the ledger row separately, and had already drifted apart on what they told the live
 *     wallet stream. (August 2026 audit step 8.)
 *   v1.0.0 — 2026-07-13 — Extracted from src/mcp/core.ts (max-file-lines); no behavior change
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { parseGAII } from '../utils/gaii.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';
import { mintMorsels } from '../services/morsel.js';

export function registerCoreAdminTools(
    mcp: McpServer,
    storage: Storage,
    config: AimeatConfig,
    getAgentGaii: () => string,
    emitResourceUpdated: (agentGaii: string, uri: string) => void,
    _emitResourceListChanged: (agentGaii: string) => void,
): void {
    const agentGaii = getAgentGaii();

    // ── Admin Tools (operator-only) ──
    // These tools are registered for all sessions but check operator role at runtime.
    // This avoids needing to know roles at session creation time.

    async function isOperator(): Promise<boolean> {
        const parsed = parseGAII(agentGaii);
        if (!parsed) return false;
        const owner = await storage.getOwner(parsed.owner);
        return !!owner && owner.roles.includes('operator');
    }

    // ── Tool 15: aimeat_admin_stats ──
    mcp.tool(
        'aimeat_admin_stats',
        descriptionFor('aimeat_admin_stats'),
        {},
        annotationsFor('aimeat_admin_stats'),
        async () => {
            if (!(await isOperator())) return { content: [{ type: 'text' as const, text: 'Operator role required' }], isError: true };
            const agents = await storage.listAgents();
            const actions = await storage.listActions();
            const boards = await storage.listBoards();
            const allWork = await storage.listAllWork();
            let totalMorsels = 0;
            let activeAgents = 0;
            const now = Date.now();
            const seenOwners = new Set<string>();
            for (const a of agents) {
                if (!seenOwners.has(a.owner)) {
                    seenOwners.add(a.owner);
                    const ghii = await storage.getGHIIByOwner(a.owner);
                    totalMorsels += ghii?.morselBalance ?? 0;
                }
                if (a.lastSeen && now - new Date(a.lastSeen).getTime() < 86_400_000) activeAgents++;
            }
            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({
                        node_id: config.nodeId,
                        uptime_seconds: Math.floor(process.uptime()),
                        counts: { agents: agents.length, active_agents_24h: activeAgents, actions: actions.length, boards: boards.length, work_items: allWork.length },
                        economy: { total_morsels_in_circulation: totalMorsels },
                    }, null, 2),
                }],
            };
        },
    );

    // ── Tool 16: aimeat_admin_agents ──
    mcp.tool(
        'aimeat_admin_agents',
        descriptionFor('aimeat_admin_agents'),
        { limit: z.number().optional() },
        annotationsFor('aimeat_admin_agents'),
        async ({ limit }) => {
            if (!(await isOperator())) return { content: [{ type: 'text' as const, text: 'Operator role required' }], isError: true };
            const agents = await storage.listAgents();
            const subset = limit ? agents.slice(0, limit) : agents;
            const ownerBalances = new Map<string, number>();
            for (const a of subset) {
                if (!ownerBalances.has(a.owner)) {
                    const ghii = await storage.getGHIIByOwner(a.owner);
                    ownerBalances.set(a.owner, ghii?.morselBalance ?? 0);
                }
            }
            const result = subset.map(a => ({
                gaii: a.gaii, owner: a.owner, display_name: a.displayName,
                trust_score: a.trustScore, morsel_balance: ownerBalances.get(a.owner) ?? 0,
                last_seen: a.lastSeen, created_at: a.createdAt,
            }));
            return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
        },
    );

    // ── Tool 17: aimeat_admin_config ──
    mcp.tool(
        'aimeat_admin_config',
        descriptionFor('aimeat_admin_config'),
        {},
        annotationsFor('aimeat_admin_config'),
        async () => {
            if (!(await isOperator())) return { content: [{ type: 'text' as const, text: 'Operator role required' }], isError: true };
            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({
                        node_id: config.nodeId, port: config.port,
                        storage_type: config.storageProvider,
                        jwt_ttl_seconds: config.jwtTtlSeconds,
                        welcome_bonus: config.welcomeBonus, daily_allowance: config.dailyAllowance,
                        burn_rate: config.burnRate, max_operator_mint_per_day: config.maxOperatorMintPerDay,
                        // Commerce + agent-readiness posture (READ-ONLY here: these are boot-time
                        // env config — robots.txt is baked and the Web Bot Auth signer is armed at
                        // startup, so a runtime setter would silently no-op until restart. Change
                        // via AIMEAT_* env + restart.)
                        commerce_enabled: config.commerceEnabled,
                        mcp_card_commerce_tools: config.mcpCardCommerceTools,
                        content_signal: config.contentSignal,
                        web_bot_auth_sign: config.webBotAuthSign,
                    }, null, 2),
                }],
            };
        },
    );

    // ── Tool 18: aimeat_admin_mint ──
    mcp.tool(
        'aimeat_admin_mint',
        descriptionFor('aimeat_admin_mint'),
        { gaii: z.string(), amount: z.number().int().positive() },
        annotationsFor('aimeat_admin_mint'),
        async ({ gaii, amount }) => {
            if (!(await isOperator())) return { content: [{ type: 'text' as const, text: 'Operator role required' }], isError: true };
            // ONE implementation (services/morsel.ts mintMorsels). This tool carried its own copy of
            // the cap arithmetic, the credit and the ledger row, which is a second answer to "how
            // much has been minted today" sitting next to the HTTP one.
            const minted = await mintMorsels({ storage, config }, agentGaii, gaii, amount);
            if (!minted.ok) {
                return { content: [{ type: 'text' as const, text: `${minted.code}: ${minted.message}` }], isError: true };
            }
            emitResourceUpdated(gaii, `aimeat://wallet/${encodeURIComponent(gaii)}`);
            return { content: [{ type: 'text' as const, text: JSON.stringify({ gaii, minted: minted.minted, new_balance: minted.newBalance }, null, 2) }] };
        },
    );
}
