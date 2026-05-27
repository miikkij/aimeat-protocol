/**
 * @file consent.ts
 * @description MCP tool registrations for consent management -- granting,
 *   listing, and revoking data-sharing consent.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatClient } from '../../api-client.js';

export function registerConsentTools(mcp: McpServer, client: AimeatClient): void {

  mcp.tool('aimeat_consent_grant', 'Grant data-sharing consent to a recipient', {
    recipient: z.string().describe('Recipient GAII or GHII'),
    keys: z.array(z.string()).describe('Memory keys to share'),
    purpose: z.string().optional().describe('Purpose of the consent grant'),
  }, async ({ recipient, keys, purpose }) => {
    const body: Record<string, unknown> = { recipient, keys };
    if (purpose) body.purpose = purpose;
    const resp = await client.post('/v1/consent', body);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_consent_list', 'List active consent grants', {}, async () => {
    const resp = await client.get('/v1/consent');
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_consent_revoke', 'Revoke a consent grant', {
    id: z.string().describe('Consent grant identifier'),
  }, async ({ id }) => {
    const resp = await client.delete(`/v1/consent/${encodeURIComponent(id)}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });
}
