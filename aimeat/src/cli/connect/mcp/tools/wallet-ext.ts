/**
 * @file wallet-ext.ts
 * @description MCP tool registration for wallet transaction history.
 * @version-history
 *   v1.0.0 -- 2026-05-29 -- Add tool annotations (title + read/destructive/idempotent/openWorld hints)
 *     from shared annotations.ts for Connectors Directory compliance.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AgentRegistry } from '../../agent-registry.js';
import { annotationsFor } from '../../../../mcp/annotations.js';

export function registerWalletExtTools(mcp: McpServer, registry: AgentRegistry): void {
  const { client } = registry.resolve();

  mcp.tool('aimeat_wallet_transactions', 'View morsel wallet transaction history', {
    limit: z.number().optional().describe('Maximum transactions to return'),
  }, annotationsFor('aimeat_wallet_transactions'), async ({ limit }) => {
    const qs = limit !== undefined ? `?limit=${limit}` : '';
    const resp = await client.get(`/v1/wallet/transactions${qs}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });
}
