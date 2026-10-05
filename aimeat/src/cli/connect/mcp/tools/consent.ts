/**
 * @file consent.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description MCP tool registrations for consent management -- granting,
 *   listing, and revoking data-sharing consent.
 * @version-history
 *   2026-10-05 — The input schemas are the catalog's: zodShapeFor(name) (secaudit 2026-10, M3).
 *   v1.0.0 -- 2026-05-29 -- Add tool annotations (title + read/destructive/idempotent/openWorld hints)
 *     from shared annotations.ts for Connectors Directory compliance.
 *   v1.1.0 -- 2026-05-30 -- MCP audit Phase 1: tool descriptions sourced from canonical catalog via descriptionFor().
 *   v1.2.0 -- 2026-05-30 -- MCP drift reconciliation: align grant input to REST source-of-truth
 *     (target_gaii/scope/data_pattern/purpose/ttl_hours; was broken — sent keys/recipient and omitted
 *     required data_pattern); rename revoke id -> consent_id to match server + REST.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AgentRegistry } from '../../agent-registry.js';
import { annotationsFor } from '../../../../mcp/annotations.js';
import { descriptionFor } from '../../../../tool-catalog/shape.js';
import { envelopeResult } from './_registry.js';
import { zodShapeFor } from '../../../../tool-catalog/zod-shape.js';

export function registerConsentTools(mcp: McpServer, registry: AgentRegistry): void {
  const { client } = registry.resolve();

  mcp.tool('aimeat_consent_grant', descriptionFor('aimeat_consent_grant'), zodShapeFor('aimeat_consent_grant'), annotationsFor('aimeat_consent_grant'), async ({ target_gaii, scope, data_pattern, purpose, ttl_hours }) => {
    const body: Record<string, unknown> = { data_pattern, recipient: target_gaii, purpose, scope };
    if (ttl_hours != null) body.expires = new Date(Date.now() + ttl_hours * 3_600_000).toISOString();
    const resp = await client.post('/v1/consent', body);
    return envelopeResult(resp);
  });

  mcp.tool('aimeat_consent_list', descriptionFor('aimeat_consent_list'), zodShapeFor('aimeat_consent_list'), annotationsFor('aimeat_consent_list'), async () => {
    const resp = await client.get('/v1/consent');
    return envelopeResult(resp);
  });

  mcp.tool('aimeat_consent_revoke', descriptionFor('aimeat_consent_revoke'), zodShapeFor('aimeat_consent_revoke'), annotationsFor('aimeat_consent_revoke'), async ({ consent_id }) => {
    const resp = await client.delete(`/v1/consent/${encodeURIComponent(consent_id)}`);
    return envelopeResult(resp);
  });
}
