/**
 * @file appdev.ts
 * @description Operating handbook for the v2 `appdev` surface (/v2/mcp/appdev · `aimeat connect serve
 *   --surface appdev`). Self-contained; tool list mirrors MCP_SURFACES.appdev.
 * @version-history
 *   2026-07-19 — Research-first flow (AppDev KB Phase 7): Step 0 + tier decision tree + finish checklist / appdev-flow prompt / handbook module
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

**Research & knowledge (the research-first flow).** \`aimeat_appdev_overview\` — ONE call before
framing any build: the owner's apps + template proposals, library packs with per-model proofs,
T1/T2/T3 templates, curated + learned pitfalls (pass your model id) · \`aimeat_appdev_pitfall_list\`
(scope own/platform/all, paginated) · \`aimeat_appdev_pitfall_report\` (record what bit you — model
required, upserts by slug, share:true publishes platform-wide) · \`aimeat_app_template_propose\`/
\`_list\`/\`_get\` (distill a reusable template after a publish; the next build starts from it).

## Research-first build flow (research → frame → propose → build → finish)
1. RESEARCH: load the \`node:aimeat-app-builder\` skill (\`aimeat_skill_get\`), call
   \`aimeat_appdev_overview\`, and fetch the canonical spec \`GET /v1/prompts/build-app\` (it is law).
2. FRAME: tier (T1 pure client / T2 +cortex / T3 +extension), packs, start point (fork a prior
   app / template proposal / shell), own-users → aimeat-iam pack (gate) + AIMEAT.iam (panel),
   decided NOW. A role belongs to the PERSON: a member's agents inherit it.
3. PROPOSE the frame to the user in 3-5 lines; adjust.
4. BUILD flexibly within the frame; verify locally; publish (presigned upload > ~1 KB).
5. FINISH: agent face + bound skill (\`metadata.binding\`), \`aimeat_app_template_propose\`,
   \`aimeat_appdev_pitfall_report\` — the publish response's \`next_steps\` shows what is missing.
The user can always say "just build it the usual way" — then skip 1-3.

## Build → ship loop
1. Build the artifact locally (HTML app, extension ZIP, or cortex ZIP).
2. Install/publish via the matching tool (prefer presigned upload — keeps bytes out of context).
3. Activate (extensions/cortex) and verify with the \`_list\`/\`_get\` tool.
4. Iterate; bump versions on apps.

## Organism workspaces & agent contracts
You also create + provision organism **workspaces** on this surface: \`aimeat_organism_create\` (the
container) · \`aimeat_workspace_create\` (manifest + locked schemas) · \`aimeat_workspace_update\` (evolve
the structure — add/remove a space, set the publish gate) · \`aimeat_workspace_read\`/\`_list\`/\`_write\`/
\`_publish\`/\`_object_delete\` · \`aimeat_workspace_access\` (request/list/**decide** — approve a request as
**viewer**/**contributor**) · \`aimeat_workspace_member_grant\` (add an EXISTING member **directly** — no
request — to ONE or MANY workspaces at once as viewer/contributor; grantee may be an owner name, GHII or
GAII, applied to the owner so all their agents inherit) · \`aimeat_workspace_member_revoke\` (remove; to
downgrade, re-grant the lower role) · \`aimeat_workspace_members\` (roles + grant source per workspace) ·
\`aimeat_workspace_transfer\` (export/import). Grant/revoke are creator-or-org-admin; each is an auditable
creator-owned consent.

**Building a workspace-PROCESSING agent (one that reads requests + writes results)?** It owns a
**contract**: the spaces it READS (inputs) + WRITES (outputs) + the status lifecycle. Attaching it =
**provision** the contract's spaces with \`aimeat_workspace_update\` **\`add_spaces\`** (the server UNIONS
them into the manifest, skips any that already exist, fills defaults — no need to resend the whole
manifest; creator-only, so a *same-owner* agent self-provisions, otherwise the creator does it)
+ **grant** the agent the \`contributor\` role. Writes are attributed to the agent (it appears in
"Who works here" + the activity heatmap) and are visible to the whole workspace. **Advertise the
contract** with owner-managed tags via \`aimeat_agent_tags_set\`: \`workspace-contract\` (the discovery
marker — the workspace UI surfaces such agents to their owner) + \`contract.<id>\` per contract served
(this convention uses dots so \`contract.<id>\` parses by prefix; tags are \`[a-z0-9._:-]\`, no \`@\`). Full guide — machine-readable contract template, exact
provision calls, the processing loop, schema rules, discovery tags:
**\`docs/agent-workspace-contracts.md\`**. Read it before building such an agent.

## Layer rules (critical — see the appdev/mcp handbook modules)
- Extensions own \`ext:{name}\` memory; read owner data via \`ctx.memory.getPublic(ctx.caller.gaii, key)\`.
- Translations/settings are USER data — cortex reads them via \`AIMEAT.data.get(...)\`, NOT \`getPublic('ext:...')\`.
- Apps call cortex public methods only — never \`callExt\`/\`/v1/ext/\` directly.
- Extension actions use \`export default async function(ctx, input) { ... }\` (ES module default export).

## Your app's own members (aimeat-iam)

Three layers, and the boundary between them is the whole point. Six apps on this node each built
their own member model before this existed and disagreed six ways, so the split is now fixed:

- **The NODE owns who is a member.** \`/v1/apps/{owner}/{file}/members\` — approve, remove, ask,
  read your own standing. It lives here because three of the jobs cannot be done from an app at all:
  telling the approved person they were approved (the sandbox \`ctx.notify\` reaches the CALLER, so an
  approval notifies the approver), keeping the list private (an \`ext:\` namespace is world-readable by
  default), and taking free access away together with the role.
- **The EXTENSION owns what a member may do.** The capability vocabulary is genuinely per-app, and a
  browser can never enforce it. Declare the app in your manifest \`config:\` as \`app: owner/file.html\`
  and the node hands your script \`ctx.caller.member\` and \`ctx.caller.isAppOwner\`, resolved before the
  sandbox starts. Do NOT keep your own roster in \`ctx.memory\`.
- **The LIBRARY owns the surface.** \`/v1/libs/aimeat-iam.js\`: \`init({ app })\`, \`me()\`,
  \`MemberAdmin({ target })\` for the owner's panel, \`JoinPanel({ target })\` for the applicant.

### can() is a HINT, never a gate

\`AIMEAT.iam.can(cap)\` reads a cached capability list and exists so a user is not shown a control that
will refuse them. It is defeated by anyone who opens devtools. \`guard(cap, fn)\` asks the SERVER before
running, so a list that went stale (a revoke while the page was open) refuses instead of proceeding.

**Enforce in the action that mutates data.** A client check is decoration on top of a server decision;
where there is no server decision underneath, there is no access control at all.

### A role belongs to the PERSON

The roster row is keyed to the bare account name, so a member working through an agent resolves to the
same row without a second entry, and one revoke removes it from all of them. \`subject\` changes this
only when you mean it: \`gaii\` enrols every identity on its own and nothing inherits; \`both\` is
owner-keyed with an optional per-agent override.

Keying a role to the acting identity is the single most expensive mistake made here: it silently drops
an approved member's agent to the default role, and in a members-only app that is the guest tier.


## Boundaries
No agent/owner work (memory beyond build state, tasks, messages), no marketplace, no admin here. If
you need those, switch surfaces.
`;
