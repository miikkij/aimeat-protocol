/**
 * @file src/tool-catalog/definitions/apps-publish.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The app publishing and draft tools, and the four that followed them in the list: SEO status and announce, image generation and the admin mint.
 *   Moved unchanged out of organisms-workspaces-apps.ts, which would have passed its 800 lines when its definitions took
 *   their exact schemas, annotations, scopes and surfaces (secaudit 2026-10, M3). Spread back in place there,
 *   so the catalog order is what it was.
 * @usage imported by ./organisms-workspaces-apps.ts
 * @version-history
 *   v1.1.0 — 2026-10-06 — aimeat_app_publish and aimeat_app_draft_save are the one schema all three
 *     surfaces register: publish types its tags and crew-defs, and the draft takes content or
 *     content_base64 (both base64) and the category, tags and icon the surfaces already took
 *     (secaudit 2026-10 follow-up, Part B).
 *   v1.0.0 — 2026-10-05 — Extracted from organisms-workspaces-apps.ts (pure extraction; no behavior change).
 */
import { z } from 'zod';
import type { AimeatToolDefinition } from './types.js';
import { agentEverywhere } from './types.js';
import { AI_PROVENANCE_TOOL_NOTE, aiProvenanceCatalogInput } from './ai-provenance-note.js';
import { AI_ROLE_PARAM } from './ai-models.js';

/**
 * The build-spec pair, declared once for both publish tools. The node's MCP wrote these two out by
 * hand with the fuller descriptions below, and the catalog's one-line ones were what the other two
 * surfaces showed (secaudit 2026-10 follow-up, Part B).
 */
const SPEC_GATE_INPUT = {
    spec_token: {
        type: 'string',
        description: 'The `spec_token` from GET /v1/prompts/build-app — the digest of the build spec you built against. '
            + 'It changes when the spec changes. Omitting it publishes anyway and returns spec_check.status "missing"; '
            + 'an out-of-date one returns "stale". Fetch the spec and pass the token rather than guessing a value: '
            + 'the point is that you read what it currently says.',
    },
    spec_ack: {
        type: 'string',
        description: 'Send "skipped-by-owner" when the owner explicitly told you to publish without reading the build spec. '
            + 'The publish is recorded as skipped on the node\'s change log instead of passing silently.',
    },
} as const;

