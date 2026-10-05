/**
 * @file extensions-cortex.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Tool definitions for the sandboxed server extensions, the per-app IAM design door,
 *   and the browser-side cortex packs.
 *
 *   Extracted from organisms-workspaces-apps.ts unchanged when that file passed the 800-line
 *   ceiling. A pure move: same entries, same descriptions, same visibility, concatenated back into
 *   the same exported list. That file is named for organisms, workspaces and apps, and extensions
 *   were never any of the three.
 * @structure extensionsCortexTools[] — concatenated into organismsWorkspacesAppsTools
 * @usage import { extensionsCortexTools } from './extensions-cortex.js';
 * @version-history
 *   2026-10-05 — The group is declared `as const satisfies`, its exact field schemas are here, and each
 *     definition carries its annotations, scope and surfaces (secaudit 2026-10, M3).
 *   v1.6.0 — 2026-10-01 — aimeat_iam_define says what it returns (matrix, extension, apply) and how to
 *     use the generated gate: install it with aimeat_extension_install, then AIMEAT.iam.init({ app, ext }).
 *     It had sent the caller to an `admin` action the generated gate does not have. New inputs
 *     default_role, version, author and ext_name reach the generator. Audit 2026-10-01, defect B.
 *   v1.5.0 — 2026-09-26 — aimeat_cortex_delete says what an uninstall removes.
 *   v1.4.0 — 2026-09-26 — aimeat_cortex_install says that a ZIP upload under the name of a cortex the
 *     caller installed replaces it the way update:true does, and what the redeploy of an active one
 *     takes down.
 *   v1.3.0 — 2026-09-26 — aimeat_cortex_deactivate says what a deactivation removes, whoever activated
 *     the cortex, and what stays.
 *   2026-09-27 — Agent-facing texts use industry terms: door, surface and the house became endpoint, tool, interface, page or this server (docs/coding-guidelines/shell-and-git.md).
 *   v1.2.0 — 2026-09-27 — aimeat_cortex_list takes name and include_source: one cortex in full, and its source.
 *   v1.1.0 — 2026-09-13 — aimeat_extension_get takes include_source (each action's script, for the
 *     installer's own sessions holding ext:write), and aimeat_cortex_install takes update (redeploy in
 *     place) and names lib_urls. Over MCP an installed extension's code could not be read back and a
 *     cortex could not be updated at all; the description sent an MCP-only agent to a REST route.
 *   v1.0.0 — 2026-08-25 — Extracted from organisms-workspaces-apps.ts (max-file-lines)
 */
import { z } from 'zod';
import type { AimeatToolDefinition } from './types.js';
import { agentEverywhere } from './types.js';

