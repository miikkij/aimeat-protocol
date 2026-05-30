/**
 * @file consent.ts
 * @description MCP tool registrations for consent management -- granting,
 *   listing, and revoking data-sharing consent.
 * @version-history
 *   v1.0.0 -- 2026-05-29 -- Add tool annotations (title + read/destructive/idempotent/openWorld hints)
 *     from shared annotations.ts for Connectors Directory compliance.
 *   v1.1.0 -- 2026-05-30 -- MCP audit Phase 1: tool descriptions sourced from canonical catalog via descriptionFor().
 *   v1.2.0 -- 2026-05-30 -- MCP drift reconciliation: align grant input to REST source-of-truth
 *     (target_gaii/scope/data_pattern/purpose/ttl_hours; was broken — sent keys/recipient and omitted
 *     required data_pattern); rename revoke id -> consent_id to match server + REST.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AgentRegistry } from '../../agent-registry.js';
import { annotationsFor } from '../../../../mcp/annotations.js';
import { descriptionFor } from '../../../../mcp/catalog/shape.js';

export function registerConsentTools(mcp: McpServer, registry: AgentRegistry): void {
  const { client } = registry.resolve();

  mcp.tool('aimeat_consent_grant', descriptionFor('aimeat_consent_grant'), {
    target_gaii: z.string().describe('Recipient GAII, "*", or prefixed identifier (organism.x, ghii:, domain:, node:)'),
    scope: z.enum(['private', 'dmz', 'federation']).describe('Consent scope zone'),
    data_pattern: z.string().describe('Glob pattern for data keys (e.g. "profile.*")'),
    purpose: z.string().describe('Human-readable purpose for this consent'),
    ttl_hours: z.number().optional().describe('Expiry in hours from now (omit for indefinite)'),
  }, annotationsFor('aimeat_consent_grant'), async ({ target_gaii, scope, data_pattern, purpose, ttl_hours }) => {
    const body: Record<string, unknown> = { data_pattern, recipient: target_gaii, purpose, scope };
    if (ttl_hours != null) body.expires = new Date(Date.now() + ttl_hours * 3_600_000).toISOString();
    const resp = await client.post('/v1/consent', body);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_consent_list', descriptionFor('aimeat_consent_list'), {}, annotationsFor('aimeat_consent_list'), async () => {
    const resp = await client.get('/v1/consent');
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });

  mcp.tool('aimeat_consent_revoke', descriptionFor('aimeat_consent_revoke'), {
    consent_id: z.string().describe('ID of the consent to revoke'),
  }, annotationsFor('aimeat_consent_revoke'), async ({ consent_id }) => {
    const resp = await client.delete(`/v1/consent/${encodeURIComponent(consent_id)}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }] };
  });
}
