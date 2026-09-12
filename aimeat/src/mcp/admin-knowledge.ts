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
 * @structure registerAdminKnowledgeTools(mcp, storage, config, getAgentGaii) — one read.
 * @usage registerAdminKnowledgeTools(mcp, storage, config, () => agentGaii);
 * @version-history
 *   v1.0.0 — 2026-09-12 — Initial, with the Knowledge page's rebuild.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';
import { resolveOperatorName } from '../services/owner-lifecycle.js';
import { buildKnowledgeOverview, DEFAULT_PER_PAGE, MAX_PER_PAGE } from '../services/knowledge-overview.js';

const text = (payload: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }] });
const refuse = (message: string) => ({ content: [{ type: 'text' as const, text: message }], isError: true });

export function registerAdminKnowledgeTools(
  mcp: McpServer,
  storage: Storage,
  config: AimeatConfig,
  getAgentGaii: () => string,
): void {
  const agentGaii = getAgentGaii();

  mcp.tool('aimeat_admin_knowledge', descriptionFor('aimeat_admin_knowledge'),
    {
      page: z.number().int().optional().describe('Which page of packages, from 1. A page past the end comes back as the last page rather than empty.'),
      limit: z.number().int().optional().describe(`How many packages on the page. ${DEFAULT_PER_PAGE} by default, ${MAX_PER_PAGE} at most.`),
      q: z.string().optional().describe('Free text over the name, the author and the tags.'),
      author_key: z.string().optional().describe('One author, collapsed across the spellings of their name. Take the key from facets.authors rather than typing a name: this node writes the same person as both `alice` and `alice@node-id`.'),
      content_type: z.string().optional().describe('One kind of package, as facets.kinds names it.'),
      flagged: z.boolean().optional().describe('Only packages somebody has reported.'),
    },
    annotationsFor('aimeat_admin_knowledge'),
    async ({ page, limit, q, author_key, content_type, flagged }) => {
      const operator = await resolveOperatorName(storage, agentGaii);
      if (!operator) return refuse('Operator role required');

      return text(await buildKnowledgeOverview(config, storage, `${operator}@${config.nodeId}`, {
        ...(page !== undefined ? { page } : {}),
        ...(limit !== undefined ? { perPage: limit } : {}),
        ...(q !== undefined ? { q } : {}),
        ...(author_key !== undefined ? { authorKey: author_key } : {}),
        ...(content_type !== undefined ? { contentType: content_type } : {}),
        ...(flagged !== undefined ? { flagged } : {}),
      }));
    });
}
