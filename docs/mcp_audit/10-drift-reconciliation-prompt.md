# Task: Reconcile MCP server↔connector schema drift (F10 follow-up)

**For:** a dedicated Claude Code session in `e:\dev\GitHub\aimeat-protocol`
**Branch:** work on `feat/mcp-phase1-catalog-descriptions` (or branch from it)
**Created by:** the MCP-audit Phase 6 session, 2026-05-30

---

## Mission

AIMEAT exposes the same tool catalog over **two MCP surfaces**:

- **Server** `/v1/mcp` — handlers in `aimeat/src/mcp/*.ts`, talk to `storage`/services directly.
- **Connector** `aimeat connect serve` — handlers in `aimeat/src/cli/connect/mcp/tools/*.ts`, proxy the REST API via `AimeatClient`.

The Phase 6 schema audit (`pnpm audit:mcp-schemas`) found **50 shared tools whose input parameters DIFFER between the two surfaces**, plus the shared catalog (`aimeat/src/mcp/catalog/definitions.ts`) disagreeing with both. This is silent drift: an agent that learns a tool on one surface and calls it on the other passes the wrong parameter names, and some connector tools may be **outright broken** (sending a field the REST route never reads).

**Your job:** reconcile each drifting tool so all three layers — server MCP input schema, connector MCP input schema, and the catalog `input` metadata — expose the **same** input contract, anchored to what the REST route actually accepts. Then prune the audit baseline and prove drift is gone.

This is mechanical-but-careful work. Go tool by tool. Do **not** rush 50 tools blindly — verify each against its REST route.

---

## The decision rule (READ THIS FIRST)

For every tool, the **source of truth is the REST route** it ultimately drives (in `aimeat/src/routes/*.ts`). The connector literally calls that route; the server MCP handler should expose the same contract to the agent.

For each drifting tool:

1. **Find the REST route** the connector calls (grep the connector handler for `client.get/post(...)`, then open that route in `src/routes/`). Read the request schema (the Zod `validateBody(...Schema)` or the `req.body`/`req.query` destructuring).
2. **Pick the canonical param names = the REST field names** (path/query/body). Prefer the *specific, descriptive* name over a generic one (`group_id`, not `id`).
3. **Align all three layers** to the canonical schema:
   - **Server** `src/mcp/<domain>.ts` (or `core.ts`): the Zod `inputSchema` keys + the handler destructuring.
   - **Connector** `src/cli/connect/mcp/tools/<domain>.ts`: the Zod input + the body/query it sends to REST (this is where bugs hide — make sure the field it SENDS matches what REST READS).
   - **Catalog** `src/mcp/catalog/definitions.ts`: the `input` metadata for that tool.
4. **Keep `agent_name`** on connector tools (intentional multi-agent routing — the audit already ignores it).
5. **Add genuinely-useful params that one surface is missing** (filters, pagination, ttl) to the other surface too, rather than deleting them — unless the REST route truly doesn't support them.
6. If a difference is **intentional and must stay**, leave it and keep that tool in the audit baseline with a one-line comment explaining why.

⚠️ **Do not change tool NAMES or behavior** in this task — only reconcile input parameter schemas. Tool renaming/consolidation is a separate effort (audit Phase 5).

---

## Verification loop (run constantly)

```bash
# from project root
pnpm typecheck                          # after every file
pnpm audit:mcp-schemas                  # see remaining drift shrink
pnpm audit:mcp-schemas -- --strict      # gate (see baseline note below)
pnpm lint                               # 0 errors required (Rule 7)

# after a domain's tools are reconciled, run that domain's e2e on SQLite (cd aimeat first):
cd aimeat
pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=mcp --test=mcp-consent --test=mcp-boards --test=mcp-organisms --test=mcp-knowledge --test=mcp-extensions --test=mcp-catalogue --test=mcp-chat-instances --test=mcp-flags --test=mcp-wallet-extended --test=mcp-prompts
```

