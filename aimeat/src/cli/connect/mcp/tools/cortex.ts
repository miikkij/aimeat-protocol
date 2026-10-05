/**
 * @file cortex.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description MCP tool registrations for cortex model lifecycle -- listing,
 *   installing, activating, deactivating, and deleting cortex models.
 * @version-history
 *   2026-10-05 — aimeat_cortex_install registers the catalog's schema: without a manifest it answers
 *     the upload offer through POST /v1/cortex (secaudit 2026-10, M3).
 *   2026-10-05 — The input schemas are the catalog's: zodShapeFor(name) (secaudit 2026-10, M3).
 *   2026-09-27 -- aimeat_cortex_list takes name (GET /v1/cortex/:name) and include_source (/export).
 *   v1.0.0 -- 2026-05-29 -- Add tool annotations (title + read/destructive/idempotent/openWorld hints)
 *     from shared annotations.ts for Connectors Directory compliance.
 *   v1.1.0 -- 2026-05-30 -- MCP audit Phase 1: tool descriptions sourced from canonical catalog via descriptionFor().
 *   v1.2.0 -- 2026-05-30 -- F10 drift reconciliation: cortex_install now takes manifest (YAML string) + libs
 *     map to match REST (connector was sending name + manifest object the route rejects).
 *   v1.3.0 -- 2026-09-13 -- aimeat_cortex_install takes update and redeploys through PUT /v1/cortex/:name
 *     (installCortexOverHttp, shared with the CLI dispatch).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AgentRegistry } from '../../agent-registry.js';
import { annotationsFor } from '../../../../mcp/annotations.js';
import { descriptionFor } from '../../../../tool-catalog/shape.js';
import { envelopeResult } from './_registry.js';
import { installCortexOverHttp } from './extensions.js';
import { zodShapeFor } from '../../../../tool-catalog/zod-shape.js';

export function registerCortexTools(mcp: McpServer, registry: AgentRegistry): void {
  const { client } = registry.resolve();

  mcp.tool('aimeat_cortex_list', descriptionFor('aimeat_cortex_list'), zodShapeFor('aimeat_cortex_list'), annotationsFor('aimeat_cortex_list'), async ({ name, include_source }) => {
    // → GET /v1/cortex, GET /v1/cortex/:name, or GET /v1/cortex/:name/export for the source.
    if (!name) return envelopeResult(await client.get('/v1/cortex'));
    const detail = await client.get(`/v1/cortex/${encodeURIComponent(name)}`);
    if (!include_source || detail.ok === false) return envelopeResult(detail);
    const source = await client.get(`/v1/cortex/${encodeURIComponent(name)}/export`);
    if (source.ok === false) return envelopeResult(source);
    return envelopeResult({ ok: true, data: { ...(detail.data as object), source: source.data } });
  });

  mcp.tool('aimeat_cortex_install', descriptionFor('aimeat_cortex_install'), zodShapeFor('aimeat_cortex_install'), annotationsFor('aimeat_cortex_install'), async ({ manifest, libs, update }) => {
    // One function with the CLI dispatch: a plain install posts, update redeploys through PUT.
    const resp = await installCortexOverHttp(client, { manifest, libs, update });
    return envelopeResult(resp);
  });

  mcp.tool('aimeat_cortex_activate', descriptionFor('aimeat_cortex_activate'), zodShapeFor('aimeat_cortex_activate'), annotationsFor('aimeat_cortex_activate'), async ({ name }) => {
    const resp = await client.post(`/v1/cortex/${encodeURIComponent(name)}/activate`);
    return envelopeResult(resp);
  });

  mcp.tool('aimeat_cortex_deactivate', descriptionFor('aimeat_cortex_deactivate'), zodShapeFor('aimeat_cortex_deactivate'), annotationsFor('aimeat_cortex_deactivate'), async ({ name }) => {
    const resp = await client.post(`/v1/cortex/${encodeURIComponent(name)}/deactivate`);
    return envelopeResult(resp);
  });

  mcp.tool('aimeat_cortex_delete', descriptionFor('aimeat_cortex_delete'), zodShapeFor('aimeat_cortex_delete'), annotationsFor('aimeat_cortex_delete'), async ({ name }) => {
    const resp = await client.delete(`/v1/cortex/${encodeURIComponent(name)}`);
    return envelopeResult(resp);
  });
}
