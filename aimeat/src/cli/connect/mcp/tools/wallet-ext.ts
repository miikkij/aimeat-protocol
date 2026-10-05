/**
 * @file wallet-ext.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description MCP tool registration for wallet transaction history.
 * @version-history
 *   2026-10-05 — The input schemas are the catalog's: zodShapeFor(name) (secaudit 2026-10, M3).
 *   v1.0.0 -- 2026-05-29 -- Add tool annotations (title + read/destructive/idempotent/openWorld hints)
 *     from shared annotations.ts for Connectors Directory compliance.
 *   v1.1.0 -- 2026-05-30 -- MCP audit Phase 1: tool descriptions sourced from canonical catalog via descriptionFor().
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AgentRegistry } from '../../agent-registry.js';
import { annotationsFor } from '../../../../mcp/annotations.js';
import { descriptionFor } from '../../../../tool-catalog/shape.js';
import { envelopeResult } from './_registry.js';
import { zodShapeFor } from '../../../../tool-catalog/zod-shape.js';

export function registerWalletExtTools(mcp: McpServer, registry: AgentRegistry): void {
  const { client } = registry.resolve();

  mcp.tool('aimeat_wallet_transactions', descriptionFor('aimeat_wallet_transactions'), zodShapeFor('aimeat_wallet_transactions'), annotationsFor('aimeat_wallet_transactions'), async ({ limit }) => {
    const qs = limit !== undefined ? `?limit=${limit}` : '';
    const resp = await client.get(`/v1/wallet/transactions${qs}`);
    return envelopeResult(resp);
  });
}