**The baseline ratchet:** `aimeat/scripts/audit-mcp-schemas.ts` has a `KNOWN_INPUT_DRIFT` set listing the 50 currently-drifting tools. As you reconcile a tool, the audit will report it under **"Baseline entries that no longer drift (prune ...)"**. **Remove each reconciled tool from `KNOWN_INPUT_DRIFT`** as you go. Goal: `KNOWN_INPUT_DRIFT` ends **empty** (or contains only documented-intentional exceptions), and `pnpm audit:mcp-schemas -- --strict` passes with **0 known and 0 new drift**.

---

## Where the code lives

| Layer | Path |
|-------|------|
| Server MCP handlers | `aimeat/src/mcp/{core,boards,organisms,knowledge,extensions,catalogue,consent,capabilities,apps,cortex,sharing-groups,chat-instances,flags,agent-tasks,agent-messages,agent-management,memory-extended,wallet-extended}.ts` |
| Connector MCP handlers | `aimeat/src/cli/connect/mcp/tools/{core,boards,organisms,knowledge,extensions,catalogue,consent,capabilities,apps,cortex,groups,instances,flags,agent-tasks,agent-messages,agent-management,memory-ext,wallet-ext,handbook,onboarding}.ts` |
| Catalog metadata | `aimeat/src/mcp/catalog/definitions.ts` (`CLI_FALLBACK_TOOL_DEFINITIONS`) |
| REST routes (source of truth) | `aimeat/src/routes/*.ts` |
| The audit | `aimeat/scripts/audit-mcp-schemas.ts` |

Helpful: `aimeat/openapi.yaml` documents many request bodies (e.g. board members PATCH uses `add`/`remove`).

---

## The drifts, grouped by fix pattern

Format: `tool: server-only [...] | connector-only [...]` (from `pnpm audit:mcp-schemas`). "Canonical" is the recommended target; **VERIFY** = confirm against the REST route before deciding.

### Group A — generic `id` → specific `*_id` (fix the CONNECTOR; align catalog)
The connector uses a bare `id`; server/REST use the descriptive name. Rename the connector param (and the value it sends) to match, and point the catalog at the specific name.

- `aimeat_consent_revoke`: server `consent_id` | connector `id` → **canonical `consent_id`**
- `aimeat_group_get`: server `group_id` | connector `id` → **`group_id`**
- `aimeat_group_remove_member`: server `group_id` | connector `id` → **`group_id`** (also see Group F for `identifier`)
- `aimeat_instance_status`: server `instance_id` | connector `id` → **`instance_id`**
- `aimeat_knowledge_get`: server `package_id` | connector `id` → **`package_id`**
- `aimeat_knowledge_contribute`: server `package_id` | connector `id` → **`package_id`**
- `aimeat_knowledge_links`: server `package_id, direction` | connector `id` → **`package_id`** + add `direction` to connector
- `aimeat_organism_get`: server `organism_id` | connector `id` → **`organism_id`**
- `aimeat_organism_leave`: server `organism_id` | connector `id` → **`organism_id`**
- `aimeat_organism_join`: server `organism_id, message` | connector `id` → **`organism_id`** + add optional `message` to connector
- `aimeat_organism_members`: server `organism_id, role, status` | connector `id` → **`organism_id`** + add `role`,`status` filters to connector

**Why:** descriptive IDs (`group_id`) reduce agent confusion vs an ambiguous `id`, and they match the REST path/query names. This is pure rename + (sometimes) adding the server's extra filters to the connector.

### Group B — connector flattened rich filters to `query` (fix the CONNECTOR; align catalog)
Canonical = the specific filters (better discovery). Expose them on the connector and map to the right REST query params.

- `aimeat_catalogue_search`: server `search, category` | connector `query`
- `aimeat_catalogue_agents`: server `search, category` | connector `query`
- `aimeat_catalogue_directory`: server `city, interest` | connector `query`
- `aimeat_app_list`: server `category, own, search, tag` | connector `query`
- `aimeat_capabilities_list`: server `search, tags, callable, authRequired, source_type` | connector `query`

