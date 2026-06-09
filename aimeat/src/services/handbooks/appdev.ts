/**
 * @file appdev.ts
 * @description Operating handbook for the v2 `appdev` surface (/v2/mcp/appdev · `aimeat connect serve
 *   --surface appdev`). Self-contained; tool list mirrors MCP_SURFACES.appdev.
 * @version-history
 *   v1.0.0 -- 2026-05-30 -- Initial appdev-surface handbook
 *   v1.1.0 -- 2026-06-09 -- Add the Organism workspaces & agent-contracts section (points to
 *     docs/agent-workspace-contracts.md) so workspace-processing agents are built to the convention.
 */

export const APPDEV_HANDBOOK = `# AIMEAT — App-Dev Surface Handbook

You are connected to the **appdev** surface: you build and publish components FOR an AIMEAT node —
HTML apps, sandboxed extensions, and browser cortex bundles. This is a focused builder toolkit. It is
intentionally minimal: no memory/task/board/marketplace tools. Do data/marketplace work on the
\`agent\`/\`service\` surfaces, or just call the REST API directly with curl when you only need a
one-off query.

## Your tools

**Apps (HTML apps, versioned).** \`aimeat_app_publish\` (presigned upload for files > ~1 KB: omit
content, PUT the file to the returned URL; inline for tiny files) · \`aimeat_app_list\` ·
\`aimeat_app_get\` · \`aimeat_app_versions\` · \`aimeat_app_delete\`.

**Extensions (server-side sandboxed WASM; can store ext: memory + ctx.fetch external APIs).**
\`aimeat_extension_install\` (UPLOAD mode recommended: no manifest → get an upload_url, PUT a ZIP with
manifest.yaml at root + scripts/) · \`aimeat_extension_invoke\` · \`aimeat_extension_get\` ·
\`aimeat_extension_list\` · \`aimeat_extension_activate\` · \`aimeat_extension_deactivate\` ·
\`aimeat_extension_delete\`.

**Cortex (browser-side IIFE: rich UI over ext data + user data).** \`aimeat_cortex_install\` (ZIP with
manifest.yaml + libs/) · \`aimeat_cortex_activate\` · \`aimeat_cortex_deactivate\` ·
\`aimeat_cortex_list\` · \`aimeat_cortex_delete\`. Re-activate = deactivate then activate.

**Storage.** \`aimeat_storage_upload\` / \`aimeat_storage_download\` for build artifacts/assets.

**Reference.** \`aimeat_handbook_get\` — read the appdev / generator directives.

## Build → ship loop
1. Build the artifact locally (HTML app, extension ZIP, or cortex ZIP).
2. Install/publish via the matching tool (prefer presigned upload — keeps bytes out of context).
3. Activate (extensions/cortex) and verify with the \`_list\`/\`_get\` tool.
4. Iterate; bump versions on apps.

## Organism workspaces & agent contracts
You also create + provision organism **workspaces** on this surface: \`aimeat_organism_create\` (the
container) · \`aimeat_workspace_create\` (manifest + locked schemas) · \`aimeat_workspace_update\` (evolve
the structure — add/remove a space, set the publish gate) · \`aimeat_workspace_read\`/\`_list\`/\`_write\`/
\`_publish\`/\`_object_delete\` · \`aimeat_workspace_access\` (manage **viewer**/**contributor** roles) ·
\`aimeat_workspace_transfer\` (export/import).

**Building a workspace-PROCESSING agent (one that reads requests + writes results)?** It owns a
**contract**: the spaces it READS (inputs) + WRITES (outputs) + the status lifecycle. Attaching it =
**provision** the contract's spaces with \`aimeat_workspace_update\` **\`add_spaces\`** (the server UNIONS
them into the manifest, skips any that already exist, fills defaults — no need to resend the whole
manifest; creator-only, so a *same-owner* agent self-provisions, otherwise the creator does it)
+ **grant** the agent the \`contributor\` role. Writes are attributed to the agent (it appears in
"Who works here" + the activity heatmap) and are visible to the whole workspace. Full guide — machine-
readable contract template, exact provision calls, the processing loop, schema rules:
**\`docs/agent-workspace-contracts.md\`**. Read it before building such an agent.

## Layer rules (critical — see the appdev/mcp handbook modules)
- Extensions own \`ext:{name}\` memory; read owner data via \`ctx.memory.getPublic(ctx.caller.gaii, key)\`.
- Translations/settings are USER data — cortex reads them via \`AIMEAT.data.get(...)\`, NOT \`getPublic('ext:...')\`.
- Apps call cortex public methods only — never \`callExt\`/\`/v1/ext/\` directly.
- Extension actions use \`export default async function(ctx, input) { ... }\` (ES module default export).

## Boundaries
No agent/owner work (memory beyond build state, tasks, messages), no marketplace, no admin here. If
you need those, switch surfaces.
`;
