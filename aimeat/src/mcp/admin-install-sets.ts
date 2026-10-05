/**
 * @file src/mcp/admin-install-sets.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description aimeat_admin_install_set on the node's own MCP surface: the operator sets up this node
 *   from an install set in a chat (install packages, phase 4). Plan first: the plan lists what would
 *   be made and every problem, such as a config value the set does not give, so the operator's AI
 *   asks the person for it before anything is created.
 *
 *   ONE IMPLEMENTATION. The work is services/install-set-apply.ts, the same function
 *   POST /v1/install-sets/apply calls. The operator test is the one every admin tool here asks
 *   (services/owner-lifecycle.ts resolveOperatorAgentName): the agent's account is an operator
 *   account, and the agent holds the exact word operator:admin, which no wildcard carries.
 * @structure registerAdminInstallSetTools(mcp, storage, config, peers, getAgentGaii, scopes)
 * @usage registered from src/mcp/register-all.ts
 * @version-history
 *   2026-10-05 — The input schemas are the catalog's: zodShapeFor(name) (secaudit 2026-10, M3).
 *   v1.3.0 — 2026-10-02 — aimeat_package_sale action review (package sale design, phase 5).
 *   v1.2.0 — 2026-10-02 — aimeat_package_sale gains offer, claim, catalogue, price, requests and decide;
 *     aimeat_package_claim redeems a claim code on the buying node (package sale design, phase 3).
 *   v1.1.0 — 2026-09-29 — aimeat_package_sale: this node, as a seller, signs a sale request to a
 *     package repository with its own key; operator-only, the same test as the install set.
 *   v1.0.0 — 2026-09-28 — Initial (install packages, phase 4).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { PeerInfo } from '../services/federation.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from '../tool-catalog/shape.js';
import { toolError } from './tool-error.js';
import { resolveOperatorAgentName, OPERATOR_AGENT_REFUSAL } from '../services/owner-lifecycle.js';
import { applyInstallSet, listAppliedSets } from '../services/install-set-apply.js';
import { getActiveScheduler } from '../services/scheduler.js';
import { saleConfigNeeds, saleGrant, saleRevoke, saleOffer, saleClaim, claimPackageHere } from '../services/packages/sale/package-sale-client.js';
import { readCatalogue, readRequests, setCatalogueEntry } from '../services/packages/sale/package-sale-catalogue.js';
import { decideSaleRequest, reviewSale } from '../services/packages/sale/package-sale-checkout.js';
import { zodShapeFor } from '../tool-catalog/zod-shape.js';

const text = (payload: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }] });

export function registerAdminInstallSetTools(
    mcp: McpServer,
    storage: Storage,
    config: AimeatConfig,
    peers: Map<string, PeerInfo>,
    getAgentGaii: () => string,
    /** This session's granted scopes: operator:admin is asked of them at call time. */
    scopes: readonly string[] = [],
): void {
    mcp.tool('aimeat_admin_install_set', descriptionFor('aimeat_admin_install_set'), zodShapeFor('aimeat_admin_install_set'), annotationsFor('aimeat_admin_install_set'), async ({ action, install_set, secrets }) => {
        const agentGaii = getAgentGaii();
        if (!(await resolveOperatorAgentName(storage, agentGaii, scopes))) return { content: [{ type: 'text' as const, text: OPERATOR_AGENT_REFUSAL }], isError: true };
        if (action === 'list') return text({ install_sets: await listAppliedSets(storage) });
        const out = await applyInstallSet({ storage, config, peers, scheduler: getActiveScheduler() ?? undefined }, {
            installSet: install_set, secrets, dryRun: action === 'plan', appliedBy: agentGaii,
        });
        if (!out.ok) return { ...toolError(out.code, out.problems ? `${out.message} ${out.problems.join(' | ')}` : out.message) };
        return text(out);
    });

    // A selling node's signed sale requests: the same services /v1/package-sales/... calls.
    mcp.tool('aimeat_package_sale', descriptionFor('aimeat_package_sale'), zodShapeFor('aimeat_package_sale'), annotationsFor('aimeat_package_sale'), async (input) => {
        const agentName = await resolveOperatorAgentName(storage, getAgentGaii(), scopes);
        if (!agentName) return { content: [{ type: 'text' as const, text: OPERATOR_AGENT_REFUSAL }], isError: true };
        const deps = { storage, config, peers };
        // This node's own records: the catalogue, the requests (services/packages/sale/package-sale-catalogue.ts).
        if (input.action === 'catalogue') return text({ entries: await readCatalogue(storage) });
        if (input.action === 'requests') return text({ requests: await readRequests(storage) });
        if (input.action === 'decide') {
            const done = await decideSaleRequest(deps, input.request_id ?? '', input.decision);
            return done.ok ? text({ request: done.request }) : { ...toolError(done.code, done.message) };
        }
        if (input.action === 'review') {
            const done = await reviewSale(deps, agentName, input.repository ?? '', input.group_id ?? '');
            return done.ok ? text({ entry: done.entry, reviewed: done.latest }) : { ...toolError(done.code, done.message) };
        }
        if (input.action === 'price') {
            // The operator account the agent acts for is the seller of record unless the call names another.
            const set = await setCatalogueEntry(storage, { owner: agentName }, input);
            return set.ok ? text({ entry: set.entry }) : { ...toolError(set.code, set.message) };
        }
        if (!input.repository || !input.group_id) return { ...toolError('INVALID_INPUT', `action "${input.action}" needs repository and group_id.`) };
        const repository = input.repository_link ? { node_id: input.repository, ...input.repository_link } : input.repository;
        const out = input.action === 'needs'
            ? await saleConfigNeeds(deps, repository, input.group_id)
            : input.action === 'offer'
                ? await saleOffer(deps, repository, input.group_id)
                : input.action === 'claim'
                    ? await saleClaim(deps, repository, input.group_id, input)
                    : input.action === 'revoke'
                        ? await saleRevoke(deps, repository, input.group_id, input.node_id ?? '')
                        : await saleGrant(deps, repository, input.group_id, input.node_id ?? '', input);
        if (!out.ok) return { ...toolError(out.code, out.message) };
        const answer = out.body as { ok?: boolean; data?: unknown; error?: { code?: string; message?: string } };
        if (answer.ok === false) return { ...toolError(answer.error?.code ?? 'REPOSITORY_REFUSED', answer.error?.message ?? `The repository answered ${out.status}.`) };
        return text({ repository: out.repository, ...(answer.data && typeof answer.data === 'object' ? answer.data : {}) });
    });

    // The buying node: its operator redeems a claim code with this node's own key (POST /v1/package-claims).
    mcp.tool('aimeat_package_claim', descriptionFor('aimeat_package_claim'), zodShapeFor('aimeat_package_claim'), annotationsFor('aimeat_package_claim'), async (input) => {
        if (!(await resolveOperatorAgentName(storage, getAgentGaii(), scopes))) return { content: [{ type: 'text' as const, text: OPERATOR_AGENT_REFUSAL }], isError: true };
        const repository = input.repository_link ? { node_id: input.repository, ...input.repository_link } : input.repository;
        const out = await claimPackageHere({ storage, config, peers }, repository, input.group_id, input.code);
        if (!out.ok) return { ...toolError(out.code, out.message) };
        const answer = out.body as { ok?: boolean; data?: unknown; error?: { code?: string; message?: string } };
        if (answer.ok === false) return { ...toolError(answer.error?.code ?? 'REPOSITORY_REFUSED', answer.error?.message ?? `The repository answered ${out.status}.`) };
        return text({ repository: out.repository, ...(answer.data && typeof answer.data === 'object' ? answer.data : {}), next_step: 'Pull the package from the repository (aimeat_package_pull) and install it.' });
    });
}