**Why:** a single `query` can't express city/interest or callable/source filters; the rich params already exist server-side and on REST. Don't lose them.

### Group C — connector missing params the server/REST supports (ADD to connector; align catalog)
The server exposes filters/options the connector dropped. Add them to the connector input + pass through to REST.

- `aimeat_action_execute`: server `provider_gaii, ttl_hours` — `provider_gaii` is **required** by `/v1/work/request`; the connector is likely broken without it. VERIFY.
- `aimeat_admin_agents`: server `limit`
- `aimeat_agent_activity`: server `days, granularity`
- `aimeat_board_read`: server `category, limit`
- `aimeat_board_post`: server `category`
- `aimeat_board_create`: server `allowed_gaiis`
- `aimeat_board_subscribe`: server `callback_url, filters`
- `aimeat_group_create`: server `members`
- `aimeat_memory_search`: server `visibility`
- `aimeat_capabilities_invoke`: server `mode`
- `aimeat_capabilities_vouch`: server `comment`
- `aimeat_task_event`: server `details`
- `aimeat_task_list`: server `page, per_page`
- `aimeat_flag_report`: server `description`

### Group D — server missing the connector's param (ADD to server; align catalog)
- `aimeat_task_complete`: connector `summary` → add `summary` (and/or `message`) to the server tool
- `aimeat_task_fail`: connector `message` → add `message` to the server tool
- `aimeat_memory_write`: server `group_id` | connector `ttl_hours` → **both surfaces should have BOTH** `group_id` and `ttl_hours`

**Why:** completing a task with a summary / failing with a reason / writing memory with a TTL are all real, supported operations; whichever surface lacks the param can't do it.

### Group E — board members (fix the CONNECTOR; canonical confirmed by openapi)
- `aimeat_board_members`: server `add, remove` | connector `members`. **openapi.yaml `/v1/boards/{boardId}/members` PATCH body = `add`/`remove`** → canonical `add`,`remove`. Replace the connector's `members` with `add`/`remove`.

### Group F — VERIFY carefully (param name + possible bug; check the REST route)
These need you to open the REST route and confirm the exact field names; some connector tools may currently send a field the route ignores.

- `aimeat_storage_upload`: server `data_base64, visibility, group_id` | connector `content`. **`POST /v1/storage` reads `data` (base64)** in `src/routes/storage-files.ts` — the connector sends `content`, which the route likely ignores (probable bug). Decide canonical (`data` per REST, or move connector to presigned mode like the server) and add `visibility`/`group_id` to the connector. VERIFY.
- `aimeat_work_deliver`: server `output` | connector `result`. Check `WorkDeliverySchema` in `src/routes/work.ts` for the real field name; align both + catalog.
- `aimeat_message_send`: server `thread_id` | connector `body`. Both share `content`. Reconcile to canonical `content` (+ optional `thread_id`, `linked_task_id`, `metadata`); drop or document the `body` alias. VERIFY the message route.
- `aimeat_handbook_get`: server `tier` | connector `module`. **These may hit different endpoints** — server → managed prompts (`/v1/prompts/:tier`), connector → handbook modules (`/v1/agents/me/handbook/:module`). Decide what `aimeat_handbook_get` should mean, unify both surfaces on ONE concept, and fix the catalog. This is the trickiest — flag it if unsure and leave baselined with a comment rather than guessing.
- `aimeat_instance_create`: server `model` | connector `template`. Check the chat-instances route for the real field.
- `aimeat_extension_invoke`: server `extension_name, instance_id` | connector `name`. Canonical `extension_name` (+ `instance_id` if supported). VERIFY.
- `aimeat_extension_install`: server `scripts` | connector `name`. These are the presigned/inline manifest-upload tools. Reconcile `manifest`/`scripts`/`name`/presigned mode against `docs/coding-guidelines/mcp-uploads.md` and `src/services/upload-zip.ts`. VERIFY.
- `aimeat_cortex_install`: server `libs` | connector `name`. Same as extension_install but `libs`. VERIFY.
- `aimeat_app_delete` / `aimeat_app_get` / `aimeat_app_versions`: server `filename` (+ `owner`) | connector `group_id`. Apps are stored by owner+filename (download URL `/v1/apps/:owner/:filename`) but the connector addresses them by `group_id`. Confirm which the REST app routes use and align. VERIFY.
- `aimeat_app_publish`: server `filename, content_base64, category, tags, icon, version` | connector `content`. The connector is a thin/outdated version. Align to the server's richer publish schema (or presigned). VERIFY.

