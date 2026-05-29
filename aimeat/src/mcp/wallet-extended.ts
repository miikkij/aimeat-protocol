/**
 * @file wallet-extended.ts
 * @description MCP wallet extended tools. Provides 1 tool that extends the core wallet
 *   capability: paginated transaction history retrieval.
 * @structure
 *   - registerWalletExtendedTools() — registers 1 extended wallet tool on an McpServer instance
 * @usage
 *   import { registerWalletExtendedTools } from './wallet-extended.js';
 *   registerWalletExtendedTools(mcp, storage, config, getAgentGaii, emitResourceUpdated, emitResourceListChanged);
 * @version-history
 *   v1.0.0 — 2026-03-21 — Initial creation: aimeat_wallet_transactions tool
 *   v1.1.0 -- 2026-05-29 -- Add tool annotations (title + read/destructive/idempotent/openWorld hints)
 *     from shared annotations.ts for Connectors Directory compliance.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { parseGaiiLoose } from '../utils/gaii.js';
import { annotationsFor } from './annotations.js';

export function registerWalletExtendedTools(
    mcp: McpServer,
    storage: Storage,
    config: AimeatConfig,
    getAgentGaii: () => string,
    _emitResourceUpdated: (agentGaii: string, uri: string) => void,
    _emitResourceListChanged: (agentGaii: string) => void,
): void {
    const agentGaii = getAgentGaii();

    // ── Tool 1: aimeat_wallet_transactions ──
    mcp.tool(
        'aimeat_wallet_transactions',
        'Retrieve your morsel transaction history. Transactions are keyed to the owner GHII balance.',
        {
            limit: z.number().int().min(1).max(200).optional(),
        },
        annotationsFor('aimeat_wallet_transactions'),
        async ({ limit }) => {
            const effectiveLimit = limit ?? 20;

            // Resolve to owner GHII — transactions are stored under GHII, not agent GAII
            const parsed = parseGaiiLoose(agentGaii);
            const ghiiRecord = await storage.getGHIIByOwner(parsed.owner);
            const identity = ghiiRecord ? ghiiRecord.ghii : `${parsed.owner}@${config.nodeId}`;

            const transactions = await storage.getTransactions(identity, effectiveLimit);

            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify(transactions.map(tx => ({
                        id: tx.id,
                        type: tx.type,
                        amount: tx.amount,
                        counterparty_gaii: tx.counterpartyGaii,
                        tracking_code: tx.trackingCode,
                        timestamp: tx.timestamp,
                    })), null, 2),
                }],
            };
        },
    );
}
