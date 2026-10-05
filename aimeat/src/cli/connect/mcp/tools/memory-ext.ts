/**
 * @file memory-ext.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description MCP tool registration for reading another agent's public memory
 *   entries via the cross-identity memory endpoint.
 * @version-history
 *   2026-10-05 — The input schemas are the catalog's: zodShapeFor(name) (secaudit 2026-10, M3).
 *   v1.0.0 -- 2026-05-29 -- Add tool annotations (title + read/destructive/idempotent/openWorld hints)
 *     from shared annotations.ts for Connectors Directory compliance.
 *   v1.1.0 -- 2026-05-30 -- MCP audit Phase 1: tool descriptions sourced from canonical catalog via descriptionFor().
 *   v1.2.0 -- 2026-09-30 -- aimeat_memory_read_public folds the envelope's meta.provenance onto its
 *     payload (readPayloadWithProvenance), as aimeat_memory_read does: the plain unwrap handed on the
 *     provenance id and dropped the statement the route served (TARGET-082 review).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AgentRegistry } from '../../agent-registry.js';
import { annotationsFor } from '../../../../mcp/annotations.js';
import { descriptionFor } from '../../../../tool-catalog/shape.js';
import { readPayloadWithProvenance } from '../../../../tool-dispatch/ai-provenance-carry.js';
import { payloadResult } from './_registry.js';
import { zodShapeFor } from '../../../../tool-catalog/zod-shape.js';

export function registerMemoryExtTools(mcp: McpServer, registry: AgentRegistry): void {
  const { client } = registry.resolve();

  mcp.tool('aimeat_memory_read_public', descriptionFor('aimeat_memory_read_public'), zodShapeFor('aimeat_memory_read_public'), annotationsFor('aimeat_memory_read_public'), async ({ gaii, key }) => {
    const resp = await client.get(
      `/v1/memory/${encodeURIComponent(gaii)}/${encodeURIComponent(key)}`,
    );
    // The route serves the record's provenance on the envelope (meta.provenance); the fold keeps it.
    return payloadResult(readPayloadWithProvenance(resp), resp);
  });
}