### Group G — capabilities create/update (fix the CONNECTOR to the rich schema; align catalog)
- `aimeat_capabilities_create`: server `id, summary, callable, visibility, tags, inputSchema, outputSchema, usage, whenToUse` | connector `description, type`. The connector is outdated. Adopt the server/REST schema.
- `aimeat_capabilities_update`: server `summary, tags, visibility, usage, whenToUse, whenNotToUse` | connector `description`. Same.
- `aimeat_group_add_member`: server `group_id, identifier_type, permissions` | connector `id, role`. Reconcile fully against the REST group-member route (likely `group_id` + `identifier`/`identifier_type` + `permissions`/`role`). VERIFY.

---

## Catalog `input` alignment

After server↔connector are reconciled for a tool, also fix its `input` block in `src/mcp/catalog/definitions.ts` so the catalog matches (the audit's "Catalog input metadata drift" section lists these — same param names as above). The catalog drives `aimeat connect schema`, so it must show the real params.

A few catalog-only extras to also fix while you're there:
- `aimeat_agent_capabilities_report`: catalog lists `modules_loaded, limitations` the server doesn't accept → reconcile (add to server or drop from catalog, per the real handler).

---

## Definition of done

- [ ] Every Group A–E tool reconciled across server MCP + connector MCP + catalog; param names match the REST route.
- [ ] Group F/G tools either reconciled or, if genuinely ambiguous, left baselined with a one-line `// intentional: <reason>` comment in `KNOWN_INPUT_DRIFT`.
- [ ] `KNOWN_INPUT_DRIFT` in `scripts/audit-mcp-schemas.ts` pruned to (ideally) empty.
- [ ] `pnpm audit:mcp-schemas -- --strict` → **0 new, 0 known drift** (or only documented exceptions).
- [ ] `pnpm audit:mcp-schemas` "Catalog input metadata drift" → empty (or documented).
- [ ] `pnpm typecheck` clean; `pnpm lint` 0 errors.
- [ ] All `mcp*` e2e suites green on SQLite (command above); run `pnpm test:e2e:sqlite` for the full sweep at the end (Rule 1).
- [ ] Each touched source file's `@version-history` header bumped (Rule 2).
- [ ] Commit per domain (e.g. `fix(mcp): reconcile organism tool schemas across surfaces`), ending each message with the Co-Authored-By line.

## Guardrails (from CLAUDE.md)

- Don't rename tools or change behavior — input-schema reconciliation only.
- `.js` import extensions; Express 5 `req.params` cast `as string`.
- Run only the suites your change affects during iteration; full sweep at the end.
- If a reconciliation would be consumer-breaking in a surprising way, prefer adding the canonical param while keeping the old one as an optional alias for one migration window, and note it — but for internal-only params just rename.

## Reference: full audit output to start from

Run `pnpm audit:mcp-schemas` first to see the live list (it will match the Group A–G tables above). The Phase 6 write-up is in `docs/mcp_audit/09-toteutussuunnitelma.md` (Vaihe 6) and the audit script itself is `aimeat/scripts/audit-mcp-schemas.ts`.
