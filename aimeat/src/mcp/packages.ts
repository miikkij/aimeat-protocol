/**
 * @file mcp/packages.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Installing a component package from the node's own MCP surface.
 *
 *   WHY THIS FILE EXISTS. The five `aimeat_package_*` tools were declared in the catalog and listed
 *   on the appdev surface, but nothing ever registered them HERE — they were implemented on the two
 *   connector doors only. So an agent talking to this node's `/v1/mcp`, including the person's own
 *   chat, could read the catalog entry for a package tool and never be handed the tool. Installing
 *   is the one of them a conversation actually needs: it is how a package that ships with the node
 *   becomes this person's own copy, and until now it was reachable over HTTP and nowhere else.
 *
 *   ONE IMPLEMENTATION. The work is services/package-install.ts, the same function
 *   POST /v1/packages/:groupId/install calls. This file resolves who is asking and renders the
 *   answer; it decides nothing the HTTP door does not.
 *
 *   THE SCOPE IS THE GATE. `packages:write` is what the route requires, and TOOL_SCOPES carries the
 *   same word here, so an agent without it is not handed the tool at all.
 * @structure registerPackageTools(mcp, storage, config, getAgentGaii) — registers
 *   aimeat_package_install.
 * @usage import { registerPackageTools } from './packages.js';
 * @version-history
 *   v1.0.0 — 2026-08-23 — Initial: install, so a chat can turn a shipped package into an owned copy.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';
import { installPackage } from '../services/package-install.js';
import { getActiveScheduler } from '../services/scheduler.js';
import { resolveGhii } from '../utils/ghii-resolver.js';
import { parseGaiiLoose } from '../utils/gaii.js';

export function registerPackageTools(
    mcp: McpServer,
    storage: Storage,
    config: AimeatConfig,
    getAgentGaii: () => string,
): void {
    mcp.tool('aimeat_package_install', descriptionFor('aimeat_package_install'), {
        group_id: z.string().describe('Package group identifier, e.g. "digital-signage::system". Get it from aimeat_package_list.'),
        label: z.string().optional().describe('What to call this copy, e.g. the company it is for. Defaults to "<package> instance".'),
        version: z.string().optional().describe('A specific version to install. Defaults to the latest published one.'),
        dry_run: z.boolean().optional().describe('Report what would be registered and register nothing.'),
    }, annotationsFor('aimeat_package_install'), async ({ group_id, label, version, dry_run: dryRun }) => {
        // Packages install under the OWNER, so resolve the agent's owner and never a supplied id.
        const gaii = getAgentGaii();
        const owner = parseGaiiLoose(gaii).owner || gaii;
        const ownerGhii = await resolveGhii(storage, owner, gaii);

        const out = await installPackage(
            { storage, config, scheduler: getActiveScheduler() ?? undefined },
            { owner, sub: gaii, ownerGhii },
            { groupId: group_id, label, version, dryRun: dryRun === true },
        );

        if (!out.ok) {
            return {
                content: [{ type: 'text' as const, text: `${out.code}: ${out.message}` }],
                isError: true,
            };
        }

        if (out.kind === 'dry-run') {
            return { content: [{ type: 'text' as const, text: JSON.stringify(out.preview, null, 2) }] };
        }

        // The registered names are the addresses that matter afterwards: an app component installs
        // under its own filename, and that is what a front page or a link has to point at.
        return {
            content: [{
                type: 'text' as const,
                text: JSON.stringify({
                    instance_id: out.instance.id,
                    label: out.instance.label,
                    package: out.instance.packageGroupId,
                    version: out.instance.packageVersion,
                    components: out.instance.installedComponents.map(c => ({
                        component_id: c.componentId, type: c.type, registered_as: c.registeredAs,
                    })),
                }, null, 2),
            }],
        };
    });
}
