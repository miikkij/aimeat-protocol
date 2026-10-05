/**
 * @file apps.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description MCP tool registrations for app/package management -- publishing,
 *   listing, retrieving, archiving versions, version history, sanctioned forks, and drafts (staging).
 * @version-history
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
import { z } from 'zod';
import type { AgentRegistry } from '../../agent-registry.js';
import { annotationsFor } from '../../../../mcp/annotations.js';
import { descriptionFor } from '../../../../tool-catalog/shape.js';
import { aiProvenanceInputs } from '../../../../mcp/ai-provenance-input.js';
import { provenanceEchoedResult, readPayloadWithProvenance } from '../../../../tool-dispatch/ai-provenance-carry.js';
import { envelopeResult, payloadResult } from './_registry.js';
import { zodShapeFor } from '../../../../tool-catalog/zod-shape.js';

export function registerAppsTools(mcp: McpServer, registry: AgentRegistry): void {
  const { client, owner } = registry.resolve();
  const out = (resp: { data?: unknown; ok?: boolean }) =>
    ({ content: [{ type: 'text' as const, text: JSON.stringify(resp.data ?? resp, null, 2) }], ...(resp.ok === false ? { isError: true } : {}) });

  mcp.tool('aimeat_app_publish', descriptionFor('aimeat_app_publish'), {
    filename: z.string().describe('App filename, e.g. "starwars.html"'),
    roadmap: z.string().optional().describe('One sentence saying what this version changes, in your own words. It goes on the app roadmap, and it is REQUIRED when somebody else helps build this app.'),
    owner: z.string().optional().describe('Whose catalogue this app is in. Omit for your own; naming somebody else works only when they granted you a development right on it.'),
    content: z.string().optional().describe('The app HTML as plain text — this tool base64-encodes it for you'),
    content_base64: z.string().optional().describe('Already-encoded HTML, if you did the encoding yourself'),
    name: z.string().describe('Display name shown in the catalogue'),
    description: z.string().optional().describe('Short description'),
    category: z.string().optional().describe('Category (default "tool")'),
    tags: z.array(z.string()).optional().describe('Tags for search and filtering'),
    icon: z.string().optional().describe('Emoji icon'),
    version: z.string().optional().describe('Semver display version. Generated if omitted.'),
    cortex_agents: z.array(z.record(z.string(), z.unknown())).optional().describe('Declarative crew-defs this app ships (manifest.cortex.agents), validated at publish. Omit on update to carry them forward; [] clears.'),
    ...aiProvenanceInputs,
  }, annotationsFor('aimeat_app_publish'), async (a) => {
    const targetOwner = a.owner;
    // POST /v1/apps takes `content` base64-encoded and 400s on plain text; encode here so the
    // caller does not have to know the rule.
    const encoded = a.content_base64 ?? (a.content !== undefined ? Buffer.from(a.content, 'utf-8').toString('base64') : undefined);
    const body: Record<string, unknown> = {
      filename: a.filename, name: a.name,
      // No path to carry it on this door, so the target owner travels in the body, which is what
      // POST /v1/apps reads.
      ...(targetOwner ? { owner: targetOwner } : {}),
      ...(a.roadmap ? { roadmap: a.roadmap } : {}),
      ...(encoded !== undefined ? { content: encoded } : {}),
    };
    for (const f of ['description', 'category', 'icon', 'version'] as const) if (a[f]) body[f] = a[f];
    if (a.tags) body.tags = a.tags;
    if (a.cortex_agents) body.cortex = { agents: a.cortex_agents };
    if (a.ai_provenance_id) body.ai_provenance_id = a.ai_provenance_id;
    const resp = await client.post('/v1/apps', body);
    return provenanceEchoedResult(client,
      { tool: 'aimeat_app_publish', declared: a.ai_provenance, declaredId: a.ai_provenance_id }, resp);
  });

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

  // ───────────────────────────────────────────────────────────────────────────────────────────────
  // THE APP TOOLS TALK ABOUT APPS. Until 2026-08-16 the four below pointed at /v1/packages, a
  // separate component-package system, while the same names on the node's MCP meant the single-file
  // web apps at /v1/apps. Measured on production the day it was found: 50 apps, 4 packages, three of
  // the four being ::system examples. The split ran through this very file — aimeat_app_get read a
  // package while aimeat_app_draft_write, twenty lines down, wrote an app — so an agent that listed,
  // chose and edited crossed between two systems with nothing saying so.
  // Packages keep the capability under aimeat_package_* below.
  // ───────────────────────────────────────────────────────────────────────────────────────────────
  mcp.tool('aimeat_app_list', descriptionFor('aimeat_app_list'), zodShapeFor('aimeat_app_list'), annotationsFor('aimeat_app_list'), async ({ search, category, tag, own, building, limit, offset }) => {
    const params = new URLSearchParams();
    // GET /v1/apps reads `q`, not `search`. Sent under the wrong name the filter was dropped and the
    // whole catalogue came back as though it had been searched.
    if (search) params.set('q', search);
    if (category) params.set('category', category);
    if (tag) params.set('tag', tag);
    if (own) params.set('own', 'true');
    if (building) params.set('building', 'true');
    if (limit !== undefined) params.set('limit', String(limit));
    if (offset !== undefined) params.set('offset', String(offset));
    const qs = params.toString() ? `?${params.toString()}` : '';
    const resp = await client.get(`/v1/apps${qs}`);
    return envelopeResult(resp);
  });

  mcp.tool('aimeat_app_get', descriptionFor('aimeat_app_get'), zodShapeFor('aimeat_app_get'), annotationsFor('aimeat_app_get'), async ({ owner, filename }) => {
    // No REST route returns one app's DETAIL — GET /v1/apps/:owner/:filename serves the app's own
    // bytes — so it comes from the catalogue listing, which already carries manifest, version, size,
    // download count and public url per entry.
    const resp = await client.get(`/v1/apps?search=${encodeURIComponent(filename)}`);
    if (resp.ok === false) return out(resp);
    const apps = ((resp.data ?? {}) as { apps?: Array<Record<string, unknown>> }).apps ?? [];
    const app = apps.find(a => a.filename === filename && (a.owner === owner || a.ownerName === owner));
    if (!app) {
      return out({ ok: false, data: { error: { code: 'NOT_FOUND', message: `No app "${filename}" published by "${owner}".` } } });
    }
    return payloadResult(readPayloadWithProvenance({ ...resp, data: { app } }), resp);
  });

  // ── Component packages: the capability the app_* tools above used to be ──

  // → PUT /v1/apps/:owner/:filename/draft — stage the next version (owner resolved server-side).
  mcp.tool('aimeat_app_draft_save', descriptionFor('aimeat_app_draft_save'), {
    filename: z.string().describe('App filename, e.g. "shop.html".'),
    owner: z.string().optional().describe('Whose catalogue this app is in. Omit for your own; naming somebody else works only when they granted you a development right on it.'),
    content: z.string().describe('Base64-encoded HTML of the draft.'),
    name: z.string().optional().describe('Display name (defaults to the live app\'s).'),
    description: z.string().optional().describe('Description (defaults to the live app\'s).'),
    category: z.string().optional().describe('Category (defaults to the live app\'s).'),
    tags: z.array(z.string()).optional().describe('Tags (default: the live app\'s).'),
    icon: z.string().optional().describe('Emoji icon (defaults to the live app\'s).'),
  }, annotationsFor('aimeat_app_draft_save'), async ({ owner: targetOwner, filename, content, name, description, category, tags, icon }) => {
    const body: Record<string, unknown> = { content };
    if (name) body.name = name;
    if (description !== undefined) body.description = description;
    if (category) body.category = category;
    if (tags) body.tags = tags;
    if (icon) body.icon = icon;
    return out(await client.put(`/v1/apps/${encodeURIComponent(targetOwner ?? owner)}/${encodeURIComponent(filename)}/draft`, body));
  });

}
