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
import { generateUploadToken } from '../services/upload-token.js';
import { generateDraftToken } from '../services/draft-token.js';
import { validateCortexAgents } from '../models/crew-def-schemas.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';
import { agentFaceKey } from '../services/agent-face.js';
import { getOwnerScopePublicMemory } from '../services/owner-memory.js';
import { listSkillsByBinding } from '../services/skills.js';

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
        },
        annotationsFor('aimeat_app_publish'),
        async ({ filename, content_base64, name, description, category, tags, icon, version, cortex_agents }) => {
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
                    utype: 'app',
                    meta: { filename, name, description, category, tags, icon, version },
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
            const existingVersion = await storage.getLatestVersionNumber(ownerGaii, filename);
            const newVersion = existingVersion + 1;
            const isUpdate = existingVersion > 0;

            // Description required for a NEW app; carried forward on an update when omitted (so a
            // re-publish never blanks it). Mirrors POST /v1/apps.
            let effectiveDescription = typeof description === 'string' ? description.trim() : '';
            if (!effectiveDescription) {
                if (isUpdate) {
                    const existingApp = await storage.getApp(ownerGaii, filename);
                    effectiveDescription = existingApp?.manifest?.description ?? '';
                } else {
                    return {
                        content: [{ type: 'text' as const, text: 'A description is required when publishing a new app. Add a short "description" (1-2 sentences about what it does).' }],
                        isError: true,
                    };
                }
            }

            // Agent-Bundled Apps: validate declared crew-defs fail-loud — a malformed
            // agents[] rejects the publish so it never reaches a fleet. Mirrors POST /v1/apps.
            let cortexAgents: Record<string, unknown>[] | undefined;
            if (cortex_agents !== undefined) {
                const check = validateCortexAgents(cortex_agents);
                if (!check.ok) {
                    return { content: [{ type: 'text' as const, text: `Invalid cortex_agents (crew-def validation failed):\n${check.errors.join('\n')}` }], isError: true };
                }
                cortexAgents = check.agents as unknown as Record<string, unknown>[];
            }

            const manifest: AppManifest = {
                name,
                description: effectiveDescription,
                version: version ?? `1.0.${newVersion - 1}`,
                category: category ?? 'tool',
                tags: tags ?? [],
                authorDisplay: parsed.owner,
                usesCortex: [],
            };
            if (icon) manifest.icon = icon;
            if (cortexAgents !== undefined && cortexAgents.length > 0) manifest.cortex = { agents: cortexAgents };

            // Carry the parked + forkable + copy-protection state forward across
            // re-publishes (an update never silently re-exposes a parked app, flips fork
            // permission, or drops the owner's copy-protection). Mirrors POST /v1/apps.
            let parkedState = false;
            let forkableState = false;
            if (isUpdate) {
                const existingApp = await storage.getApp(ownerGaii, filename);
                parkedState = !!existingApp?.parked;
                forkableState = !!existingApp?.forkable;
                if (existingApp?.manifest?.protection) manifest.protection = existingApp.manifest.protection;
                // cortex.agents carried forward when omitted (an update never silently drops
                // the app's bundled agents); an explicit [] clears the section.
                if (cortex_agents === undefined && existingApp?.manifest?.cortex?.agents?.length) {
                    manifest.cortex = existingApp.manifest.cortex;
                }
            }

            try {
                await storage.createApp({
                    ownerGaii,
                    ownerName: parsed.owner,
                    filename,
                    versionNumber: newVersion,
                    manifest,
                    mimeType: 'text/html',
                    size: data.length,
                    data,
                    parked: parkedState,
                    forkable: forkableState,
                    createdAt: new Date().toISOString(),
                });

                const downloadUrl = `/v1/apps/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(filename)}`;
                logger.info(`App ${isUpdate ? 'updated' : 'published'} via MCP: ${filename} v${newVersion}`, { by: agentGaii });
                emitResourceListChanged(agentGaii);

                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({
                            mode: 'inline',
                            filename,
                            version_number: newVersion,
                            name: manifest.name,
                            size: data.length,
                            is_update: isUpdate,
                            download_url: downloadUrl,
                            inline_url: `${downloadUrl}?mode=inline`,
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
        { filename: z.string().describe('App filename whose saved draft should be promoted to a new live version.') },
        annotationsFor('aimeat_app_draft_publish'),
        async ({ filename }) => {
            const agentGaii = getAgentGaii();
            const parsed = parseGAII(agentGaii);
            if (!parsed) return { content: [{ type: 'text' as const, text: 'Failed to parse agent GAII' }], isError: true };
            const ownerGaii = `${parsed.owner}@${config.nodeId}`;
            const draft = await storage.getAppDraft(ownerGaii, filename);
            if (!draft) {
                return { content: [{ type: 'text' as const, text: `No draft to publish for "${filename}". Save one with aimeat_app_draft_save first.` }], isError: true };
            }
            const existingVersion = await storage.getLatestVersionNumber(ownerGaii, filename);
            const isUpdate = existingVersion > 0;
            const newVersion = existingVersion + 1;
            // Carry the live parked/forkable/protection state forward, mirroring publish.
            let parkedState = false, forkableState = false;
            if (isUpdate) {
                const live = await storage.getApp(ownerGaii, filename);
                parkedState = !!live?.parked;
                forkableState = !!live?.forkable;
            }
            const manifest: AppManifest = { ...draft.manifest, version: draft.manifest.version || `1.0.${newVersion - 1}`, authorDisplay: parsed.owner };
            try {
                await storage.createApp({
                    ownerGaii, ownerName: parsed.owner, filename, versionNumber: newVersion,
                    manifest, mimeType: draft.mimeType, size: draft.size, data: draft.data,
                    parked: parkedState, forkable: forkableState, createdAt: new Date().toISOString(),
                });
                await storage.deleteAppDraft(ownerGaii, filename);
                emitResourceListChanged(agentGaii);
                logger.info(`App draft published via MCP: ${filename} v${newVersion}`, { by: agentGaii });
                const downloadUrl = `/v1/apps/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(filename)}`;
                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({
                            filename, version_number: newVersion, is_update: isUpdate,
                            parked: parkedState, download_url: downloadUrl, inline_url: `${downloadUrl}?mode=inline`,
                            note: 'Draft published as the new live version; the draft slot is cleared.',
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

    // ── Tool 2: aimeat_app_list ──
    mcp.tool(
        'aimeat_app_list',
        descriptionFor('aimeat_app_list'),
        {
            category: z.string().optional().describe('Filter by category'),
            search: z.string().optional().describe('Search query string'),
            tag: z.string().optional().describe('Filter by tag'),
            own: z.boolean().optional().describe('If true, list only apps owned by the current agent'),
        },
        annotationsFor('aimeat_app_list'),
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
                        download_url: `/v1/apps/${encodeURIComponent(app.ownerName)}/${encodeURIComponent(app.filename)}`,
                        inline_url: `/v1/apps/${encodeURIComponent(app.ownerName)}/${encodeURIComponent(app.filename)}?mode=inline`,
                        created_at: app.createdAt,
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
