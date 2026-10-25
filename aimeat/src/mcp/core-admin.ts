/**
 * @file src/mcp/core-admin.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Operator-only core MCP admin tools (aimeat_admin_stats, aimeat_admin_agents,
 *   aimeat_admin_config, aimeat_admin_mint, aimeat_admin_organism_ownership,
 *   aimeat_admin_organism_owner_add). Registered only for a session holding the tool's operator word
 *   (TOOL_SCOPES), and each asks again at call time: the account is an operator, and the agent holds
 *   the word. Extracted from src/mcp/core.ts to satisfy max-file-lines.
 * @structure
 *   - registerCoreAdminTools() — registers the six operator-only admin tools on an McpServer
 * @usage
 *   import { registerCoreAdminTools } from './core-admin.js';
 *   registerCoreAdminTools(mcp, storage, config, getAgentGaii, emitResourceUpdated, emitResourceListChanged, scopes);
 * @version-history
 *   2026-10-25 — aimeat_admin_config answers the list GET /v1/admin/config answers (services/config-admin-view.ts),
 *     narrowed by `section` and `q`, in place of a flat twelve fields; the sealed settings are in it. New
 *     tool aimeat_admin_config_set changes settings through changeNodeSettings, PUT's function, as the
 *     session's caller (core.ts passes it; register-all.ts builds it).
 *   2026-10-20 — Imports the MCP SDK v2 packages (@modelcontextprotocol/server, /node, /client) in place of @modelcontextprotocol/sdk, through the official codemod (SDK v2 migration step 4b).
 *   2026-10-20 — Tools register with mcp.registerTool(name, { description, inputSchema, annotations }, handler), the form the MCP SDK v2 keeps (plan doc-mvguy322f9se, step 3). No behaviour change.
 *   2026-10-19 — aimeat_admin_agents carries each agent's `avatar` (services/agent-avatar.ts), one batched read, as GET /v1/admin/agents does.
 *   2026-10-15 — aimeat_admin_stats counts morsels in circulation with morselsInCirculation(), the function the admin dashboard uses: every account holder, with or without an agent (feature-list audit #169).
 *   2026-10-05 — The input schemas are the catalog's: zodShapeFor(name) (secaudit 2026-10, M3).
 *   v1.5.0 — 2026-09-29 — aimeat_admin_config reports the classification switch (classification_mode)
 *     and names aimeat_classification switch_set, which sets it (TARGET-082). This tool stays read-only.
 *   v1.4.0 — 2026-09-24 — SECURITY (audit A8-1): the operator test asks the word as well as the
 *     account, through services/owner-lifecycle.ts resolveOperatorAgentName(): operator:admin for the
 *     four node tools, operator:organism-repair for the two repair tools. The account role alone had
 *     handed every agent an operator connected the power to mint morsels and read every owner's agents.
 *   v1.3.0 — 2026-08-18 — aimeat_admin_config reports the settings this node's host sealed, with
 *     their values. The flat payload here shows twelve fields and none of the sealed classes, so
 *     an operator asking their AI what their limits are got an answer that did not contain them.
 *     The connector tool and the CLI dispatch entry proxy GET /v1/admin/config and inherit it.
 *     https://aimeat-pages.apps.aimeat.io/#org=fbb51de5-56d5-4143-9871-b998a1187655&ws=ws-mq664uyfz21&doc=doc-mv44mc35csxm
 *   v1.2.0 — 2026-08-15 — Two organism-ownership tools: the operator's read of who holds an
 *     organism, and the break-glass that installs an owner on one whose creator account is
 *     unreachable. Both call services/organism-ownership.ts, the same function the HTTP door calls.
 *   v1.1.0 — 2026-08-11 — aimeat_admin_mint calls services/morsel.ts mintMorsels, the same function
 *     POST /v1/admin/mint calls. The two copies computed the daily cap, credited the balance and
 *     wrote the ledger row separately, and had already drifted apart on what they told the live
 *     wallet stream. (August 2026 audit step 8.)
 *   v1.0.0 — 2026-07-13 — Extracted from src/mcp/core.ts (max-file-lines); no behavior change
 */

import { McpServer } from '@modelcontextprotocol/server';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';
import { hasSealedKeys, sealedView } from '../services/config-sealing.js';
import { buildConfigView, changeNodeSettings } from '../services/config-admin-view.js';
import { provenanceOf } from '../services/config-provenance.js';
import type { CallerContext } from '../services/caller-context.js';
import { toolError } from './tool-error.js';
import { descriptionFor } from '../tool-catalog/shape.js';
import { mintMorsels, morselsInCirculation } from '../services/morsel.js';
import { addOrganismOwner, organismOwners } from '../services/organism-ownership.js';
import { resolveOperatorAgentName, OPERATOR_AGENT_REFUSAL } from '../services/owner-lifecycle.js';
import { OPERATOR_ORGANISM_REPAIR_SCOPE } from '../utils/scope-coverage.js';
import { logger } from '../utils/logger.js';
import { zodShapeFor } from '../tool-catalog/zod-shape.js';
import { readAvatarsOrEmpty } from '../services/agent-avatar.js';

