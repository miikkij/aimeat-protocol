/**
 * @file apps.ts
 * @description MCP app management tools. Provides 6 tools for the app lifecycle: publish, list,
 *   get details, delete, list versions, and fork. Apps are single-file HTML applications stored
 *   with auto-incrementing version numbers and manifest metadata.
 * @structure
 *   - registerAppsTools() — registers all app tools on an McpServer instance
 * @usage
 *   import { registerAppsTools } from './apps.js';
 *   registerAppsTools(mcp, storage, config, getAgentGaii, emitResourceUpdated, emitResourceListChanged);
 * @version-history
 *   v1.11.0 — 2026-08-09 — aimeat_app_list is an MCP App: `_meta.ui.resourceUri` names the card grid
 *     in ./apps-ui.ts, which a host that supports the extension renders inside the conversation.
 *     Moved from mcp.tool to mcp.registerTool because only the config form carries `_meta`. First
 *     use of the extension on this node, deliberately on ONE tool: the sandbox's deny-by-default
 *     CSP and the absence of a portal session are the parts worth proving before the catalogue
 *     leans on them.
 *   v1.10.0 — 2026-08-09 — aimeat_app_list and aimeat_app_get carry `url`, the app's public
 *     app-origin address (its own subdomain when it has one, else the shared path form). Both
 *     served only `download_url`, a node-relative path, so an agent asked to show someone their
 *     apps had nothing it could hand over: the address existed and the chat surface never saw it.
 *     Resolved read-only via resolveAppUrls (one subdomain-table read for the whole page) rather
 *     than appOriginUrl, which would mint a subdomain per app as a side effect of listing.
 *   v1.9.0 — 2026-08-01 — TARGET-058: aimeat_app_publish's UPLOAD mode mints its token through
 *     buildUploadMeta and carries `ai_provenance` / `ai_provenance_id` + `actor`. Phase 4 gave this
 *     tool the parameter and Phase 8 shared the publish, but the presigned branch still hand-wrote
 *     `meta: { filename, name, description, category, tags, icon, version }` — so the door the tool
 *     itself recommends for anything over 1 KB accepted a declaration, dropped it at mint, and
 *     published with `aiProvenanceId: null`. The missing `actor` blocked MINT-3 on the same branch,
 *     so neither the caller's statement nor the node's fallback stamp could reach a presigned app.
 *   v1.8.0 — 2026-08-01 — TARGET-058 Phase 8 step 0a: aimeat_app_publish and aimeat_app_draft_publish
 *     go through services/app-publish.ts, the one function the three REST doors already call. They
 *     were the fourth and fifth partial copies of the publish — no transparency lint, no quota, no
 *     change log, no announcement, no public feed, no subdomain, and a carry-forward list missing
 *     the description, tags, icon, pricing, the access code and the operator-hidden flag. Promoting
 *     a draft over MCP was consequently a way out of an operator hide.
 *   v1.7.0 — 2026-08-01 — TARGET-058 Phase 4: aimeat_app_publish and aimeat_app_draft_publish accept
 *     an `ai_provenance` declaration and go through provenanceForWrite() instead of straight to
 *     Mint-3, so an agent that DOES say how it built the app is believed about the how while the node
 *     still fills in the who, the when and the content hash. Both results echo the stored record.
 *   2026-07-19 — publish/draft_publish next_steps nudge (face+bound-skills+template hint, best-effort) (AppDev KB Phase 6)
 *   v1.0.0 — 2026-05-02 — Initial creation: 5 tools for app publish, list, get, delete, versions
 *   v1.1.0 -- 2026-05-29 -- Add tool annotations (title + read/destructive/idempotent/openWorld hints)
 *     from shared annotations.ts for Connectors Directory compliance.
 *   v1.2.0 -- 2026-05-30 -- MCP audit Phase 1: tool descriptions sourced from canonical catalog via descriptionFor().
 *   v1.3.0 -- 2026-06-20 -- aimeat_app_publish requires a description for a NEW app (carried forward
 *     on update when omitted), mirroring POST /v1/apps.
 *   v1.4.0 -- 2026-07-07 -- Add aimeat_app_fork (sanctioned, provenance-recording fork behind the
 *     forkable/paid gates); publish carries the forkable flag forward; list/get surface forkable +
 *     forked_from.
 *   v1.5.0 -- 2026-07-16 -- aimeat_app_list metrics via 2 batch queries (getAppDownloadsForApps +
 *     countAppForksForApps), was getAppDownloads + countAppForks PER app (Phase 3).
 *   v1.6.0 -- 2026-07-16 -- Agent-Bundled Apps Slice 1: aimeat_app_publish accepts cortex_agents
 *     (declarative crew-defs → manifest.cortex.agents), validated fail-loud; carried forward on
 *     update + draft save when omitted.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage, AppManifest } from '../storage/interface.js';
import { parseGAII } from '../utils/gaii.js';
import { logger } from '../utils/logger.js';
import { generateUploadToken, buildUploadMeta } from '../services/upload-token.js';
import { generateDraftToken } from '../services/draft-token.js';
import { validateCortexAgents } from '../models/crew-def-schemas.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';
import { agentFaceKey } from '../services/agent-face.js';
import { getOwnerScopePublicMemory } from '../services/owner-memory.js';
import { listSkillsByBinding } from '../services/skills.js';
import { publishApp } from '../services/app-publish.js';
import { resolveAppUrls } from '../routes/apps/helpers.js';
import { registerAppIndexUi, APP_INDEX_UI_URI, uiToolMeta, appUiAvailable } from './apps-ui.js';
import { aiProvenanceInputs, toDeclaredProvenance } from './ai-provenance-input.js';
import { writeProvenanceEcho } from './ai-provenance-result.js';
import { loadServedProvenance } from '../services/ai-provenance-marks.js';

export function registerAppsTools(
    mcp: McpServer,
    storage: Storage,
    config: AimeatConfig,
    getAgentGaii: () => string,
    emitResourceUpdated: (agentGaii: string, uri: string) => void,
    emitResourceListChanged: (agentGaii: string) => void,
): void {

    // Post-publish reflection nudge (AppDev KB Phase 6): report whether the app already has an
    // agent face + bound skills, and hint at proposing a template. Best-effort — a publish must
    // NEVER fail because this enrichment does.
    async function buildNextSteps(ownerName: string, filename: string): Promise<Record<string, unknown> | undefined> {
        try {
            // Resolve the face across the owner's whole keyspace (GHII + the owner's agents), matching what
            // the anonymous serve path serves — so an agent that published the face under its own GAII still
            // reports agent_face_present:true here.
            const [faceRec, boundSkills] = await Promise.all([
                getOwnerScopePublicMemory(storage, config.nodeId, ownerName, agentFaceKey(filename)).catch(err => { logger.warn('buildNextSteps: continuing after a suppressed failure', { error: String(err) }); return null; }),
                listSkillsByBinding(storage, config, `app:${ownerName}/${filename}`, { ownerName }).catch(err => { logger.warn('buildNextSteps: continuing after a suppressed failure', { error: String(err) }); return []; }),
            ]);
            return {
                agent_face_present: !!faceRec,
                bound_skills_count: boundSkills.length,
                template_proposal_hint: 'If anything here generalizes, record it: aimeat_app_template_propose (with your model id). Finish checklist: agent face published, a skill bound (metadata.binding app:owner/filename), learnings reported via aimeat_appdev_pitfall_report.',
            };
        } catch (err) {
          logger.warn('buildNextSteps: continuing after a suppressed failure', { error: String(err) });
          return undefined;
        }
    }

    // ── Tool 1: aimeat_app_publish ──
    mcp.tool(
        'aimeat_app_publish',
        descriptionFor('aimeat_app_publish'),
        {
            filename: z.string().describe('App filename (e.g. "starwars.html"). Alphanumeric, dots, hyphens, underscores. Max 100 chars.'),
            content_base64: z.string().optional().describe('Base64-encoded HTML content. Omit to get an upload URL instead (recommended for files > 1KB).'),
            name: z.string().describe('Display name of the app'),
            description: z.string().optional().describe('Short description of the app'),
            category: z.string().optional().describe('App category (default: "tool")'),
            tags: z.array(z.string()).optional().describe('Array of tags for search/filtering'),
            icon: z.string().optional().describe('Emoji icon for the app'),
            version: z.string().optional().describe('Semver display version (e.g. "1.0.0"). Auto-generated if omitted.'),
            cortex_agents: z.array(z.record(z.string(), z.unknown())).optional().describe(
                'Declarative crew-defs this app ships (Agent-Bundled Apps). Each entry is a crewaimeat crew_def JSON document (agent_name, agents[], tasks[], ...) validated at publish — DATA the owner\'s own fleet interprets, never code. Stored as manifest.cortex.agents. Omit on update to carry the existing list forward; send [] to clear.'),
            ...aiProvenanceInputs,
        },
        annotationsFor('aimeat_app_publish'),
        async ({ filename, content_base64, name, description, category, tags, icon, version, cortex_agents, ai_provenance, ai_provenance_id }) => {
            const agentGaii = getAgentGaii();
            const parsed = parseGAII(agentGaii);
            if (!parsed) {
                return { content: [{ type: 'text' as const, text: 'Failed to parse agent GAII' }], isError: true };
            }

            // Validate filename
            if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(filename)) {
                return {
                    content: [{ type: 'text' as const, text: 'Invalid filename. Use alphanumeric, dots, hyphens, underscores. Max 100 chars.' }],
                    isError: true,
                };
            }

            // --- UPLOAD MODE: no content provided, return presigned upload URL ---
            if (!content_base64) {
                const MAX_APP_SIZE = config.appMaxSizeMb * 1024 * 1024;
                const token = await generateUploadToken({
                    sub: `${parsed.owner}@${config.nodeId}`,
                    // WHO asked, next to WHERE it lands. An app always lands in the owner's bucket,
                    // so `sub` alone erased the publishing agent — and with it everything MINT-3 has
                    // to reason from, on the door this tool recommends for anything over 1 KB. The
                    // REST presigned mint has carried `actor` since Phase 5; this one had not.
                    actor: agentGaii,
                    utype: 'app',
                    // buildUploadMeta, not a hand-written object: the hand-written one is what
                    // dropped `ai_provenance` (and `cortex_agents` before it). The carry-over list
                    // lives with the token, so a new option is covered by declaring it there once.
                    meta: buildUploadMeta('app', {
                        filename, name, description, category, tags, icon, version,
                        ai_provenance, ai_provenance_id,
                    }),
                    maxBytes: MAX_APP_SIZE,
                    contentType: 'text/html',
                });

                const uploadUrl = `${config.baseUrl}/v1/upload/${token}`;

                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({
                            mode: 'upload',
                            upload_url: uploadUrl,
                            upload_method: 'PUT',
                            content_type: 'text/html',
                            max_size_bytes: MAX_APP_SIZE,
                            expires_in_seconds: 3600,
                            note: 'PUT the raw HTML file to upload_url. The response contains the publish result as JSON.',
                        }, null, 2),
                    }],
                };
            }

            // --- INLINE MODE: content provided, process immediately ---
            const data = Buffer.from(content_base64, 'base64');
            const MAX_APP_SIZE = config.appMaxSizeMb * 1024 * 1024;
            if (data.length > MAX_APP_SIZE) {
                return {
                    content: [{ type: 'text' as const, text: `App file exceeds ${config.appMaxSizeMb}MB limit (${data.length} bytes)` }],
                    isError: true,
                };
            }

            const ownerGaii = `${parsed.owner}@${config.nodeId}`;

            // Agent-Bundled Apps: validate declared crew-defs fail-loud — a malformed agents[]
            // rejects the publish so it never reaches a fleet. This stays HERE because it is
            // validation of an MCP parameter, not part of the publish itself.
            let cortexAgents: Record<string, unknown>[] | undefined;
            if (cortex_agents !== undefined) {
                const check = validateCortexAgents(cortex_agents);
                if (!check.ok) {
                    return { content: [{ type: 'text' as const, text: `Invalid cortex_agents (crew-def validation failed):\n${check.errors.join('\n')}` }], isError: true };
                }
                cortexAgents = check.agents as unknown as Record<string, unknown>[];
            }

            // From here it is services/app-publish.ts — the same function POST /v1/apps, the
            // presigned upload and publish-draft call. This tool was a FOURTH partial copy of the
            // publish: no transparency lint, no protection-cache invalidation, no quota, no
            // change-log entry, no announcement, no public feed, no subdomain provisioning, and a
            // carry-forward list that dropped the description, tags, icon, pricing, the access code
            // and the operator-hidden flag — so an agent could escape an operator hide by
            // re-publishing over MCP.
            try {
                const out = await publishApp(storage, config, {
                    ownerName: parsed.owner,
                    ownerGhii: ownerGaii,
                    callerGaii: agentGaii,
                    filename,
                    data,
                    mimeType: 'text/html',
                    requested: { name, description, category, tags, icon, version, cortexAgents },
                    accessCode: { mode: 'carry' },
                    source: 'inline',
                    declaredProvenanceId: ai_provenance_id,
                    declaredProvenance: toDeclaredProvenance(ai_provenance),
                });
                if ('refusal' in out) {
                    return { content: [{ type: 'text' as const, text: out.refusal.message }], isError: true };
                }

                logger.info(`App ${out.isUpdate ? 'updated' : 'published'} via MCP: ${filename} v${out.versionNumber}`, { by: agentGaii });
                emitResourceListChanged(agentGaii);

                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({
                            mode: 'inline',
                            filename,
                            version_number: out.versionNumber,
                            name: out.manifest.name,
                            size: out.size,
                            is_update: out.isUpdate,
                            download_url: out.downloadUrl,
                            inline_url: `${out.downloadUrl}?mode=inline`,
                            ...(out.mobileHints.length ? { mobile_hints: out.mobileHints } : {}),
                            ...(out.aiLint ? { ai_posture: out.aiLint.posture } : {}),
                            ...(out.aiLint?.hints.length ? { ai_hints: out.aiLint.hints } : {}),
                            ...(await writeProvenanceEcho(storage, config, out.aiProvenanceId)),
                            next_steps: await buildNextSteps(parsed.owner, filename),
                        }, null, 2),
                    }],
                };
            } catch (err) {
                return { content: [{ type: 'text' as const, text: `Failed to publish app: ${(err as Error).message}` }], isError: true };
            }
        },
    );

    // ── Tool: aimeat_app_draft_save ──
    // Staging: save the NEXT version as a draft WITHOUT touching the live app, and get a
    // preview URL to test it on a real origin (mic/camera work) before deciding to publish.
    mcp.tool(
        'aimeat_app_draft_save',
        descriptionFor('aimeat_app_draft_save'),
        {
            filename: z.string().describe('App filename (e.g. "starwars.html"). The draft is the staging copy of THIS app.'),
            content_base64: z.string().describe('Base64-encoded HTML of the draft (the next version to test).'),
            name: z.string().optional().describe('Display name (defaults to the live app\'s name when omitted).'),
            description: z.string().optional().describe('Description (defaults to the live app\'s when omitted).'),
            category: z.string().optional().describe('Category (defaults to the live app\'s).'),
            tags: z.array(z.string()).optional().describe('Tags (default: the live app\'s).'),
            icon: z.string().optional().describe('Emoji icon (defaults to the live app\'s).'),
        },
        annotationsFor('aimeat_app_draft_save'),
        async ({ filename, content_base64, name, description, category, tags, icon }) => {
            const agentGaii = getAgentGaii();
            const parsed = parseGAII(agentGaii);
            if (!parsed) return { content: [{ type: 'text' as const, text: 'Failed to parse agent GAII' }], isError: true };
            if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(filename)) {
                return { content: [{ type: 'text' as const, text: 'Invalid filename. Use alphanumeric, dots, hyphens, underscores. Max 100 chars.' }], isError: true };
            }
            const data = Buffer.from(content_base64, 'base64');
            const MAX_APP_SIZE = config.appMaxSizeMb * 1024 * 1024;
            if (data.length > MAX_APP_SIZE) {
                return { content: [{ type: 'text' as const, text: `Draft exceeds ${config.appMaxSizeMb}MB limit (${data.length} bytes)` }], isError: true };
            }
            const ownerGaii = `${parsed.owner}@${config.nodeId}`;
            // Inherit the live app's manifest as the base so a draft that only changes HTML
            // keeps its name/description/category/icon.
            const live = await storage.getApp(ownerGaii, filename);
            const base = live?.manifest;
            const manifest: AppManifest = {
                name: name ?? base?.name ?? filename.replace(/\.html?$/i, ''),
                description: (typeof description === 'string' ? description : base?.description) ?? '',
                version: base?.version ?? '1.0.0',
                category: category ?? base?.category ?? 'tool',
                tags: tags ?? base?.tags ?? [],
                authorDisplay: parsed.owner,
                usesCortex: base?.usesCortex ?? [],
            };
            if (icon ?? base?.icon) manifest.icon = icon ?? base?.icon;
            if (base?.protection) manifest.protection = base.protection;
            if (base?.cortex?.agents?.length) manifest.cortex = base.cortex;
            try {
                await storage.saveAppDraft({
                    ownerGaii, ownerName: parsed.owner, filename, manifest,
                    mimeType: live?.mimeType ?? 'text/html', size: data.length, data,
                    updatedAt: new Date().toISOString(),
                });
                // Mint a preview token + apex preview URL. On a node with the app origin ON the
                // apex GET handler 301-redirects this to the isolated origin (preserving the
                // token), so the SAME URL works in both postures.
                const token = await generateDraftToken({ sub: ownerGaii, filename }, 600);
                const previewUrl = `${config.baseUrl}/v1/apps/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(filename)}?mode=inline&preview=${encodeURIComponent(token)}`;
                logger.info(`App draft saved via MCP: ${filename}`, { by: agentGaii });
                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({
                            filename,
                            saved: true,
                            has_live_version: !!live,
                            live_version_number: live?.versionNumber ?? 0,
                            preview_url: previewUrl,
                            preview_expires_in_seconds: 600,
                            note: 'Draft saved — the LIVE app is unchanged. Open preview_url in a browser to test this next version on a real origin (mic/camera prompts work). When it is good, call aimeat_app_draft_publish to make it live; to throw it away call aimeat_app_draft_discard. To ship straight to live without staging, use aimeat_app_publish instead.',
                        }, null, 2),
                    }],
                };
            } catch (err) {
                return { content: [{ type: 'text' as const, text: `Failed to save draft: ${(err as Error).message}` }], isError: true };
            }
        },
    );

    // ── Tool: aimeat_app_draft_publish ──
    mcp.tool(
        'aimeat_app_draft_publish',
        descriptionFor('aimeat_app_draft_publish'),
        { filename: z.string().describe('App filename whose saved draft should be promoted to a new live version.'), ...aiProvenanceInputs },
        annotationsFor('aimeat_app_draft_publish'),
        async ({ filename, ai_provenance, ai_provenance_id }) => {
            const agentGaii = getAgentGaii();
            const parsed = parseGAII(agentGaii);
            if (!parsed) return { content: [{ type: 'text' as const, text: 'Failed to parse agent GAII' }], isError: true };
            const ownerGaii = `${parsed.owner}@${config.nodeId}`;
            const draft = await storage.getAppDraft(ownerGaii, filename);
            if (!draft) {
                return { content: [{ type: 'text' as const, text: `No draft to publish for "${filename}". Save one with aimeat_app_draft_save first.` }], isError: true };
            }
            try {
                // The same shared publish the REST publish-draft goes through. This tool was the
                // FIFTH copy, and the thinnest: it carried neither the access code nor the
                // operator-hidden flag, so staging a draft and promoting it over MCP was a way out
                // of an operator hide.
                const out = await publishApp(storage, config, {
                    ownerName: parsed.owner,
                    ownerGhii: ownerGaii,
                    callerGaii: agentGaii,
                    filename,
                    data: draft.data,
                    mimeType: draft.mimeType,
                    requested: {
                        name: draft.manifest.name,
                        description: draft.manifest.description,
                        version: draft.manifest.version || undefined,
                        category: draft.manifest.category,
                        tags: draft.manifest.tags,
                        icon: draft.manifest.icon,
                        usesCortex: draft.manifest.usesCortex,
                        cortexAgents: draft.manifest.cortex?.agents,
                        protection: draft.manifest.protection,
                    },
                    accessCode: { mode: 'carry' },
                    source: 'draft',
                    declaredProvenanceId: ai_provenance_id,
                    declaredProvenance: toDeclaredProvenance(ai_provenance),
                });
                if ('refusal' in out) {
                    return { content: [{ type: 'text' as const, text: out.refusal.message }], isError: true };
                }
                await storage.deleteAppDraft(ownerGaii, filename);
                emitResourceListChanged(agentGaii);
                logger.info(`App draft published via MCP: ${filename} v${out.versionNumber}`, { by: agentGaii });
                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({
                            filename, version_number: out.versionNumber, is_update: out.isUpdate,
                            parked: out.parked, download_url: out.downloadUrl, inline_url: `${out.downloadUrl}?mode=inline`,
                            note: 'Draft published as the new live version; the draft slot is cleared.',
                            ...(out.aiLint ? { ai_posture: out.aiLint.posture } : {}),
                            ...(out.aiLint?.hints.length ? { ai_hints: out.aiLint.hints } : {}),
                            ...(await writeProvenanceEcho(storage, config, out.aiProvenanceId)),
                            next_steps: await buildNextSteps(parsed.owner, filename),
                        }, null, 2),
                    }],
                };
            } catch (err) {
                return { content: [{ type: 'text' as const, text: `Failed to publish draft: ${(err as Error).message}` }], isError: true };
            }
        },
    );

    // ── Tool: aimeat_app_draft_discard ──
    mcp.tool(
        'aimeat_app_draft_discard',
        descriptionFor('aimeat_app_draft_discard'),
        { filename: z.string().describe('App filename whose saved draft should be discarded (the live app is untouched).') },
        annotationsFor('aimeat_app_draft_discard'),
        async ({ filename }) => {
            const agentGaii = getAgentGaii();
            const parsed = parseGAII(agentGaii);
            if (!parsed) return { content: [{ type: 'text' as const, text: 'Failed to parse agent GAII' }], isError: true };
            const ownerGaii = `${parsed.owner}@${config.nodeId}`;
            const discarded = await storage.deleteAppDraft(ownerGaii, filename);
            if (!discarded) {
                return { content: [{ type: 'text' as const, text: `No draft to discard for "${filename}".` }], isError: true };
            }
            return { content: [{ type: 'text' as const, text: JSON.stringify({ filename, discarded: true }, null, 2) }] };
        },
    );

    // ── The app index as an MCP App (the page aimeat_app_list's _meta.ui points at) ──
    registerAppIndexUi(mcp);

    // ── Tool 2: aimeat_app_list ──
    // registerTool rather than mcp.tool: only the config form carries `_meta`, and `_meta.ui` is
    // how a tool tells the host "render my result as this page". Same gate, same catalog entry.
    mcp.registerTool(
        'aimeat_app_list',
        {
            description: descriptionFor('aimeat_app_list'),
            inputSchema: {
                category: z.string().optional().describe('Filter by category'),
                search: z.string().optional().describe('Search query string'),
                tag: z.string().optional().describe('Filter by tag'),
                own: z.boolean().optional().describe('If true, list only apps owned by the current agent'),
            },
            annotations: annotationsFor('aimeat_app_list'),
            // A host that renders MCP Apps shows the card grid; one that does not ignores this
            // field and shows the same JSON it always did. Nothing is lost either way.
            // Both keys, for the reason spelled out on uiToolMeta. Omitted entirely on a node that
            // cannot build the page, so a host is never pointed at a resource that is not there.
            ...(appUiAvailable() ? { _meta: uiToolMeta(APP_INDEX_UI_URI) } : {}),
        },
        async ({ category, search, tag, own }) => {
            const agentGaii = getAgentGaii();
            const ownerGhii = `${parseGAII(agentGaii)?.owner ?? agentGaii}@${config.nodeId}`;

            const opts = {
                category,
                q: search,
                tag,
                sort: 'newest' as const,
                limit: 50,
                offset: 0,
                // Browsing the full catalogue still surfaces the caller's OWN parked apps
                // (hidden from everyone else), so an owner's agent can act on them.
                viewerGhii: ownerGhii,
                ...(own ? { ownerGaii: ownerGhii } : {}),
            };

            const { apps, total } = await storage.listApps(opts);

            // Per-app metrics in TWO batch queries (was getAppDownloads + countAppForks PER app = 2N).
            const refs = apps.map(a => ({ ownerGaii: a.ownerGaii, filename: a.filename }));
            const downloadsByApp = await storage.getAppDownloadsForApps(refs);
            const forksByApp = await storage.countAppForksForApps(refs);
            // Public addresses in ONE subdomain-table read for the whole page. Read-only on
            // purpose: appOriginUrl would mint a subdomain per app, and listing must not write.
            const urlByApp = await resolveAppUrls(config, storage, apps.map(a => ({ owner: a.ownerName, filename: a.filename })));

            const result = apps.map((app) => {
                const metricKey = `${app.ownerGaii} ${app.filename}`;
                const downloads = downloadsByApp[metricKey] ?? 0;
                const forks = forksByApp[metricKey] ?? 0;
                return {
                    owner: app.ownerName,
                    filename: app.filename,
                    name: app.manifest.name,
                    description: app.manifest.description,
                    version: app.manifest.version,
                    version_number: app.versionNumber,
                    category: app.manifest.category,
                    tags: app.manifest.tags,
                    icon: app.manifest.icon,
                    size: app.size,
                    parked: !!app.parked,
                    forkable: !!app.forkable,
                    downloads,
                    forks,
                    // The address to give a person. Absent when this node runs without an app origin.
                    url: urlByApp[`${app.ownerName}/${app.filename}`] ?? null,
                    download_url: `/v1/apps/${encodeURIComponent(app.ownerName)}/${encodeURIComponent(app.filename)}`,
                    created_at: app.createdAt,
                };
            });

            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({ apps: result, total }, null, 2),
                }],
            };
        },
    );

    // ── Tool 3: aimeat_app_get ──
    mcp.tool(
        'aimeat_app_get',
        descriptionFor('aimeat_app_get'),
        {
            owner: z.string().describe('Owner name of the app'),
            filename: z.string().describe('App filename'),
        },
        annotationsFor('aimeat_app_get'),
        async ({ owner, filename }) => {
            const app = await storage.getAppByOwnerName(owner, filename);
            if (!app) {
                return { content: [{ type: 'text' as const, text: `App "${filename}" not found for owner "${owner}"` }], isError: true };
            }

            const downloads = await storage.getAppDownloads(app.ownerGaii, app.filename);
            const forks = await storage.countAppForks(app.ownerGaii, app.filename);
            // TARGET-058: the same record the REST envelope, the markdown face and the WebMCP
            // listing serve for this app. An agent reading an app through MCP must not be the one
            // surface that silently drops how it was made. Absent = UNSTATED, never "human-written".
            const prov = await loadServedProvenance(storage, config, app.aiProvenanceId);
            const urlByApp = await resolveAppUrls(config, storage, [{ owner: app.ownerName, filename: app.filename }]);

            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({
                        owner: app.ownerName,
                        filename: app.filename,
                        version_number: app.versionNumber,
                        manifest: app.manifest,
                        size: app.size,
                        mime_type: app.mimeType,
                        protected: !!app.accessCode,
                        parked: !!app.parked,
                        forkable: !!app.forkable,
                        forked_from: app.manifest.forkedFrom ?? null,
                        downloads,
                        forks,
                        // The address to give a person. Absent when this node runs without an app origin.
                        url: urlByApp[`${app.ownerName}/${app.filename}`] ?? null,
                        download_url: `/v1/apps/${encodeURIComponent(app.ownerName)}/${encodeURIComponent(app.filename)}`,
                        inline_url: `/v1/apps/${encodeURIComponent(app.ownerName)}/${encodeURIComponent(app.filename)}?mode=inline`,
                        created_at: app.createdAt,
                        ai_provenance: prov?.record ?? null,
                        ai_provenance_url: prov?.recordUrl ?? null,
                    }, null, 2),
                }],
            };
        },
    );

    // ── Tool 4: aimeat_app_delete ──
    mcp.tool(
        'aimeat_app_delete',
        descriptionFor('aimeat_app_delete'),
        {
            filename: z.string().describe('App filename to delete'),
            version: z.number().optional().describe('Specific version number to delete. Omit to delete all versions.'),
        },
        annotationsFor('aimeat_app_delete'),
        async ({ filename, version }) => {
            const agentGaii = getAgentGaii();
            const ownerGaii = `${parseGAII(agentGaii)?.owner ?? agentGaii}@${config.nodeId}`;

            // Verify the app exists and belongs to this owner
            const app = await storage.getApp(ownerGaii, filename, version);
            if (!app) {
                return {
                    content: [{ type: 'text' as const, text: `App "${filename}" not found in your uploads${version ? ` (version ${version})` : ''}` }],
                    isError: true,
                };
            }

            try {
                await storage.deleteApp(ownerGaii, filename, version);

                logger.info(`App deleted via MCP: ${filename}${version ? ` v${version}` : ' (all versions)'}`, { by: agentGaii });

                emitResourceListChanged(agentGaii);

                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({
                            filename,
                            version_deleted: version ?? 'all',
                            note: version ? `Version ${version} deleted.` : 'App deleted (all versions).',
                        }, null, 2),
                    }],
                };
            } catch (err) {
                return { content: [{ type: 'text' as const, text: `Failed to delete app: ${(err as Error).message}` }], isError: true };
            }
        },
    );

    // ── Tool 5: aimeat_app_versions ──
    mcp.tool(
        'aimeat_app_versions',
        descriptionFor('aimeat_app_versions'),
        {
            owner: z.string().describe('Owner name of the app'),
            filename: z.string().describe('App filename'),
        },
        annotationsFor('aimeat_app_versions'),
        async ({ owner, filename }) => {
            // First find the app to get the ownerGaii
            const app = await storage.getAppByOwnerName(owner, filename);
            if (!app) {
                return { content: [{ type: 'text' as const, text: `App "${filename}" not found for owner "${owner}"` }], isError: true };
            }

            const versions = await storage.listAppVersions(app.ownerGaii, filename);

            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({
                        owner,
                        filename,
                        versions: versions.map(v => ({
                            version_number: v.versionNumber,
                            version: v.manifest.version,
                            size: v.size,
                            created_at: v.createdAt,
                        })),
                        total: versions.length,
                    }, null, 2),
                }],
            };
        },
    );

    // ── Tool 6: aimeat_app_fork ──
    mcp.tool(
        'aimeat_app_fork',
        descriptionFor('aimeat_app_fork'),
        {
            owner: z.string().describe('Owner name of the source app'),
            filename: z.string().describe('Filename of the source app'),
            new_filename: z.string().describe('Filename for the fork in your catalogue. Alphanumeric, dots, hyphens, underscores. Max 100 chars.'),
            version: z.number().optional().describe('Source version to fork (default: latest)'),
        },
        annotationsFor('aimeat_app_fork'),
        async ({ owner, filename, new_filename, version }) => {
            const agentGaii = getAgentGaii();
            const parsed = parseGAII(agentGaii);
            if (!parsed) {
                return { content: [{ type: 'text' as const, text: 'Failed to parse agent GAII' }], isError: true };
            }
            if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(new_filename)) {
                return { content: [{ type: 'text' as const, text: 'Invalid new_filename. Use alphanumeric, dots, hyphens, underscores. Max 100 chars.' }], isError: true };
            }

            const source = await storage.getAppByOwnerName(owner, filename, version);
            if (!source || source.operatorHidden) {
                return { content: [{ type: 'text' as const, text: `App "${filename}" not found for owner "${owner}"${version ? ` (version ${version})` : ''}` }], isError: true };
            }

            const callerOwner = parsed.owner;
            const callerGhii = `${callerOwner}@${config.nodeId}`;
            const sameOwner = callerOwner === source.ownerName;

            // Gate 1 — derivative permission (agents are never operators here).
            if (!sameOwner && !source.forkable) {
                return { content: [{ type: 'text' as const, text: 'This app is not open for forking by others. Ask the owner to enable forking.' }], isError: true };
            }
            // Gate 2 — a paid source's bytes must not bypass the paywall.
            if (config.marketplaceEnabled && source.manifest.priceMorsels && source.manifest.priceMorsels > 0 && !sameOwner) {
                const hasLicense = await storage.hasValidLicense(agentGaii, source.ownerGaii, filename);
                if (!hasLicense) {
                    return { content: [{ type: 'text' as const, text: `This app costs ${source.manifest.priceMorsels} morsels. Purchase it first before forking.` }], isError: true };
                }
            }

            const existing = await storage.getLatestVersionNumber(callerGhii, new_filename);
            if (existing > 0) {
                return { content: [{ type: 'text' as const, text: `You already have an app named "${new_filename}". Choose a different new_filename.` }], isError: true };
            }

            const now = new Date().toISOString();
            const forkedManifest: AppManifest = {
                ...source.manifest,
                name: `${source.manifest.name || filename.replace(/\.html?$/i, '')} (fork)`,
                authorDisplay: callerOwner,
                forkedFrom: { owner: source.ownerName, filename, version: source.versionNumber, node: config.nodeId },
            };
            delete forkedManifest.priceMorsels;
            delete forkedManifest.licenseType;

            try {
                await storage.createApp({
                    ownerGaii: callerGhii,
                    ownerName: callerOwner,
                    filename: new_filename,
                    versionNumber: 1,
                    manifest: forkedManifest,
                    mimeType: source.mimeType,
                    size: source.size,
                    data: source.data,
                    parked: false,
                    forkable: false,
                    createdAt: now,
                    // A fork copies bytes; it does not generate them. Carry the SOURCE's statement
                    // forward rather than minting a new one — a fresh Mint-3 here would claim the
                    // forker's agent produced content it merely copied, and the hash is the same
                    // bytes either way, so a detection query must lead to the original assertion.
                    ...(source.aiProvenanceId ? { aiProvenanceId: source.aiProvenanceId } : {}),
                });
                await storage.recordAppFork({
                    id: `fork-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`,
                    sourceOwnerGaii: source.ownerGaii,
                    sourceOwnerName: source.ownerName,
                    sourceFilename: filename,
                    sourceVersion: source.versionNumber,
                    childOwnerGaii: callerGhii,
                    childOwnerName: callerOwner,
                    childFilename: new_filename,
                    forkedByGaii: agentGaii,
                    forkedAt: now,
                });

                const downloadUrl = `/v1/apps/${encodeURIComponent(callerOwner)}/${encodeURIComponent(new_filename)}`;
                logger.info(`App forked via MCP: ${owner}/${filename} → ${new_filename}`, { by: agentGaii });
                emitResourceListChanged(agentGaii);

                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({
                            filename: new_filename,
                            version_number: 1,
                            forked_from: { owner: source.ownerName, filename, version: source.versionNumber },
                            download_url: downloadUrl,
                            inline_url: `${downloadUrl}?mode=inline`,
                            note: `Forked "${filename}" into your catalogue as "${new_filename}".`,
                        }, null, 2),
                    }],
                };
            } catch (err) {
                return { content: [{ type: 'text' as const, text: `Failed to fork app: ${(err as Error).message}` }], isError: true };
            }
        },
    );
}
