/**
 * @file catalogue.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description MCP catalogue tools. Provides 3 read-only discovery tools for browsing
 *   the agent directory, public boards, and the people directory.
 * @structure
 *   - registerCatalogueTools() — registers all catalogue tools on an McpServer instance
 * @usage
 *   import { registerCatalogueTools } from './catalogue.js';
 *   registerCatalogueTools(mcp, storage, config, getAgentGaii, emitResourceUpdated, emitResourceListChanged);
 * @version-history
 *   2026-10-20 — Tools register with mcp.registerTool(name, { description, inputSchema, annotations }, handler), the form the MCP SDK v2 keeps (plan doc-mvguy322f9se, step 3). No behaviour change.
 *   2026-10-20 — SECURITY: aimeat_catalogue_directory answers from the node's DirectoryService, so it
 *     lists only people holding an active federation consent, as GET /v1/catalogue/directory does;
 *     aimeat_catalogue_agents drops `unlisted` agents, as GET /v1/catalogue/agents does
 *     (secaudit 2026-10, two doors on one listing with two opt-in policies).
 *   2026-10-19 — aimeat_catalogue_agents carries each agent's `avatar` (services/agent-avatar.ts), one batched read per call.
 *   2026-10-05 — The input schemas are the catalog's: zodShapeFor(name) (secaudit 2026-10, M3).
 *   v1.0.0 — 2026-03-21 — Initial creation: 3 tools for agent directory, public boards, and people directory
 *   v1.1.0 -- 2026-05-29 -- Add tool annotations (title + read/destructive/idempotent/openWorld hints)
 *     from shared annotations.ts for Connectors Directory compliance.
 *   v1.2.0 -- 2026-05-30 -- MCP audit Phase 1: tool descriptions sourced from canonical catalog via descriptionFor().
 *   v1.3.0 — 2026-07-16 — directory reads profile.location/interests in 2 IN queries (was getMemory per owner)
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from '../tool-catalog/shape.js';
import { zodShapeFor } from '../tool-catalog/zod-shape.js';
import { readAvatarsOrEmpty } from '../services/agent-avatar.js';
import { nodeDirectory } from '../services/directory.js';
import { toolError } from './tool-error.js';
import { logger } from '../utils/logger.js';

export function registerCatalogueTools(
    mcp: McpServer,
    storage: Storage,
    _config: AimeatConfig,
    _getAgentGaii: () => string,
    _emitResourceUpdated: (agentGaii: string, uri: string) => void,
    _emitResourceListChanged: (agentGaii: string) => void,
): void {

    // ── Tool 1: aimeat_catalogue_agents ──
    mcp.registerTool(
        'aimeat_catalogue_agents',
        {
            description: descriptionFor('aimeat_catalogue_agents'),
            inputSchema: zodShapeFor('aimeat_catalogue_agents'),
            annotations: annotationsFor('aimeat_catalogue_agents'),
        },
        async ({ search, category }) => {
            // An agent tagged `unlisted` (the per-owner Secretary, for one) is out of the public
            // directory, as it is on GET /v1/catalogue/agents. This door had not applied the rule,
            // so the same listing hid an agent on REST and named it over MCP (secaudit 2026-10).
            const agents = (await storage.listAgents()).filter(a => !(a.tags ?? []).includes('unlisted'));

            const q = search?.toLowerCase();
            const cat = category?.toLowerCase();

            const filtered = agents.filter(a => {
                if (q) {
                    const inName = (a.displayName ?? a.name).toLowerCase().includes(q);
                    const inDesc = (a.description ?? '').toLowerCase().includes(q);
                    const inGaii = a.gaii.toLowerCase().includes(q);
                    if (!inName && !inDesc && !inGaii) return false;
                }
                if (cat) {
                    const inCaps = a.capabilities.some(c => c.toLowerCase().includes(cat));
                    if (!inCaps) return false;
                }
                return true;
            });
            // The agent's picture is public like its description (services/agent-avatar.ts): one read for the list.
            const avatars = await readAvatarsOrEmpty(storage, filtered.map(a => a.gaii), logger.warn.bind(logger), 'aimeat_catalogue_agents');

            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify(filtered.map(a => ({
                        gaii: a.gaii,
                        display_name: a.displayName ?? a.name,
                        avatar: avatars.get(a.gaii) ?? null,
                        description: a.description,
                        capabilities: a.capabilities,
                        trust_score: a.trustScore,
                        last_seen: a.lastSeen,
                    })), null, 2),
                }],
            };
        },
    );

    // ── Tool 2: aimeat_catalogue_boards ──
    mcp.registerTool(
        'aimeat_catalogue_boards',
        {
            description: descriptionFor('aimeat_catalogue_boards'),
            inputSchema: zodShapeFor('aimeat_catalogue_boards'),
            annotations: annotationsFor('aimeat_catalogue_boards'),
        },
        async () => {
            const boards = await storage.listBoards();
            const publicBoards = boards.filter(b => b.visibility === 'public');

            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify(publicBoards.map(b => ({
                        id: b.id,
                        name: b.name,
                        description: b.description,
                        created_at: b.createdAt,
                    })), null, 2),
                }],
            };
        },
    );

    // ── Tool 3: aimeat_catalogue_directory ──
    mcp.registerTool(
        'aimeat_catalogue_directory',
        {
            description: descriptionFor('aimeat_catalogue_directory'),
            inputSchema: zodShapeFor('aimeat_catalogue_directory'),
            annotations: annotationsFor('aimeat_catalogue_directory'),
        },
        async ({ city, interest }) => {
            // ONE LISTING, ONE OPT-IN. GET /v1/catalogue/directory answers from the DirectoryService,
            // which indexes a person only while they hold an active `federation` consent and reads
            // their profile under `profile.<username>.location` and `.interests`. This tool had its
            // own listing over listGHIIs: it published every GHII whose bare `profile.location` or
            // `profile.interests` record was public, with their display name and bio, consent or no
            // consent. So the same people directory had two doors and two opt-in policies, and the
            // MCP one listed people the REST one kept out (secaudit 2026-10). It now reads the same
            // service, which also drops a person whose consent was revoked before the index was
            // rebuilt (directory.ts stillConsented).
            const directory = nodeDirectory();
            if (!directory) return { ...toolError('FEATURE_DISABLED', 'This node runs no people directory.') };

            const result = await directory.search({ type: 'people', city, interest, perPage: 100 });
            const entries = result.entries.map(e => ({
                ghii: e.ghii,
                display_name: e.displayName,
                bio: e.bio,
                city: e.city,
                interests: e.interests,
            }));

            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify(entries, null, 2),
                }],
            };
        },
    );
}