export function registerCoreAdminTools(
    mcp: McpServer,
    storage: Storage,
    config: AimeatConfig,
    getAgentGaii: () => string,
    emitResourceUpdated: (agentGaii: string, uri: string) => void,
    _emitResourceListChanged: (agentGaii: string) => void,
    /** This session's granted scopes: the operator words are asked of them at call time. */
    scopes: readonly string[] = [],
    /** The session's caller (register-all.ts), for the checks aimeat_admin_config_set shares with PUT. */
    caller?: () => CallerContext,
): void {
    const agentGaii = getAgentGaii();

    // ── Admin Tools (operator-only) ──
    // Registered only for a session holding the tool's word (TOOL_SCOPES), and asked again here at
    // call time: the account behind the agent runs this node, and the agent carries the exact word.
    // The account alone armed every agent an operator connected (security audit A8-1).
    const isOperator = async (word?: string): Promise<boolean> =>
        (await resolveOperatorAgentName(storage, agentGaii, scopes, word)) !== null;
    const notOperator = { content: [{ type: 'text' as const, text: OPERATOR_AGENT_REFUSAL }], isError: true };
    // The two repair tools have a word of their own, and operator:admin does not stand in for it.
    const notRepairer = {
        content: [{ type: 'text' as const, text: `This is for the node operator's own agent, and only with the "${OPERATOR_ORGANISM_REPAIR_SCOPE}" permission, which the operator ticks for that agent.` }],
        isError: true,
    };

    // ── Tool 15: aimeat_admin_stats ──
    mcp.registerTool(
        'aimeat_admin_stats',
        {
            description: descriptionFor('aimeat_admin_stats'),
            inputSchema: zodShapeFor('aimeat_admin_stats'),
            annotations: annotationsFor('aimeat_admin_stats'),
        },
        async () => {
            if (!(await isOperator())) return notOperator;
            const agents = await storage.listAgents();
            const actions = await storage.listActions();
            const boards = await storage.listBoards();
            const allWork = await storage.listAllWork();
            let activeAgents = 0;
            const now = Date.now();
            for (const a of agents) {
                if (a.lastSeen && now - new Date(a.lastSeen).getTime() < 86_400_000) activeAgents++;
            }
            // The supply GET /v1/admin/dashboard reports, from one function: every account holder's
            // balance, including a person with no agent, whom the per-agent loop left out
            // (feature-list audit #169).
            const totalMorsels = await morselsInCirculation(storage);
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
    mcp.registerTool(
        'aimeat_admin_agents',
        {
            description: descriptionFor('aimeat_admin_agents'),
            inputSchema: zodShapeFor('aimeat_admin_agents'),
            annotations: annotationsFor('aimeat_admin_agents'),
        },
        async ({ limit }) => {
            if (!(await isOperator())) return notOperator;
            const agents = await storage.listAgents();
            const subset = limit ? agents.slice(0, limit) : agents;
            const ownerBalances = new Map<string, number>();
            for (const a of subset) {
                if (!ownerBalances.has(a.owner)) {
                    const ghii = await storage.getGHIIByOwner(a.owner);
                    ownerBalances.set(a.owner, ghii?.morselBalance ?? 0);
                }
            }
            const avatars = await readAvatarsOrEmpty(storage, subset.map(a => a.gaii), logger.warn.bind(logger), 'aimeat_admin_agents');
            const result = subset.map(a => ({
                gaii: a.gaii, owner: a.owner, display_name: a.displayName,
                avatar: avatars.get(a.gaii) ?? null,
                trust_score: a.trustScore, morsel_balance: ownerBalances.get(a.owner) ?? 0,
                last_seen: a.lastSeen, created_at: a.createdAt,
            }));
            return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
        },
    );

    // ── Tool 17: aimeat_admin_config ──
    mcp.registerTool(
        'aimeat_admin_config',
        {
            description: descriptionFor('aimeat_admin_config'),
            inputSchema: zodShapeFor('aimeat_admin_config'),
            annotations: annotationsFor('aimeat_admin_config'),
        },
        async ({ section, q }) => {
            if (!(await isOperator())) return notOperator;
            // The list the admin Config tab and GET /v1/admin/config show, built by the same function
            // (services/config-admin-view.ts). This tool answered a flat twelve fields while the
            // connector's copy proxied the whole list, so an operator's AI on the node could not see
            // most of what it was asked about.
            const view = buildConfigView({ config, storage, provenance: provenanceOf(config) }, { section, q });
            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({
                        ...view,
                        // Settings whoever runs this node set, with their values (a secret as whether it
                        // is set): the answer an operator asking their AI what their limits are needs
                        // in one place. services/config-sealing.ts.
                        ...(hasSealedKeys(config) ? {
                            sealed: sealedView(config),
                            sealed_note: 'Set by whoever runs this node. Readable here, changed by asking them.',
                        } : {}),
                        // The classification switch (TARGET-082) has a tool of its own, which keeps each
                        // change in the classification audit log.
                        classification_mode_note: 'Set it with aimeat_classification { action: "switch_set", mode }. Turning it off, or from all to owner, is the operator\'s to do on the admin Config page.',
                        how_to_change: 'aimeat_admin_config_set { changes: [{ path, value }] }. A row with appliesAt "restart" takes effect when the node next starts. A secret shows only whether it is set; set it on its set_path.',
                    }, null, 2),
                }],
            };
        },
    );

    // ── aimeat_admin_config_set ──
    mcp.registerTool(
        'aimeat_admin_config_set',
        {
            description: descriptionFor('aimeat_admin_config_set'),
            inputSchema: zodShapeFor('aimeat_admin_config_set'),
            annotations: annotationsFor('aimeat_admin_config_set'),
        },
        async ({ changes }) => {
            if (!caller || !(await isOperator())) return notOperator;
            // PUT /v1/admin/config's function: sealed paths and the classification switch are refused
            // before anything is applied, and the change is written to the operator trail.
            const r = await changeNodeSettings({ config, storage, provenance: provenanceOf(config) }, caller().auth, changes);
            if (!r.ok) return toolError(r.code, `${r.message}${r.details ? ` ${JSON.stringify(r.details)}` : ''}`);
            return { content: [{ type: 'text' as const, text: JSON.stringify({ applied: r.applied, errors: r.errors, note: r.note }, null, 2) }] };
        },
    );

    // ── Tool 18: aimeat_admin_mint ──
    mcp.registerTool(
        'aimeat_admin_mint',
        {
            description: descriptionFor('aimeat_admin_mint'),
            inputSchema: zodShapeFor('aimeat_admin_mint'),
            annotations: annotationsFor('aimeat_admin_mint'),
        },
        async ({ gaii, amount }) => {
            if (!(await isOperator())) return notOperator;
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

    // ── Tool 19: aimeat_admin_organism_ownership ──
    mcp.registerTool(
        'aimeat_admin_organism_ownership',
        {
            description: descriptionFor('aimeat_admin_organism_ownership'),
            inputSchema: zodShapeFor('aimeat_admin_organism_ownership'),
            annotations: annotationsFor('aimeat_admin_organism_ownership'),
        },
        async ({ organism_id }) => {
            if (!(await isOperator(OPERATOR_ORGANISM_REPAIR_SCOPE))) return notRepairer;
            const organism = await storage.getOrganism(organism_id);
            if (!organism) return { content: [{ type: 'text' as const, text: `Organism not found: ${organism_id}` }], isError: true };
            const members = await storage.listMembers(organism_id);
            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({
                        id: organism.id, name: organism.name,
                        owners: organismOwners(organism), created_by: organism.createdBy, admins: organism.admins,
                        created_at: organism.createdAt, updated_at: organism.updatedAt,
                        members: members.map(m => ({ ghii: m.ghii, role: m.role, status: m.status, joined_at: m.joinedAt })),
                    }, null, 2),
                }],
            };
        },
    );

    // ── Tool 20: aimeat_admin_organism_owner_add ──
    // The break-glass. ONE implementation (services/organism-ownership.ts handOverOwnership), the
    // same function POST /v1/admin/organisms/:id/ownership calls, so the membership rules, the
    // notifications and the three-writes-together transaction cannot differ between the surfaces.
    mcp.registerTool(
        'aimeat_admin_organism_owner_add',
        {
            description: descriptionFor('aimeat_admin_organism_owner_add'),
            inputSchema: zodShapeFor('aimeat_admin_organism_owner_add'),
            annotations: annotationsFor('aimeat_admin_organism_owner_add'),
        },
        async ({ organism_id, ghii }) => {
            if (!(await isOperator(OPERATOR_ORGANISM_REPAIR_SCOPE))) return notRepairer;
            const organism = await storage.getOrganism(organism_id);
            if (!organism) return { content: [{ type: 'text' as const, text: `Organism not found: ${organism_id}` }], isError: true };
            const outcome = await addOrganismOwner(storage, config, organism, ghii, {
                seatNonMember: true,
                performedBy: `operator repair by ${agentGaii}`,
            });
            if (!outcome.ok) {
                return { content: [{ type: 'text' as const, text: `${outcome.code}: ${outcome.message}` }], isError: true };
            }
            logger.warn('[operator-organism-repair] owner installed', {
                organism: organism_id, added: outcome.added, owners: outcome.owners,
                seated: outcome.membershipCreated, by: agentGaii,
            });
            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({
                        organism: organism_id, added: outcome.added, owners: outcome.owners,
                        membership_created: outcome.membershipCreated,
                    }, null, 2),
                }],
            };
        },
    );
}