export const appPublishTools = [
    {
        name: 'aimeat_app_publish',
        description: 'Publish or update an HTML app STRAIGHT TO LIVE (versioned by group) — every call becomes the new live version users get immediately. START FROM THE SHELL: fetch `GET /v1/app-templates` and build on one, rather than writing an app from scratch. The shell carries the login pill, the language and theme controls, and the design system the node already serves; an app written from nothing typically ships without them, and the person only finds out by opening it. Two modes: UPLOAD MODE (recommended for files > 1 KB) — call with metadata only (omit content), get an upload_url, then PUT the raw HTML; the PUT response is the publish result. INLINE MODE — pass content for tiny files. Use @file:path with the CLI fallback. DECIDING LIVE vs STAGING: use this when you are confident the app works. When you want to TEST the next version first (e.g. anything using the microphone/camera, which only work on a real origin — never in an embedded preview), stage it with aimeat_app_draft_save, open its preview_url to verify, then aimeat_app_draft_publish — the live app stays untouched until you do.' + AI_PROVENANCE_TOOL_NOTE,
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Publish App', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        scope: 'app:write',
        surfaces: ['appdev'],
        input: {
            owner: { type: 'string', description: 'App owner. Omit for your own apps; another owner requires a development grant.' },
            roadmap: { type: 'string', description: 'What this version changes. Required when the app is shared with another developer.' },
            ...SPEC_GATE_INPUT,
            ...aiProvenanceCatalogInput,
            filename: { type: 'string', required: true, description: 'App filename, e.g. "starwars.html". Alphanumeric, dots, hyphens, underscores.' },
            name: { type: 'string', required: true, description: 'Display name shown in the catalogue.' },
            content: { type: 'string', description: 'The app HTML as plain text; the tool encodes it. Omit both content fields for upload mode. Use @file:path with the CLI fallback.' },
            content_base64: { type: 'string', description: 'Already base64-encoded HTML, if you did the encoding yourself. Give this or content, not both.' },
            description: { type: 'string', description: 'Short description.' },
            category: { type: 'string', description: 'Category (default "tool").' },
            tags: { type: 'array', description: 'Tags for search and filtering.', zod: z.array(z.string()) },
            icon: { type: 'string', description: 'Emoji icon.' },
            version: { type: 'string', description: 'Semver display version. Generated if omitted.' },
            cortex_agents: { type: 'array', description: 'Declarative crew-defs this app ships (manifest.cortex.agents), validated at publish in both modes. Omit on update to carry them forward; [] clears.', zod: z.array(z.record(z.string(), z.unknown())) },
        },
    },
    {
        name: 'aimeat_app_list',
        description: 'List published HTML apps on the node (name, description, version, category, tags, size, download count, and `url` — the app\'s public web address, which is what to give a person who wants to open it), with optional category/tag/text filters and an "own apps only" mode. Paged: the answer carries `total`, `limit`, `offset` and `has_more`, so read the whole catalogue by calling again with offset += limit while has_more is true. Use to discover apps and to show someone their own; fetch one app\'s detail with aimeat_app_get and its version history with aimeat_app_manage { action: "versions" }. Publish with aimeat_app_publish.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'List Apps', readOnlyHint: true },
        // On `chat`: Their apps and skills.
        surfaces: ['appdev', 'chat'],
        input: {
            building: { type: 'boolean', description: 'List apps another owner lets you build; opt-in and separate from your own.' },
            search: { type: 'string', description: 'Free-text search over name and description.' },
            category: { type: 'string', description: 'Filter by category.' },
            tag: { type: 'string', description: 'Filter by tag.' },
            own: { type: 'boolean', description: "List only your own owner's apps." },
            limit: { type: 'number', description: 'How many to return (default 50, max 200).', zod: z.number().int().min(1).max(200) },
            offset: { type: 'number', description: 'How many to skip; with has_more this reads the whole catalogue.', zod: z.number().int().min(0) },
        },
    },
    {
        name: 'aimeat_app_get',
        description: 'Get one app\'s detail (manifest, current version number, size, mime type, whether access-protected, download count, `url` — the app\'s public web address to give a person — and the download/inline URLs) identified by its owner and filename. Find owner/filename via aimeat_app_list; for the list of prior versions use aimeat_app_manage { action: "versions" }.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Get App', readOnlyHint: true },
        surfaces: ['appdev'],
        input: {
            owner: { type: 'string', required: true, description: 'Owner name of the app.' },
            filename: { type: 'string', required: true, description: 'App filename, e.g. "starwars.html".' },
        },
    },
    {
        name: 'aimeat_app_delete',
        description: 'Archive (soft-delete) an app. Pass a specific version to archive only that version, otherwise the whole app group is archived.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Delete App', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
        // The destructive half: delete an app. Split from write because shipping an update and
        // removing the thing are different risks.
        scope: 'app:manage',
        surfaces: ['appdev'],
        input: {
            filename: { type: 'string', required: true, description: "App filename to archive (your own owner's)." },
            version: { type: 'number', description: 'A specific version number. Omit to archive all versions.' },
        },
    },
    {
        name: 'aimeat_app_fork',
        description: 'Fork an app into your own catalogue as a new independent app, recording its origin (manifest.forkedFrom) and a lineage event. You may fork your own apps freely; you may fork someone else\'s only when they have marked it forkable (and, for a paid app, you hold a license). This is the sanctioned, provenance-recording path — prefer it over app_get+app_publish so the fork chain stays intact.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Fork App', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        scope: 'app:write',
        surfaces: ['appdev'],
        input: {
            owner: { type: 'string', required: true, description: 'Owner name of the source app.' },
            filename: { type: 'string', required: true, description: 'Filename of the source app.' },
            new_filename: { type: 'string', required: true, description: 'Filename for the fork in your catalogue.' },
            version: { type: 'number', description: 'Source version to fork (default: latest).' },
        },
    },
    {
        name: 'aimeat_app_draft_save',
        description: 'STAGING — save the NEXT version of an app as a draft WITHOUT touching the live one, and get a preview_url to test it on a real origin before publishing. Use this instead of aimeat_app_publish whenever you want to VERIFY before going live — especially for anything using the microphone or camera (getUserMedia only works on a real, top-level origin; it is impossible in an embedded/sandboxed preview, so testing in a preview pane will always "fail"). Flow: aimeat_app_draft_save → open preview_url in a browser (a real tab, mic/camera prompts work) → if good, aimeat_app_draft_publish; if not, edit + save again, or aimeat_app_draft_discard. The live app (the version users see) stays exactly as it was until you publish the draft. At most one draft per app; saving again overwrites it. Manifest fields you omit default from the current live app. UPLOAD/SIZE: this tool is INLINE-ONLY — unlike aimeat_app_publish it has no presigned upload_url mode, so content_base64 must be inline. Do NOT read/cat/paste a large base64 blob to feed it (a ~60 KB single-line base64 file bills ~2.5 tokens/char and wastes tens of thousands of tokens). For an app over ~1 KB, prefer aimeat_app_publish in UPLOAD MODE (omit content → PUT the raw file) — going straight to live is fine when the app link is not yet distributed and the real send/use is gated elsewhere; only pay the inline staging cost for a small app, or one you genuinely must preview before it is ever live (e.g. a mic/camera app).',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Save App Draft', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        scope: 'app:write',
        surfaces: ['appdev'],
        input: {
            owner: { type: 'string', description: 'App owner. Omit for your own apps; another owner requires a development grant.' },
            filename: { type: 'string', required: true, description: 'App filename this draft stages (e.g. "drumpad.html").' },
            // Base64 under both names: the connector and the shell have read `content` as base64 since
            // the tool was written, and the node's MCP named it content_base64. One of the two is needed.
            content: { type: 'string', description: 'Base64-encoded HTML of the draft (the next version to test). Give this or content_base64. Use @file:path with the CLI fallback.' },
            content_base64: { type: 'string', description: 'The same base64-encoded HTML, under the name the node\'s MCP used. Give this or content.' },
            name: { type: 'string', description: 'Display name (defaults to the live app\'s).' },
            description: { type: 'string', description: 'Description (defaults to the live app\'s).' },
            category: { type: 'string', description: 'Category (defaults to the live app\'s).' },
            tags: { type: 'array', description: 'Tags (default: the live app\'s).', zod: z.array(z.string()) },
            icon: { type: 'string', description: 'Emoji icon (defaults to the live app\'s).' },
        },
    },
    {
        name: 'aimeat_app_draft_publish',
        description: 'Promote an app\'s saved draft to a NEW live version, then clear the draft slot — THIS is the moment the live app changes. Carries the live app\'s parked/forkable/protection state forward, exactly like a normal re-publish. Call this after you have tested the draft via the preview_url from aimeat_app_draft_save and it works. Fails if there is no saved draft.' + AI_PROVENANCE_TOOL_NOTE,
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Publish App Draft', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        scope: 'app:write',
        surfaces: ['appdev'],
        input: {
            owner: { type: 'string', description: 'App owner. Omit for your own apps; another owner requires a development grant.' },
            roadmap: { type: 'string', description: 'What this version changes. Required when the app is shared with another developer.' },
            ...SPEC_GATE_INPUT,
            ...aiProvenanceCatalogInput,
            filename: { type: 'string', required: true, description: 'App filename whose draft to publish.' },
        },
    },
    {
        name: 'aimeat_app_draft_discard',
        description: 'Throw away an app\'s saved draft. The live app is untouched. Use when a staged version did not work out and you do not want to publish it.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Discard App Draft', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
        // Publish or update an app under the owner's account, including drafts.
        scope: 'app:write',
        surfaces: ['appdev'],
        input: {
            owner: { type: 'string', description: 'App owner. Omit for your own apps; another owner requires a development grant.' },
            filename: { type: 'string', required: true, description: 'App filename whose draft to discard.' },
        },
    },
    {
        name: 'aimeat_app_draft_write',
        description: 'Write into an app\'s draft slot a PIECE AT A TIME, so you can build an app larger than one model response. This is the way to author a real app: no model emits 400 kB in one go, and there is no filesystem here to assemble it on. Call repeatedly with mode "append" until the file is complete, then aimeat_app_draft_publish. Use mode "replace" for the first call, or to start over. Content is plain UTF-8 text, NOT base64. To continue an app that is already live, copy it into the slot first with aimeat_app_draft_seed. To change something you already wrote, prefer aimeat_app_draft_replace over rewriting the whole file. Pass expected_size_bytes when you are appending across many calls and want to be told if the draft moved underneath you.',
        caller: 'agent',
        visibility: agentEverywhere,
        // append is not idempotent: calling it twice writes the chunk twice, which is the whole point of
        // building a file across many calls. A client that retries on timeout must use expected_size_bytes.
        annotations: { title: 'Write App Draft', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        scope: 'app:write',
        surfaces: ['appdev'],
        input: {
            owner: { type: 'string', description: 'App owner. Omit for your own apps; another owner requires a development grant.' },
            filename: { type: 'string', required: true, description: 'App filename this draft stages (e.g. "pong.html").' },
            content: { type: 'string', required: true, description: 'The text to write. Plain UTF-8, not base64.' },
            mode: { type: 'string', enum: ['append', 'replace'], description: 'append (default) adds to the end; replace overwrites the whole draft.' },
            expected_size_bytes: { type: 'number', description: 'Refuse unless the draft is currently this many bytes. Guards a multi-call build against a lost update.', zod: z.number().int().nonnegative() },
            name: { type: 'string', description: 'Display name (defaults to the live app\'s, or the draft\'s once set).' },
            description: { type: 'string', description: 'Description (defaults to the live app\'s, or the draft\'s once set).' },
        },
    },
    {
        name: 'aimeat_app_draft_replace',
        description: 'Replace an exact piece of text inside an app\'s draft, the way an editor does. Use this to iterate: read the part you want to change with aimeat_app_draft_read, then replace it, instead of rewriting the whole app through your context. old_string must match EXACTLY, including indentation and line breaks, and must appear exactly once unless you set replace_all. When it is not unique the refusal tells you how many times it appeared, so widen the surrounding text until the match is unambiguous rather than guessing.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Replace In App Draft', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        scope: 'app:write',
        surfaces: ['appdev'],
        input: {
            owner: { type: 'string', description: 'App owner. Omit for your own apps; another owner requires a development grant.' },
            filename: { type: 'string', required: true, description: 'App filename whose draft to edit.' },
            old_string: { type: 'string', required: true, description: 'The exact text to replace, including indentation.' },
            new_string: { type: 'string', required: true, description: 'What to put there instead.' },
            replace_all: { type: 'boolean', description: 'Replace every occurrence instead of requiring exactly one. Default false.' },
        },
    },
    {
        name: 'aimeat_app_draft_read',
        description: 'Read a line range of an app\'s draft. Returns the slice plus the total line count and byte size, so you can page through a large app without pulling all of it into context. Ask for the part you are about to change, not the whole file: a read with no range returns the first page and tells you that more remains. Line numbers are 1-based.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Read App Draft', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        scope: 'app:write',
        surfaces: ['appdev'],
        input: {
            owner: { type: 'string', description: 'App owner. Omit for your own apps; another owner requires a development grant.' },
            filename: { type: 'string', required: true, description: 'App filename whose draft to read.' },
            offset: { type: 'number', description: 'First line to return, 1-based. Default 1.', zod: z.number().int().min(1) },
            limit: { type: 'number', description: 'How many lines to return. Default 400, maximum 2000.', zod: z.number().int().min(1) },
        },
    },
    {
        name: 'aimeat_app_draft_seed',
        description: 'Copy a published app\'s source into its draft slot, server-side, so you can continue an app you already shipped. This is the missing first step when someone asks you to change a live app: aimeat_app_get returns the manifest and NOT the source, so without this there is nothing to edit. The bytes never pass through your context. Seed, then read and replace the parts you need, then aimeat_app_draft_publish. Seeding under a different filename copies the app, manifest and all.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Seed App Draft', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        scope: 'app:write',
        surfaces: ['appdev'],
        input: {
            owner: { type: 'string', description: 'App owner. Omit for your own apps; another owner requires a development grant.' },
            filename: { type: 'string', required: true, description: 'The draft slot to write into.' },
            from_filename: { type: 'string', description: 'The published app to copy from. Defaults to filename.' },
            version: { type: 'number', description: 'Which published version. Defaults to the newest.', zod: z.number().int().min(1) },
        },
    },
    {
        name: 'aimeat_seo_status',
        description: 'Whether this node can be found in a search engine, and what is still undone about it. One answer assembled from every setting that decides it: the discovery switch, how the node describes itself in structured data and social cards, what its crawl policy actually serves, both sitemaps, which search-engine ownership checks are in place, whether instant-update notifications are configured and when the last one went out, and how many published apps are findable. Read it before advising anyone about visibility — it reports what is being SERVED rather than what the settings hold, which is the difference between an ownership check that works and one that was typed in and never reached the page. Operator-only.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Search Visibility Status', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        // The node's discovery status and the announcement to search engines. Both refuse everyone but
        // the operator in their handler, so the word is the operator's (security audit A8-1): on app:write,
        // which every Full-access agent holds, any agent of the operator could tell the search engines
        // about the whole node.
        scope: 'operator:admin',
        surfaces: ['appdev'],
        input: {},
    },
    {
        name: 'aimeat_seo_announce',
        description: 'Tell the search engines about the whole site now, through IndexNow: the node\'s pages and, by default, every findable application, sent as one batch per host under that host\'s own key file. It reaches Bing (and through Bing, Copilot and ChatGPT search), Yandex, Naver, Seznam and Yep; Google does not take part, so the sitemap stays the way Google hears. It is a knock, not an order: each engine decides whether to come and what to keep, and a site never verified in Bing Webmaster Tools gets little of Bing\'s time, so read aimeat_seo_status first and get the verification done. With plan: true it lists what would be sent, host by host, and sends nothing. Refuses when no IndexNow key is configured or when the node turns search engines away. Operator-only.',
        caller: 'agent',
        visibility: agentEverywhere,
        // Open world: it posts to api.indexnow.org. Idempotent: the same notice twice is the same notice.
        annotations: { title: 'Instant Update to Search Engines', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
        scope: 'operator:admin',
        surfaces: ['appdev'],
        input: {
            scope: { type: 'string', description: '"all" (default): the pages and every findable application. "pages": the pages alone.', zod: z.enum(['all', 'pages']) },
            plan: { type: 'boolean', description: 'true lists what would be sent, host by host, and sends nothing.' },
        },
    },
    {
        name: 'aimeat_image_generate',
        description: 'Make a picture from a description, on the owner\'s AI key, and store it. Returns a storage key and a URL rather than the image itself, so the bytes never travel through your context. Pass public: true when a model or a web page has to fetch it back by URL; leave it off for anything private. Needs an IMAGE model to be configured (Profile > OpenRouter, or a node default) — it refuses by name rather than handing the request to a chat model, because a chat model answers an image request with prose. Spends the owner\'s daily AI budget and reports what it cost.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Generate Image', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
        scope: 'ai:use',
        surfaces: ['appdev', 'agent'],
        input: {
            prompt: { type: 'string', required: true, description: 'What the picture should show.' },
            size: { type: 'string', description: 'Provider-specific size, e.g. "1024x1024".' },
            storage_key: { type: 'string', description: 'Where to store it. Defaults to ai-images/<timestamp>-<random>.<ext>.' },
            public: { type: 'boolean', description: 'Make it publicly readable so a model or page can fetch it. Default false.' },
            model: { type: 'string', description: 'Override the image model.' },
            app_id: { type: 'string', description: 'Attribution for the per-app quota and the spend report.' },
            provider: { type: 'string', description: 'One of the owner\'s AI providers (aimeat_ai_providers), or a type. No fallback then.' },
            fallback: { type: 'boolean', description: 'false keeps the call on its first provider; omitted, the owner\'s rules decide.' },
            role: { type: 'string', description: AI_ROLE_PARAM, zod: z.string().min(1).max(300) },
        },
    },
    {
        // Server-only: operator-gated node administration. Not exposed on the connector
        // MCP or CLI fallback. Present here so the catalog is complete vs every registered tool.
        name: 'aimeat_admin_mint',
        description: 'Operator-only. Mint morsels into an agent\'s owner balance (irreversible ledger credit). Enforces the node\'s daily mint cap. Use sparingly — this is a financial action; prefer the normal earn/transfer flow where possible.',
        caller: 'operator',
        visibility: { publicMcp: true, connectorMcp: false, cliFallback: false },
        // destructiveHint: mints morsels (irreversible ledger change, financial action)
        annotations: { title: 'Admin: Mint Morsels', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
        scope: 'operator:admin',
        surfaces: ['admin'],
        input: {
            gaii: { type: 'string', required: true, description: 'Target agent GAII whose owner balance is credited.' },
            amount: { type: 'number', required: true, description: 'Positive integer amount of morsels to mint.', zod: z.number().int().positive() },
        },
    },
] as const satisfies readonly AimeatToolDefinition[];
