/**
 * @file src/mcp/operator-services.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description aimeat_admin_service_access on the node's MCP: the outside services the operator
 *   switched on for every account (agents.operator_services) and the accounts one of them covers.
 *   It calls operatorServicesView and operatorServiceAccounts (services/operator-services/listing.ts),
 *   the functions GET /v1/operator-services and GET /v1/operator-services/{id}/accounts call, with the
 *   session's caller, so who may read what is decided in one place. The actions account_off and
 *   account_on call setServiceForAccount (services/operator-services/operator-switch.ts), the function
 *   PUT /v1/operator-services/{id}/accounts/{account} calls. An operator tool: offered to an agent
 *   holding operator:admin and asked again at call time, as its neighbours are.
 * @structure registerOperatorServiceTools
 * @usage registerOperatorServiceTools(mcp, config, storage, caller) from mcp/core-admin.ts
 * @version-history
 *   v1.2.0 — 2026-11-26 — Actions account_off and account_on: the operator's per-account switch.
 *   v1.1.0 — 2026-11-26 — operator:admin, the word of the other operator read tools, offered and asked.
 *   v1.0.0 — 2026-11-26 — Initial (wish-situatedai-koko-henkil-st-lle-ilman-henkil-kohtaisia-hyv-ksy).
 */
import type { McpServer } from '@modelcontextprotocol/server';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { CallerContext } from '../services/caller-context.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from '../tool-catalog/shape.js';
import { zodShapeFor } from '../tool-catalog/zod-shape.js';
import { toolError } from './tool-error.js';
import { operatorServicesView, operatorServiceAccounts } from '../services/operator-services/listing.js';
import { OPERATOR_AGENT_REFUSAL } from '../services/operator/principal.js';
import { OPERATOR_ADMIN_SCOPE } from '../utils/scope-coverage.js';
import { setServiceForAccount } from '../services/operator-services/operator-switch.js';
import { closeMcpSessionsForGaii } from './session-registry.js';

export function registerOperatorServiceTools(mcp: McpServer, config: AimeatConfig, storage: Storage, caller: () => CallerContext): void {
    mcp.registerTool('aimeat_admin_service_access', {
        description: descriptionFor('aimeat_admin_service_access'), inputSchema: zodShapeFor('aimeat_admin_service_access'),
        annotations: annotationsFor('aimeat_admin_service_access'),
    }, async (args) => {
        const a = args as { action?: string; service?: string; account?: string; reason?: string; limit?: number; cursor?: string };
        const c = caller();
        // The operator read tools' gate (aimeat_admin_key_reencrypt asks the same): an operator account,
        // and its agent holding operator:admin. listing.ts then decides what that caller reads.
        if (!(await c.operator(OPERATOR_ADMIN_SCOPE))) return toolError('FORBIDDEN', OPERATOR_AGENT_REFUSAL);
        const who = { kind: c.kind, ...c.auth };
        const deps = { storage, config };
        const text = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data) }] });
        if (a.action === 'account_off' || a.action === 'account_on') {
            if (!a.service || !a.account) return toolError('INVALID_INPUT', `Action "${a.action}" needs \`service\` (the entry's id) and \`account\` (the account name).`);
            // The function PUT /v1/operator-services/{id}/accounts/{account} calls, which refuses a service's own agent.
            const out = await setServiceForAccount({ ...deps, closeMcpSessions: closeMcpSessionsForGaii },
                { ...who, principal: c.principal }, a.service, a.account,
                { on: a.action === 'account_on', ...(a.reason !== undefined ? { reason: a.reason } : {}) });
            return out.ok ? text(out.data) : toolError(out.code, out.message);
        }
        if (a.action === 'accounts') {
            if (!a.service) return toolError('INVALID_INPUT', 'Action "accounts" needs `service`: the id of an entry of agents.operator_services.');
            const out = await operatorServiceAccounts(deps, who, a.service, { limit: a.limit, cursor: a.cursor });
            return out.ok ? text(out.data) : toolError(out.code, out.message);
        }
        const out = await operatorServicesView(deps, who);
        return out.ok ? text(out.data) : toolError(out.code, out.message);
    });
}
