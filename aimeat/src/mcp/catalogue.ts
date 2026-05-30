/**
 * @file catalogue.ts
 * @description MCP catalogue tools. Provides 3 read-only discovery tools for browsing
 *   the agent directory, public boards, and the people directory.
 * @structure
 *   - registerCatalogueTools() — registers all catalogue tools on an McpServer instance
 * @usage
 *   import { registerCatalogueTools } from './catalogue.js';
 *   registerCatalogueTools(mcp, storage, config, getAgentGaii, emitResourceUpdated, emitResourceListChanged);
 * @version-history
 *   v1.0.0 — 2026-03-21 — Initial creation: 3 tools for agent directory, public boards, and people directory
 *   v1.1.0 -- 2026-05-29 -- Add tool annotations (title + read/destructive/idempotent/openWorld hints)
 *     from shared annotations.ts for Connectors Directory compliance.
 *   v1.2.0 -- 2026-05-30 -- MCP audit Phase 1: tool descriptions sourced from canonical catalog via descriptionFor().
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';

export function registerCatalogueTools(
    mcp: McpServer,
    storage: Storage,
    _config: AimeatConfig,
    _getAgentGaii: () => string,
    _emitResourceUpdated: (agentGaii: string, uri: string) => void,
    _emitResourceListChanged: (agentGaii: string) => void,
): void {

    // ── Tool 1: aimeat_catalogue_agents ──
    mcp.tool(
        'aimeat_catalogue_agents',
        descriptionFor('aimeat_catalogue_agents'),
        {
            search: z.string().optional(),
            category: z.string().optional(),
        },
        annotationsFor('aimeat_catalogue_agents'),
        async ({ search, category }) => {
            const agents = await storage.listAgents();

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

            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify(filtered.map(a => ({
                        gaii: a.gaii,
                        display_name: a.displayName ?? a.name,
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
    mcp.tool(
        'aimeat_catalogue_boards',
        descriptionFor('aimeat_catalogue_boards'),
        {},
        annotationsFor('aimeat_catalogue_boards'),
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
    mcp.tool(
        'aimeat_catalogue_directory',
        descriptionFor('aimeat_catalogue_directory'),
        {
            city: z.string().optional(),
            interest: z.string().optional(),
        },
        annotationsFor('aimeat_catalogue_directory'),
        async ({ city, interest }) => {
            const ghiis = await storage.listGHIIs();

            const cityQ = city?.toLowerCase();
            const interestQ = interest?.toLowerCase();

            // For each GHII, read their public location/interests from memory
            const entries: Array<{
                ghii: string;
                display_name: string;
                bio?: string;
                city?: string;
                interests: string[];
            }> = [];

            for (const ghii of ghiis) {
                // Read public profile location and interests memory keys
                const locationRecord = await storage.getMemory(ghii.ghii, 'profile.location');
                const interestsRecord = await storage.getMemory(ghii.ghii, 'profile.interests');

                // Skip profiles that haven't set public location/interests (not opted in to directory)
                if (!locationRecord && !interestsRecord) continue;
                if (locationRecord && locationRecord.visibility !== 'public') continue;
                if (interestsRecord && interestsRecord.visibility !== 'public') continue;

                const loc = locationRecord?.value as { city?: string } | undefined;
                const interests: string[] = Array.isArray(interestsRecord?.value)
                    ? interestsRecord!.value as string[]
                    : [];

                // Apply filters
                if (cityQ && !loc?.city?.toLowerCase().includes(cityQ)) continue;
                if (interestQ && !interests.some(i => i.toLowerCase().includes(interestQ))) continue;

                entries.push({
                    ghii: ghii.ghii,
                    display_name: ghii.displayName,
                    bio: ghii.bio,
                    city: loc?.city,
                    interests,
                });
            }

            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify(entries, null, 2),
                }],
            };
        },
    );
}
