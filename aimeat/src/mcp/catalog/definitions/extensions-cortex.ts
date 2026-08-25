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
 *   v1.0.0 — 2026-08-25 — Extracted from organisms-workspaces-apps.ts (max-file-lines)
 */
import type { AimeatToolDefinition } from './types.js';
import { agentEverywhere } from './types.js';

export const extensionsCortexTools: AimeatToolDefinition[] = [
    {
        name: 'aimeat_extension_list',
        description: 'List the node\'s ACTIVE server-side extensions with their version, description, author, available actions (id/method/path), and federation flags. Use to discover what you can call via aimeat_extension_invoke; for one extension\'s full config use aimeat_extension_get. Inactive/installed-but-not-activated extensions are not shown here.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {},
    },
    {
        name: 'aimeat_extension_invoke',
        description: 'Run one action of an installed, active extension by extension name + action id, passing input params (optionally scoped to a specific extension instance). Executes server-side in the sandbox and returns the action\'s result. The extension and action must exist and be active. Discover actions with aimeat_extension_list / aimeat_extension_get.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            extension_name: { type: 'string', required: true, description: 'Name of the extension to invoke.' },
            action_id: { type: 'string', required: true, description: 'Action identifier.' },
            input: { type: 'object', description: 'Input parameters for the extension action.' },
            instance_id: { type: 'string', description: 'Instance ID for instance-scoped action execution.' },
        },
    },
    {
        name: 'aimeat_extension_install',
        description: 'Install or update a server-side extension (sandboxed WASM that can store ext: memory and call external APIs via ctx.fetch). BEFORE you build one to fetch something on a person\'s behalf on a schedule: check whether that belongs in their hatchery instead — load `node:hatchery-agent-requests`. An extension you write is a fourth parallel implementation if they already have an agent doing it, and it will not show up in any of their agent surfaces. Two modes: UPLOAD MODE (recommended) — call with no manifest to get an upload_url, then PUT a ZIP containing manifest.yaml at root and scripts in scripts/. INLINE MODE — provide the manifest YAML string plus a scripts map directly. Updating an installed extension: pass update:true to upsert it in place (activation status, lifecycle fields and its ext: memory are preserved; owner-gated). Pass activate:true to activate in the same call; otherwise activate with aimeat_extension_activate.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            manifest: { type: 'string', description: 'Extension manifest in YAML format. Omit to get an upload_url for a ZIP bundle. Use @file:path with the CLI fallback.' },
            scripts: { type: 'object', description: 'Map of script filename to JavaScript source code. Omit for upload mode.' },
            update: { type: 'boolean', description: 'Upsert an already-installed extension in place (lifecycle + ext: memory preserved). Without this, an existing name is an error.' },
            activate: { type: 'boolean', description: 'Activate immediately after install/update.' },
        },
    },
    {
        name: 'aimeat_extension_activate',
        description: 'Activate an installed extension by name so its actions become invokable and its capabilities are aggregated. Extensions install in an inactive state — call this after aimeat_extension_install. Reverse with aimeat_extension_deactivate.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: { name: { type: 'string', required: true, description: 'Extension name.' } },
    },
    {
        name: 'aimeat_extension_deactivate',
        description: 'Deactivate an active extension by name, setting it inactive so its actions can no longer be invoked (it stays installed). Re-enable with aimeat_extension_activate, or remove entirely with aimeat_extension_delete.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: { name: { type: 'string', required: true, description: 'Extension name.' } },
    },
    {
        name: 'aimeat_extension_delete',
        description: 'Uninstall an extension by name, removing it from the node (it is deactivated first if active). Irreversible — its aggregated capabilities go away too. To merely pause it, use aimeat_extension_deactivate instead.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: { name: { type: 'string', required: true, description: 'Extension name.' } },
    },
    {
        name: 'aimeat_extension_get',
        description: 'Get one extension\'s full detail by name: status, version, author, required APIs, every action with input/output schemas, config, resource limits, federation, and instance support. Works for inactive extensions too (unlike aimeat_extension_list). Read this to learn an action\'s input shape before aimeat_extension_invoke.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: { name: { type: 'string', required: true, description: 'Extension name.' } },
    },
    {
        name: 'aimeat_iam_define',
        description: 'Design an app\'s in-app permission model (for the aimeat-iam extension): validate a level schema (BBS ordinal levels, lower = more power, with app capability strings — a level 0 holding "*" is required) + a command manifest (commands → required capability + mutation tier read|write|irreversible), compute the level→command matrix (which levels may run which commands + which need human confirmation), and return ready-to-apply admin payloads (setRoles/setLevels/setCommands). PURE DESIGN + VALIDATION — it does not change any live state; apply the returned payloads with aimeat_extension_invoke against the app\'s iam extension\'s "admin" action. One model for both user kinds (human GHII + agent GAII).',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            app_id: { type: 'string', description: 'App id / name for the schema label (optional).' },
            levels: { type: 'array', required: true, description: 'Level schema: array of { level (int, 0 = most power), key, label, capabilities: string[] }.' },
            commands: { type: 'array', required: true, description: 'Command manifest: array of { id, description, capability, tier: read|write|irreversible }.' },
        },
    },
    {
        name: 'aimeat_cortex_list',
        description: 'List installed cortex extensions (browser-side UI/IIFE bundles) with name, version, status, visibility, namespace, tags, and author. Cortex code runs in the browser (not server-side like a regular extension), so it cannot be invoked here — manage its lifecycle with aimeat_cortex_activate / _deactivate / _delete. Install with aimeat_cortex_install.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {},
    },
    {
        name: 'aimeat_cortex_install',
        description: 'Install a NEW cortex extension (browser-side IIFE that reads ext data and user data and renders rich UI). Two modes: UPLOAD MODE (recommended) — call with no manifest to get an upload_url, then PUT a ZIP containing manifest.yaml at root and lib files in libs/. INLINE MODE — provide the manifest YAML string plus a libs map directly. Activate afterwards with aimeat_cortex_activate. CREATE-ONLY: installing a name that already exists FAILS (the ZIP upload path returns PROCESSING_FAILED) — update an existing cortex with PUT /v1/cortex/{name} instead (JSON body { manifest, libs }, cortex:write scope; idempotent redeploy that bumps the version and keeps it active), or delete it first with aimeat_cortex_delete.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: {
            manifest: { type: 'string', description: 'Cortex manifest in YAML format. Omit to get an upload_url for a ZIP bundle. Use @file:path with the CLI fallback.' },
            libs: { type: 'object', description: 'Map of filename to JavaScript source code for lib files. Omit for upload mode.' },
        },
    },
    {
        name: 'aimeat_cortex_activate',
        description: 'Activate an installed cortex extension by name so its components become available to browser apps and its capabilities are aggregated. Idempotent — returns success if already active. Cortex installs inactive; call this after aimeat_cortex_install. Reverse with aimeat_cortex_deactivate.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: { name: { type: 'string', required: true, description: 'Cortex name.' } },
    },
    {
        name: 'aimeat_cortex_deactivate',
        description: 'Deactivate an active cortex extension by name, setting it inactive so its components are no longer served to apps (it stays installed). Idempotent — returns success if already inactive. Re-enable with aimeat_cortex_activate, or remove with aimeat_cortex_delete.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: { name: { type: 'string', required: true, description: 'Cortex name.' } },
    },
    {
        name: 'aimeat_cortex_delete',
        description: 'Uninstall a cortex extension by name, deactivating it first if active and removing its stored lib files. Irreversible. To merely pause it, use aimeat_cortex_deactivate instead.',
        caller: 'agent',
        visibility: agentEverywhere,
        input: { name: { type: 'string', required: true, description: 'Cortex name.' } },
    },
];