export const extensionsCortexTools = [
    {
        name: 'aimeat_extension_list',
        description: 'List the node\'s ACTIVE server-side extensions with their version, description, author, available actions (id/method/path), and federation flags. Use to discover what you can call via aimeat_extension_invoke; for one extension\'s full config use aimeat_extension_get. Inactive/installed-but-not-activated extensions are not shown here.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'List Extensions', readOnlyHint: true },
        surfaces: ['appdev'],
        input: {},
    },
    {
        name: 'aimeat_extension_invoke',
        description: 'Run one action of an installed, active extension by extension name + action id, passing input params (optionally scoped to a specific extension instance). Executes server-side in the sandbox and returns the action\'s result. The extension and action must exist and be active. Discover actions with aimeat_extension_list / aimeat_extension_get.',
        caller: 'agent',
        visibility: agentEverywhere,
        // openWorldHint: extension actions run user-provided WASM with ctx.fetch -- effects unbounded
        annotations: { title: 'Invoke Extension Action', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
        // RUN an installed extension's action. Separate from ext:write, which is about which
        // extensions exist — using a capability is not the same as installing one.
        scope: 'ext:invoke',
        surfaces: ['appdev'],
        input: {
            extension_name: { type: 'string', required: true, description: 'Name of the extension to invoke.' },
            action_id: { type: 'string', required: true, description: 'Action identifier.' },
            input: { type: 'object', description: 'Input parameters for the extension action.' },
            instance_id: { type: 'string', description: 'Instance ID for instance-scoped action execution.' },
        },
    },
    {
        name: 'aimeat_extension_install',
        description: 'Install or update a server-side extension (sandboxed WASM that can store ext: memory and call external APIs via ctx.fetch). BEFORE you build one to fetch something on a person\'s behalf on a schedule: check whether one of their agents should do it instead: load `node:aimeat-recurring-work`. An extension you write is a fourth parallel implementation if they already have an agent doing it, and it will not show up in any of their agent screens. Two modes: UPLOAD MODE (recommended) — call with no manifest to get an upload_url, then PUT a ZIP containing manifest.yaml at root and scripts in scripts/. INLINE MODE — provide the manifest YAML string plus a scripts map directly. Updating an installed extension: pass update:true to upsert it in place (activation status, lifecycle fields and its ext: memory are preserved; owner-gated). Pass activate:true to activate in the same call; otherwise activate with aimeat_extension_activate.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Install Extension', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        // Install, activate, deactivate or delete an extension.
        scope: 'ext:write',
        surfaces: ['appdev'],
        input: {
            manifest: { type: 'string', description: 'Extension manifest in YAML format. Omit to get an upload_url for a ZIP bundle. Use @file:path with the CLI fallback.' },
            scripts: { type: 'object', description: 'Map of script filename to JavaScript source code. Omit for upload mode.', zod: z.record(z.string(), z.string()) },
            update: { type: 'boolean', description: 'Upsert an already-installed extension in place (lifecycle + ext: memory preserved). Without this, an existing name is an error.' },
            activate: { type: 'boolean', description: 'Activate immediately after install/update.' },
        },
    },
    {
        name: 'aimeat_extension_activate',
        description: 'Activate an installed extension by name so its actions become invokable and its capabilities are aggregated. Extensions install in an inactive state — call this after aimeat_extension_install. Reverse with aimeat_extension_deactivate.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Activate Extension', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        // Extension lifecycle (POST /v1/extensions/:name/activate etc. → ext:write)
        // Install is NOT gated (mirrors REST: POST /v1/extensions is just requireAuth — agents
        // can push code, but it stays inert until ext:write activates it).
        scope: 'ext:write',
        surfaces: ['appdev'],
        input: { name: { type: 'string', required: true, description: 'Extension name.' } },
    },
    {
        name: 'aimeat_extension_deactivate',
        description: 'Deactivate an active extension by name, setting it inactive so its actions can no longer be invoked (it stays installed). Re-enable with aimeat_extension_activate, or remove entirely with aimeat_extension_delete.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Deactivate Extension', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        scope: 'ext:write',
        surfaces: ['appdev'],
        input: { name: { type: 'string', required: true, description: 'Extension name.' } },
    },
    {
        name: 'aimeat_extension_delete',
        description: 'Uninstall an extension by name, removing it from the node (it is deactivated first if active). Irreversible — its aggregated capabilities go away too. To merely pause it, use aimeat_extension_deactivate instead.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Delete Extension', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
        scope: 'ext:write',
        surfaces: ['appdev'],
        input: { name: { type: 'string', required: true, description: 'Extension name.' } },
    },
    {
        name: 'aimeat_extension_get',
        description: 'Get one extension\'s full detail by name: status, version, author, required APIs, every action with input/output schemas, config, resource limits, federation, and instance support. Works for inactive extensions too (unlike aimeat_extension_list). Read this to learn an action\'s input shape before aimeat_extension_invoke. Pass include_source:true to get each action\'s installed script as well, which is what you need to add an action or change one and redeploy with aimeat_extension_install update:true; only the installing owner\'s own sessions holding ext:write may read it, and anyone else is refused.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Get Extension', readOnlyHint: true },
        surfaces: ['appdev'],
        input: {
            name: { type: 'string', required: true, description: 'Extension name.' },
            include_source: { type: 'boolean', description: 'Also return each action\'s installed script. Refused unless this extension was installed by your own owner and the session holds ext:write.' },
        },
    },
    {
        name: 'aimeat_iam_define',
        description: 'Design an app\'s in-app permission model and get the gate that enforces it. Validates a level schema (ordinal levels, lower = more power, each with app capability strings; a level 0 holding "*" is required) and a command manifest (each command names the capability it needs and a mutation tier read|write|irreversible). A level also holds every weaker level\'s capabilities. It changes no live state; it returns: `matrix`, per level the commands it may run and the ones a human should confirm; `extension`, only when app_id names an app as owner/file.html, an installable gate { name, manifest, scripts } with the actions check, commands and roles, which reads each caller\'s role from the app\'s member list on this node; and `apply`, setRoles/setLevels/setCommands payloads for the "admin" action of an aimeat-iam package install (aimeat_extension_invoke), which the generated gate does not need. To use the generated gate: install it with aimeat_extension_install { manifest: extension.manifest, scripts: extension.scripts, activate: true } (add update: true and the next version when regenerating over an installed gate), then in the app call AIMEAT.iam.init({ app: "<owner/file.html>", ext: extension.name }) from the aimeat-iam browser library. One model for both user kinds (a person and their agents).',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Design App IAM', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        surfaces: ['appdev'],
        input: {
            app_id: { type: 'string', description: 'owner/file.html of the app the gate protects; with it the result includes the installable `extension`. A name without a slash only labels the schema and generates no extension.' },
            levels: { type: 'array', required: true, description: 'Level schema: array of { level (int, 0 = most power), key, label, capabilities: string[] }.', zod: z.array(z.object({
                level: z.number(), key: z.string(), label: z.string(), capabilities: z.array(z.string()),
            })) },
            commands: { type: 'array', required: true, description: 'Command manifest: array of { id, description, capability, tier: read|write|irreversible }.', zod: z.array(z.object({
                id: z.string(), description: z.string(), capability: z.string(),
                tier: z.enum(['read', 'write', 'irreversible']),
            })) },
            default_role: { type: 'string', description: 'Level key that a signed-in caller who is not on the member list holds in the generated gate. Omit for a members-only app. A level holding "*" is refused.' },
            version: { type: 'string', description: 'Manifest version of the generated gate, x.y.z. Default 1.0.0; pass the next version when you regenerate an installed gate.' },
            author: { type: 'string', description: 'Manifest author of the generated gate. Default "generated".' },
            ext_name: { type: 'string', description: 'Extension name of the generated gate (lowercase letters, digits, hyphens). Default: a slug of app_id plus -iam.' },
        },
    },
    {
        name: 'aimeat_cortex_list',
        description: 'List installed cortex extensions (browser-side UI/IIFE bundles) with name, version, status, visibility, namespace, tags, and author. Cortex code runs in the browser (not server-side like a regular extension), so it cannot be invoked here — manage its lifecycle with aimeat_cortex_activate / _deactivate / _delete. Install with aimeat_cortex_install. Give `name` to read one cortex in full (its components, versions and what its activation created), and add include_source: true to get its manifest and lib files, which is what you edit before replacing it with aimeat_cortex_install update: true; the source belongs to the owner who installed it, and reading it needs the cortex:write permission.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'List Cortex Extensions', readOnlyHint: true },
        surfaces: ['appdev'],
        input: {
            name: { type: 'string', description: 'One cortex, in full, instead of the list.' },
            include_source: { type: 'boolean', description: 'With name: also its manifest and lib files, for editing. Your own cortex only; needs cortex:write.' },
        },
    },
    {
        name: 'aimeat_cortex_install',
        description: 'Install a cortex extension (browser-side IIFE that reads ext data and user data and renders rich UI), or redeploy one you installed. Two modes. UPLOAD MODE: call with no manifest to get an upload_url, then PUT a ZIP containing manifest.yaml at root and lib files in libs/. INLINE MODE: provide the manifest YAML string plus a libs map directly. Activate a new one afterwards with aimeat_cortex_activate. REDEPLOYING: pass update:true with the inline manifest and libs to replace your installed cortex of that metadata.name in place, with no delete: it stays served for the whole call, an active one is taken down and activated again from the new manifest (its old actions, boards, schema locks and prompts go, its seed data stays), and identical bytes answer "unchanged". Without update:true an inline install of a name that already exists is refused. A ZIP upload that carries the name of a cortex you installed replaces it the same way, without update:true. Do not delete a live cortex to reinstall it, because every app loading its lib breaks until the new one is active. The answer names each lib\'s address in lib_urls; that is the exact script src an app loads.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Install Cortex', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
        // Cortex management (POST/PUT/DELETE /v1/cortex* → cortex:write; PUT is the idempotent upsert)
        // List/get are NOT gated (mirrors REST: GET /v1/cortex is just requireAuth).
        scope: 'cortex:write',
        surfaces: ['appdev'],
        input: {
            manifest: { type: 'string', description: 'Cortex manifest in YAML format. Omit to get an upload_url for a ZIP bundle. Use @file:path with the CLI fallback.' },
            libs: { type: 'object', description: 'Map of filename to JavaScript source code for lib files. Omit for upload mode.' },
            update: { type: 'boolean', description: 'Replace your installed cortex of the manifest\'s metadata.name in place (inline mode). Without it an inline install of an existing name is refused; a ZIP upload replaces a cortex you installed either way.' },
        },
    },
    {
        name: 'aimeat_cortex_activate',
        description: 'Activate an installed cortex extension by name so its components become available to browser apps and its capabilities are aggregated. Idempotent — returns success if already active. Cortex installs inactive; call this after aimeat_cortex_install. Reverse with aimeat_cortex_deactivate.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Activate Cortex', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        scope: 'cortex:write',
        surfaces: ['appdev'],
        input: { name: { type: 'string', required: true, description: 'Cortex name.' } },
    },
    {
        name: 'aimeat_cortex_deactivate',
        description: 'Deactivate an active cortex extension by name, setting it inactive so its components are no longer served to apps (it stays installed). Its actions leave the catalogue and its schema locks, boards, prompts and ontologies are removed, also when another principal of the person (the person, an agent or an app of theirs) activated it. Its seed data and lib files stay. Idempotent — returns success if already inactive. Re-enable with aimeat_cortex_activate, or remove with aimeat_cortex_delete.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Deactivate Cortex', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        scope: 'cortex:write',
        surfaces: ['appdev'],
        input: { name: { type: 'string', required: true, description: 'Cortex name.' } },
    },
    {
        name: 'aimeat_cortex_delete',
        description: 'Uninstall a cortex extension by name. An active one is deactivated first, so its actions, boards, schema locks, prompts and ontologies go; then its seed data, stored lib files and kept versions go with it. Irreversible. To merely pause it, use aimeat_cortex_deactivate instead.',
        caller: 'agent',
        visibility: agentEverywhere,
        annotations: { title: 'Delete Cortex', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
        scope: 'cortex:write',
        surfaces: ['appdev'],
        input: { name: { type: 'string', required: true, description: 'Cortex name.' } },
    },
] as const satisfies readonly AimeatToolDefinition[];
