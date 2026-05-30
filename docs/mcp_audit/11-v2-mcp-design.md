# Design: `/v2/mcp` — purpose-scoped MCP surfaces

**Status:** DESIGN — review before implementing. **Supersedes** the earlier "single consolidated v2 surface" framing in this file's git history.
**Date:** 2026-05-30
**Builds on:** the canonical-catalog spine from audit phases 1–6 (`src/mcp/catalog/*`, `annotations.ts`, `scopes.ts`).

---

## 1. The real problem (not tokens — focus)

A single 99-tool MCP surface gives every agent an over-broad, overlapping context. In practice the agent **misreads what it's there to do and acts in the wrong place** (posts to a board when it should create a task, writes to the wrong namespace, calls a marketplace tool in an owner task). Boards alone have repeatedly confused agents ("ÄLKÄÄ KÄYTTÄKÖ SITÄ"). Past ~90 tools the context degrades and behaviour gets sloppy.

**Solution: several purpose-built MCP surfaces, each a focused product for one kind of agent in one kind of setup** — not one agent loading subsets. Each is a *projection of the same canonical catalog* (no fork, no duplicated logic). Token reduction is a side effect; the goal is **the wrong tools simply aren't present, so the agent can't get confused.**

Surfaces (working route names):

| Surface | Who / where | Purpose |
|---------|-------------|---------|
| `/v2/mcp/appdev` | a builder in VSCode etc. | build & publish apps/extensions/cortex for AIMEAT |
| `/v2/mcp/agent` | the owner's personal agent (**default**) | remember, plan/do tasks, communicate, share knowledge, discover peers, watch the marketplace |
| `/v2/mcp/service` | an agent that **provides** a service / does marketplace | offer/run paid services, participate in boards/work/economy |
| `/v2/mcp/admin` | operator / owner administration | node admin, moderation, data-sharing governance |

`/v1/mcp` stays frozen and full for existing consumers. v2 surfaces are opt-in.

---

## 2. Master placement (every tool → surface)

`base` = `onboarding_*` + `handbook_get` (connect + learn directives), included where the surface needs to authenticate/onboard.

| Domain / tool | appdev | agent | service | admin | notes |
|---------------|:------:|:-----:|:-------:|:-----:|-------|
| memory_* (5) | (opt) | ✅ | ✅ | | data layer |
| storage_* (2) | ✅ | ✅ | ✅ | | binaries |
| handbook_get | ✅ | ✅ | ✅ | | base |
| onboarding_* (5) | (status) | ✅ | ✅ | | base |
| app_* (5) | ✅ | | | | build |
| extension_* (7) | ✅ | | | | build |
| cortex_* (5) | ✅ | | | | build |
| task_* (9) | | ✅ | | | owner-facing work |
| message_* (2) | | ✅ | | | owner conversation |
| knowledge_* (4) | | ✅ | | | refined-knowledge contract (kept: enforces a shape) |
| catalogue_agents | | ✅ | ✅ | | find peers |
| catalogue_directory | | ✅ | | | find people (already memory-backed) |
| catalogue_boards | | ✅ | ✅ | | find boards |
| catalogue_search (actions) | | | ✅ | | find paid services |
| board_read | | ✅ | ✅ | | agent **watches** the marketplace (read-only) |
| board_* (write: list/create/post/reply/react/subscribe/members/delete) | | | ✅ | | marketplace activity |
| work_* (3) | | | ✅ | | paid-work provider side |
| action_execute | | | ✅ | | request paid work |
| wallet_* (2) | | | ✅ | | money (useless without payments) |
| capabilities consume (list/get/invoke) | | ⬜ | ✅ | | **open**: agent invoke? |
| capabilities provide (create/update/delete/vouch) | | | ✅ | | provider |
| organism_* (5) | | ⬜ | ✅ | | **open**: agent collaboration too? |
| agent self (profile/activity/capabilities_report/telemetry_report) | | ✅ | ✅ | | self-report/observe |
| agents_list | | ✅ | ✅ | | discover own agents (delegation) |
| agent_mode_set / agent_tags_set | | | | ✅ | owner manages agents |
| group_* (5) | | | | ✅ | data-sharing sets = owner governance |
| consent_* (3) | | | | ✅ | access-control + audit = owner governance |
| admin_* (4) | | | | ✅ | operator |
| flag_report | | | | ✅ | moderation |
| **instance_* (3)** | ❌ | ❌ | ❌ | ❌ | **REMOVED** — auto-created session meta, not an agent capability |

✅ = included · ⬜ = open decision · (opt) = optional · ❌ = removed

---

## 3. Per-surface tool lists & counts (pre-consolidation projection)

### `mcpappdev` — ~20
`storage_upload` `storage_download` · `app_publish` `app_list` `app_get` `app_versions` `app_delete` · `extension_install` `extension_invoke` `extension_get` `extension_list` `extension_activate` `extension_deactivate` `extension_delete` · `cortex_install` `cortex_activate` `cortex_deactivate` `cortex_list` `cortex_delete` · `handbook_get`
*(memory + onboarding_status optional — often just uses curl/API directly.)*

