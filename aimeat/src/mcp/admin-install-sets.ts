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
 *   v1.0.0 — 2026-09-28 — Initial (install packages, phase 4).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { PeerInfo } from '../services/federation.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';
import { toolError } from './tool-error.js';
import { resolveOperatorAgentName, OPERATOR_AGENT_REFUSAL } from '../services/owner-lifecycle.js';
import { applyInstallSet, listAppliedSets } from '../services/install-set-apply.js';
import { getActiveScheduler } from '../services/scheduler.js';

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
    mcp.tool('aimeat_admin_install_set', descriptionFor('aimeat_admin_install_set'), {
        action: z.enum(['plan', 'apply', 'list']).describe('plan: what the set would make, and every problem, writing nothing. apply: make it. list: the sets applied on this node.'),
        install_set: z.record(z.string(), z.unknown()).optional().describe('For plan and apply: the install set, a JSON object with spec "aimeat.install-set/1".'),
        secrets: z.record(z.string(), z.unknown()).optional().describe('For plan and apply: secret config values, { <package group id>: { <component id>: { <field>: value } } }. Never stored in the record.'),
    }, annotationsFor('aimeat_admin_install_set'), async ({ action, install_set, secrets }) => {
        const agentGaii = getAgentGaii();
        if (!(await resolveOperatorAgentName(storage, agentGaii, scopes))) return { content: [{ type: 'text' as const, text: OPERATOR_AGENT_REFUSAL }], isError: true };
        if (action === 'list') return text({ install_sets: await listAppliedSets(storage) });
        const out = await applyInstallSet({ storage, config, peers, scheduler: getActiveScheduler() ?? undefined }, {
            installSet: install_set, secrets, dryRun: action === 'plan', appliedBy: agentGaii,
        });
        if (!out.ok) return { ...toolError(out.code, out.problems ? `${out.message} ${out.problems.join(' | ')}` : out.message) };
        return text(out);
    });
}
