/**
 * @file appdev.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Connector MCP registrations for the AppDev research KB + app-template + IAM tools —
 *   parity with the server MCP (src/mcp/appdev-overview.ts, appdev-pitfalls.ts, appdev-proofs.ts,
 *   app-template-proposals.ts, services/iam) so `aimeat connect serve --surface appdev|agent` exposes
 *   the same set locally. Thin REST proxies: dedicated /v1/appdev/* routes where they exist, and the
 *   generic POST /v1/memory (memory:write authz unchanged) for the report/propose/proof memory records
 *   the server MCP writes directly (the manifest side-index those tools also maintain is a server-only
 *   nicety the shell path skips). The proof attach reads before it writes, because that ledger is
 *   append-only. iam_define is pure-local computation (no node round-trip).
 * @structure registerAppdevTools() -- one mcp.tool() per appdev capability. The proof attach delegates
 *   to attachProofOverHttp() in tool-call-defs-apps.ts, which the shell path calls as well.
 * @usage registerAppdevTools(mcp, registry);
 * @version-history
 *   2026-10-06 — aimeat_iam_define runs its dispatch definition (secaudit 2026-10 follow-up, Part B).
 *   2026-10-05 — The input schemas are the catalog's: zodShapeFor(name) (secaudit 2026-10, M3).
 *   v1.2.0 -- 2026-10-01 -- aimeat_iam_define takes default_role, version, author and ext_name, as the
 *     node MCP tool and the CLI dispatch do (audit 2026-10-01, defect B).
 *   v1.1.1 -- 2026-09-13 -- appdev_overview's model parameter is described as ordering, not filtering.
 *     pitfall_report posts to POST /v1/appdev/pitfalls/learned instead of writing raw memory.
 *   v1.1.0 -- 2026-08-11 -- proof_attach takes the node's own parameters (subject_type, verdict,
 *     evidence, test_set, tokens) and appends a ContributionProof to the ledger instead of setting a
 *     one-entry array in a shape the reader ignores. The append itself is shared with the shell door.
 *   v1.0.0 -- 2026-07-19 -- Initial: appdev_overview, pitfall report/list/delete, proof_attach,
 *     app_template propose/list/get/delete, iam_define — connector-surface coverage.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AgentRegistry } from '../../agent-registry.js';
import { annotationsFor } from '../../../../mcp/annotations.js';
import { descriptionFor } from '../../../../tool-catalog/shape.js';
import { zodShapeFor } from '../../../../tool-catalog/zod-shape.js';

export function registerAppdevTools(mcp: McpServer, registry: AgentRegistry): void {
  const { client } = registry.resolve();
  const out = (resp: { data?: unknown; ok?: boolean }) =>
    ({ content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }], ...(resp.ok === false ? { isError: true } : {}) });

  mcp.tool('aimeat_appdev_overview', descriptionFor('aimeat_appdev_overview'), zodShapeFor('aimeat_appdev_overview'), annotationsFor('aimeat_appdev_overview'), async ({ model, sections }) => {
    const params = new URLSearchParams();
    if (model) params.set('model', model);
    // The node takes a list; the route reads it comma-separated.
    if (sections?.length) params.set('sections', sections.join(','));
    const qs = params.toString();
    return out(await client.get(`/v1/appdev/overview${qs ? '?' + qs : ''}`));
  });

  mcp.tool('aimeat_appdev_pitfall_list', descriptionFor('aimeat_appdev_pitfall_list'), {
    include_shared: z.boolean().optional().describe('Also include other owners\' public-shared entries.'),
  }, annotationsFor('aimeat_appdev_pitfall_list'), async ({ include_shared }) => {
    return out(await client.get(`/v1/appdev/pitfalls/learned${include_shared ? '?include_shared=1' : ''}`));
  });

  // Propose/upsert an app template — server MCP validates + writes template.catalog.{id}.manifest;
  // the connector writes that same owner memory record via POST /v1/memory.
  mcp.tool('aimeat_app_template_propose', descriptionFor('aimeat_app_template_propose'), {
    id: z.string().describe('Stable kebab-case template id (re-proposing updates it).'),
    title: z.string().describe('Template title.'),
    description: z.string().describe('What this template is for.'),
    owner: z.string().describe('Your own owner name (source app owner).'),
    filename: z.string().describe('The published app this template distills.'),
    tier: z.enum(['T1', 'T2', 'T3']).optional().describe('T1 pure client · T2 +cortex · T3 +extension.'),
    reuse_notes: z.string().describe('What generalizes — the parts a next build should keep.'),
    model: z.string().describe('YOUR OWN model id (self-identify; indicative).'),
    tags: z.array(z.string()).optional().describe('Optional tags.'),
    start_mode: z.enum(['fork', 'scaffold', 'either']).optional().describe('How the next build should start (default either).'),
  }, annotationsFor('aimeat_app_template_propose'), async ({ id, title, description, owner, filename, tier, reuse_notes, model, tags, start_mode }) => {
    const value = {
      id, title, description, derivedFrom: { owner, filename }, tier: tier ?? 'T1',
      reuseNotes: reuse_notes, model: model.trim().toLowerCase(), tags: tags ?? [], startMode: start_mode ?? 'either',
      updatedAt: new Date().toISOString(),
    };
    return out(await client.post('/v1/memory', { key: `template.catalog.${id}.manifest`, value, visibility: 'owner', tags: ['app-template'] }));
  });
}
