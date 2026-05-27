/**
 * @file wallet-ext.ts
 * @description MCP tool registration for wallet transaction history.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatClient } from '../../api-client.js';

export function registerWalletExtTools(mcp: McpServer, client: AimeatClient): void {

  mcp.tool('aimeat_wallet_transactions', 'View morsel wallet transaction history', {
    limit: z.number().optional().describe('Maximum transactions to return'),
  }, async ({ limit }) => {
    const qs = limit !== undefined ? `?limit=${limit}` : '';
    const resp = await client.get(`/v1/wallet/transactions${qs}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });
}
