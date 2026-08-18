/**
 * @file apps.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description MCP app management tools. Provides 6 tools for the app lifecycle: publish, list,
 *   get details, delete, list versions, and fork. Apps are single-file HTML applications stored
 *   with auto-incrementing version numbers and manifest metadata.
 * @structure
 *   - registerAppsTools() — registers all app tools on an McpServer instance
 * @usage
 *   import { registerAppsTools } from './apps.js';
 *   registerAppsTools(mcp, storage, config, getAgentGaii, emitResourceUpdated, emitResourceListChanged);
 * @version-history
 *   v1.13.0 — 2026-08-11 — August 2026 audit step 8: the draft save, the draft promotion and the
 *     delete go through services/app-lifecycle.ts, the same functions the HTTP routes call. Three
 *     divergences went with the duplication. The delete removed ONE bucket and left the app's
 *     screenshot in storage with no change-log line, where the route sweeps every bucket the owner
 *     has for that filename (old publish paths left ghost rows), deletes the screenshot and logs. The
 *     draft save defaulted a new app's category to 'tool' where every other door says 'utility'. And
 *     all five tools composed the owner bucket as `owner@nodeId` by hand instead of resolving the
 *     owner's canonical GHII, which is the key routes/apps.ts addresses and the key the startup
 *     bucket-merge migration consolidates onto.
 *   v1.12.0 — 2026-08-11 — Both publish tools take `spec_token` / `spec_ack` (carried into the token
 *     in upload mode) and return `spec_check` + `app_hints`. A blocking artifact finding comes back
 *     as an error carrying the findings, so the remedy survives MCP's plain-text error channel.
 *     `buildNextSteps` moved to services/app-publish-next-steps.ts and now runs on the shared publish
 *     path — it lived here, so the agent-face and bound-skill reminder reached MCP-inline callers
 *     only, and never the presigned door this very tool recommends above 1 KB.
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
import type { Storage } from '../storage/interface.js';
import { parseGAII } from '../utils/gaii.js';
import { logger } from '../utils/logger.js';
import { generateUploadToken, buildUploadMeta } from '../services/upload-token.js';
import { generateDraftToken } from '../services/draft-token.js';
import { validateCortexAgents } from '../models/crew-def-schemas.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';
import { publishApp } from '../services/app-publish.js';
import {
    appFilenameRefusal, resolveAppOwnerScope, stageAppDraft, discardAppDraft,
    publishAppDraft, deleteOwnedApp,
} from '../services/app-lifecycle.js';
import { publicPosture } from '../services/app-ai-posture.js';
import { resolveAppUrls } from '../routes/apps/helpers.js';
import { registerAppIndexUi, APP_INDEX_UI_URI, uiToolMeta, appUiAvailable } from './apps-ui.js';
import { aiProvenanceInputs, toDeclaredProvenance } from './ai-provenance-input.js';
import { writeProvenanceEcho } from './ai-provenance-result.js';
import { loadServedProvenance } from '../services/ai-provenance-marks.js';
import { registerAppForkTool } from './apps-fork.js';

export function registerAppsTools(
    mcp: McpServer,
    storage: Storage,
    config: AimeatConfig,
    getAgentGaii: () => string,
    emitResourceUpdated: (agentGaii: string, uri: string) => void,
    emitResourceListChanged: (agentGaii: string) => void,
): void {

    /**
     * A refusal, rendered for the model that will read it.
     *
     * MCP has no status codes and no error envelope, so a refusal is a paragraph of text — and a
     * paragraph is exactly where a per-finding remedy gets lost. The findings are appended as JSON
     * so `pitfall` and `url` survive, and the agent can fetch the full entry instead of inferring
     * one from prose.
     */
    function refusalText(refusal: { message: string; details?: Record<string, unknown> }): string {
        if (!refusal.details) return refusal.message;
        return `${refusal.message}\n\n${JSON.stringify(refusal.details, null, 2)}`;
    }

    /**
     * The build-spec parameters, declared once and spread into both publish tools. Two tools
     * spelling the same pair by hand is how `ai_provenance` came to be accepted on one door and
     * dropped on another.
     */
    const specGateInputs = {
        spec_token: z.string().optional().describe(
            'The `spec_token` from GET /v1/prompts/build-app — the digest of the build spec you built against. '
            + 'It changes when the spec changes. Omitting it publishes anyway and returns spec_check.status "missing"; '
            + 'an out-of-date one returns "stale". Fetch the spec and pass the token rather than guessing a value: '
            + 'the point is that you read what it currently says.'),
        spec_ack: z.string().optional().describe(
            'Send "skipped-by-owner" when the owner explicitly told you to publish without reading the build spec. '
            + 'The publish is recorded as skipped on the node\'s change log instead of passing silently.'),
    };

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
            ...specGateInputs,
        },
        annotationsFor('aimeat_app_publish'),
        async ({ filename, content_base64, name, description, category, tags, icon, version, cortex_agents, ai_provenance, ai_provenance_id, spec_token, spec_ack }) => {
            const agentGaii = getAgentGaii();
            // The same owner scope the HTTP door resolves. Composing `owner@nodeId` here addressed a
            // different bucket than routes/apps.ts for any owner whose GHII record says otherwise.
            const scope = await resolveAppOwnerScope(storage, config, agentGaii);
            if (!scope) {
                return { content: [{ type: 'text' as const, text: 'Failed to parse agent GAII' }], isError: true };
            }

            const badName = appFilenameRefusal(filename);
            if (badName) {
                return { content: [{ type: 'text' as const, text: badName.refusal.message }], isError: true };
            }

            // --- UPLOAD MODE: no content provided, return presigned upload URL ---
            if (!content_base64) {
                const MAX_APP_SIZE = config.appMaxSizeMb * 1024 * 1024;
                const token = await generateUploadToken({
                    sub: scope.ownerGhii,
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
                        ai_provenance, ai_provenance_id, spec_token, spec_ack,
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
                    ownerName: scope.ownerName,
                    ownerGhii: scope.ownerGhii,
                    callerGaii: agentGaii,
                    filename,
                    data,
                    mimeType: 'text/html',
                    requested: { name, description, category, tags, icon, version, cortexAgents },
                    accessCode: { mode: 'carry' },
                    source: 'inline',
                    declaredProvenanceId: ai_provenance_id,
                    declaredProvenance: toDeclaredProvenance(ai_provenance),
                    specToken: spec_token,
                    specAck: spec_ack,
                });
                if ('refusal' in out) {
                    return { content: [{ type: 'text' as const, text: refusalText(out.refusal) }], isError: true };
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
                            spec_check: out.specCheck,
                            ...(out.artifactWarnings.length ? { app_hints: out.artifactWarnings } : {}),
                            next_steps: out.nextSteps,
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
            const scope = await resolveAppOwnerScope(storage, config, agentGaii);
            if (!scope) return { content: [{ type: 'text' as const, text: 'Failed to parse agent GAII' }], isError: true };
            const data = Buffer.from(content_base64, 'base64');
            try {
                // The draft slot is written in services/app-lifecycle.ts, the same function
                // PUT /v1/apps/:owner/:filename/draft calls. The two used to build the manifest
                // separately and disagreed on the default category.
                const staged = await stageAppDraft(storage, config, {
                    ownerName: scope.ownerName,
                    ownerGhii: scope.ownerGhii,
                    filename,
                    data,
                    requested: { name, description, category, tags, icon },
                });
                if ('refusal' in staged) {
                    return { content: [{ type: 'text' as const, text: refusalText(staged.refusal) }], isError: true };
                }
                // Mint a preview token + apex preview URL. On a node with the app origin ON the
                // apex GET handler 301-redirects this to the isolated origin (preserving the
                // token), so the SAME URL works in both postures.
                const token = await generateDraftToken({ sub: scope.ownerGhii, filename }, 600);
                const previewUrl = `${config.baseUrl}/v1/apps/${encodeURIComponent(scope.ownerName)}/${encodeURIComponent(filename)}?mode=inline&preview=${encodeURIComponent(token)}`;
                logger.info(`App draft saved via MCP: ${filename}`, { by: agentGaii });
                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({
                            filename,
                            saved: true,
                            has_live_version: staged.hasLiveVersion,
                            live_version_number: staged.liveVersionNumber,
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
        {
            filename: z.string().describe('App filename whose saved draft should be promoted to a new live version.'),
            ...aiProvenanceInputs,
            ...specGateInputs,
        },
        annotationsFor('aimeat_app_draft_publish'),
        async ({ filename, ai_provenance, ai_provenance_id, spec_token, spec_ack }) => {
            const agentGaii = getAgentGaii();
            const scope = await resolveAppOwnerScope(storage, config, agentGaii);
            if (!scope) return { content: [{ type: 'text' as const, text: 'Failed to parse agent GAII' }], isError: true };
            // Loaded here rather than in the service so this door can name ITS remedy; the HTTP door
            // points at `PUT .../draft` for the same condition.
            const draft = await storage.getAppDraft(scope.ownerGhii, filename);
            if (!draft) {
                return { content: [{ type: 'text' as const, text: `No draft to publish for "${filename}". Save one with aimeat_app_draft_save first.` }], isError: true };
            }
            try {
                // The promotion, including the draft-slot clear, is services/app-lifecycle.ts — the
                // same function POST .../publish-draft calls. Both doors used to map the draft
                // manifest onto the publish input by hand, nine fields each.
                const out = await publishAppDraft(storage, config, {
                    ownerName: scope.ownerName,
                    ownerGhii: scope.ownerGhii,
                    callerGaii: agentGaii,
                    filename,
                    draft,
                    declaredProvenanceId: ai_provenance_id,
                    declaredProvenance: toDeclaredProvenance(ai_provenance),
                    specToken: spec_token,
                    specAck: spec_ack,
                });
                if ('refusal' in out) {
                    // The draft stays: a refused promotion is work to fix, not work to lose.
                    return { content: [{ type: 'text' as const, text: refusalText(out.refusal) }], isError: true };
                }
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
                            spec_check: out.specCheck,
                            ...(out.artifactWarnings.length ? { app_hints: out.artifactWarnings } : {}),
                            next_steps: out.nextSteps,
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
            const scope = await resolveAppOwnerScope(storage, config, agentGaii);
            if (!scope) return { content: [{ type: 'text' as const, text: 'Failed to parse agent GAII' }], isError: true };
            const discarded = await discardAppDraft(storage, scope.ownerGhii, filename);
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
                limit: z.number().int().min(1).max(200).optional()
                    .describe('How many to return (default 50, max 200).'),
                offset: z.number().int().min(0).optional()
                    .describe('How many to skip. With `total` and `has_more` in the answer, this is how the whole catalogue is read: keep calling with offset += limit while has_more is true.'),
            },
            annotations: annotationsFor('aimeat_app_list'),
            // A host that renders MCP Apps shows the card grid; one that does not ignores this
            // field and shows the same JSON it always did. Nothing is lost either way.
            // Both keys, for the reason spelled out on uiToolMeta. Omitted entirely on a node that
            // cannot build the page, so a host is never pointed at a resource that is not there.
            ...(appUiAvailable() ? { _meta: uiToolMeta(APP_INDEX_UI_URI) } : {}),
        },
        async ({ category, search, tag, own, limit, offset }) => {
            const agentGaii = getAgentGaii();
            // The same bucket key the write tools use, so `own: true` cannot list a set the delete
            // tool then fails to find.
            const ownerGhii = (await resolveAppOwnerScope(storage, config, agentGaii))?.ownerGhii
                ?? `${agentGaii}@${config.nodeId}`;

            // PAGING, because the catalogue outgrew the page. A fixed 50 with no way to ask for the
            // rest left the agent explaining its own instrument to the person — "there are 138, I
            // can see 50, tell me a filter" — which is a tool making its limitation somebody else's
            // problem. The window is the caller's, the total is the truth, and `has_more` says
            // whether another call is worth making.
            const take = Math.min(Math.max(limit ?? 50, 1), 200);
            const skip = Math.max(offset ?? 0, 0);
            const opts = {
                category,
                q: search,
                tag,
                sort: 'newest' as const,
                limit: take,
                offset: skip,
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
                    text: JSON.stringify({
                        apps: result,
                        total,
                        limit: take,
                        offset: skip,
                        has_more: skip + result.length < total,
                    }, null, 2),
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

            // Two notes on the manifest are the OWNER's own — the disclosure gap and the build-spec
            // state of their last publish — and this tool reads any owner's app. The catalogue
            // listing has stripped them from the start; this door had not.
            const isOwn = parseGAII(getAgentGaii())?.owner === app.ownerName;
            const manifest = isOwn ? app.manifest : {
                ...app.manifest,
                ...(app.manifest.aiPosture ? { aiPosture: publicPosture(app.manifest.aiPosture) } : {}),
                ...(app.manifest.specCheck ? { specCheck: undefined } : {}),
            };

            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({
                        owner: app.ownerName,
                        filename: app.filename,
                        version_number: app.versionNumber,
                        manifest,
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
            const scope = await resolveAppOwnerScope(storage, config, agentGaii);
            if (!scope) {
                return { content: [{ type: 'text' as const, text: 'Failed to parse agent GAII' }], isError: true };
            }

            try {
                // The delete is services/app-lifecycle.ts, the same function DELETE /v1/apps/:filename
                // calls. This tool used to delete one bucket and stop: the ghost rows an old publish
                // path left behind stayed listed, and the app's screenshot stayed in storage forever.
                const out = await deleteOwnedApp(storage, {
                    ownerName: scope.ownerName,
                    ownerGhii: scope.ownerGhii,
                    callerGaii: agentGaii,
                    filename,
                    version,
                });
                if ('refusal' in out) {
                    return { content: [{ type: 'text' as const, text: out.refusal.message }], isError: true };
                }

                logger.info(`App deleted via MCP: ${filename}${version ? ` v${version}` : ' (all versions)'}`, { by: agentGaii });
                emitResourceListChanged(agentGaii);

                return {
                    content: [{
                        type: 'text' as const,
                        text: JSON.stringify({
                            filename,
                            version_deleted: out.versionDeleted,
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

    registerAppForkTool(mcp, storage, config, getAgentGaii, emitResourceListChanged);
}