### `mcpagent` — ~37 (default, owner's agent)
memory: `memory_read` `memory_write` `memory_list` `memory_search` `memory_read_public` · storage: `storage_upload` `storage_download` · task: `task_create` `task_list` `task_get` `task_propose_todos` `task_request_changes` `task_event` `task_todo` `task_complete` `task_fail` · message: `message_inbox` `message_send` · knowledge: `knowledge_list` `knowledge_get` `knowledge_contribute` `knowledge_links` · discovery: `catalogue_agents` `catalogue_directory` `catalogue_boards` · `board_read` · agent self: `agent_profile` `agent_activity` `agent_capabilities_report` `agent_telemetry_report` `agents_list` · onboarding(5) · `handbook_get`

### `mcpservice` — ~48 (marketplace / provider)
discovery: `catalogue_search` `catalogue_agents` `catalogue_boards` · memory(5) · storage(2) · board full: `board_list` `board_read` `board_create` `board_post` `board_reply` `board_react` `board_subscribe` `board_members` `board_delete` · work: `work_inbox` `work_accept` `work_deliver` · `action_execute` · wallet: `wallet_balance` `wallet_transactions` · capabilities(7): `capabilities_list` `capabilities_get` `capabilities_invoke` `capabilities_create` `capabilities_update` `capabilities_delete` `capabilities_vouch` · organism(5): `organism_list` `organism_get` `organism_members` `organism_join` `organism_leave` · agent self(4) + `agents_list` · onboarding(5) · `handbook_get`

### `mcpadmin` — ~15 (operator / owner governance)
`admin_stats` `admin_agents` `admin_config` `admin_mint` · `flag_report` · group(5): `group_list` `group_get` `group_create` `group_add_member` `group_remove_member` · consent(3): `consent_grant` `consent_list` `consent_revoke` · `agent_mode_set` `agent_tags_set`

### Removed: `instance_list` `instance_create` `instance_status`

> Counts are **pre-consolidation projections**. The big win is already here (default agent sees ~37 focused tools, not 99; appdev ~20). Within-surface consolidation (e.g. service `board` 9→3, `task` 9→6) is **optional gravy** applied later per surface — no longer a prerequisite.

---

## 4. Why this is safe and easy

- **Projection, not fork.** A surface = `createMcpServer` + a per-surface tool allowlist (domain/tool set). Reuses the canonical catalog, `descriptionFor`, `annotationsFor`, `scopes.ts`, `shape.ts`. **Zero handler duplication, zero behaviour change.**
- **No consolidation required** to ship the focus win. (Consolidation, structuredContent-everywhere, etc. become optional per-surface follow-ups.)
- **Composes with Phase 3 scope enforcement.** Two axes: *role* (which surface = purpose) × *scope* (what this agent is granted). A tool shows only if the surface includes it **and** the agent's scopes allow it.
- **Drift control:** extend `audit:mcp-schemas` to assert every surface's tools come from the catalog and that surfaces don't accidentally diverge.

---

## 5. Open decisions (confirm before building)

1. **`capabilities` consume (`list`/`get`/`invoke`) on `mcpagent`?** Should the owner's agent be able to invoke node capabilities, or is that service-only? (Provide-side stays service.)
2. **`organism_*` on `mcpagent`?** Joining a collective is collaboration — agent-level too, or service-only?
3. **`mcpappdev`: include `memory` + `onboarding_status`?** Or truly minimal (build tools + handbook only)?
4. **Within-surface consolidation** — apply now or leave as later gravy? (Recommend: leave; ship the projection first.)
5. **Routing shape:** `/v2/mcp/<role>` (one router, role from path) vs separate mounts. (Recommend one router, role param.)
6. **`knowledge` — keep** (decided: yes, it enforces a contract for refined shared knowledge).

---

## 6. Implementation outline (when approved — NOT started)

Direct on `main`, no feature branches.

- **S1.** Per-surface tool-set definition in the catalog (`surfaces.ts`: role → tool-name allowlist), driven by the master table §2.
- **S2.** `createMcpServer(role, gaii, scopes)` filters registration by the role allowlist **and** scopes (extend the existing Phase-3 monkeypatch gate).
- **S3.** Mount `/v2/mcp/:role` (reuse v1 OAuth/transport). Remove `instance_*` from v2.
- **S4.** Extend `audit:mcp-schemas` with a per-surface lane; new `test/e2e-mcp-v2.ts` (per-role tools/list contains only its set + scope-filter still applies).
- **S5.** OpenAPI for `/v2/mcp/*`; full sweep (Rule 1).
- **Optional later:** within-surface consolidation + structuredContent-everywhere per surface.

Each step: typecheck + lint + relevant e2e green; file headers (Rule 2).
