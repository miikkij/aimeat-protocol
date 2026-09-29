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
 * @structure registerPackageTools(mcp, storage, config, getAgentGaii, peers, sessionScopes) — registers
 *   aimeat_package_list, aimeat_package_get, aimeat_package_status_set, aimeat_package_install,
 *   aimeat_package_instances, aimeat_package_fork, aimeat_package_instance_set,
 *   aimeat_package_check_updates, aimeat_package_repository, aimeat_package_entitlements.
 * @usage import { registerPackageTools } from './packages.js';
 * @version-history
 *   v1.9.0 — 2026-09-29 — aimeat_package_check_updates runs with federation off when an install set named a repository.
 *   v1.8.0 — 2026-09-29 — aimeat_package_sellers: the nodes that sell your packages with no token.
 *   v1.7.0 — 2026-09-28 — aimeat_package_config_needs: the questions a shop asks before payment.
 *   v1.6.0 — 2026-09-28 — aimeat_package_entitlements takes `node` and registers an unknown node as a
 *     packages-only peer with the grant (install packages, phase 5).
 *   v1.5.0 — 2026-09-28 — aimeat_package_instance_set, aimeat_package_check_updates,
 *     aimeat_package_repository and aimeat_package_entitlements: the package repository, both sides.
 *   v1.4.1 — 2026-09-28 — install takes `config`, each part's config (services/package-config.ts).
 *   v1.4.0 — 2026-09-28 — install takes `mode` (managed | editable); aimeat_package_instances lists
 *     the owner's installed copies and aimeat_package_fork releases a managed one
 *     (services/package-managed.ts).
 *   v1.3.1 — 2026-09-26 — The caller's account name comes from localAccountName (utils/gaii.ts),
 *     which keeps a visitor from another node whole (secaudit 2026-09, F-1).
 *   v1.3.0 — 2026-09-25 — install and update go through installOrRequest / updateOrRequest: without
 *     the words a memory part needs, the answer is a request for the owner, as on the HTTP door.
 *   v1.2.0 — 2026-09-24 — install and update hand the session's scopes to the service, which asks
 *     them for a memory component that writes into the owner's memory, as the HTTP door does.
 *   v1.1.1 — 2026-09-12 — resolveGhii takes the node here too. These tools passed the AGENT's GAII
 *     as the fallback identity, so a missing owner record would have filed the package under the
 *     agent rather than the person it acted for. wish-identity-gate-sees-resolveghii.
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
import { installOrRequest, updateOrRequest, requestedBody } from '../services/package-install-requests.js';
import { listPackagesFor, getPackageFor, listInstancesFor } from '../services/package-read.js';
import { forkPackageInstance, setPackageInstance } from '../services/package-managed.js';
import { refreshInstalledPackages } from '../services/package-upstream-refresh.js';
import { listEntitlements, grantEntitlement, revokeEntitlement } from '../services/package-entitlements.js';
import { packageConfigNeeds } from '../services/package-config-needs.js';
import { listSellers, addSeller, removeSeller } from '../services/package-sellers.js';
import { installSetRepositories } from '../services/install-set-trust.js';
import { toolError } from './tool-error.js';
import { PACKAGE_CONFIG_PARAM } from './catalog/definitions/packages.js';
import { setPackageVersionStatus } from '../services/package-create.js';
import { composePackageFromApps } from '../services/package-compose.js';
import { pullPackage, listRepositoryPackages } from '../services/package-pull.js';
import type { PeerInfo } from '../services/federation.js';
import { getActiveScheduler } from '../services/scheduler.js';
import { resolveGhii } from '../utils/ghii-resolver.js';
import { localAccountName } from '../utils/gaii.js';

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
    peers: Map<string, PeerInfo> = new Map(),
    sessionScopes: string[] = [],
): void {
    /** The owner this agent acts for. Never a caller-supplied id. */
    const ownerOf = (): string => {
        const gaii = getAgentGaii();
        return localAccountName(gaii);
    };
    /** What this session answers for when a component writes into the owner's memory. */
    const grant = { roles: ['agent'], scopes: sessionScopes };

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
        const out = await composePackageFromApps({ storage, config },
            { owner, ownerGhii: await resolveGhii(storage, owner, config) },
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

    mcp.tool('aimeat_package_pull', descriptionFor('aimeat_package_pull'), {
        group_id: z.string().describe('The package on the other node, e.g. "signage::alice".'),
        node_id: z.string().optional().describe('A peer this node knows. Its address and key come from the peer record.'),
        source_url: z.string().optional().describe('A node that is not a peer. Operator only, and only with trust:"tofu".'),
        trust: z.enum(['tofu']).optional().describe('Accept and pin the key that node publishes.'),
        version: z.string().optional().describe('A specific version. Defaults to the latest one there.'),
    }, annotationsFor('aimeat_package_pull'), async (args) => {
        const out = await pullPackage({ storage, config, peers }, {
            owner: ownerOf(),
            // An agent acts within its own grant; the operator branch of a pull is a person's
            // decision at a keyboard, so it is not offered here.
            isOperator: false,
        }, {
            groupId: args.group_id, nodeId: args.node_id, sourceUrl: args.source_url,
            trust: args.trust, version: args.version,
        });

        if (!out.ok) {
            return {
                content: [{ type: 'text' as const, text: `${out.code}: ${out.message}` }],
                isError: true,
            };
        }
        if (!out.applied) {
            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({ applied: false, reason: out.reason, upstream: out.upstream }, null, 2),
                }],
            };
        }
        return {
            content: [{
                type: 'text' as const,
                text: JSON.stringify({
                    applied: true, ...packageSummary(out.package), upstream: out.upstream,
                }, null, 2),
            }],
        };
    });

    mcp.tool('aimeat_package_update', descriptionFor('aimeat_package_update'), {
        instance_id: z.string().describe('The installed copy, from the instances list.'),
        dry_run: z.boolean().optional().describe('Report what would change and change nothing.'),
    }, annotationsFor('aimeat_package_update'), async ({ instance_id, dry_run: dryRun }) => {
        const owner = ownerOf();
        const gaii = getAgentGaii();
        const out = await updateOrRequest({ storage, config },
            { owner, ownerGhii: await resolveGhii(storage, owner, config), sub: gaii, ...grant },
            { instanceId: instance_id, dryRun: dryRun === true });
        if (!out.ok) {
            return {
                content: [{ type: 'text' as const, text: `${out.code}: ${out.message}` }],
                isError: true,
            };
        }
        // Not a failure: the update waits for the owner, and the answer says how it goes on.
        if ('kind' in out) return { content: [{ type: 'text' as const, text: JSON.stringify(requestedBody(out), null, 2) }] };
        return { content: [{ type: 'text' as const, text: JSON.stringify(out.answer, null, 2) }] };
    });

    mcp.tool('aimeat_package_status_set', descriptionFor('aimeat_package_status_set'), {
        group_id: z.string().describe('Package group identifier.'),
        version: z.string().optional().describe('Which version. Defaults to the newest one.'),
        status: z.enum(['draft', 'published', 'beta', 'archived']).describe('The status to set. Only a published version can be installed here; a beta version goes to beta-channel customer nodes.'),
    }, annotationsFor('aimeat_package_status_set'), async ({ group_id, version, status }) => {
        const owner = ownerOf();
        const out = await setPackageVersionStatus({ storage, config },
            { owner }, { groupId: group_id, version, status });
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
        mode: z.enum(['managed', 'editable']).optional().describe('"managed": the package owns the code and layout, updates replace them, and only settings are yours to change. "editable" (default): you may edit everything.'),
        config: z.record(z.string(), z.record(z.string(), z.unknown())).optional().describe(PACKAGE_CONFIG_PARAM),
    }, annotationsFor('aimeat_package_install'), async ({ group_id, label, version, dry_run: dryRun, mode, config: installConfig }) => {
        // Packages install under the OWNER, so resolve the agent's owner and never a supplied id.
        const gaii = getAgentGaii();
        const owner = localAccountName(gaii);
        const ownerGhii = await resolveGhii(storage, owner, config);

        const out = await installOrRequest(
            { storage, config, scheduler: getActiveScheduler() ?? undefined },
            { owner, sub: gaii, ownerGhii, ...grant },
            { groupId: group_id, label, version, dryRun: dryRun === true, mode, config: installConfig },
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

        // Not a failure: the install waits for the owner, the same 202 the HTTP door answers.
        if (out.kind === 'requested') {
            return { content: [{ type: 'text' as const, text: JSON.stringify(requestedBody(out), null, 2) }] };
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
                    mode: out.instance.mode ?? 'editable',
                    components: out.instance.installedComponents.map(c => ({
                        component_id: c.componentId, type: c.type, registered_as: c.registeredAs,
                    })),
                }, null, 2),
            }],
        };
    });

    // The installed copies. aimeat_package_update and aimeat_package_fork both take an instance id,
    // and without this list a conversation could not name one.
    mcp.tool('aimeat_package_instances', descriptionFor('aimeat_package_instances'), {
        group_id: z.string().optional().describe('Only the copies of this package.'),
        status: z.enum(['installed', 'paused', 'removed']).optional().describe('Only copies in this state.'),
    }, annotationsFor('aimeat_package_instances'), async ({ group_id, status }) => {
        const result = await listInstancesFor(storage, ownerOf(), { packageGroupId: group_id, status, limit: 200 });
        return {
            content: [{
                type: 'text' as const,
                text: JSON.stringify({
                    total: result.total,
                    instances: result.instances.map(i => ({
                        instance_id: i.id,
                        label: i.label,
                        package: i.packageGroupId,
                        version: i.packageVersion,
                        status: i.status,
                        mode: i.mode ?? 'editable',
                        ...(i.forkedAt ? { forked_at: i.forkedAt } : {}),
                        installed_at: i.installedAt,
                        components: i.installedComponents.map(c => ({
                            component_id: c.componentId, type: c.type, registered_as: c.registeredAs,
                        })),
                    })),
                }, null, 2),
            }],
        };
    });

    // The owner's own choices about an install: its label, and whether the daily check updates it.
    mcp.tool('aimeat_package_instance_set', descriptionFor('aimeat_package_instance_set'), {
        instance_id: z.string().describe('The installed copy, from aimeat_package_instances.'),
        label: z.string().optional().describe('A new name for this copy.'),
        auto_update: z.boolean().optional().describe('true: the daily check updates this copy by itself. false: it tells your owner an update is ready.'),
    }, annotationsFor('aimeat_package_instance_set'), async ({ instance_id, label, auto_update }) => {
        const out = await setPackageInstance(storage, { owner: ownerOf() }, instance_id, { label, autoUpdate: auto_update });
        if (!out.ok) return { ...toolError(out.code, out.message) };
        return { content: [{ type: 'text' as const, text: JSON.stringify({ instance_id: out.instance.id, label: out.instance.label, auto_update: out.instance.autoUpdate === true }, null, 2) }] };
    });

    // What POST /v1/instances/check-updates does, for this owner's installs.
    mcp.tool('aimeat_package_check_updates', descriptionFor('aimeat_package_check_updates'), {},
        annotationsFor('aimeat_package_check_updates'), async () => {
            // With federation off, the repository an install set named is still a source (install-set-trust.ts).
            if (!config.packageFederationEnabled && (await installSetRepositories(storage)).size === 0) {
                return { ...toolError('PACKAGE_FEDERATION_DISABLED', 'This node does not exchange packages with other nodes, so there is no source to check.') };
            }
            const outcomes = await refreshInstalledPackages({ storage, config, peers }, { owner: ownerOf() }, { notify: false });
            return { content: [{ type: 'text' as const, text: JSON.stringify({ checked: outcomes.length, outcomes }, null, 2) }] };
        });

    // What a repository peer serves this node, before pulling one of them.
    mcp.tool('aimeat_package_repository', descriptionFor('aimeat_package_repository'), {
        node_id: z.string().describe('The repository node, a peer of this node.'),
    }, annotationsFor('aimeat_package_repository'), async ({ node_id }) => {
        const out = await listRepositoryPackages({ storage, config, peers }, node_id);
        if (!out.ok) return { ...toolError(out.code, out.message) };
        return { content: [{ type: 'text' as const, text: JSON.stringify({ node: out.node, packages: out.packages }, null, 2) }] };
    });

    // On a repository: which nodes a private package is served to, and up to when.
    mcp.tool('aimeat_package_entitlements', descriptionFor('aimeat_package_entitlements'), {
        group_id: z.string().describe('Your package group identifier.'),
        action: z.enum(['list', 'grant', 'revoke']).describe('list the nodes, grant (or change) one, or revoke one.'),
        node_id: z.string().optional().describe('For grant and revoke: the customer node.'),
        updates_until: z.string().nullable().optional().describe('For grant: versions published after this ISO date-time are not served to the node. null or omitted: the updates run on.'),
        channel: z.enum(['stable', 'beta']).optional().describe('For grant: stable serves published versions (the default); beta serves versions set to beta too, whichever is newest.'),
        note: z.string().optional().describe('For grant: why, e.g. the order it came from.'),
        node: z.object({ url: z.string(), public_key: z.string() }).optional().describe('For grant: a node this repository does not know yet, registered with the grant as a packages-only peer: its address and the public key its /.well-known/aimeat publishes.'),
    }, annotationsFor('aimeat_package_entitlements'), async ({ group_id, action, node_id, updates_until, channel, note, node }) => {
        const caller = { owner: ownerOf(), isOperator: false };
        if (action === 'list') {
            const out = await listEntitlements(storage, caller, group_id);
            if (!out.ok) return { ...toolError(out.code, out.message) };
            return { content: [{ type: 'text' as const, text: JSON.stringify({ entitlements: out.entitlements, repository_role: config.packageRepository }, null, 2) }] };
        }
        if (!node_id) return { ...toolError('INVALID_INPUT', `action "${action}" needs node_id.`) };
        if (action === 'revoke') {
            const out = await revokeEntitlement(storage, caller, group_id, node_id);
            if (!out.ok) return { ...toolError(out.code, out.message) };
            return { content: [{ type: 'text' as const, text: JSON.stringify({ revoked: true, node_id }, null, 2) }] };
        }
        const out = await grantEntitlement(storage, caller, { groupId: group_id, nodeId: node_id, updatesUntil: updates_until, note, channel, node }, peers);
        if (!out.ok) return { ...toolError(out.code, out.message) };
        return { content: [{ type: 'text' as const, text: JSON.stringify({ entitlement: out.entitlement, peer_registered: out.peerRegistered === true, repository_role: config.packageRepository }, null, 2) }] };
    });

    // The nodes that sell this author's packages with no token: the same service /v1/package-sellers calls.
    mcp.tool('aimeat_package_sellers', descriptionFor('aimeat_package_sellers'), {
        action: z.enum(['list', 'add', 'remove']).describe('list your sellers, add (or change) one, or remove one.'),
        node_id: z.string().optional().describe('For add and remove: the seller node.'),
        node: z.object({ url: z.string(), public_key: z.string() }).optional().describe('For add: { url, public_key } of a node this repository does not know yet.'),
        note: z.string().optional().describe('For add: why.'),
    }, annotationsFor('aimeat_package_sellers'), async ({ action, node_id, node, note }) => {
        const owner = ownerOf();
        const text = (v: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v, null, 2) }] });
        if (action === 'list') return text({ sellers: await listSellers(storage, owner), repository_role: config.packageRepository });
        if (!node_id) return { ...toolError('INVALID_INPUT', `action "${action}" needs node_id.`) };
        if (action === 'remove') {
            const out = await removeSeller(storage, { owner }, node_id);
            if (!out.ok) return { ...toolError(out.code, out.message) };
            return text({ removed: true, node_id });
        }
        const out = await addSeller(storage, peers, { owner }, { nodeId: node_id, node, note });
        if (!out.ok) return { ...toolError(out.code, out.message) };
        return text({ seller: out.seller, peer_registered: out.peerRegistered, repository_role: config.packageRepository });
    });

    // The questions a shop asks before payment: the same service GET /v1/packages/:groupId/config-needs calls.
    mcp.tool('aimeat_package_config_needs', descriptionFor('aimeat_package_config_needs'), {
        group_id: z.string().describe('The package or install bundle group id.'),
    }, annotationsFor('aimeat_package_config_needs'), async ({ group_id }) => {
        const out = await packageConfigNeeds(storage, config, { owner: ownerOf(), isOperator: false }, group_id);
        if (!out.ok) return { ...toolError(out.code, out.message) };
        const { group_id: g, version, bundle, name, questions, defaults, problems } = out;
        return { content: [{ type: 'text' as const, text: JSON.stringify({ group_id: g, version, bundle, name, questions, defaults, problems }, null, 2) }] };
    });

    // Releasing a managed install: the same service POST /v1/instances/:id/fork calls.
    mcp.tool('aimeat_package_fork', descriptionFor('aimeat_package_fork'), {
        instance_id: z.string().describe('The managed copy, from aimeat_package_instances.'),
    }, annotationsFor('aimeat_package_fork'), async ({ instance_id }) => {
        const out = await forkPackageInstance(storage, { owner: ownerOf() }, instance_id);
        if (!out.ok) return { ...toolError(out.code, out.message) };
        return {
            content: [{
                type: 'text' as const,
                text: JSON.stringify({
                    instance_id: out.instance.id,
                    label: out.instance.label,
                    package: out.instance.packageGroupId,
                    version: out.instance.packageVersion,
                    mode: out.instance.mode,
                    forked_at: out.instance.forkedAt,
                }, null, 2),
            }],
        };
    });
}
