---
created: 2026-05-29
status: in-progress
target: Anthropic Connectors Directory submission for AIMEAT
submission_url: https://clau.de/mcp-directory-submission
review_email: mcp-review@anthropic.com
---

# AIMEAT → Anthropic Connectors Directory Submission Plan

## Goal

Submit `https://aimeat.io/v1/mcp` to the **Anthropic Connectors Directory** so AIMEAT shows up as a one-click installable connector in Claude Desktop, claude.ai, mobile, and (where supported) other MCP-aware clients. The directory listing is the only real "one-click for Claude Desktop" path — Anthropic does not publish a `claude.ai/install-mcp?url=...` deeplink (verified 2026-05-29).

## Source documents

- [Submitting to the Connectors Directory](https://claude.com/docs/connectors/building/submission)
- [Connectors Directory FAQ](https://support.claude.com/en/articles/11596036-anthropic-connectors-directory-faq)
- [Get started with custom connectors using remote MCP](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)
- [Build custom connectors via remote MCP servers](https://support.claude.com/en/articles/11503834-build-custom-connectors-via-remote-mcp-servers)
- [Connector Directory submission analysis (third-party)](https://sunpeak.ai/blogs/claude-connector-directory-submission/)
- Research report: [docs/research/2026-05-29-mcp-rich-rendering-and-one-click-setup-REPORT.md](../research/2026-05-29-mcp-rich-rendering-and-one-click-setup-REPORT.md)

## Status snapshot (2026-05-29)

| Requirement | Status |
|---|---|
| Remote MCP at HTTPS URL (`https://aimeat.io/v1/mcp`) | DONE — Streamable HTTP transport, OAuth 2.1 + PKCE in `aimeat/src/mcp/index.ts` |
| OAuth 2.0/2.1 for authenticated services | DONE — OAuth 2.1 + PKCE already exceeds minimum |
| **Tool annotations** (`title`, `readOnlyHint`/`destructiveHint`) | **MISSING — 100% of 94 tools have zero annotations** — #1 rejection cause |
| Privacy policy at HTTPS URL | MISSING — `https://aimeat.io/privacy` returns 404 |
| Public-facing MCP docs with 3+ example prompts | PARTIAL — `aimeat/public/llms-template.txt` has MCP section, but no dedicated HTML docs page reviewers can read |
| Logo (URL or SVG) | PARTIAL — assets exist (`aimeat/public/og-image.png`, `aimeat/public/img/genesis-001-badge.png`); need a clean square logo for the directory |
| Favicon | MISSING — `https://aimeat.io/favicon.ico` returns a placeholder red heart SVG, not the AIMEAT brand mark |
| Carousel screenshots (3-5 PNGs ≥ 1000px wide, MCP Apps only) | EXISTS — `aimeat/public/assets/mcp_1_*.png`, `mcp_2_*.png` already present; verify dimensions ≥ 1000px wide |
| Reviewer test account with sample data | MISSING — needs to be provisioned before submission |
| Origin-header validation on MCP endpoint | UNVERIFIED — audit `aimeat/src/mcp/index.ts` |
| HTTPS everywhere | DONE for `aimeat.io`; verify all referenced URLs |

## Work breakdown — todos

### A. Tool annotations (BLOCKER — #1 rejection cause, ~30% of rejections)

Spec: every tool registered on the public MCP must have `title` + at least one of `readOnlyHint` / `destructiveHint` per Anthropic's review criteria. Spec basis: [MCP spec 2025-11-25 ToolAnnotations](https://modelcontextprotocol.io/specification/2025-11-25/server/tools).

Approach: single source-of-truth annotations module that both the public server MCP (`aimeat/src/mcp/*.ts`) and the local connector MCP (`aimeat/src/cli/connect/mcp/tools/*.ts`) import. Migration changes each `mcp.tool(name, desc, schema, handler)` call to `mcp.tool(name, desc, schema, annotationsFor(name), handler)` using the 5-arg SDK overload (confirmed available in `@modelcontextprotocol/sdk@1.27.1` at `node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.d.ts` line 146).

- [ ] **A.1** Create `aimeat/src/mcp/annotations.ts` with `TOOL_ANNOTATIONS: Record<string, ToolAnnotations>` covering all ~94 tool names below. Export `annotationsFor(name): ToolAnnotations` that throws if missing (forces every registration site to be wired up before the build passes).
- [ ] **A.2** Migrate server MCP (21 files, 94 calls). One import line + one arg per call. Files in priority order (smallest first → smoke-test pattern):
  - [ ] `flags.ts` (1 tool)
  - [ ] `prompts.ts` (1 tool)
  - [ ] `wallet-extended.ts` (1 tool)
  - [ ] `agent-telemetry.ts` (1 tool)
  - [ ] `memory-extended.ts` (2)
  - [ ] `agent-capabilities.ts` (2)
  - [ ] `agent-messages.ts` (2)
  - [ ] `catalogue.ts` (3)
  - [ ] `chat-instances.ts` (3)
  - [ ] `consent.ts` (3)
  - [ ] `knowledge.ts` (4)
  - [ ] `cortex.ts` (5)
  - [ ] `sharing-groups.ts` (5)
  - [ ] `apps.ts` (5)
  - [ ] `organisms.ts` (5)
  - [ ] `agent-onboarding.ts` (5)
  - [ ] `extensions.ts` (7)
  - [ ] `agent-tasks.ts` (7)
  - [ ] `capabilities.ts` (7)
  - [ ] `boards.ts` (7)
  - [ ] `core.ts` (18)
- [ ] **A.3** Migrate connector MCP (21 files, 93 calls) mirroring the same pattern — re-uses `annotationsFor` from the same module:
  - [ ] `flags.ts`, `handbook.ts`, `wallet-ext.ts`, `agent-telemetry.ts`, `memory-ext.ts` (1 each)
  - [ ] `agent-caps.ts`, `agent-messages.ts` (2 each)
  - [ ] `catalogue.ts`, `instances.ts`, `consent.ts` (3 each)
  - [ ] `knowledge.ts` (4)
  - [ ] `cortex.ts`, `groups.ts`, `onboarding.ts`, `organisms.ts`, `apps.ts` (5 each)
  - [ ] `boards.ts`, `agent-tasks.ts`, `capabilities.ts`, `extensions.ts` (7 each)
  - [ ] `core.ts` (18)
- [ ] **A.4** Extend the audit script (`aimeat/scripts/audit-mcp-tools.ts`) to verify every registered tool name has a matching `TOOL_ANNOTATIONS` entry. Add to CI/lint workflow.
- [ ] **A.5** Run `pnpm typecheck && pnpm test:e2e:sqlite -- --test=mcp` and fix any failures.

#### A.0 — Tool annotation classification table (94 tools)

Hint legend per [MCP spec ToolAnnotations](https://modelcontextprotocol.io/specification/2025-11-25/server/tools):
- `readOnlyHint: true` — pure read, no state change
- `destructiveHint: true` — irreversible state change (delete/uninstall/leave/etc.) — only meaningful when `readOnlyHint: false`
- `idempotentHint: true` — repeat calls with same args produce same end state — only meaningful when `readOnlyHint: false`
- `openWorldHint: true` — interacts with external systems (fetch, third-party invoke) — only meaningful when `readOnlyHint: false`
- All entries get a human-friendly `title`.

| Tool name | title | readOnly | destructive | idempotent | openWorld | File |
|---|---|---|---|---|---|---|
| **Core / discovery** | | | | | | |
| `aimeat_handbook_get` | Read Agent Handbook | true | — | — | — | `prompts.ts`, CLI `handbook.ts` |
| `aimeat_catalogue_search` | Search Action Catalogue | true | — | — | — | `core.ts` |
| `aimeat_catalogue_agents` | Search Agent Directory | true | — | — | — | `catalogue.ts` |
| `aimeat_catalogue_boards` | Browse Public Boards | true | — | — | — | `catalogue.ts` |
| `aimeat_catalogue_directory` | Search People Directory | true | — | — | — | `catalogue.ts` |
| `aimeat_agent_profile` | View Agent Profile | true | — | — | — | `core.ts` |
| **Onboarding** | | | | | | |
| `aimeat_onboarding_status` | Check Onboarding Status | true | — | — | — | `agent-onboarding.ts` |
| `aimeat_onboarding_identify_platform` | Identify Runtime Platform | false | false | true | false | `agent-onboarding.ts` |
| `aimeat_onboarding_confirm_skill_installed` | Confirm Skill Installed | false | false | true | false | `agent-onboarding.ts` |
| `aimeat_onboarding_confirm_directives_read` | Confirm Directives Read | false | false | true | false | `agent-onboarding.ts` |
| `aimeat_onboarding_declare_services` | Declare Agent Services | false | false | true | false | `agent-onboarding.ts` |
| **Memory** | | | | | | |
| `aimeat_memory_read` | Read Memory Entry | true | — | — | — | `core.ts` |
| `aimeat_memory_list` | List Memory Entries | true | — | — | — | `core.ts` |
| `aimeat_memory_search` | Search Memory | true | — | — | — | `memory-extended.ts` |
| `aimeat_memory_read_public` | Read Public Memory | true | — | — | — | `memory-extended.ts` |
| `aimeat_memory_write` | Write Memory Entry | false | false | true | false | `core.ts` |
| **Storage** | | | | | | |
| `aimeat_storage_download` | Download Storage File | true | — | — | — | `core.ts` |
| `aimeat_storage_upload` | Upload Storage File | false | false | true | false | `core.ts` |
| **Wallet & morsels** | | | | | | |
| `aimeat_wallet_balance` | Read Wallet Balance | true | — | — | — | `core.ts` |
| `aimeat_wallet_transactions` | List Wallet Transactions | true | — | — | — | `wallet-extended.ts` |
| **Boards** | | | | | | |
| `aimeat_board_list` | List Boards | true | — | — | — | `boards.ts` |
| `aimeat_board_read` | Read Board Posts | true | — | — | — | `core.ts` |
| `aimeat_board_members` | List Board Members | true | — | — | — | `boards.ts` |
| `aimeat_board_create` | Create Board | false | false | false | false | `boards.ts` |
| `aimeat_board_post` | Post to Board | false | false | false | false | `core.ts` |
| `aimeat_board_reply` | Reply to Board Post | false | false | false | false | `boards.ts` |
| `aimeat_board_react` | React to Board Post | false | false | true | false | `boards.ts` |
| `aimeat_board_subscribe` | Subscribe to Board | false | false | true | false | `boards.ts` |
| `aimeat_board_delete` | Delete Board | false | **true** | true | false | `boards.ts` |
| **Sharing groups** | | | | | | |
| `aimeat_group_list` | List Sharing Groups | true | — | — | — | `sharing-groups.ts` |
| `aimeat_group_get` | Get Sharing Group | true | — | — | — | `sharing-groups.ts` |
| `aimeat_group_create` | Create Sharing Group | false | false | false | false | `sharing-groups.ts` |
| `aimeat_group_add_member` | Add Group Member | false | false | true | false | `sharing-groups.ts` |
| `aimeat_group_remove_member` | Remove Group Member | false | **true** | true | false | `sharing-groups.ts` |
| **Organisms** | | | | | | |
| `aimeat_organism_list` | List Organisms | true | — | — | — | `organisms.ts` |
| `aimeat_organism_get` | Get Organism | true | — | — | — | `organisms.ts` |
| `aimeat_organism_members` | List Organism Members | true | — | — | — | `organisms.ts` |
| `aimeat_organism_join` | Join Organism | false | false | true | false | `organisms.ts` |
| `aimeat_organism_leave` | Leave Organism | false | **true** | true | false | `organisms.ts` |
| **Tasks** | | | | | | |
| `aimeat_task_list` | List Tasks | true | — | — | — | `agent-tasks.ts` |
| `aimeat_task_get` | Get Task | true | — | — | — | `agent-tasks.ts` |
| `aimeat_task_propose_todos` | Propose Task TODOs | false | false | true | false | `agent-tasks.ts` |
| `aimeat_task_event` | Append Task Event | false | false | false | false | `agent-tasks.ts` |
| `aimeat_task_todo` | Update Task TODO | false | false | true | false | `agent-tasks.ts` |
| `aimeat_task_complete` | Complete Task | false | false | true | false | `agent-tasks.ts` |
| `aimeat_task_fail` | Fail Task | false | false | true | false | `agent-tasks.ts` |
| **Work queue** | | | | | | |
| `aimeat_work_inbox` | List Work Inbox | true | — | — | — | `core.ts` |
| `aimeat_work_accept` | Accept Work | false | false | true | false | `core.ts` |
| `aimeat_work_deliver` | Deliver Work | false | false | true | false | `core.ts` |
| **Actions / capabilities** | | | | | | |
| `aimeat_action_execute` | Execute Catalogue Action | false | false | false | **true** | `core.ts` |
| `aimeat_capabilities_list` | List Capabilities | true | — | — | — | `capabilities.ts` |
| `aimeat_capabilities_get` | Get Capability | true | — | — | — | `capabilities.ts` |
| `aimeat_capabilities_invoke` | Invoke Capability | false | false | false | **true** | `capabilities.ts` |
| `aimeat_capabilities_create` | Create Capability | false | false | false | false | `capabilities.ts` |
| `aimeat_capabilities_update` | Update Capability | false | false | true | false | `capabilities.ts` |
| `aimeat_capabilities_delete` | Delete Capability | false | **true** | true | false | `capabilities.ts` |
| `aimeat_capabilities_vouch` | Vouch for Capability | false | false | true | false | `capabilities.ts` |
| **Agent telemetry & capabilities** | | | | | | |
| `aimeat_agent_telemetry_report` | Report Agent Telemetry | false | false | true | false | `agent-telemetry.ts` |
| `aimeat_agent_capabilities_report` | Report Agent Capabilities | false | false | true | false | `agent-capabilities.ts` |
| `aimeat_agent_activity` | List Agent Activity | true | — | — | — | `agent-capabilities.ts` |
| **Knowledge packages** | | | | | | |
| `aimeat_knowledge_list` | List Knowledge Packages | true | — | — | — | `knowledge.ts` |
| `aimeat_knowledge_get` | Read Knowledge Package | true | — | — | — | `knowledge.ts` |
| `aimeat_knowledge_links` | Get Knowledge Links | true | — | — | — | `knowledge.ts` |
| `aimeat_knowledge_contribute` | Contribute to Knowledge Package | false | false | true | false | `knowledge.ts` |
| **Apps** | | | | | | |
| `aimeat_app_list` | List Apps | true | — | — | — | `apps.ts` |
| `aimeat_app_get` | Get App | true | — | — | — | `apps.ts` |
| `aimeat_app_versions` | List App Versions | true | — | — | — | `apps.ts` |
| `aimeat_app_publish` | Publish App | false | false | true | false | `apps.ts` |
| `aimeat_app_delete` | Delete App | false | **true** | true | false | `apps.ts` |
| **Extensions** | | | | | | |
| `aimeat_extension_list` | List Extensions | true | — | — | — | `extensions.ts` |
| `aimeat_extension_get` | Get Extension | true | — | — | — | `extensions.ts` |
| `aimeat_extension_install` | Install Extension | false | false | false | false | `extensions.ts` |
| `aimeat_extension_activate` | Activate Extension | false | false | true | false | `extensions.ts` |
| `aimeat_extension_deactivate` | Deactivate Extension | false | false | true | false | `extensions.ts` |
| `aimeat_extension_invoke` | Invoke Extension Action | false | false | false | **true** | `extensions.ts` |
| `aimeat_extension_delete` | Delete Extension | false | **true** | true | false | `extensions.ts` |
| **Cortex** | | | | | | |
| `aimeat_cortex_list` | List Cortex Extensions | true | — | — | — | `cortex.ts` |
| `aimeat_cortex_install` | Install Cortex | false | false | false | false | `cortex.ts` |
| `aimeat_cortex_activate` | Activate Cortex | false | false | true | false | `cortex.ts` |
| `aimeat_cortex_deactivate` | Deactivate Cortex | false | false | true | false | `cortex.ts` |
| `aimeat_cortex_delete` | Delete Cortex | false | **true** | true | false | `cortex.ts` |
| **Chat instances** | | | | | | |
| `aimeat_instance_list` | List Chat Instances | true | — | — | — | `chat-instances.ts` |
| `aimeat_instance_status` | Get Chat Instance Status | true | — | — | — | `chat-instances.ts` |
| `aimeat_instance_create` | Create Chat Instance | false | false | false | false | `chat-instances.ts` |
| **Messages** | | | | | | |
| `aimeat_message_inbox` | Read Message Inbox | true | — | — | — | `agent-messages.ts` |
| `aimeat_message_send` | Send Agent Message | false | false | false | false | `agent-messages.ts` |
| **Consent** | | | | | | |
| `aimeat_consent_list` | List Consents | true | — | — | — | `consent.ts` |
| `aimeat_consent_grant` | Grant Consent | false | false | true | false | `consent.ts` |
| `aimeat_consent_revoke` | Revoke Consent | false | **true** | true | false | `consent.ts` |
| **Flags / moderation** | | | | | | |
| `aimeat_flag_report` | Report Content for Moderation | false | false | false | false | `flags.ts` |
| **Admin** (operator-only) | | | | | | |
| `aimeat_admin_stats` | Admin: Node Stats | true | — | — | — | `core.ts` |
| `aimeat_admin_agents` | Admin: List Agents | true | — | — | — | `core.ts` |
| `aimeat_admin_config` | Admin: Read Config | true | — | — | — | `core.ts` |
| `aimeat_admin_mint` | Admin: Mint Morsels | false | **true** | false | false | `core.ts` |

**Notes:**
- "destructive" marked **bold** = irreversible deletes/unjoins/revokes. These are the calls where Claude Desktop will surface a stronger confirmation UI when annotations are honored.
- `aimeat_action_execute`, `aimeat_capabilities_invoke`, `aimeat_extension_invoke` get `openWorldHint: true` because they dispatch to third-party or sandboxed extension code whose effects we can't bound.
- "false / —" pattern: when `readOnlyHint: true`, the other three hints are ignored per spec — emit as `undefined` in the annotations object to avoid noise.

### B. Privacy policy — DONE (template-driven, env-configured)

Anthropic requires a privacy policy URL. **Missing or incomplete = immediate rejection** per [submission docs](https://claude.com/docs/connectors/building/submission).

- [x] **B.1** Format chosen: static HTML at `aimeat/public/privacy.html` (EN) and `privacy.fi.html` (FI), served at `/v1/privacy` and `/v1/privacy/fi`. Both files are **templates** with `{{placeholder}}` tokens substituted per-request from operator config — every AIMEAT node operator fills in their own info via `AIMEAT_OPERATOR_*` env vars. **No hardcoded operator identity in the repo.**
- [x] **B.2** Privacy policy drafted covering all required sections: controller, data categories, legal bases, recipients, sub-processors, international transfers, retention, cookies, GDPR rights with Data Wallet links, security, children, self-hosting, changes, contact. Voice is neutral third-person ("the operator") so the template works for any node. Genesis-network framing kept as protocol-level content; aimeat.io-specific personality is not in the template.
- [x] **B.3** `https://aimeat.io/v1/privacy` and `/v1/privacy/fi` serve over HTTPS via Scaleway + nginx.
- [x] **B.4** Privacy policy linked from `connect.html` (in the "data handling" details section) and from the directory submission form (field G.20).
- [x] **B.5** Operator config: 13 env vars (`AIMEAT_OPERATOR_*`) cover legal name, type, postal address, country, email, security email, hosting provider name/url/location, supervisory authority name/url, effective date, policy version. Required fields: name, address, country, email, hostingName, hostingLocation, supervisoryName, supervisoryUrl, effectiveDate. Optional with defaults: type (natural_person), securityEmail (falls back to email), hostingUrl (no link), policyVersion (1.0).
- [x] **B.6** Fail-loud behavior: if any required `AIMEAT_OPERATOR_*` is missing, `/v1/privacy` returns **HTTP 503** with an operator-facing fallback page listing the missing env vars + linking to `.env.example`. This prevents self-hosters from silently shipping a half-configured policy. Implementation: `missingOperatorConfig()` in `src/config.ts`, wired into `serveStaticPage` in `src/routes/portal.ts`.
- [x] **B.7** `.env.example` documents all `AIMEAT_OPERATOR_*` vars in a clearly labelled REQUIRED/OPTIONAL block.
- [x] **B.8** Updated `aimeat init` CLI wizard with `askOperatorSettings()` — 13 prompts covering name/type/address/country/email/security email/hosting (name, url, location)/supervisory authority (name, url)/effective date. Skipped for `dev` use case; ask-with-confirm for `personal`; required for `public`/`custom`. Translations added to `locales/en.json` + `fi.json` under `init.operator*` keys.
- [x] **B.9** Templated `connect.html` + `connect.fi.html` so self-hosters get their own MCP endpoint URL, Cursor deeplink (base64-config server-rendered), node name + node ID embedded. The same `templateVars()` in `src/routes/portal.ts` feeds both privacy and connect pages.

### C. Public-facing MCP docs page (3+ example prompts) — DONE

Anthropic requires at least 3 working example prompts demonstrating core functionality, plus public docs by publish date.

- [x] **C.1** Created `aimeat/public/connect.html` (EN) and `aimeat/public/connect.fi.html` (FI), served at `https://aimeat.io/v1/connect` and `/v1/connect/fi`. Content shape:
  - Hero with tagline + endpoint URL + protocol version
  - **6 client cards** with attach instructions: Cursor (1-click deeplink), Claude Code CLI (1-line), VS Code Copilot (1-line via `code --add-mcp`), Claude Desktop (4-step GUI), claude.ai web (4-step GUI), ChatGPT custom connector
  - 4 worked example prompts (see C.2)
  - "What you get" bullets (94 MCP tools, persistent identity, GDPR tooling, federation)
  - Collapsible technical details: protocol/transport, reference manifest, self-host instructions, data handling
  - Cross-links to privacy policy, GitHub, language switcher
- [x] **C.2** Example prompts implemented (4 total — one bonus on top of the required 3):
  1. "Save a note for me: my favourite hobby is rock climbing, and I'm based in Helsinki." → `aimeat_memory_write`
  2. "What do you know about me from AIMEAT?" → `aimeat_memory_list` + `aimeat_memory_read`
  3. "Find people in the AIMEAT directory who are also into rock climbing, near Helsinki." → `aimeat_catalogue_directory`
  4. "What organisms (groups) can I join, and what's happening on the boards?" → `aimeat_organism_list` + `aimeat_catalogue_boards`
- [x] **C.3** Cursor deeplink base64-encoded: `cursor://anysphere.cursor-deeplink/mcp/install?name=aimeat&config=eyJ1cmwiOiJodHRwczovL2FpbWVhdC5pby92MS9tY3AifQ==` (decodes to `{"url":"https://aimeat.io/v1/mcp"}`).
- [ ] **C.4** Cross-reference content with `aimeat/public/llms-template.txt` MCP section so the two stay in sync. (Deferred — `llms-template.txt` is for AI assistants discovering the protocol; `connect.html` is for humans attaching their AI.)

### D. Logo, favicon, screenshots

- [ ] **D.1** Replace the placeholder red-heart `favicon.ico` at `https://aimeat.io/favicon.ico` with the actual AIMEAT brand mark. Source: probably the genesis-001 badge or a derivative.
- [ ] **D.2** Prepare a square logo (PNG or SVG) for the directory listing. Anthropic doesn't publish exact dimensions in the public submission form, but 512×512 PNG + an SVG is safe.
- [ ] **D.3** If submitting as MCP App (interactive UI surface, not just tools), prepare **3–5 carousel PNG screenshots, ≥ 1000px wide**, each with a paired prompt text. The existing `aimeat/public/assets/mcp_1_*.png`, `mcp_2_*.png` may already work — verify width.
- [ ] **D.4** Add a SAFE permanent home for all submission-image assets under `aimeat/public/assets/connector/` and reference them by https URL in the submission form.

### E. Reviewer test account

Anthropic requires a test account with sample data so reviewers can exercise the connector.

- [ ] **E.1** Provision a `reviewer@aimeat.io` GHII (or similar) on aimeat.io with a stable password (vault it). Document setup steps for reviewers in the submission form.
- [ ] **E.2** Seed the test account with sample data covering each capability surface:
  - 5+ memory entries (different types: notes, preferences, public profile fields)
  - 2 organisms joined
  - 1 sharing group owned + 1 joined
  - 1 published app
  - 1 installed extension + 1 cortex
  - Sample work inbox / wallet balance
- [ ] **E.3** Decide whether to grant the reviewer account `operator` role so admin tools are exercisable. Probably yes for a complete review, no if you'd rather only show agent-scoped surface.
- [ ] **E.4** Write a short Markdown setup-instructions doc (link in submission form) explaining how to OAuth-connect from Claude Desktop using the test credentials.

### F. Endpoint & policy hardening (technical pre-flight)

**Audit completed 2026-05-29 against local dev (`http://localhost:40050`) and live prod (`https://aimeat.io`).**

- [x] **F.1** Origin-header validation. **Code at `aimeat/src/mcp/index.ts:137-149` is correct.** Production setting `AIMEAT_CORS_ALLOWED_ORIGINS=*` is **intentional by architecture**: AIMEAT is Bearer-token-only (OAuth 2.1), with no cookies/implicit credentials, so CORS is not the protection layer. Apps published via `aimeat_app_publish` run in arbitrary browser origins and must be able to attach. The MCP spec's Origin recommendation targets local stdio servers preventing DNS rebinding; it does not apply to OAuth-protected remote resource servers. **Document this architectural choice in the directory submission notes** to preempt reviewer flags.
- [x] **F.2** OAuth metadata documents (RFC 8414 / RFC 9728). **Fixed 2026-05-29**: nginx now passes `.well-known/` through to Express. Verified live: both endpoints return 200 with correct `https://aimeat.io` issuer + resource URIs. End-to-end OAuth discovery chain (401 → `WWW-Authenticate` header → `.well-known/oauth-protected-resource` → `oauth-authorization-server` → authorize/token endpoints) is now traversable by any conforming MCP client.
- [x] **F.3** MCP protocol version. SDK 1.27.1 advertises `LATEST_PROTOCOL_VERSION = '2025-11-25'`, exactly what Anthropic Connectors Directory expects. Backward-compatible negotiation down to `2024-10-07`.
- [x] **F.4** Rate-limiting on `/v1/mcp`. Confirmed live: `X-RateLimit-Limit: 300` per window. Reviewer hot-loop traffic gets `429`, not 500.
- [x] **F.5** CORS for Anthropic-origin attachment. Confirmed live: `Access-Control-Allow-Origin: *`, `Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS`, `Access-Control-Allow-Headers: Content-Type, Authorization, Idempotency-Key, mcp-session-id`, `Access-Control-Expose-Headers: mcp-session-id`. Permissive by design (see F.1).
- [x] **F.6** Production base URL. Live `WWW-Authenticate` header on 401 confirms `AIMEAT_BASE_URL=https://aimeat.io` is set correctly: `Bearer resource_metadata="https://aimeat.io/.well-known/oauth-protected-resource"`.
- [x] **F.7** Production security headers. Confirmed live: `Strict-Transport-Security: max-age=31536000; includeSubDomains`, CSP with nonce, `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: strict-origin-when-cross-origin`.
- [ ] **F.8** Run pre-submission checklist at `https://claude.com/docs/connectors/building/review-criteria`.

#### Nginx fix for F.2

The catch-all dotfile-deny rule is blocking `.well-known/`. Add an explicit exception **before** the dotfile-deny block:

```nginx
# Allow .well-known/ through to the Express app (RFC 8615)
location ^~ /.well-known/ {
    proxy_pass http://localhost:40050;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Real-IP $remote_addr;
}

# Existing dotfile deny (keep as-is) — now applies to everything EXCEPT .well-known/
location ~ /\. {
    deny all;
}
```

Verify after `nginx -t && systemctl reload nginx`:
```bash
curl -sS -o /dev/null -w "%{http_code}\n" https://aimeat.io/.well-known/oauth-authorization-server
# Must output: 200
```

### G. Submission form fields (collect everything before opening the form)

- [ ] **G.1** Server name: `AIMEAT` (or `AIMEAT Protocol`)
- [ ] **G.2** Server URL: `https://aimeat.io/v1/mcp`
- [ ] **G.3** Tagline (one line, ~80 chars): _draft_
- [ ] **G.4** Description (longer): _draft_
- [ ] **G.5** Use cases: list 3-5 — personal AI memory across chats, agent-to-agent collaboration via work queue, shared knowledge packages, federated identity across nodes, prompt-driven app generation.
- [ ] **G.6** Server logo URL/SVG (from D.2)
- [ ] **G.7** Favicon verification (D.1 must be done before this)
- [ ] **G.8** Auth type: `OAuth 2.1 + PKCE`
- [ ] **G.9** Transport: `Streamable HTTP (MCP spec 2025-11-25)`
- [ ] **G.10** Read/write capabilities: read + write (both)
- [ ] **G.11** Connection requirements: public OAuth (no allowlist)
- [ ] **G.12** Complete tool list with human-readable names (use `title` from the table above)
- [ ] **G.13** Resources & prompts inventory (memory/storage/wallet resources from `core.ts`, plus any prompts)
- [ ] **G.14** Tool-annotations compliance confirmation (post-A)
- [ ] **G.15** Data handling description (cross-reference privacy policy)
- [ ] **G.16** Third-party connections disclosure (federation peers if any are configured by default)
- [ ] **G.17** Health data flag: false
- [ ] **G.18** Category selection: "Productivity" or "Developer Tools" (pick the closest)
- [ ] **G.19** Documentation links (C.1)
- [ ] **G.20** Privacy policy URL (B.1)
- [ ] **G.21** Support channel (GitHub Issues link)
- [ ] **G.22** Test account credentials + setup instructions (E.4)
- [ ] **G.23** GA date
- [ ] **G.24** Surfaces tested: claude.ai web, Claude Desktop, Claude Mobile, VS Code Copilot, Cursor
- [ ] **G.25** Allowed Link URIs (optional): `https://aimeat.io`, `https://app.aimeat.io` (if used)
- [ ] **G.26** Policy compliance checkbox(es)
- [ ] **G.27** If MCP App track: paired screenshot prompts (D.3)

### H. Post-submission

- [ ] **H.1** Submit at [https://clau.de/mcp-directory-submission](https://clau.de/mcp-directory-submission)
- [ ] **H.2** Monitor `mcp-review@anthropic.com` inbox for review feedback. Typical timeline ~2 weeks; queue-dependent.
- [ ] **H.3** Watch for rejection categories — re-run the [sunpeak.ai rejection-cause analysis](https://sunpeak.ai/blogs/claude-connector-directory-submission/) checklist if rejected.
- [ ] **H.4** Once accepted, announce on README + add a "One-click connect to Claude" button to the aimeat.io landing page.
- [ ] **H.5** Decide whether to also submit to: Cline MCP Marketplace ([github.com/cline/mcp-marketplace](https://github.com/cline/mcp-marketplace)), Smithery, Awesome-MCP-Servers, MCP Bundles directory.

## Adjacent work (related but not blocking)

- [ ] **X.1** Adopt MCP `structuredContent` on every tool while keeping a compact text summary in `content` — unlocks zero-token UI payloads in MCP Apps clients. Tracked in [research report Part 1.5](../research/2026-05-29-mcp-rich-rendering-and-one-click-setup-REPORT.md).
- [ ] **X.2** Expose memory + knowledge as first-class **MCP Resources** (not JSON-stringified tool output) so Claude Code `@`-mentions auto-attach. Some scaffolding exists in `core.ts` (`aimeat://memory/{key}` resource template).
- [ ] **X.3** Ship `aimeat connect mcp-config <client>` helper subcommand that prints the right config snippet for each client (Claude Desktop, Cursor, VS Code, Cline).
- [ ] **X.4** Add a public `aimeat.io/connect` landing page with platform-aware "Add to Claude / Cursor / VS Code" buttons.

## Open questions / decisions for the developer

1. **MCP App vs plain MCP Server submission?** The MCP App track requires 3-5 screenshots + paired prompts and unlocks the interactive HTML iframe UI (per [MCP Apps spec 2026-01-26](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx)). AIMEAT has views already; might be worth submitting as both tracks if they're separate.
2. **Reviewer account scope** — operator (sees admin tools) or owner only? Operator is more thorough; owner is safer.
3. **Brand mark** — is the genesis-001-badge the canonical logo or is there a separate aimeat-logo asset somewhere?
