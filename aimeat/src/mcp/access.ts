/**
 * @file src/mcp/access.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The read side of the Access page for the chat path: aimeat_access_list says, in one
 *   answer, who holds a key to the person's account and how far each key reaches — the apps and
 *   their rights, the tokens and their levels, the accounts connected elsewhere, the sign-in state
 *   (password, two-step, passkeys, open sessions) without any secret. Until 2026-09-05 an AI could
 *   list the person's consents and connections but had no way to answer "which apps act in my name",
 *   and a capability reachable only by clicking is not finished.
 *
 *   ONE IMPLEMENTATION. It calls the SAME service GET /v1/access/overview calls, so the owner
 *   scoping and the shaping happen once, where they were written. Read-only: revoking a key stays
 *   on the page, by the person's own hand.
 *
 *   BEHIND account:security. The words in the answer are the person's whole attack surface, and
 *   that scope is the one no wildcard carries — an owner ticks it per agent (utils/scope-coverage.ts).
 * @structure registerAccessTools(mcp, storage, config, getAgentGaii)
 * @usage registerAccessTools(mcp, storage, config, agentGaii) — from mcp/register-all.ts
 * @version-history
 *   v1.0.0 — 2026-09-05 — Initial (design canvas "AIMEAT Pääsy-sivu", decision 8).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';
import { createAccessTabService } from '../services/db/access-tab-db-service.js';
import { ownerGhiiOf } from '../utils/gaii.js';

export function registerAccessTools(
    mcp: McpServer,
    storage: Storage,
    config: AimeatConfig,
    getAgentGaii: () => string,
): void {
    const accessDb = createAccessTabService(storage, config);

    mcp.tool('aimeat_access_list', descriptionFor('aimeat_access_list'), {}, annotationsFor('aimeat_access_list'), async () => {
        // The human behind this session, whichever principal is speaking: the keys are the owner's,
        // and an agent asking about "my access" is asking about the account it acts within.
        const ownerGhii = ownerGhiiOf(getAgentGaii());
        const ownerName = ownerGhii.split('@')[0];
        // No session id: a tool call is not one of the person's browser sessions, so nothing is
        // marked "current". The list still says how many are open and on which devices.
        const data = await accessDb.overview(ownerName, ownerGhii, undefined);
        return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
    });
}
