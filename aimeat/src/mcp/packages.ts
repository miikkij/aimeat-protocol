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
 *   aimeat_package_list, aimeat_package_get, aimeat_package_status_set, aimeat_package_install.
 * @usage import { registerPackageTools } from './packages.js';
 * @version-history
 *   v1.1.0 — 2026-09-05 — list, get and status_set join install, because install alone was a step
 *     with no way in and no way out: an agent could not name the group id install requires without
 *     listing, and could not make its own package installable, since a package is created private
 *     and the status door existed on no MCP or CLI surface at all.
 *   v1.0.0 — 2026-08-23 — Initial: install, so a chat can turn a shipped package into an owned copy.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';
import { installPackage } from '../services/package-install.js';
import { listPackagesFor, getPackageFor } from '../services/package-read.js';
import { setPackageVersionStatus } from '../services/package-create.js';
import { composePackageFromApps } from '../services/package-compose.js';
import { getActiveScheduler } from '../services/scheduler.js';
import { resolveGhii } from '../utils/ghii-resolver.js';
import { parseGaiiLoose } from '../utils/gaii.js';

/** A package row as a conversation needs it: what it is, not every byte it holds. */
function packageSummary(pkg: { packageGroupId: string; name: string; author: string; version: string; status: string; visibility: string; description: string; category: string; tags: string[]; components: { id: string; type: string; label: string }[] }) {
    return {
        group_id: pkg.packageGroupId,
        name: pkg.name,
        author: pkg.author,
        version: pkg.version,
        status: pkg.status,
        visibility: pkg.visibility,
        description: pkg.description,
        category: pkg.category,
        tags: pkg.tags,
        components: pkg.components.map(c => ({ id: c.id, type: c.type, label: c.label })),
    };
}

export function registerPackageTools(
    mcp: McpServer,
    storage: Storage,
    config: AimeatConfig,
    getAgentGaii: () => string,
): void {
    /** The owner this agent acts for. Never a caller-supplied id. */
    const ownerOf = (): string => {
        const gaii = getAgentGaii();
        return parseGaiiLoose(gaii).owner || gaii;
    };

    mcp.tool('aimeat_package_list', descriptionFor('aimeat_package_list'), {
        search: z.string().optional().describe('Search over name, description and tags.'),
        author: z.string().optional().describe('Only this author\'s packages. Your own name also shows your private ones.'),
        status: z.enum(['draft', 'published', 'archived']).optional().describe('Defaults to published.'),
    }, annotationsFor('aimeat_package_list'), async ({ search, author, status }) => {
        const result = await listPackagesFor(storage, ownerOf(), { search, author, status });
        return {
            content: [{
                type: 'text' as const,
                text: JSON.stringify({
                    total: result.total,
                    packages: result.packages.map(packageSummary),
                }, null, 2),
            }],
        };
    });

    mcp.tool('aimeat_package_get', descriptionFor('aimeat_package_get'), {
        group_id: z.string().describe('Package group identifier, e.g. "digital-signage::system". Get it from aimeat_package_list.'),
    }, annotationsFor('aimeat_package_get'), async ({ group_id }) => {
        const pkg = await getPackageFor(storage, group_id, ownerOf());
        if (!pkg) {
            return {
                content: [{ type: 'text' as const, text: `NOT_FOUND: Package not found: ${group_id}` }],
                isError: true,
            };
        }
        return { content: [{ type: 'text' as const, text: JSON.stringify(packageSummary(pkg), null, 2) }] };
    });

    mcp.tool('aimeat_package_compose', descriptionFor('aimeat_package_compose'), {
        name: z.string().describe('Package name. With your owner name it forms the group id.'),
        apps: z.array(z.string()).min(1).describe('Filenames of your own apps, e.g. ["shop.html", "admin.html"].'),
        description: z.string().optional().describe('What the package is for.'),
        category: z.string().optional().describe('Category for the package gallery.'),
        tags: z.array(z.string()).optional().describe('Tags for search.'),
        visibility: z.enum(['private', 'public']).optional().describe('Who may install it. Defaults to private.'),
        status: z.enum(['draft', 'published', 'archived']).optional().describe('Defaults to published.'),
        include_cortex: z.boolean().optional().describe('Package the cortexes you installed yourself. Default true.'),
        allow_expectations: z.boolean().optional().describe('Compose even when an app calls an extension the package cannot carry.'),
    }, annotationsFor('aimeat_package_compose'), async (args) => {
        const owner = ownerOf();
        const gaii = getAgentGaii();
        const out = await composePackageFromApps({ storage, config },
            { owner, sub: gaii, ownerGhii: await resolveGhii(storage, owner, gaii) },
            {
                name: args.name, apps: args.apps, description: args.description, category: args.category,
                tags: args.tags, visibility: args.visibility, status: args.status,
                includeCortex: args.include_cortex, allowExpectations: args.allow_expectations,
            });
        if (!out.ok) {
            return {
                content: [{ type: 'text' as const, text: `${out.code}: ${out.message}` }],
                isError: true,
            };
        }
        return {
            content: [{
                type: 'text' as const,
                text: JSON.stringify({
                    ...packageSummary(out.package),
                    expects: out.expects,
                    notes: out.notes,
                }, null, 2),
            }],
        };
    });

    mcp.tool('aimeat_package_status_set', descriptionFor('aimeat_package_status_set'), {
        group_id: z.string().describe('Package group identifier.'),
        version: z.string().optional().describe('Which version. Defaults to the newest one.'),
        status: z.enum(['draft', 'published', 'archived']).describe('The status to set. Only a published version can be installed.'),
    }, annotationsFor('aimeat_package_status_set'), async ({ group_id, version, status }) => {
        const owner = ownerOf();
        const out = await setPackageVersionStatus({ storage, config },
            { owner, sub: getAgentGaii() }, { groupId: group_id, version, status });
        if (!out.ok) {
            return {
                content: [{ type: 'text' as const, text: `${out.code}: ${out.message}` }],
                isError: true,
            };
        }
        return { content: [{ type: 'text' as const, text: JSON.stringify(packageSummary(out.package), null, 2) }] };
    });
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
