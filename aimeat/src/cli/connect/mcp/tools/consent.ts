/**
 * @file consent.ts
 * @description MCP tool registrations for consent management -- granting,
 *   listing, and revoking data-sharing consent.
 * @version-history
 *   v1.0.0 -- 2026-05-29 -- Add tool annotations (title + read/destructive/idempotent/openWorld hints)
 *     from shared annotations.ts for Connectors Directory compliance.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AgentRegistry } from '../../agent-registry.js';
import { annotationsFor } from '../../../../mcp/annotations.js';

export function registerConsentTools(mcp: McpServer, registry: AgentRegistry): void {
  const { client } = registry.resolve();

  mcp.tool('aimeat_consent_grant', 'Grant data-sharing consent to a recipient', {
    recipient: z.string().describe('Recipient GAII or GHII'),
    keys: z.array(z.string()).describe('Memory keys to share'),
    purpose: z.string().optional().describe('Purpose of the consent grant'),
  }, annotationsFor('aimeat_consent_grant'), async ({ recipient, keys, purpose }) => {
    const body: Record<string, unknown> = { recipient, keys };
    if (purpose) body.purpose = purpose;
    const resp = await client.post('/v1/consent', body);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_consent_list', 'List active consent grants', {}, annotationsFor('aimeat_consent_list'), async () => {
    const resp = await client.get('/v1/consent');
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_consent_revoke', 'Revoke a consent grant', {
    id: z.string().describe('Consent grant identifier'),
  }, annotationsFor('aimeat_consent_revoke'), async ({ id }) => {
    const resp = await client.delete(`/v1/consent/${encodeURIComponent(id)}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });
}
