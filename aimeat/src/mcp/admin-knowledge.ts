/**
 * @file src/mcp/admin-knowledge.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The operator's Knowledge page over MCP: how many packages this node holds, the
 *   SHAPE of the collection, and whether anybody has already looked at each one.
 *
 *   NOT THE SAME QUESTION AS aimeat_knowledge_list. That tool is the catalogue — what a caller may
 *   read — and it answers about packages that were published for reading. This one is the
 *   moderation view: every package on the node including the ones nobody catalogued, the counts by
 *   author, kind, maturity and visibility, and the review trail. An operator asking their own AI
 *   "what is in this node's knowledge store, and what has nobody looked at" got the catalogue and
 *   no way to tell that the answer was a subset.
 *
 *   IT CALLS services/knowledge-overview.ts, the ONE implementation GET /v1/admin/knowledge calls.
 *   The facets are counted over everything that matched rather than over the page, and a facet does
 *   not narrow its own counts, so an AI reading this can move sideways between filters instead of
 *   having to clear one before it can see the next.
 *
 *   THE IDENTITY IS THE OPERATOR'S OWN, not the calling agent's. The operator's imports are stored
 *   under their GHII, and the route resolves an owner session to `name@nodeId`; building the same
 *   string here is what makes this tool see the packages the page sees. Reading the agent's GAII
 *   instead would hide the operator's own imports from the operator, which is the defect this
 *   change fixed on the review and delete doors.
 * @structure registerAdminKnowledgeTools(mcp, storage, config, getAgentGaii, scopes) — one read.
 * @usage registerAdminKnowledgeTools(mcp, storage, config, () => agentGaii, scopes);
 * @version-history
 *   2026-10-20 — Imports the MCP SDK v2 packages (@modelcontextprotocol/server, /node, /client) in place of @modelcontextprotocol/sdk, through the official codemod (SDK v2 migration step 4b).
 *   2026-10-20 — Tools register with mcp.registerTool(name, { description, inputSchema, annotations }, handler), the form the MCP SDK v2 keeps (plan doc-mvguy322f9se, step 3). No behaviour change.
 *   2026-10-05 — The input schemas are the catalog's: zodShapeFor(name) (secaudit 2026-10, M3).
 *   v1.2.0 — 2026-09-29 — TARGET-082 V4: the overview is built with the session's classification
 *     reader (readerForAgent). The data space stays the operator's GHII; what is shown is decided for
 *     the agent that asked, so a manifest hidden from AI is not listed here.
 *   v1.1.0 — 2026-09-24 — SECURITY (audit A8-1): the operator test asks the operator:admin word as
 *     well as the account (services/owner-lifecycle.ts resolveOperatorAgentName).
 *   v1.0.0 — 2026-09-12 — Initial, with the Knowledge page's rebuild.
 */
import { McpServer } from '@modelcontextprotocol/server';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from '../tool-catalog/shape.js';
import { resolveOperatorAgentName, OPERATOR_AGENT_REFUSAL } from '../services/owner-lifecycle.js';
import { buildKnowledgeOverview } from '../services/knowledge-overview.js';
import { readerForAgent } from '../services/classification/reader.js';
import { zodShapeFor } from '../tool-catalog/zod-shape.js';

const text = (payload: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }] });
const refuse = (message: string) => ({ content: [{ type: 'text' as const, text: message }], isError: true });

export function registerAdminKnowledgeTools(
  mcp: McpServer,
  storage: Storage,
  config: AimeatConfig,
  getAgentGaii: () => string,
  /** This session's granted scopes: operator:admin is asked of them at call time. */
  scopes: readonly string[] = [],
): void {
  const agentGaii = getAgentGaii();

  mcp.registerTool('aimeat_admin_knowledge', { description: descriptionFor('aimeat_admin_knowledge'),
    inputSchema: zodShapeFor('aimeat_admin_knowledge'),
    annotations: annotationsFor('aimeat_admin_knowledge') },
    async ({ page, limit, q, author_key, content_type, flagged }) => {
      const operator = await resolveOperatorAgentName(storage, agentGaii, scopes);
      if (!operator) return refuse(OPERATOR_AGENT_REFUSAL);

      return text(await buildKnowledgeOverview(config, storage, `${operator}@${config.nodeId}`, readerForAgent({ storage, config }, agentGaii, scopes), {
        ...(page !== undefined ? { page } : {}),
        ...(limit !== undefined ? { perPage: limit } : {}),
        ...(q !== undefined ? { q } : {}),
        ...(author_key !== undefined ? { authorKey: author_key } : {}),
        ...(content_type !== undefined ? { contentType: content_type } : {}),
        ...(flagged !== undefined ? { flagged } : {}),
      }));
    });
}
