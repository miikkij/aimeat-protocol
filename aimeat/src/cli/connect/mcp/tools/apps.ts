/**
 * @file apps.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description MCP tool registrations for app/package management -- publishing,
 *   listing, retrieving, archiving versions, version history, sanctioned forks, and drafts (staging).
 * @version-history
 *   2026-10-06 — aimeat_app_publish, aimeat_app_list, aimeat_app_get and aimeat_app_draft_save run their
 *     dispatch definition (secaudit 2026-10 follow-up, Part B).
 *   2026-10-05 — The input schemas are the catalog's: zodShapeFor(name) (secaudit 2026-10, M3).
 *   2026-10-02 — aimeat_package_withdraw (POST /v1/packages/:groupId/versions/:version/withdraw).
 *   2026-10-02 — aimeat_package_compose_set (POST /v1/packages/compose-set); aimeat_package_install
 *     forwards `organism_names` (a set's organisms).
 *   2026-10-02 — aimeat_package_offer (GET, PUT /v1/packages/:groupId/offer) and aimeat_package_buy
 *     (/v1/package-sales/offer, /v1/commerce/checkout-sessions, /v1/package-sales/subscriptions).
 *   2026-10-01 — aimeat_package_compose forwards `outcome` and `prompts` (the package sheet).
 *   2026-09-30 — aimeat_package_compose forwards `include_skills` (the composer's own bound skills travel).
 *   2026-09-29 — aimeat_package_sellers (GET, PUT, DELETE /v1/package-sellers).
 *   2026-09-28 — aimeat_package_config_needs (GET /v1/packages/:groupId/config-needs).
 *   2026-09-28 — aimeat_package_entitlements forwards `node` (packages-only peer registered with a grant).
 *   2026-09-28 — aimeat_package_instance_set, aimeat_package_check_updates, aimeat_package_repository and
 *     aimeat_package_entitlements over their REST endpoints.
 *   2026-09-28 — aimeat_package_install sends `config`, each part's config.
 *   2026-09-28 — aimeat_package_install sends `mode` (managed | editable), as the node's own tool does;
 *     aimeat_package_instances and aimeat_package_fork over GET /v1/instances and POST /v1/instances/:id/fork.
 *   2026-09-28 — aimeat_image_generate takes `role`, the AI role the call runs as, sent to POST /v1/ai/image.
 *   2026-09-27 — Agent-facing texts use industry terms: door, surface and the house became endpoint, tool, interface, page or this server (docs/coding-guidelines/shell-and-git.md).
 *   v1.11.0 -- 2026-10-04 -- aimeat_package_install forwards `grant_apps`.
 *   v1.10.0 -- 2026-09-27 -- The versions, screenshot, seo, marks, visitors, visitors_measure, legal and
 *     audit tools moved into aimeat_app_manage (app-manage.ts).
 *   v1.9.0 -- 2026-09-25 -- aimeat_package_install_requests over GET /v1/package-install-requests(/:id)
 *     and POST /v1/package-install-requests/:id/decision.
 *   v1.8.1 -- 2026-09-13 -- aimeat_app_publish declares cortex_agents and sends them as cortex.agents,
 *     as the node's own tool has since 2026-07-16.
 *   v1.8.0 -- 2026-09-11 -- aimeat_seo_announce over POST /v1/admin/seo/indexnow (plan: true reads
 *     GET /v1/admin/seo/indexnow/plan): the whole site to the search engines, one batch per host.
 *   v1.7.0 -- 2026-08-29 -- aimeat_app_legal_set over PATCH and GET /v1/apps/me/:filename/legal,
 *     carrying ai_provenance in the body (the route records it); the audit tool (now aimeat_app_manage) over
 *     GET /v1/apps/me/:filename/audit?limit=N.
 *   v1.6.0 -- 2026-08-29 -- aimeat_app_marks_set: the badge and install-chip switches over PATCH.
 *   v1.5.0 -- 2026-08-23 -- aimeat_package_install, and aimeat_package_publish given the route's own
 *     parameters. Publish declared {name, description, content} while POST /v1/packages requires a
 *     `components` array and reads no `content`, so every call it described was answered 400.
 *   v1.4.0 -- 2026-08-01 -- TARGET-058 Phase 11b: aimeat_app_get folds meta.provenance.
 *   v1.3.0 -- 2026-08-01 -- TARGET-058 Phase 11: aimeat_app_publish / aimeat_app_draft_publish
 *     carry `ai_provenance` / `ai_provenance_id` and echo what was recorded.
 *   v1.2.0 -- 2026-07-19 -- Connector reachability: add aimeat_app_fork + app draft save/publish/discard
 *     (thin proxies to /v1/apps/:owner/:filename/fork | /draft | /publish-draft).
 *   v1.0.0 -- 2026-05-29 -- Add tool annotations (title + read/destructive/idempotent/openWorld hints)
 *     from shared annotations.ts for Connectors Directory compliance.
 *   v1.1.0 -- 2026-05-30 -- MCP audit Phase 1: tool descriptions sourced from canonical catalog via descriptionFor().
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AgentRegistry } from '../../agent-registry.js';
import { annotationsFor } from '../../../../mcp/annotations.js';
import { descriptionFor } from '../../../../tool-catalog/shape.js';
import { zodShapeFor } from '../../../../tool-catalog/zod-shape.js';

export function registerAppsTools(mcp: McpServer, registry: AgentRegistry): void {
  const { client } = registry.resolve();
  const out = (resp: { data?: unknown; ok?: boolean }) =>
    ({ content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }], ...(resp.ok === false ? { isError: true } : {}) });

  // An install that needed words this agent lacked came back as a request (202, awaiting_owner).
  // This lists the owner's requests and lets an agent of theirs answer one, on the node's own rule.
  mcp.tool('aimeat_package_install_requests', descriptionFor('aimeat_package_install_requests'), zodShapeFor('aimeat_package_install_requests'), annotationsFor('aimeat_package_install_requests'), async ({ request_id, decision }) => {
    if (decision !== undefined) {
      if (!request_id) {
        return { content: [{ type: 'text' as const, text: 'INVALID_INPUT: Name the request to decide with request_id. List them by calling this tool with no arguments.' }], isError: true };
      }
      return out(await client.post(`/v1/package-install-requests/${encodeURIComponent(request_id)}/decision`, { decision }));
    }
    if (request_id) return out(await client.get(`/v1/package-install-requests/${encodeURIComponent(request_id)}`));
    return out(await client.get('/v1/package-install-requests'));
  });
}
