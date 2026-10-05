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

  // POST /v1/packages takes a `components` ARRAY and reads no `content` field at all. This tool
  // declared {name, description, content} from the day it was split out, so every call it described
  // was answered 400 INVALID_INPUT ("components must be an array with at least 1 item") — the tool
  // was published, callable, and could not succeed. The parameters below are the route's own.
  mcp.tool('aimeat_package_publish', descriptionFor('aimeat_package_publish'), zodShapeFor('aimeat_package_publish'), annotationsFor('aimeat_package_publish'), async ({ name, description, category, tags, visibility, components, manifest }) => {
    const body: Record<string, unknown> = { name, components };
    if (description !== undefined) body.description = description;
    if (category !== undefined) body.category = category;
    if (tags !== undefined) body.tags = tags;
    if (visibility !== undefined) body.visibility = visibility;
    if (manifest !== undefined) body.manifest = manifest;
    return out(await client.post('/v1/packages', body));
  });

  mcp.tool('aimeat_package_install', descriptionFor('aimeat_package_install'), zodShapeFor('aimeat_package_install'), annotationsFor('aimeat_package_install'), async ({ group_id, label, version, dry_run, mode, config, organism_names, grant_apps }) => {
    const body: Record<string, unknown> = {};
    if (label !== undefined) body.label = label;
    if (version !== undefined) body.version = version;
    if (dry_run !== undefined) body.dry_run = dry_run;
    if (mode !== undefined) body.mode = mode;
    if (config !== undefined) body.config = config;
    if (organism_names !== undefined) body.organism_names = organism_names;
    if (grant_apps !== undefined) body.grant_apps = grant_apps;
    return out(await client.post(`/v1/packages/${encodeURIComponent(group_id)}/install`, body));
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

  // The installed copies, which update and fork both address by id.
  mcp.tool('aimeat_package_instances', descriptionFor('aimeat_package_instances'), zodShapeFor('aimeat_package_instances'), annotationsFor('aimeat_package_instances'), async ({ group_id, status }) => {
    const qs = new URLSearchParams();
    if (group_id !== undefined) qs.set('packageGroupId', group_id);
    if (status !== undefined) qs.set('status', status);
    const q = qs.toString();
    return out(await client.get(`/v1/instances${q ? `?${q}` : ''}`));
  });

  mcp.tool('aimeat_package_instance_set', descriptionFor('aimeat_package_instance_set'), zodShapeFor('aimeat_package_instance_set'), annotationsFor('aimeat_package_instance_set'), async ({ instance_id, label, auto_update }) => {
    const body: Record<string, unknown> = {};
    if (label !== undefined) body.label = label;
    if (auto_update !== undefined) body.auto_update = auto_update;
    return out(await client.patch(`/v1/instances/${encodeURIComponent(instance_id)}`, body));
  });

  mcp.tool('aimeat_package_check_updates', descriptionFor('aimeat_package_check_updates'), zodShapeFor('aimeat_package_check_updates'),
    annotationsFor('aimeat_package_check_updates'), async () => out(await client.post('/v1/instances/check-updates', {})));

  mcp.tool('aimeat_package_repository', descriptionFor('aimeat_package_repository'), zodShapeFor('aimeat_package_repository'), annotationsFor('aimeat_package_repository'), async ({ node_id }) =>
    out(await client.get(`/v1/federation/peers/${encodeURIComponent(node_id)}/packages`)));

  mcp.tool('aimeat_package_entitlements', descriptionFor('aimeat_package_entitlements'), zodShapeFor('aimeat_package_entitlements'), annotationsFor('aimeat_package_entitlements'), async ({ group_id, action, node_id, updates_until, channel, note, node }) => {
    const base = `/v1/packages/${encodeURIComponent(group_id)}/entitlements`;
    if (action === 'list') return out(await client.get(base));
    if (!node_id) return { content: [{ type: 'text' as const, text: `INVALID_INPUT: action "${action}" needs node_id.` }], isError: true };
    const nodePath = `${base}/${encodeURIComponent(node_id)}`;
    if (action === 'revoke') return out(await client.delete(nodePath));
    const body: Record<string, unknown> = {};
    if (updates_until !== undefined) body.updates_until = updates_until;
    if (channel !== undefined) body.channel = channel;
    if (note !== undefined) body.note = note;
    if (node !== undefined) body.node = node;
    return out(await client.put(nodePath, body));
  });

  mcp.tool('aimeat_package_sellers', descriptionFor('aimeat_package_sellers'), zodShapeFor('aimeat_package_sellers'), annotationsFor('aimeat_package_sellers'), async ({ action, node_id, node, note }) => {
    if (action === 'list') return out(await client.get('/v1/package-sellers'));
    if (!node_id) return { content: [{ type: 'text' as const, text: `INVALID_INPUT: action "${action}" needs node_id.` }], isError: true };
    const path = `/v1/package-sellers/${encodeURIComponent(node_id)}`;
    if (action === 'remove') return out(await client.delete(path));
    const body: Record<string, unknown> = {};
    if (node !== undefined) body.node = node;
    if (note !== undefined) body.note = note;
    return out(await client.put(path, body));
  });

  // The author's terms on a repository (GET, PUT /v1/packages/:groupId/offer).
  mcp.tool('aimeat_package_offer', descriptionFor('aimeat_package_offer'), zodShapeFor('aimeat_package_offer'), annotationsFor('aimeat_package_offer'), async ({ group_id, action, terms, state }) => {
    if (action === 'get') return out(await client.get(`/v1/packages/${encodeURIComponent(group_id)}/offer`));
    const body: Record<string, unknown> = {};
    if (terms !== undefined) body.terms = terms;
    if (state !== undefined) body.state = state;
    return out(await client.put(`/v1/packages/${encodeURIComponent(group_id)}/offer`, body));
  });

  // A purchase on the node that sells (GET /v1/package-sales/offer, POST /v1/commerce/checkout-sessions,
  // GET /v1/package-sales/subscriptions, PUT /v1/package-sales/subscriptions/auto-renew).
  mcp.tool('aimeat_package_buy', descriptionFor('aimeat_package_buy'), zodShapeFor('aimeat_package_buy'), annotationsFor('aimeat_package_buy'), async (input) => {
    const repository = input.repository ?? '';
    const groupId = input.group_id ?? '';
    if (input.action === 'subscriptions') return out(await client.get('/v1/package-sales/subscriptions'));
    if (input.action === 'auto_renew') {
      return out(await client.put('/v1/package-sales/subscriptions/auto-renew', { repository, group_id: groupId, node_id: input.node_id, auto_renew: input.auto_renew }));
    }
    const view = await client.get(`/v1/package-sales/offer?${new URLSearchParams({ repository, group_id: groupId }).toString()}`);
    if (input.action === 'offer' || view.ok === false) return out(view);
    const currency = ((view.data ?? {}) as { buy?: { currency?: string } }).buy?.currency;
    return out(await client.post('/v1/commerce/checkout-sessions', {
      ...(currency ? { currency } : {}),
      items: [{
        kind: 'package', agent: repository, app: groupId,
        offer_id: input.action === 'renew' ? `renew:${input.node_id ?? ''}` : 'buy',
        input: { ...(input.node ? { node: input.node } : {}), ...(input.auto_renew ? { auto_renew: true } : {}) },
      }],
    }));
  });

  mcp.tool('aimeat_package_config_needs', descriptionFor('aimeat_package_config_needs'), zodShapeFor('aimeat_package_config_needs'), annotationsFor('aimeat_package_config_needs'), async ({ group_id }) =>
    out(await client.get(`/v1/packages/${encodeURIComponent(group_id)}/config-needs`)));

  // Releasing a managed install: it becomes editable in place and its updates stop.
  mcp.tool('aimeat_package_fork', descriptionFor('aimeat_package_fork'), zodShapeFor('aimeat_package_fork'), annotationsFor('aimeat_package_fork'), async ({ instance_id }) =>
    out(await client.post(`/v1/instances/${encodeURIComponent(instance_id)}/fork`, {})));

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

  mcp.tool('aimeat_app_delete', descriptionFor('aimeat_app_delete'), zodShapeFor('aimeat_app_delete'), annotationsFor('aimeat_app_delete'), async ({ filename, version }) => {
    const qs = version !== undefined ? `?version=${encodeURIComponent(String(version))}` : '';
    const resp = await client.delete(`/v1/apps/${encodeURIComponent(filename)}${qs}`);
    return envelopeResult(resp);
  });

  // ── Component packages: the capability the app_* tools above used to be ──
  // The search parameter was `query` sent as `?q=`, against a route that reads `?search=`. A
  // filtered call therefore returned the unfiltered list and reported success. Both halves now use
  // the route's own names.
  mcp.tool('aimeat_package_list', descriptionFor('aimeat_package_list'), zodShapeFor('aimeat_package_list'), annotationsFor('aimeat_package_list'), async ({ search, author, status }) => {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (author) params.set('author', author);
    if (status) params.set('status', status);
    const qs = params.size > 0 ? `?${params.toString()}` : '';
    const resp = await client.get(`/v1/packages${qs}`);
    return envelopeResult(resp);
  });

  // Making a package out of apps that already exist, instead of pasting every component by hand.
  mcp.tool('aimeat_package_compose', descriptionFor('aimeat_package_compose'), zodShapeFor('aimeat_package_compose'), annotationsFor('aimeat_package_compose'), async (args) => {
    const body: Record<string, unknown> = { name: args.name, apps: args.apps };
    for (const key of ['description', 'category', 'tags', 'visibility', 'status', 'include_cortex', 'include_skills', 'allow_expectations', 'outcome', 'prompts'] as const) {
      if (args[key] !== undefined) body[key] = args[key];
    }
    const resp = await client.post('/v1/packages/compose', body);
    return envelopeResult(resp);
  });

  // Taking a bad version back (POST /v1/packages/:groupId/versions/:version/withdraw).
  mcp.tool('aimeat_package_withdraw', descriptionFor('aimeat_package_withdraw'), zodShapeFor('aimeat_package_withdraw'), annotationsFor('aimeat_package_withdraw'), async ({ group_id, version, reason }) =>
    envelopeResult(await client.post(`/v1/packages/${encodeURIComponent(group_id)}/versions/${encodeURIComponent(version)}/withdraw`, { reason })));

  // A set to sell: one package per app and the install bundle (POST /v1/packages/compose-set).
  mcp.tool('aimeat_package_compose_set', descriptionFor('aimeat_package_compose_set'), zodShapeFor('aimeat_package_compose_set'), annotationsFor('aimeat_package_compose_set'), async (args) => {
    const body: Record<string, unknown> = { name: args.name, apps: args.apps };
    for (const key of ['title', 'organism', 'defaults', 'description', 'category', 'tags', 'visibility', 'include_cortex', 'include_skills', 'allow_expectations', 'outcome', 'prompts', 'dry_run'] as const) {
      if (args[key] !== undefined) body[key] = args[key];
    }
    return envelopeResult(await client.post('/v1/packages/compose-set', body));
  });

  // Bringing a package in from another node, signature and digests checked before anything lands.
  mcp.tool('aimeat_package_pull', descriptionFor('aimeat_package_pull'), zodShapeFor('aimeat_package_pull'), annotationsFor('aimeat_package_pull'), async (args) => {
    const body: Record<string, unknown> = { group_id: args.group_id };
    for (const key of ['node_id', 'source_url', 'trust', 'version'] as const) {
      if (args[key] !== undefined) body[key] = args[key];
    }
    const resp = await client.post('/v1/federation/packages/pull', body);
    return envelopeResult(resp);
  });

  // One act for a whole installed package. What the owner edited is reported, never overwritten.
  mcp.tool('aimeat_package_update', descriptionFor('aimeat_package_update'), zodShapeFor('aimeat_package_update'), annotationsFor('aimeat_package_update'), async ({ instance_id, dry_run }) => {
    const body: Record<string, unknown> = {};
    if (dry_run !== undefined) body.dry_run = dry_run;
    const resp = await client.post(`/v1/instances/${encodeURIComponent(instance_id)}/update`, body);
    return envelopeResult(resp);
  });

  // A package is created private; this is the act that makes it installable. It existed on no MCP
  // or CLI surface until now, so publishing left a package its own author could not see.
  mcp.tool('aimeat_package_status_set', descriptionFor('aimeat_package_status_set'), zodShapeFor('aimeat_package_status_set'), annotationsFor('aimeat_package_status_set'), async ({ group_id, version, status }) => {
    const body: Record<string, unknown> = { status };
    if (version !== undefined) body.version = version;
    const resp = await client.patch(`/v1/packages/${encodeURIComponent(group_id)}/status`, body);
    return envelopeResult(resp);
  });

  mcp.tool('aimeat_package_get', descriptionFor('aimeat_package_get'), zodShapeFor('aimeat_package_get'), annotationsFor('aimeat_package_get'), async ({ group_id }) => {
    const resp = await client.get(`/v1/packages/${encodeURIComponent(group_id)}`);
    return payloadResult(readPayloadWithProvenance(resp), resp);
  });

  mcp.tool('aimeat_package_versions', descriptionFor('aimeat_package_versions'), zodShapeFor('aimeat_package_versions'), annotationsFor('aimeat_package_versions'), async ({ group_id }) => {
    const resp = await client.get(`/v1/packages/${encodeURIComponent(group_id)}/versions`);
    return envelopeResult(resp);
  });

  mcp.tool('aimeat_package_delete', descriptionFor('aimeat_package_delete'), zodShapeFor('aimeat_package_delete'), annotationsFor('aimeat_package_delete'), async ({ group_id, version }) => {
    const resp = await client.delete(
      `/v1/packages/${encodeURIComponent(group_id)}/versions/${encodeURIComponent(version)}`,
    );
    return envelopeResult(resp);
  });

  // → POST /v1/apps/:owner/:filename/fork — sanctioned, provenance-recording fork (behind the forkable/paid gates).
  mcp.tool('aimeat_app_fork', descriptionFor('aimeat_app_fork'), zodShapeFor('aimeat_app_fork'), annotationsFor('aimeat_app_fork'), async ({ owner: srcOwner, filename, new_filename, version }) => {
    const body: Record<string, unknown> = { new_filename };
    if (version !== undefined) body.version = version;
    return out(await client.post(`/v1/apps/${encodeURIComponent(srcOwner)}/${encodeURIComponent(filename)}/fork`, body));
  });

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

  // → POST /v1/apps/:owner/:filename/draft/write — append a piece of the draft, or replace it.
  //   Plain text rather than base64: the caller is composing HTML, not moving a file.
  mcp.tool('aimeat_app_draft_write', descriptionFor('aimeat_app_draft_write'), zodShapeFor('aimeat_app_draft_write'), annotationsFor('aimeat_app_draft_write'), async ({ owner: targetOwner, filename, content, mode, expected_size_bytes, name, description }) => {
    const body: Record<string, unknown> = { content };
    if (mode) body.mode = mode;
    if (expected_size_bytes !== undefined) body.expected_size_bytes = expected_size_bytes;
    if (name) body.name = name;
    if (description !== undefined) body.description = description;
    return out(await client.post(`/v1/apps/${encodeURIComponent(targetOwner ?? owner)}/${encodeURIComponent(filename)}/draft/write`, body));
  });

  // → POST /v1/apps/:owner/:filename/draft/replace — exact old → new inside the draft.
  mcp.tool('aimeat_app_draft_replace', descriptionFor('aimeat_app_draft_replace'), zodShapeFor('aimeat_app_draft_replace'), annotationsFor('aimeat_app_draft_replace'), async ({ owner: targetOwner, filename, old_string, new_string, replace_all }) => {
    const body: Record<string, unknown> = { old_string, new_string };
    if (replace_all) body.replace_all = true;
    return out(await client.post(`/v1/apps/${encodeURIComponent(targetOwner ?? owner)}/${encodeURIComponent(filename)}/draft/replace`, body));
  });

  // → GET /v1/apps/:owner/:filename/draft/lines — a line range, not the whole slot.
  mcp.tool('aimeat_app_draft_read', descriptionFor('aimeat_app_draft_read'), zodShapeFor('aimeat_app_draft_read'), annotationsFor('aimeat_app_draft_read'), async ({ owner: targetOwner, filename, offset, limit }) => {
    const qs = new URLSearchParams();
    if (offset !== undefined) qs.set('offset', String(offset));
    if (limit !== undefined) qs.set('limit', String(limit));
    const query = qs.toString() ? `?${qs.toString()}` : '';
    return out(await client.get(`/v1/apps/${encodeURIComponent(targetOwner ?? owner)}/${encodeURIComponent(filename)}/draft/lines${query}`));
  });

  // → POST /v1/apps/:owner/:filename/draft/seed — copy a published version into the slot.
  mcp.tool('aimeat_app_draft_seed', descriptionFor('aimeat_app_draft_seed'), zodShapeFor('aimeat_app_draft_seed'), annotationsFor('aimeat_app_draft_seed'), async ({ owner: targetOwner, filename, from_filename, version }) => {
    const body: Record<string, unknown> = {};
    if (from_filename) body.from_filename = from_filename;
    if (version !== undefined) body.version = version;
    return out(await client.post(`/v1/apps/${encodeURIComponent(targetOwner ?? owner)}/${encodeURIComponent(filename)}/draft/seed`, body));
  });

  // → POST /v1/ai/image — make a picture on the owner's key; the bytes land in storage, not here.
  mcp.tool('aimeat_image_generate', descriptionFor('aimeat_image_generate'), zodShapeFor('aimeat_image_generate'), annotationsFor('aimeat_image_generate'), async ({ prompt, size, storage_key, public: isPublic, model, app_id, provider, fallback, role }) => {
    const body: Record<string, unknown> = { prompt };
    if (size) body.size = size;
    if (storage_key) body.storage_key = storage_key;
    if (isPublic) body.public = true;
    if (model) body.model = model;
    if (app_id) body.app_id = app_id;
    if (provider) body.provider = provider;
    if (fallback !== undefined) body.fallback = fallback;
    if (role) body.role = role;
    return out(await client.post('/v1/ai/image', body));
  });

  // → POST /v1/apps/:owner/:filename/publish-draft — promote the draft to a new live version.
  mcp.tool('aimeat_app_draft_publish', descriptionFor('aimeat_app_draft_publish'), zodShapeFor('aimeat_app_draft_publish'), annotationsFor('aimeat_app_draft_publish'), async ({ owner: targetOwner, filename, roadmap, ai_provenance, ai_provenance_id, spec_token, spec_ack }) => {
    const resp = await client.post(`/v1/apps/${encodeURIComponent(targetOwner ?? owner)}/${encodeURIComponent(filename)}/publish-draft`, { roadmap, ai_provenance, ai_provenance_id, spec_token, spec_ack });
    if (resp.ok === false) return out(resp);
    return provenanceEchoedResult(client,
      { tool: 'aimeat_app_draft_publish', declared: ai_provenance, declaredId: ai_provenance_id }, resp);
  });

  // → DELETE /v1/apps/:owner/:filename/draft — discard the draft (live app untouched).
  mcp.tool('aimeat_app_draft_discard', descriptionFor('aimeat_app_draft_discard'), zodShapeFor('aimeat_app_draft_discard'), annotationsFor('aimeat_app_draft_discard'), async ({ owner: targetOwner, filename }) => {
    return out(await client.delete(`/v1/apps/${encodeURIComponent(targetOwner ?? owner)}/${encodeURIComponent(filename)}/draft`));
  });

  // → GET /v1/admin/seo/status — is this node findable, and what is left to do. Operator-only.
  mcp.tool('aimeat_seo_status', descriptionFor('aimeat_seo_status'), zodShapeFor('aimeat_seo_status'),
    annotationsFor('aimeat_seo_status'), async () => {
      return out(await client.get('/v1/admin/seo/status'));
    });

  // → POST /v1/admin/seo/indexnow, or GET /v1/admin/seo/indexnow/plan with plan: true — the whole
  //   site to IndexNow, one batch per host. Operator-only.
  mcp.tool('aimeat_seo_announce', descriptionFor('aimeat_seo_announce'), zodShapeFor('aimeat_seo_announce'), annotationsFor('aimeat_seo_announce'), async (a) => {
    const scope = a.scope ?? 'all';
    if (a.plan) return out(await client.get(`/v1/admin/seo/indexnow/plan?scope=${scope}`));
    return out(await client.post('/v1/admin/seo/indexnow', { scope }));
  });
}
