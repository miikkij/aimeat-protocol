# Changelog

All notable changes to AIMEAT are documented in this file.

## [1.13.3] - 2026-05-29

### Changed (skill bundle SKILL.md frontmatter)

- **`generic-adapter` SKILL.md now ships Anthropic Agent-Skill style YAML frontmatter** (`name`, `description`, `trigger`, `tags`) at the top of the file. Previously it started directly with the `# AIMEAT Agent Integration` heading and was just free-form markdown. The frontmatter lets frameworks that natively auto-discover skills register the bundle as a first-class skill instead of reading it as opaque text -- specifically CrewAI >= 1.14's `discover_skills()` (and `Agent(skills=[path])`), Anthropic's own Claude Agent Skills, and future LangGraph/AutoGen adapters that adopt the same convention. The bundle body below the frontmatter is unchanged, so existing LLM-driven flows that parse the body as text continue to work. `aimeat-hermes` adapter already shipped with frontmatter since v1.0; this brings the generic (CrewAI / LangGraph / AutoGen / generic MCP) adapter to parity.
- **`hermes-adapter` SKILL.md frontmatter expanded** with a fuller `description`, the same standardised `trigger`, and a `tags` block (`aimeat`, `agent-orchestration`, `mcp`, `hermes`). The old shorter form ("AIMEAT node integration for {nodeId}") was too terse for token-aware skill discovery -- LLMs read the description before deciding to activate the skill, so describing what activation enables matters.

### Why this matters

The next architectural step on the CrewAI integration side is `aimeat-crewai 0.2.0`, which will load the AIMEAT skill bundle as a CrewAI Skill (`Agent(skills=[skill_path])`) instead of carrying the entire operational manual inside the Python package's persona template. With this change in place, the bundle that AIMEAT already distributes IS the canonical operational manual -- the Python package shrinks to just identity + calling-conventions, and skill updates flow naturally through `aimeat connect refresh` without requiring a `pip install -U`.

## aimeat-crewai 0.1.2 - 2026-05-29

### Fixed

- **Optional MCP parameters leaked through as JSON `null`.** Persona instructions to "omit instead of null" were ignored not by the LLM but by the layer below it: `crewai-tools` / `mcpadapt` builds a Pydantic args model for each MCP tool, fills missing optional fields with `None`, and serialises to JSON where `None` becomes `null`. AIMEAT server-side zod `.optional()` then rejected those calls with "expected string, received null". 0.1.2 wraps each tool's `_run` to filter kwargs where the value is `None` before forwarding to the MCP transport, so the request payload omits the field entirely (which `.optional()` accepts). Fixes were observed in `aimeat_memory_write` (tags/ttl_hours/group_id), `aimeat_handbook_get` (module), and any other tool with optional params.
- Internal helper `_strip_none_kwargs(tool)` applied to every tool returned by both `create_liaison_agent` and `liaison_tools`. Persona's earlier "omit instead of null" guidance stays in place as a redundancy.

## [1.13.2] - 2026-05-29

### Fixed (stalled task recovery)

- **Tasks that were marked `stalled` by the stall detector had no recovery path: `aimeat_task_complete`, `aimeat_task_event`, `aimeat_task_todo`, and `aimeat_task_fail` all returned `INVALID_STATE` ("Only active tasks can be ...").** The stall detector was originally designed as a one-way signal -- once stalled, the task was effectively orphaned. In practice this hits during normal onboarding flow whenever an agent's subprocess briefly crashes, the operator kills it to fix something, or there's a network glitch: the onboarding test task gets stalled, the agent restarts, the agent has the correct deliverable -- and AIMEAT refuses to accept it. Now all four endpoints handle stalled tasks gracefully:
  - `POST /v1/agents/:name/tasks/:id/event` -- if the task is stalled when an event arrives, the task is auto-resumed (`stalled` → `active`) and a `started` event is appended ("Task auto-resumed from stalled"). The original event is then appended normally. Rationale: an event from the agent IS evidence that the agent is back.
  - `PATCH /v1/agents/:name/tasks/:id/todos/:todoId` -- same auto-resume semantics.
  - `POST /v1/agents/:name/tasks/:id/complete` -- accepts `stalled` directly without requiring re-activation. A late deliverable is more useful than rejecting it.
  - `POST /v1/agents/:name/tasks/:id/fail` -- accepts `stalled` so the agent can explicitly mark the task failed instead of leaving it lingering.
  - `POST /v1/agents/:name/tasks/:id/start` (owner-only) -- `queued | paused | stalled` → `active`, so the owner has an explicit re-start path too.
- The stall detector itself is unchanged: it still marks quiet active tasks as stalled. What changed is that stalled is now a recoverable state.

## [1.13.1] - 2026-05-29

### Fixed (multi-agent `aimeat connect serve` routing)

- **`aimeat_memory_*`, `aimeat_handbook_get`, `aimeat_storage_*`, `aimeat_wallet_balance`, `aimeat_action_execute`, `aimeat_work_*`, `aimeat_catalogue_search`, `aimeat_agent_profile`, `aimeat_board_*`, `aimeat_admin_*` all silently routed through the connector's primary-agent token regardless of which `agent_name` the caller passed.** The pattern from `core.ts` and `handbook.ts` was `const { client } = registry.resolve()` at MODULE scope -- once -- which captured a single client and reused it across every tool call. So in a multi-agent install (e.g. one user has `assistant`, `falcon`, `hermes`, `company-crew` all locally), a CrewAI liaison agent calling `aimeat_memory_write --agent company-crew "..."` would write to whoever the connector picked as primary at startup (often `falcon` or `assistant`, NOT `company-crew`), and worse: if the primary's token didn't have valid scopes on the target node, the result was `AUTH_REQUIRED` -- baffling because the same connection's onboarding tools worked fine (those used per-call `pickAgent()`). Fix: every tool in `core.ts` and `handbook.ts` now accepts an `agent_name` parameter and calls `pickAgent(registry, agent_name)` PER CALL. Single-agent installs are unaffected: `agent_name` is optional and defaults to the only loaded agent.
- **Note:** This patch covers the 17 tools that CrewAI liaison agents typically reach for (memory CRUD, handbook, storage, wallet, work queue, catalogue, agent profile, boards, admin). The remaining 15 tool files (apps, capabilities, cortex, extensions, flags, groups, instances, knowledge, organisms, etc.) still use module-scope client resolution and will be migrated in 1.14.0. They affect fewer typical liaison flows so the patch is staged rather than blocked on a full sweep.

### Changed (onboarding error semantics)

- **`POST /v1/agents/:name/onboarding/step/:id`** now distinguishes two failure modes that previously both returned `INVALID_STEP`: (a) the step ID is not in the canonical step catalog at all -- still `INVALID_STEP` (typo / bad request), and (b) the step ID IS canonical but is not part of THIS agent's onboarding flow (task-runner mode skips interactive-only steps like `read_directives`) -- now `STEP_NOT_IN_FLOW`. The error message explicitly tells LLM-driven liaison agents to treat the second case as "no-op, skip and continue" rather than retrying. The `aimeat-crewai 0.1.1` persona reads this and handles it gracefully; the canonical interactive-mode `INVALID_STEP` behaviour is unchanged.

### Related work in `aimeat-crewai` 0.1.1

The above server-side fixes pair with `aimeat-crewai 0.1.1` (published the same day) which (a) fixes the Windows `.cmd` shim crash in `stdio_params`, (b) injects the agent_name into the liaison persona so the LLM stops guessing it, and (c) tells the liaison to OMIT optional MCP parameters instead of passing null (which the MCP schema rejected). Together these resolve the four blockers observed in the first end-to-end CrewAI field test against aimeat.io. See `python/aimeat-crewai/CHANGELOG`-section above (independent versioning).

## aimeat-crewai 0.1.1 - 2026-05-29

(Independent versioning for the Python package; see `python/aimeat-crewai/`.)

### Fixed

- **Windows `stdio_params` crashed with WinError 193.** `aimeat` on Windows is an npm-installed `.cmd` shim that `CreateProcess` (used by the stdio MCP client) cannot execute directly. `stdio_params()` now detects Windows + `.cmd`/`.bat` shims on PATH and auto-wraps the invocation via `cmd.exe /c <command>`. No-op on Linux/Mac. No-op when the user passed an absolute path to a real `.exe`. Internal helper: `_resolve_windows_command()`.
- **Liaison persona did not know its own agent name** → the LLM guessed (`"assistant"`, `"crewai"`, the CrewAI role name) and wasted retries on AIMEAT tools that take an `agent_name` parameter. `create_liaison_agent()` now accepts an `agent_name=` keyword that gets injected verbatim into the persona's `backstory`. When omitted, the factory tries to extract it from the `--agent` flag in `stdio_params()` automatically. HTTP/SSE transport users must pass `agent_name` explicitly because there's no `--agent` flag to read.
- **Persona did not tell the LLM how to handle optional MCP parameters.** Added explicit calling-conventions section: "for OPTIONAL parameters, OMIT them entirely instead of passing null. MCP schema validation rejects explicit null." Also covered: enum params, AUTH_REQUIRED handling, INVALID_STEP handling (so the liaison gracefully skips steps that don't exist in reduced task-runner onboarding flow).

### Changed

- **`DEFAULT_BACKSTORY` → `DEFAULT_BACKSTORY_TEMPLATE`.** The template contains a `{agent_name}` placeholder that the factory formats. The old `DEFAULT_BACKSTORY` constant is kept as a backwards-compat alias that resolves the placeholder to a generic string.
- **Persona now mentions** the 3 calling conventions before the responsibilities list -- LLMs read top-of-prompt content more reliably than buried mid-text instructions.

## [1.13.0] - 2026-05-29

### Changed (task-runner Hello Integration)

- **Task-runner reduced flow is now 7 steps, not 5. `accept_test_task` and `complete_test_task` are kept.** The original 1.12.0 rationale ("task-runners have no interactive surface, skip the test task") was wrong on inspection: a task-runner agent's ENTIRE purpose is to execute queued tasks. The onboarding test task is the natural, server-driven smoke test that proves the operator's `runner:` block in `config.yaml` is wired correctly, the subprocess starts, and stdout round-trips back as the deliverable. Onboarding now does not flip to `completed` until the agent's subprocess has actually executed a real task end-to-end. The previously documented "Step 4 smoke test" disappears as a manual step -- it is built into onboarding. New skipped set for task-runner: `send_test_message`, `configure_delivery`, `report_telemetry`, `publish_commands`, `declare_services`, `read_directives` (the truly interactive-only steps).

### Changed (paste prompt + CLI hint)

- **Profile -> Agents -> "Connect a task-runner agent" paste rewritten.** Step 4 (manual smoke test through the browser) is removed. Verification at the end now lists the expected 7-step progression and explains that `complete_test_task` staying pending after `accept_test_task` passes is the canonical "your subprocess didn't run" signal -- with the actual diagnostic command (`aimeat_task_list`) to inspect the server-side task state.
- **`aimeat connect add --mode task-runner`** post-auth hint now says "reduced 7-step flow (the test-task pair is kept so onboarding doubles as a smoke test for your subprocess)" instead of the misleading "5-step".

### Updated tests

- **`e2e-agent-onboarding` test 40** asserts exactly 7 steps for task-runner (was 5), and verifies the expected ID set includes `accept_test_task` + `complete_test_task`.
- **Test 41** renamed from "auto-completes when all 5 steps pass" to "non-test-task steps pass; test-task pair stays pending until subprocess runs" -- it now asserts the 5 non-test-task steps reach `passed`, the test-task pair stays `pending`, and overall onboarding stays `in_progress`. This is the correct shape: the E2E cannot simulate a real subprocess, and the new design is explicit that onboarding waits for a real task round-trip before flipping to `completed`. 44/44 onboarding tests passing on SQLite.

### Migration

- **Existing task-runner agents under 1.12.4 have only 5 onboarding steps.** They show `completed` once those 5 pass, which under the new shape would correspond to "5/7 done, subprocess never verified". The cleanest path is to delete + recreate the agent under 1.13.0 so onboarding adopts the new shape. Alternatively, leave them alone -- the onboarding record is immutable for completed agents and the new step list only affects newly-onboarded agents.

## [1.12.5] - 2026-05-29

### Fixed (documentation)

- **Profile -> Agents -> "Connect a task-runner agent" paste prompt Step 4 (smoke test) recommended a CLI call that cannot work.** The paste told the agent to invoke `aimeat_task_propose_todos --json '{"target_agent":"...","title":"Smoke test","prompt":"..."}'` to queue a test task. This was wrong on two counts: (1) `aimeat_task_propose_todos` is for adding TODOs to an EXISTING task (it requires `task_id`), not for creating new ones; the schema rejects `target_agent`, `title`, and `prompt` outright. (2) Task creation goes through `POST /v1/agents/:name/tasks` which requires the `owner` role, so even a correct create-tool would 403 from an agent token. The CLI fallback has no task-creation tool at all. Updated paste Step 4 to direct the operator to create the smoke task from the browser (Profile -> Agents -> expand card -> Tasks tab -> "+ New task"), which uses the owner's session JWT and works. The verification side (listing the completed task via `aimeat_task_list`) is still done from the agent's CLI session and is correct.

## [1.12.4] - 2026-05-29

### Fixed

- **CRITICAL: `--mode task-runner` was silently dropped during device-auth registration.** The mode field was added to `DeviceAuthorizationRecord` in 1.12.0 but the SQLite + MongoDB storage layers never persisted it. SQLite `createDeviceAuth` INSERT statement omitted the column; MongoDB `createDeviceAuth` omitted it from the Prisma `data` block; both `deserializeDeviceAuth` / `toDeviceAuthRecord` returned `mode: undefined` no matter what the route stored. Net effect: every `aimeat connect add --mode task-runner` request looked successful (server returned `ok: true`, agent got approved, token issued), but the verify-route's `request.mode` was `undefined`, so `createAgent` defaulted to `'interactive'` and `createDefaultSteps()` produced the full 13-step Hello Integration. Operators saw `INTERACTIVE` badges and 13-step onboarding for agents they had explicitly registered as `task-runner` -- the entire mode field was a no-op for device-auth registrations from 1.12.0 through 1.12.3. Fix: SQLite `device_auth` table gets a `mode` column via `safeAddColumn` migration (auto-applied on server start); MongoDB Prisma `DeviceAuth` model gets a `mode String?` field (run `prisma generate` + redeploy); both `createDeviceAuth` and the deserializers now round-trip the field. The owner-only `PATCH /v1/agents/:name/mode` route was unaffected and worked all along -- it just was not a viable single-call path because of the runToolCall agent-routing bug (also in 1.12.3).
- **Operator migration:** Any agent created with 1.12.0-1.12.3 and registered as `task-runner` is actually `interactive` on the server. The clean fix is to delete + recreate with 1.12.4. Alternatively, the owner can use the browser DevTools console workaround (`fetch('/v1/agents/<name>/mode', { method: 'PATCH', ... })` with their own owner JWT) to re-classify in place -- the storage layer reads/writes the agent table's `mode` column correctly (only the device-auth pathway was broken).

### Changed

- **`device_auth` table gains a `mode` column** (SQLite + MongoDB). Existing pending device-auth requests created before 1.12.4 default to `'interactive'`; if the operator wants a pending request to become task-runner, they should cancel + re-register.

## [1.12.3] - 2026-05-29

### Fixed

- **`aimeat connect call --agent <name>` silently routed through the primary agent.** `runToolCall` always loaded the global config (`loadConfig()`) and called `Client.fromConfig()` no matter what `--agent` was passed, then put `config.agent` in the REST URL. Net effect: in any multi-agent install, every `connect call --agent foo` ran as whichever agent `~/.aimeat/config.yaml` happened to point at (the primary). For users whose primary was a remote agent (e.g. `falcon@aimeat.io`) but who had local task-runner agents, every call returned the WRONG agent's data — `aimeat_onboarding_status --agent company-crew` returned falcon's completed 13-step onboarding, masking that company-crew's onboarding was actually fine. Fix: `runToolCall` now resolves `--agent` (and optional `--owner` disambiguator) via the new `loadAgentByName()` helper, builds an `AimeatClient` from that agent's stored token + per-agent `node_url`, and uses the right agent name in REST paths. Without `--agent`, behavior is unchanged (falls back to primary).
- **`aimeat connect list` showed `[interactive]` for agents registered with `--mode task-runner`.** The label only flipped to `[task-runner]` when the local config.yaml had a `runner:` block, ignoring the server-side `mode` field entirely. Now reads `pa.mode` from per-agent config (written by `connect add --mode`) first, falling back to `runner:` presence for agents predating the field. Also adds a `[missing runner: block]` warning next to task-runner agents whose subprocess command has not been configured yet — a frequent stuck point ("agent is registered but nothing happens when I queue a task").

### Changed

- **`AimeatPerAgentConfig.mode` field** added to `~/.aimeat/agents/<name>/config.yaml`. Written by `aimeat connect add --mode <mode>` so the connector knows what the server thinks this agent is, without an extra REST call. Independent of the `runner:` block (which configures the local subprocess); both are needed for a working task-runner.
- **`aimeat connect add --mode <mode>` is now idempotent on the local label.** If the agent already has a valid token, rerunning `connect add --mode task-runner` updates only the local `mode` field in per-agent config — no second device-auth round, no server-side change. Use this to retroactively label agents registered with 1.12.2's CLI (which set the server-side mode but did not persist a local label) so they show `[task-runner]` in `connect list`.

## [1.12.2] - 2026-05-29

### Fixed

- **Task-runner agents could not be created from the CLI without a manual owner-role REST call.** `aimeat connect add` registered every agent as `mode: interactive`, then required the owner to switch it to `task-runner` via `PATCH /v1/agents/:name/mode` (owner-only). But the connector only holds agent tokens, so `aimeat connect call aimeat_agent_mode_set` from the new agent's session returned `Role "owner" required`. The only path was DevTools console / curl, which was a workaround, not a flow. Fix: `aimeat connect [add] --mode <mode>` now propagates the mode all the way to `POST /v1/agents/device-authorize` so the agent is created with the right mode from the start -- the reduced 5-step Hello Integration kicks in immediately, no second call needed.

### Changed

- **Profile -> Agents -> "Connect a task-runner agent" paste prompt** rewritten to use `--mode task-runner` on `connect add` as Step 1, dropping the old broken Step 2 (`aimeat_agent_mode_set`). Steps renumbered 1-4 (was 1-5).
- **`aimeat connect --help`** updated: `connect add` now documents `--mode <mode>` with the four valid values and a note that `mode` alone does not configure the subprocess -- `~/.aimeat/agents/<name>/config.yaml` still needs a `runner:` block. Example invocation in the help text now shows `--mode task-runner`.

### Migration

If you registered a task-runner-style agent under 1.12.0 / 1.12.1 (it will show `INTERACTIVE` badge in Profile -> Agents and have 13 onboarding steps), the cleanest path is to delete + recreate it with `--mode task-runner`. The `PATCH /v1/agents/:name/mode` endpoint still exists for owner-driven re-classification of existing agents.

## [1.12.1] - 2026-05-29

### Fixed

- **`aimeat connect call aimeat_agent_mode_set` / `aimeat_agent_tags_set` returned `Unknown CLI-callable tool`** -- the two new owner-only tools added in 1.12.0 were defined in `cli/connect/tool-call.ts` (handler side) but not in the central `mcp/catalog/definitions.ts` registry, so `runToolCall` rejected them via the `getCliToolMetadata` check that requires `visibility.cliFallback === true`. They also showed up in zero `aimeat connect tools` listings. This blocked task-runner agents from being switched to `mode: task-runner` via the CLI fallback, leaving them stuck on the 13-step interactive Hello Integration. Catalog + annotation entries added; both tools now visible in `aimeat connect tools` and callable.

### Added (Profile UI)

- **"Connect a task-runner agent (CrewAI, custom workers)" collapsible** on Profile -> Agents -> + Connect agent. Includes a what-is/when-to-use explanation, a CrewAI-shaped example, an editable agent-name input that re-templates the paste live, and a "Copy task-runner instruction" button. The paste covers all 5 steps (connect add, `aimeat_agent_mode_set`, runner-block `config.yaml`, `connect serve`, smoke test) with the owner-handle and node URL pre-filled. Distinct from the generic interactive-agent prompt because task-runners never go through the 13-step flow.

## [1.12.0] - 2026-05-29

Headline: agents are now classified by **operational mode** and can carry
**owner-managed tags**. Mode picks the Hello Integration flow -- a
**task-runner** agent (CrewAI crew, triggered worker) gets a reduced
5-step onboarding instead of the full 13, because it has no interactive
command surface, never sends messages, and never runs a test task. Tags
drive a new filter bar + group-by selector on the Your Agents tab so a
fleet of 2-20 mixed agents stays navigable.

### Added

#### Agent Mode Classification (`autonomous` / `interactive` / `task-runner` / `coordinator`)
- **`AgentRecord.mode` field** -- new strict union persisted on every agent record. `autonomous` runs continuously (Hermes, OpenClaw). `interactive` (default) responds to user requests (Claude Code, Cursor, Cline). `task-runner` is triggered, runs one task, exits (CrewAI crews, Inngest-style workers). `coordinator` orchestrates other agents (Claude Desktop, LangGraph supervisor) and shares the interactive onboarding. SQLite gets a `mode TEXT DEFAULT 'interactive'` column via `safeAddColumn`; MongoDB gets `mode String?` on the Prisma `Agent` model. Existing agents fall back to `interactive` on read (they already completed the full flow).
- **Mode wired through registration + management** -- `POST /v1/agents/device-authorize`, legacy `POST /v1/agents`, and the new `PATCH /v1/agents/:name/mode` route (owner-only) all accept and validate against the closed `VALID_MODES` set. `AgentRegistrationSchema` enforces the enum at the zod layer. `GET /v1/agents` returns `mode` for every listed agent.
- **Mode-aware Hello Integration** -- `createDefaultSteps(mode)` in `agent-onboarding-schemas.ts` filters the 13-step canonical list down to 5 for `task-runner` (`authenticate`, `identify_platform`, `install_skill`, `report_capabilities`, `publish_config`). Omitted steps are absent from the record -- not pending, not skipped, just not there. `agent-onboarding.ts` switched array-indexed step access to `.find()` so missing steps no longer crash test-task creation; the test task is only created when `accept_test_task` exists.

#### Owner-Managed Tags Surfaced in UI (Your Agents tab)
- **Tag chip strip on every expanded agent card** -- `agent-card.js` renders `agent.tags` as small rounded chips above the capabilities row. Replaces the previous text-only "Shared tags: [x]" line in zone2.
- **Mode badge on every agent card** (collapsed + expanded) -- four distinct colors (violet / blue / orange / green) corresponding to autonomous / interactive / task-runner / coordinator. CSS classes `.pf-agd-badge--mode-*` defined in `agents-detail.css`.
- **Tag filter bar** -- multi-select chip row at the top of the agent list. Selecting multiple tags applies an AND filter (agent must carry all selected tags). A "Clear" link appears when any filter is active.
- **Group-by selector** with three options: `none` (flat list, default), `tag` (one section per tag with an "Untagged" catch-all), `mode` (one section per mode in canonical order). Filtering applies before grouping, so e.g. tag=`crew:marketing-001` + groupBy=mode shows the mode breakdown of just that crew.

#### MCP Tools (owner-only)
- **`aimeat_agent_tags_set`** -- replaces an agent's tag list (max 20). Wraps `PATCH /v1/agents/:name/tags`.
- **`aimeat_agent_mode_set`** -- sets an agent's operational mode. Wraps `PATCH /v1/agents/:name/mode`.
- Both registered in a new `mcp/tools/agent-management.ts` module + mirrored in the `aimeat connect call` shell-fallback tool list.

#### Documentation
- **`docs/coding-guidelines/agent-tags.md`** -- new file documenting the mode union, the recommended tag conventions (`crew:`, `source:`, `role:`, `project:`), how to set both via UI/MCP/REST, and the UI grouping behaviour. Closes with explicit "Don't" rules (don't gate scopes by tag, don't reuse mode for grouping things tags should handle).
- **`docs/coding-guidelines/architecture.md`** -- Identity Model section now includes the four-mode table and points to `agent-tags.md`.
- **README.md** -- Connect AI agents section now mentions modes, the reduced task-runner Hello Integration, and tag conventions.

#### E2E Coverage
- **4 new `e2e-agent-onboarding.ts` tests** -- create a `mode: 'task-runner'` agent, verify mode persists across reads, verify exactly 5 steps appear (with the correct IDs and the right omissions), and verify the onboarding auto-completes when all 5 task-runner steps pass. 44/44 passing on both SQLite and MongoDB.

### Changed

- **`AgentRegistrationSchema`** -- now accepts an optional `mode` enum field; rejects values outside the strict union.
- **`createDefaultSteps()`** -- signature changed from `()` to `(mode?: AgentMode)`. Callers in `agents.ts` and `agent-onboarding.ts` updated to pass the agent's mode.
- **`renderZone2()` production/idle path** -- no longer renders an inline `Shared tags: [x]` text line; tags are now rendered above the zone via the dedicated `renderTagStrip()` so they don't fight with the delivery/stats row.

### i18n
- **EN + FI updated together** -- new `profile.agents.mode.{autonomous,interactive,task-runner,coordinator,tooltip}` and `profile.agents.filter.{byTag,groupBy,groupByNone,groupByTag,groupByMode,clear,untagged,noMatches}` keys added to both `locales/en.json` and `locales/fi.json`.

## [1.11.0] - 2026-05-29

Headline: submission-ready for the **Anthropic Connectors Directory**. Every
registered MCP tool now carries the `title` + read-only/destructive/idempotent/open-world
annotations the directory requires. Privacy policy and `/v1/connect` attach
page are operator-configurable so every self-hosted AIMEAT node can identify
itself as the GDPR controller without forking the HTML. Default `/v1/privacy`
behaviour is **fail-loud (HTTP 503)** when the operator has not filled in the
required identity fields -- no AIMEAT node should ever silently ship the
upstream author's information.

### Added

#### Connectors Directory Submission Package
- **94-tool MCP annotation registry** -- new `aimeat/src/mcp/annotations.ts` exports `TOOL_ANNOTATIONS` (single source of truth) and `annotationsFor(name)` (throws on missing entry so new tools cannot ship without classification). Every `mcp.tool(...)` call across the 21 public server files and 21 local connector files now passes `annotationsFor(name)` as the 5th SDK argument (verified in `@modelcontextprotocol/sdk@1.27.1`). 0 unannotated tools confirmed by extended `pnpm audit:mcp-tools`. The directory's #1 rejection cause (~30% per public review-criteria analysis) is closed.
- **`audit:mcp-tools` script extension** -- the existing surface-parity audit now also reports `registeredWithoutAnnotation` and `annotationWithoutRegistration` so future drift is visible in CI. Current report: 94 entries, 0 missing, 0 orphan, with `aimeat_admin_mint` correctly flagged as server-only operator endpoint.
- **Submission plan + classification table** -- `docs/plans/2026-05-29-connectors-directory-submission.md` documents all 27 form fields, the per-tool annotation decisions (readOnly / destructive / idempotent / openWorld with reasoning), 8 file-level pre-submission checks, and the nginx fix for `.well-known/*`.

#### Privacy Policy (operator-configurable, fail-loud)
- **`AIMEAT_OPERATOR_*` env-var family** -- 13 fields in `src/config.ts` (name, type, address, country, email, security email, hosting name/url/location, supervisory authority name/url, effective date, policy version). Loaded into `config.operator`. Helpers `missingOperatorConfig()` and `operatorTypeLabel(type, locale)`. Required fields documented in `.env.example` as a clearly labelled REQUIRED/OPTIONAL block.
- **`/v1/privacy` template substitution** -- `aimeat/public/privacy.html` (EN) and `privacy.fi.html` (FI) are templates with `{{placeholder}}` tokens. `serveStaticPage()` in `src/routes/portal.ts` substitutes them per-request using `config.operator` + the locale-resolved operator-type label ("a natural person" / "luonnollinen henkilö"). Each self-hosted node renders its own policy with no source-tree changes.
- **Fail-loud guard** -- if any required `AIMEAT_OPERATOR_*` is missing, `/v1/privacy` returns **HTTP 503** with an operator-facing fallback page that lists exactly which env vars to set + links to `.env.example`. Prevents silent shipping of half-configured policies and shifts the responsibility to the right person (the operator, not the upstream author).
- **14-section policy content** -- TL;DR with "you own your data" framing, genesis-network callout (protocol-level, applies to every node), controller info, data categories (direct / generated / automatic), legal bases table, recipients, single-row sub-processors table (Scaleway only on aimeat.io -- self-hosters fill their own), international transfers, retention table, cookies (no analytics, no trackers, no advertising, no fingerprinting), GDPR rights with Data Wallet links, security, children (EU GDPR 16 default), self-hosting, changes, contact. Neutral third-person voice ("the operator") throughout so the template works for any operator.
- **BYOK clarification in section 4** -- "AIMEAT does not automatically send your data to third-party AI inference providers" but the *generator* feature is explicitly bring-your-own-key: if the user provides their own OpenRouter / OpenAI key, the server calls that provider under THE USER's contract with that provider. If no key, no outbound calls.

#### `/v1/terms` Terms of Service (EN + FI)
- **20-section ToS template** at `aimeat/public/terms.html` + `terms.fi.html`, served at `/v1/terms` and `/v1/terms/fi`. Uses the same `{{placeholder}}` substitution as the privacy policy; every `AIMEAT_OPERATOR_*` field that names the operator as a party to the agreement (legal name, type, postal address, country, email, effective date) is filled in per-node at render time. The same `missingOperatorConfig()` guard 503s the page if any required field is missing, with an operator-facing fallback. Covers: parties, the Service, eligibility/account, acceptable use, your content + necessary licences, connected AI agents, BYOK responsibility, sandboxed-extension responsibility, morsels (not money / not crypto), federation (peer operator's terms apply), service availability (no SLA), warranty disclaimer, limitation of liability, indemnification (user indemnifies operator for misuse / their content / their keys / their agents), termination, changes, open-source clarification (MIT licence governs software; ToS governs the operator's deployment), governing law (operator's country), miscellaneous (entire agreement, severability, no waiver, assignment, notices), contact.
- **Privacy policy footer cross-links to the ToS** in both languages for discovery.
- **`/terms.html` and `/terms.fi.html` 301-redirect** to canonical `/v1/` routes -- added to `STATIC_HTML_REDIRECTS` in `server-bootstrap/static-files.ts`, same pattern as `/privacy.html` and `/connect.html`. Direct access to the raw template files is never served.
- **Submission impact**: closes the last remaining Documentation Requirements checkbox on the Anthropic Connectors Directory submission form ("Terms of service are published and accessible").

#### `/v1/connect` MCP Attach Page (EN + FI)
- **6 client cards with attach instructions** -- Cursor (1-click `cursor://anysphere.cursor-deeplink/mcp/install?...` URL with server-rendered base64 config), Claude Code CLI (`claude mcp add aimeat --transport http <mcpUrl>`), VS Code Copilot (`code --add-mcp '{...}'`), Claude Desktop (4-step Settings → Connectors), claude.ai web (4-step + plan-tier note), ChatGPT generic custom-connector flow.
- **4 worked example prompts** -- each exercises real AIMEAT tools end-to-end: memory write, memory list+read in a fresh chat (cross-AI persistence), people directory search, organism + boards browsing.
- **"What you get" + collapsible tech details** -- 94-tool count, persistent GAII identity, GDPR-tooling-as-core-protocol-feature, federation. Collapsible sections for protocol/transport spec, reference manifest pointing at `annotations.ts` and the submission plan, self-host CLI walkthrough, data-handling summary cross-linking the privacy page.
- **Template substitution** -- `templateVars()` in `portal.ts` was generalised to cover both privacy and connect pages: emits `nodeName`, `nodeUrl`, `nodeId`, `mcpUrl = baseUrl + '/v1/mcp'`, `cursorDeeplinkConfig = base64({url:mcpUrl})`. Self-hosters get their own URLs everywhere on the connect page; aimeat.io's existing setup behaviour is unchanged.

#### Init Wizard Operator Prompts (`aimeat init`)
- **`askOperatorSettings()` function** -- 13 prompts gather the same fields documented in `.env.example`. Skipped entirely for `dev` use case (privacy 503 is fine in dev); ask-with-confirm for `personal`; required for `public`/`custom`. Reasonable placeholders shown (Scaleway, France, tietosuoja.fi) so new self-hosters see plausible examples; required fields refuse to advance with empty input.
- **27 new `init.operator*` translation keys** -- localised prompts, validation errors, and the intro note explaining why the wizard is collecting these fields. Both `locales/en.json` and `locales/fi.json` updated.
- **`CONFIG_DEFAULTS` extended** -- so the wizard's change summary correctly flags operator fields as "Changed from default" when the operator fills them in.

#### Public Research Reports
- **MCP rich rendering report** (`docs/research/2026-05-29-mcp-rich-rendering-and-one-click-setup-REPORT.md`) -- ~2200 words on the MCP 2025-11-25 spec's five content types (text / image / audio / resource_link / embedded resource) + `structuredContent` field, MCP Apps extension 2026-01-26 client matrix (8 supporting clients), per-client rendering capability matrix (Claude Desktop / Cursor / Claude Code / Cline / Continue / Zed), copy-paste config snippets, and AIMEAT-specific recommendations for adopting `structuredContent` + first-class MCP Resources.
- **Agent visibility reframe report** (`docs/research/2026-05-29-agent-visibility-reframe-REPORT.md`) -- ~3000 words taking a defensible contrarian position on the Manus-style "computer window" pattern. Recommendation: build a **structured execution view** (Camunda-Cockpit-shaped: BPMN diagram + activity tree + tabbed detail) as AIMEAT's front door, NOT live screen replay. Evidence: 8 mature categories (Temporal, Airflow, Camunda, Rundeck, AWX, GitHub Actions, Jenkins, GitLab CI) independently converged on graph-and-state views, never video.

### Changed

#### Privacy / Connect Plumbing
- **`servePrivacyPage` -> `serveStaticPage`** -- the helper in `portal.ts` was renamed and generalised. It now handles both privacy and connect pages, detects the locale from the filename (`.fi.html` -> Finnish operator-type label), runs the fail-loud guard only for privacy pages, and substitutes `{{var}}` tokens for any templatable page.
- **Genesis-network framing moved out of operator-specific voice** -- the privacy policy's section 12 was rewritten from first-person aimeat.io-specific ("I run this to promote AIMEAT...") into third-person protocol-level prose ("AIMEAT is an open, federated network... the aimeat.io node is the public 'genesis' reference deployment..."). Works for every operator; aimeat.io's marketing message stays accurate.

#### CORS Architecture Clarification
- **`AIMEAT_CORS_ALLOWED_ORIGINS=*` documented as intentional** -- `.env.example` now explains the architectural reason: AIMEAT is Bearer-token-only with no cookies, so CORS is not the protection layer; apps published via `aimeat_app_publish` can attach from arbitrary browser origins. Prevents future contributors from "tightening" the default and breaking the platform model.

### Fixed

#### Production OAuth Discovery
- **nginx `/.well-known/*` blocked by dotfile-deny rule** -- production nginx config was rejecting `/.well-known/oauth-authorization-server` and `/.well-known/oauth-protected-resource` with 403 because the standard `location ~ /\. { deny all; }` rule matched. The Express MCP handlers were returning correct JSON on `localhost:40050` but reviewers and clients could not auto-discover OAuth on prod. Fixed on the operator side (nginx config) with an explicit `location ^~ /.well-known/` allow block. End-to-end OAuth chain (`401` -> `WWW-Authenticate: Bearer resource_metadata="..."` -> `/.well-known/oauth-protected-resource` -> `/.well-known/oauth-authorization-server` -> authorize/token endpoints) now traversable by any conforming MCP client.

#### Templated Pages Served Raw via Static Middleware
- **`/privacy.html` and `/connect.html` showed unresolved `{{placeholder}}` tokens** -- the templated HTML files live in `public/`, which Express's `express.static` serves directly. Direct access to `https://aimeat.io/privacy.html` returned the raw template (`{{nodeName}}`, `{{operatorName}}`, etc.) instead of the substituted content available at `/v1/privacy`. Catastrophic if a search engine or reviewer landed on the legacy URL. Fixed by extending the redirect middleware in `server-bootstrap/static-files.ts` with a `STATIC_HTML_REDIRECTS` map: `/privacy.html`, `/privacy.fi.html`, `/connect.html`, `/connect.fi.html` now 301-redirect to their `/v1/` canonical routes. Pattern is now generalised so future templated pages can be added in one line.

#### Silent Base64 Corruption on Inline Uploads
- **`POST /v1/apps`, `POST /v1/memory/files`, `POST /v1/storage` (inline mode) accepted raw bytes as "base64" and stored a tiny garbage payload** -- Node's `Buffer.from(str, 'base64')` is permissive and silently drops characters outside the base64 alphabet. A caller that POSTed raw HTML (or JSON, or binary) as `content` therefore got a successful publish with whichever few characters of their input happened to be base64-legal -- typically 10-20 bytes of garbage out of a multi-KB upload. The server returned 2xx, the storage layer happily persisted it, and downloaders later hit gibberish at the canonical URL with no diagnostic anywhere. Discovered while seeding the directory-submission reviewer account on aimeat.io: a 1.2 KB HTML app published via `POST /v1/apps` with raw HTML in `content` saved as 14 bytes and served as binary noise. Fixed by introducing a strict `decodeStrictBase64()` helper at `aimeat/src/utils/base64.ts` (rejects empty input; rejects any character outside `[A-Za-z0-9+/_-]` with optional 0-2 `=` padding) and applying it at every inline-upload site: `apps.ts` (`content` + `screenshot`), `memory.ts` (`/v1/memory/files`), `storage-files.ts` (`/v1/storage` inline mode). Three regression tests added in `test/e2e-upload.ts` Phase 3.5 pin the boundary: raw HTML and malformed input now return 400 INVALID_INPUT with a remediation hint pointing to `Buffer.from(html).toString("base64")` and the presigned-upload alternative; valid base64 round-trips to the exact original byte length. Existing presigned-upload mode is unaffected (it uses raw PUT, not base64). e2e-upload: 16/16 passing on SQLite.

### Documentation
- **Connectors Directory submission plan** -- single source of truth for every form field, all 94 tools' annotation classifications with hint reasoning, pre-submission technical pre-flight verified against live aimeat.io, nginx fix snippet, reviewer-test-account seeding instructions deferred to Section E.
- **Plan doc Section F audit** -- documented that CORS=* is intentional (Bearer-token model), MCP spec 2025-11-25 supported, rate limiting + HSTS + CSP + nonce all verified live on prod, `AIMEAT_BASE_URL` correctly set in prod.
- **CLAUDE.md still valid** -- no rules changed; this release reinforces Rule 2 (file headers updated on every touched file) and Rule 1 (37/37 MCP e2e passing on SQLite after the bulk migration).

## [1.10.0] - 2026-05-28

Headline: a single `aimeat connect` CLI that any AI runtime can use to attach
to a node in seconds, plus onboarding that no longer lets agents lie about
being "done" -- they must publish commands and config before the system agrees
they are finished.

### Added

#### AIMEAT Connect CLI + MCP Server
- **`aimeat connect` subcommand in the main CLI** -- previously a separate `@aimeat/connect` package, now merged into the canonical `aimeat` binary so a global `aimeat` install gives every AI runtime the same toolset (`6bb7b06`, `46fecd5`, `322163e`).
- **RFC 8628 device-authorization flow** -- non-interactive `aimeat connect --url <node> --owner <name> [--agent <name>]` requests a device code, polls for owner approval, stores the issued token, downloads the runtime-specific skill bundle, and prints a paste-ready Hello Integration instruction.
- **`aimeat connect serve` MCP server** -- stdio-attached MCP server registering ~41 AIMEAT tools (handbook, onboarding, capabilities, tasks, telemetry, messages, memory, work queue, wallet, boards, knowledge, storage, admin) with background poller that wakes the agent via shell command or webhook when new tasks/messages arrive.
- **Shell fallback for non-MCP runtimes** -- `aimeat connect tools` lists every tool, `aimeat connect schema <tool>` returns its input schema, `aimeat connect call <tool> --json '<input>'` invokes it. For CLI-only or shell-driven agents where MCP stdio cannot attach, every Hello Integration step is reachable via one-shot commands.
- **Token keychain** -- file-based credential store at `~/.aimeat/tokens/{agent}@{owner}.token` with `mode 0600`; config at `~/.aimeat/config.yaml`; skill bundle extracted to `~/.aimeat/{agent}/` with proper Zip-Slip defenses (100 file cap, 20 MB total cap, 5 MB per-file cap, path-traversal rejection).
- **Runtime-specific skill bundles** -- generic adapter (default) and Hermes adapter ship a `SKILL.md` + `BUNDLE.md` + `references/` tree appropriate for each platform. Post-connect output documents both the MCP stdio path (Option A) and the shell fallback path (Option B), so agents that cannot do stdio still know how to onboard.
- **`aimeat connect status`, `inbox`, `tasks`, `send`, `docs`, `refresh`** -- one-shot operational subcommands for diagnosing the connection, polling inbox, listing tasks, sending messages, fetching docs, and refreshing the skill bundle.

#### Hello Integration Tightening (post-onboarding gating)
- **`publish_commands` onboarding step (required)** -- onboarding stays `in_progress` until the agent writes a non-empty `agents.{name}.commands` memory entry shaped as `[{ name, description, category }, ...]`. The validator rejects empty arrays and missing-field entries, so agents cannot stub out the SKILL.md "After Onboarding" instruction.
- **`publish_config` onboarding step (required)** -- same gating for runtime/config descriptors: at least one `agents.config.{name}.*` memory entry must exist (e.g. `agents.config.{name}.connector`). Agents that only run `aimeat connect serve` describe that accurately; no invented watchdog files.
- **`post_onboarding_checklist` in `GET /onboarding`** -- response now includes `{ commands_registered, config_published, shared_tags_in_use, knowledge_packages_published }`. `shared_tags_in_use` is `null` when the owner has not assigned shared tag areas (not applicable); the other three are booleans. Stays visible after `status` flips to `completed` so the signal does not disappear once Hello Integration finishes.
- **Auto-validation on POST step** -- POSTing the last manual step now also re-runs `checkAutoSteps()` against all auto-validatable steps before evaluating `allRequiredPassed`. Previously the agent had to do an extra `GET /onboarding` to trigger memory-backed step validation; POST and GET now behave symmetrically.
- **Post-Onboarding Setup panel in Integration tab** -- new UI section between Readiness and Identity showing the four checklist items as labeled rows with status dots, so the owner can see at a glance that commands are registered and config is published.

#### `/v1/agents/me/*` Universal Alias
- **Path rewriter middleware** -- `agentMeAliasMiddleware` resolves `/v1/agents/me/...` to `/v1/agents/{agentName}/...` based on the authenticated agent's JWT (handbook routes are excluded because they intentionally serve the literal `me`). The tier-1 handbook tells agents "all agent URLs use /v1/agents/me/ which resolves to your name", and that promise is now true for every route, not only handbook.

#### Agent Languages Capability
- **`languages: string[]` as a first-class agent field** -- BCP-47 short codes stored separately from `domainCapabilities` instead of being concatenated as `"Language: xx"` strings. Persisted in SQLite (`languages` column) and MongoDB (`languages Json?` column on `agent`). PUT/GET capabilities responses return `languages` as its own array. UI renders language chips from this field, with backward compatibility for older agents whose languages still live inside `domainCapabilities`.

#### Tier-1 Module Expansion
- **Three new tier-1 modules** -- `appdev`, `collaboration`, `mcp` added to the loadable module catalogue. Agents can now fetch operational knowledge for app development, multi-agent coordination, and MCP attachment incrementally instead of via the monolithic tier-1 prompt.
- **`appdev` module best practices** -- iterated from real agent feedback during early-access pilots; starter template embedded directly in the module instead of fetched separately.

#### Public Knowledge Viewer
- **Browser-side public knowledge browser** -- new view for browsing, searching, and rendering knowledge entries with no auth required, so visitors can read public packages before signing up.

### Fixed

#### Hello Integration Friction Points
- **Telemetry counted in Activity stats** -- POST `/v1/agents/:name/telemetry` now calls `recordTelemetryEvent()` which bumps the daily `telemetry_events` counter and (for `llm_call` events with `tokens_in`/`tokens_out`/`tokens_used` data) accumulates into `tokensUsed30d` and `aiCalls30d`. Activity tab no longer shows zeros when telemetry is actively being reported.
- **Telemetry UI field name** -- profile activity tab read `telResp.data.entries` but the route returns `telResp.data.events`; the `entries` lookup always came up empty so "Telemetry events today" was permanently `0`. Fixed to read `events` (with `entries` fallback for older deployments).
- **Telemetry token extraction** -- UI now reads tokens from `event.data.tokens_used` (or `tokens_in + tokens_out`) instead of `event.tokens_used`, matching the actual telemetry storage shape.
- **Capabilities `type` enum exposed in MCP schema** -- `aimeat_agent_capabilities_report` MCP tool now declares `technical[].type` as `z.enum(['mcp', 'skill', 'tool'])` instead of `z.string()`. Agents that previously had to guess and retry on `INVALID_INPUT` now see the constraint in the schema.
- **Languages no longer mutated into domain capabilities** -- PUT capabilities used to concatenate `["en", "fi"]` as `"Language: en"`, `"Language: fi"` strings into `domainCapabilities`. The languages array is now preserved verbatim in a dedicated field, returned as `languages` by GET, and rendered as a separate language chip group by the UI.
- **Handbook response deduplication** -- `GET /v1/agents/me/handbook` no longer returns both `content` and `system_prompt` with identical text. Only `system_prompt` is returned now; agents and clients that read `content` should switch to `system_prompt`.
- **Optional steps marked `skipped` on auto-complete** -- when onboarding auto-completes via "all required passed", untouched optional steps (like `declare_services`) now transition from `pending` to `skipped`, so a completed onboarding does not visually still show pending work.
- **`/v1/agents/me/tasks/*` actually works** -- previously only `/v1/agents/me/handbook` resolved the `me` alias; task PATCH/POST routes 404'd. The new path rewriter middleware makes the alias universal (handbook excluded as a literal).
- **Onboarding hint uses real agent name** -- `agentOnboarding.routeHint` now says `PATCH /v1/agents/{actualName}/tasks/{id}` instead of the broken `/me/` reference. (Both work post-rewriter, but the hint is now accurate for owner sessions too.)

#### Connector / CLI Robustness
- **Poller tracks task and message IDs, not counts** -- background poller in `aimeat connect serve` now diffs ID sets between polls; an interleaved task complete + new task arrival in the same window no longer goes silent (was missed by the old `tasks.length > lastTaskCount` heuristic).
- **Poller uses recursive `setTimeout` instead of `setInterval`** -- prevents overlapping polls if a single round trip slows.
- **Poller stops on stale token** -- `UNAUTHORIZED`, `INVALID_TOKEN`, `TOKEN_EXPIRED`, `FORBIDDEN` envelope codes now stop the poller with a clear `Run: aimeat connect` instruction instead of spinning silently.
- **Wake command security warning** -- `wake.command` in `config.yaml` is executed via `child_process.exec`. The CLI's connector now documents this loudly in both the type definition and the runtime adapter so users do not paste untrusted configs.

#### Storage & Data
- **MongoDB `toAgentRecord()` deserializes `languages`** -- field was being written by Prisma but stripped from the read path, so PUT capabilities looked like a no-op for languages on MongoDB until the deserializer was fixed.
- **SQLite cascade delete table name** -- corrected `webhook_delivery_logs` (was `webhookDeliveryLog`); orphaned rows on agent deletion are gone.
- **Storage chunked base64 conversion** -- 64 KB file uploads via `lib-storage.ts` no longer overflow the JavaScript stack; conversion now chunks the binary instead of `String.fromCharCode(...spread)`-ing the whole buffer.
- **Body parsing limit for `/v1/storage`** -- middleware extended to accept larger payloads for direct file uploads via the storage endpoint.

#### UI
- **Delivery method label honest about polling** -- Integration tab's "Delivery method" row used to show "● Webhook" with a green dot whenever a webhook record existed, even if `webhook.url` was empty. It now checks the URL and shows "● Polling" (gray dot) when no URL is configured. The Edit/Test webhook buttons remain so the owner can still add a URL.
- **Today's Governance counts task lifecycle events** -- Activity tab's tasks-today filter used to require the event `type` to contain the substring `"task"` or `"todo"`, but task lifecycle events emit types like `"completed"` and `"progress"` that have neither. The categorizer now keys off `event.taskId` instead, so completed tasks count.
- **Agent card language chips render from `languages` field** -- previously the `Language: xx` chips came from the polluted `domainCapabilities` array; now they read from the dedicated `languages` array with a fallback for legacy entries.

#### Data Access / Generator
- **`data.get()` public fallback** -- the lib's `data.get(key)` now falls back to a public read from the app's creator when the caller has no private entry, with the bare-username case appending `nodeId` correctly and the empty-`{}` value also triggering fallback (was failing silently).
- **`GET /v1/memory/:key` no longer auto-creates** -- previously a 404 on read would side-effect a new empty entry; the auto-create was removed so missing keys stay missing.
- **App-builder starter template embedded in `appdev` module** -- no more external fetch at module load.

### Changed

#### Testing Policy (CLAUDE.md Rule 1 and 1b rewrite)
- **In-memory backend deprecated** -- `pnpm test:e2e` and `pnpm test:e2e:memory` are no longer the recommended verification path. SQLite (with `AIMEAT_DB_PATH=:memory:` for true in-RAM speed) covers the fast-iteration role using the real production code path. The `.env.test.memory` env file may not even exist in the repo.
- **Scoped suites by default** -- documented in CLAUDE.md and `docs/coding-guidelines/testing-requirements.md`: run only the suites the change can plausibly affect via `pnpm exec node --env-file=.env.test.sqlite --import tsx test/run-e2e-ci.ts --test=<suite>`. Full sweep on both persistent backends only at the end of a multi-step plan or before a PR.
- **Pre-existing failure protocol** -- when an unrelated suite fails, verify it pre-exists on `main` (e.g. `git stash`) and report as pre-existing; do not fix as part of the current work.

#### Skill Bundle Documentation
- **Onboarding instruction extracted to a shared module** -- the long Hello Integration paste-into-agent text used to be duplicated across `cli/connect/auth.ts` and `cli/connect/skill-bundle.ts`. Now lives in `cli/connect/onboarding-prompt.ts` as a single source of truth that both consumers import.
- **Post-connect output documents both MCP and shell paths** -- the terminal output after a successful `aimeat connect` now explains Option A (MCP stdio, for runtimes that can attach) and Option B (shell fallback via `aimeat connect call`, for runtimes that cannot). Eliminates the "agent stares at `aimeat connect serve` blocking forever" failure mode.
- **BUNDLE.md compatibility guide uses the canonical tool sequence** -- the fallback BUNDLE.md generator now pulls the Hello Integration MCP tool list from `HELLO_INTEGRATION_TOOL_SEQUENCE`, so drift between the generated bundle and the auth-time instruction is impossible.

#### Agent Sessions
- **Auth lib `session.identity`** -- unified field returns GAII for agents and GHII for owners, so libs do not need to handle `session.gaii` vs `session.ghii` separately.
- **Cortex `myGaii()` falls through identity sources** -- returns `s.gaii ?? s.ghii ?? s.identity ?? null` so owner sessions get a usable identifier.

### Documentation
- **Audit report on Connect work** -- internal audit of the GPT-5.5-built Connect system documented findings F1-F7 and the A+C onboarding-gating proposal; all findings closed in this release.
- **Three end-to-end simulation runs** -- assistant, scout, and ranger agent simulations verified Hello Integration end-to-end through the CLI shell fallback; final ranger run validated the publish-gating works (onboarding stayed `in_progress` until the agent wrote `agents.{name}.commands` and `agents.config.{name}.*` memory entries).
- **CLAUDE.md updates** -- Rule 1 and Rule 1b rewritten for SQLite-default + scoped-suites testing policy; testing-requirements.md updated to match.

## [1.9.0] - 2026-05-25

### Added

#### Agent Integration Architecture (Plans 1-5)
- **Push Layer (Plan 1)** -- webhook infrastructure with HMAC-SHA256 signing, 3x retry with backoff, auto-disable after 10 failures, SSRF validation, delivery log (last 50 per agent), telemetry endpoints (POST/GET), cursor-based inbox polling with composite timestamp@id cursors, 7 webhook event schemas with Zod validation.
- **Skill Bundle Generator (Plan 2)** -- runtime-specific skill bundles (Hermes + Generic adapters), SHA-256 versioned ZIP downloads, 6 reference documents (api-overview, task-lifecycle, message-protocol, telemetry-protocol, capability-report, error-protocol), auto-selects adapter based on agent platform.
- **Hello Integration (Plan 3)** -- 11-step onboarding flow with platform detection, readiness scoring (baseline + operational health), auto-check on GET, auto-start test task, device auth auto-creates onboarding + test task.
- **Agent Detail Tab-View (Plan 4)** -- 8-tab UI (Integration, Tasks, Messages, Data Access, Directives, Agent Config, Activity, Services), state detector (5 states), two-zone card header, shared agent board, step pills with i18n, expandable memory key preview.
- **Governance + Admin (Plan 5)** -- budget limits on directives, owner-only task pause, readiness gate middleware, stall detection (unreachable + webhook_down), 5 admin fleet endpoints, admin Agent Integration dashboard tab.

#### Agent Onboarding UX
- **Device auth next_steps** -- device-token response includes step-by-step instructions for skill bundle download, system prompt, and Hello Integration with exact URLs.
- **Device auth user_instructions** -- tells the agent where the owner approves (AIMEAT profile Agents tab) so the agent can relay this to the user.
- **Copy prompt for agent** -- button in Integration tab copies a ready-made prompt with auth, skill bundle download, and onboarding instructions.
- **Polling instructions in prompt** -- exact curl command + python3 parse example for device-token polling, with "poll IMMEDIATELY" instruction.
- **Test task auto-start** -- onboarding validator auto-starts the test task when agent proposes todos, removing the need for owner to click Start.
- **Test task auto-creation** -- device auth approval creates the test task automatically so agents can complete steps 9-10 without owner intervention.
- **access_token alias** -- device-token response includes both `token` and `access_token` (RFC 8628 standard) for compatibility.

#### Agent Dashboard Features
- **Capabilities badges** -- technical (green) and domain (blue) capability badges displayed on agent card below the name.
- **Agent Commands palette** -- Messages tab shows agent-registered commands with `/` autocomplete.
- **Stored Memory Keys** -- Data Access tab shows agent's actual memory keys with click-to-expand JSON preview.
- **Agent Config tab** -- shows config files pushed by the agent (watchdog, skill_bundle metadata).
- **Activity onboarding events** -- Activity tab includes Hello Integration step-pass events alongside task events.
- **TODAY'S GOVERNANCE section** -- token budget, tasks today, policy issues, delivery health always visible in Activity tab.
- **10s polling fallback** -- agents-tab and messages-tab poll every 10 seconds as SSE fallback.

#### Agent Prompt Improvements
- **Positive framing** -- 60 negations in prompt-defaults.ts rewritten to positive language (e.g., "wait for approval" instead of "DO NOT start working").
- **Boot sequence reordered** -- directives, CORE modules (tasks, messages), Hello Integration, EXTEND modules, watchdog. Agents learn task operations before onboarding.
- **Each onboarding step documented** -- tier1 prompt lists what triggers validation for every step (PUT capabilities, POST message, POST telemetry, etc.).
- **Watchdog uses skill bundle script** -- tier1 prompt says "install scripts/poll-inbox.sh from your skill bundle" instead of 40 lines of "build your own".
- **Commands/config in SKILL.md** -- "After Onboarding" section with exact POST /v1/memory examples moved from references/ to SKILL.md where agents actually read it.
- **Agent API Quick Reference in llms.txt** -- copypaste-ready examples for capabilities PUT, todos PATCH, telemetry POST, onboarding step POST, memory write.

### Fixed

#### Critical Data Safety
- **Dev-mode no longer destroys agent data** -- re-registration in dev mode now resets password only, preserving all agents, memory, and data. New `AIMEAT_TEST_MODE` flag for E2E test isolation (full wipe behavior).
- **Agent cascade delete** -- deleting an agent now cleans up messages, telemetry, webhook logs, onboarding records, sharing groups (were missing from cascade).

#### Prisma/Storage
- **TelemetryEvent 500 fix** -- Prisma schema used `@db.ObjectId` but code generated UUIDs. Removed ObjectId constraint.
- **WebhookDeliveryLog 500 fix** -- same ObjectId issue.
- **Webhook DELETE fix** -- used `undefined` instead of `null` for Prisma nullable fields, so webhook URL was never actually cleared.
- **Step 10 testTaskId lost** -- validateAcceptTestTask overwrote step details without preserving testTaskId, causing validateCompleteTestTask to always fail "No test task created".
- **read_directives auto-validation** -- added to auto-check list (always passes but was missing, requiring manual POST).
- **Memory route owner access** -- removed `requireRole('agent')` from GET /v1/memory and search routes so owner sessions can view agent memory with `?agent=GAII`.
- **Memory `?agent=` parameter** -- when agent GAII is specified, bypasses ownerScope aggregation and queries only that agent's keys.

#### UI Fixes
- **Zone 2 "NEXT: undefined"** -- used `nextStep.name` but steps have `title`. Fixed to `nextStep.title || nextStep.id`.
- **Onboarding step names translated** -- UI now uses `t('agentOnboarding.steps.' + step.id)` instead of raw step IDs.
- **Data Access empty state** -- shows all 3 action buttons (tag, area, package) and corrected text from "above" to "below".
- **TabMessages missing agent prop** -- commands always showed (0) because `agent.gaii` was undefined.
- **Approve/Deny removes request immediately** -- no more 5-second wait for polling to clear it.
- **Deny button styled** -- changed from invisible `btn-danger` (text only) to visible `btn-danger-solid`.
- **Messages textarea full width** -- input field stretches to fill available space.
- **SSE ticket retry** -- SSE connection now retries with backoff when ticket request fails instead of silently giving up.

#### Webhook/Schema
- **onboarding.step webhook payload** -- field names now match Zod schema (step_order, step_title, action, onboarding_progress, onboarding_total).
- **directive.updated Zod enum** -- added `budget_limits` to changed_sections enum.
- **MCP notification for task.updated** -- added missing `emitResourceUpdated()` in PATCH task handler.

#### Security
- **SSRF blocklist** -- added RFC 5737 TEST-NET ranges (192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24).

### Changed
- **Hermes skill bundle** -- SKILL.md "On First Run" includes exact cron install commands for poll-inbox.sh and telemetry hook.
- **Skill bundle adapter selection** -- auto-selects Hermes adapter based on agent's platform field instead of requiring `?runtime=hermes` query parameter.
- **i18n** -- service visibility values translated (Public/Private/Internal), admin platform form placeholders translated, onboarding step names translated in both en.json and fi.json.
- **E2E webhook test** -- unreachable URL changed from RFC 5737 blocked IP to httpbin.org:12345.

### Documentation
- **Hello Integration demo video** -- added to README with YouTube thumbnail link.
- **AIMEAT_TEST_MODE** -- documented in .env.example, config-schema.ts, env-config.ts.

## [1.8.0] - 2026-05-22

### Added

#### Tier 1 Multi-Module Prompt System
- **Bootloader rewrite** -- tier-1 prompt rewritten as a lightweight bootloader that loads capability-specific modules on demand instead of one monolithic prompt. Reduces initial payload and lets agents load only what they need.
- **7 module prompt seeds** -- `memory`, `tasks`, `messaging`, `knowledge`, `wallet`, `work-exchange`, `extensions` as separate loadable modules stored in the prompt system.
- **Modular route** -- `GET /v1/prompts/tier1/:module` serves individual modules so agents can fetch capabilities incrementally.
- **Bootloader watchdog** -- enforces propose-first workflow where agents must propose actions before executing them.
- **E2E test suite** -- dedicated test suite for the tier1 module system.

#### Federation Enhancements
- **Schema-based auth policy** -- federation tab and peer routes updated to support structured auth policy configuration with federated auth scopes.
- **Peer re-introduction** -- depeered or offline nodes can be re-introduced without re-creating the peering from scratch.
- **Key exchange improvements** -- peer public key included in exchange process, streamlined join functions.
- **Federated memory UI** -- enhanced browsing and interaction for federated memory across peers.
- **Peering request management** -- confirmation and deletion flows for peering requests.

#### Memory Discovery
- **Discover and copy public memory** -- new endpoints for discovering public memory entries across identities and copying them to the caller's own namespace.

#### Agent Capabilities Schema
- **`modulesLoaded` field** -- tracks which tier1 modules an agent has loaded, visible in capabilities reporting and admin views.
- **`agentLimitations` field** -- agents can self-report operational limitations (context window, rate limits, etc.).

#### Generator Autopilot Improvements
- **Contract verification** -- autopilot now runs `verifyContract()` after code validation, checking generated output against blueprint actions, exported methods, and cortex references. Attempts one fix round on mismatch.
- **Blocking spec validation** -- spec validation failures now trigger a retry with error context instead of silently proceeding with a broken spec. Blueprint action coverage is enforced as part of validation.
- **Smoke test after registration** -- quick accessibility check (extension activates, cortex lib loads, app HTML serves) runs immediately after registration to catch deployment failures early.
- **App spec validator** -- new `validateAppSpec()` function validates app-type specs (name, title, appDomainLib, cortexDependencies) instead of falling through to the wrong validator.

### Fixed
- **Message timestamps and ordering** -- messages now show timestamps and sort oldest-first (chat-style chronological order).
- **Task telemetry accumulation** -- telemetry counters now accumulate across task events instead of being overwritten on each event.
- **Propose-first task workflow** -- agents must propose tasks before the owner approves them; todo UI rendering corrected for this flow.
- **Agent PATCH on queued tasks** -- agents can now update todos on tasks that are still in queued status.
- **Tier1 module field corrections** -- 39 field name and schema errors corrected across all 7 module prompts (3 audit passes).
- **Spec UI prompt refresh** -- saving a spec now immediately rebuilds the code generation prompt so it includes the spec. Previously required clicking "Copy Prompt" twice.

### Changed
- **Sharing group member resolution** -- member identifiers in sharing groups now resolve correctly against GHII/GAII identity formats.
- **Sharing group default permissions** -- groups support editing default read/write permissions for new members.
- **Agent instructions** -- updated operational clarity in agent prompts, added llms.txt reference to bootloader.
- **Wallet UI** -- ownership clarification text added to wallet display.
- **Memory browsing errors** -- user-facing error messages added for memory browsing failures.

### i18n
- New translation keys in both `en.json` and `fi.json` for federation peering, memory browsing errors, wallet ownership, and agent limitations.

## [1.7.0] - 2026-05-22

### Added -- Agent Dashboard (3 phases, 7 features, ~15,000 lines across 113 files)

Complete per-agent management dashboard with task queues, directives, sharing groups, capabilities, activity monitoring, offered services, and messaging -- all accessible from the profile Agents tab.

#### Agent Tasks (Phase 1)
- **Task queue per agent** -- create, assign, start, complete, fail tasks with full lifecycle management. Each task tracks status (`queued`/`active`/`completed`/`failed`), priority, deadline, and event log.
- **Task creation builder** -- frontend form with title, description, priority, and deadline fields.
- **Task stall detection** -- background job flags active tasks with no events past a configurable threshold (`AIMEAT_TASK_STALL_THRESHOLD_MINUTES`).
- **Work-to-task bridge** -- automatically creates an `AgentTask` when an agent accepts a work exchange item, linking the two systems.
- **Task event logging** -- every lifecycle transition (start, complete, fail, stall) is recorded as a timestamped event with optional metadata.
- **7 MCP tools** -- `agent_task_create`, `agent_task_list`, `agent_task_get`, `agent_task_start`, `agent_task_complete`, `agent_task_fail`, `agent_task_event`.
- **Admin agent tasks tab** -- operator view of all tasks across all agents with status badges.

#### Agent Directives (Phase 1)
- **Three-layer directive inheritance** -- System (operator-set via admin dashboard), Owner (user-set via access tab), and Agent (per-agent in detail view). Merged view shows effective directives with source labels.
- **System configuration fields** -- `agentSystemPrinciples`, `agentMaxTokensPerTask`, `agentMandatoryLogging`, `agentAimeatFirstEnabled` configurable via admin dashboard and `.env`.
- **Tier1 prompt extended** -- downloaded agent instructions now include directives and task handling sections.

#### Sharing Groups (Phase 1)
- **Group-based memory visibility** -- new `group` visibility level extends `private|owner|public`. Memory entries with `visibility: 'group'` are readable only by group members.
- **Group CRUD** -- create, update, delete groups with per-member GAII/GHII read/write permissions.
- **Consent integration** -- `checkConsentForRead()` extended with group visibility branch.
- **Memory tab group picker** -- visibility cycle extended to 4 states; popup for selecting target group.
- **Access tab sections** -- sharing groups management and agent directive defaults in the access tab.
- **Admin sharing groups tab** -- operator view of all groups across all owners.
- **5 MCP tools** -- `sharing_group_create`, `sharing_group_list`, `sharing_group_get`, `sharing_group_update`, `sharing_group_delete`.

#### Agent Capabilities (Phase 2)
- **Technical + domain capabilities** -- agents report their technical capabilities (languages, frameworks, APIs) and domain skills via `PUT /v1/agents/:name/capabilities`.
- **MCP-type verification** -- capabilities reported by agent sessions are verified against actual MCP tool availability.
- **Capabilities sub-tab** -- displays technical skills, domain skills, and action queue in the agent detail view.
- **2 MCP tools** -- `capabilities_report`, `agent_activity`.

#### Activity Monitoring (Phase 2)
- **Embedded activity counters** -- `tasksCompleted`, `tasksFailed`, `messagesProcessed`, `lastActiveAt` on AgentRecord, updated on every task lifecycle event.
- **Time-series activity table** -- `agent_activity` stores metric/value/timestamp rows for historical charts.
- **Activity recorder service** -- records task events to the time-series table automatically.
- **Activity sub-tab** -- stats cards, CSS bar chart (no external charting library), scheduled jobs list, and scrollable event log.
- **REST endpoints** -- `GET /v1/agents/:name/activity/stats`, `/activity/history`, `/activity/log`.

#### Offered Services (Phase 3)
- **Services sub-tab** -- displays published actions (services) offered by the agent on the work exchange, with name, description, cost, visibility, call count, success rate, and average response time.
- **Unpublish button** -- remove a service from the exchange directly from the dashboard.

#### Agent Messages (Phase 3)
- **Message CRUD with thread support** -- `POST/GET /v1/agents/:name/messages` with optional `threadId` for conversation threading.
- **Chat UI** -- message bubbles (inbound/outbound), auto-scroll, textarea with Enter-to-send.
- **Proposed task handling** -- inbound messages with `metadata.proposedTask` render inline with "Create Task" and "Adjust" buttons.
- **Status bar** -- online/offline indicator, inbox/delivered/error counters.
- **Thread selector** -- horizontal thread navigation buttons.
- **Inbox integration** -- pending messages included in the agent integration kit inbox endpoint.
- **2 MCP tools** -- `message_inbox`, `message_send`.
- **Tier1 prompt extended** -- message handling instructions added to downloadable agent specs.

#### Agent Detail View (cross-phase)
- **6 sub-tabs** -- Tasks, Directives, Capabilities, Activity, Services, Messages. Tab navigation within agent detail.
- **Shortened connection prompt** -- buildAgentPrompt() reduced to 10 lines (Telegram-safe). Full instructions available via Download/Copy buttons.
- **Agent Integration Kit** -- consolidated inbox endpoint (`GET /v1/agents/:name/inbox`) returns pending tasks, messages, and directives in one call. Long-poll support for real-time agents.
- **Live updates** -- all sub-tabs listen for SSE `aimeat-live-update` events and refresh automatically.

#### Admin Integration
- **Peer management in admin monitoring** -- admin monitoring tab extended with peer status tracking and routing controls.

### Storage
- **7 new SQLite tables** -- `agent_tasks`, `agent_task_events`, `agent_directives`, `owner_agent_defaults`, `sharing_groups`, `agent_activity`, `agent_messages`.
- **7 new Prisma models** -- matching MongoDB implementations for all tables.
- **6 new repository interfaces** -- `AgentTaskRepository`, `AgentDirectivesRepository`, `SharingGroupRepository`, `AgentActivityRepository`, `AgentMessageRepository`, plus capability extensions on `AgentRepository`.
- **Storage interface extended** -- `AgentTaskRecord`, `AgentDirectivesRecord`, `SharingGroupRecord`, `AgentMessageRecord`, `AgentActivityRecord`, `AgentActivityStats`, `AgentTechnicalCapability` types added.

### Tests
- **8 new E2E test suites, 109+ tests** covering all features on both SQLite and MongoDB:
  - `e2e-agent-tasks.ts` (19 tests) -- task CRUD, lifecycle, stall detection, events
  - `e2e-agent-directives.ts` (12 tests) -- three-layer inheritance, merge view
  - `e2e-sharing-groups.ts` (23 tests) -- group CRUD, member permissions, memory visibility
  - `e2e-integration-kit.ts` (15 tests) -- inbox, task lifecycle, kit endpoint, long-poll
  - `e2e-agent-capabilities.ts` (8 tests) -- capability reporting, MCP verification
  - `e2e-agent-activity.ts` (10 tests) -- stats, history, log, recorder
  - `e2e-agent-messages.ts` (14 tests) -- message CRUD, threads, inbox integration
  - `e2e-agent-services.ts` (22 tests) -- service listing, stats, unpublish

### i18n
- **228 new translation keys** in both `en.json` and `fi.json` covering all 7 features, admin tabs, status badges, form labels, and empty states.

### OpenAPI
- **~1,700 lines added to `openapi.yaml`** -- all new endpoints documented with request/response schemas, including agent tasks, directives, sharing groups, capabilities, activity, messages, and integration kit.

## [1.6.1] - 2026-05-21

### Security

Full security audit covering authentication, authorization, input validation, dependencies, storage, GDPR, extensions, federation, and infrastructure. 33 findings addressed across 7 phases.

#### Critical & High Fixes
- **Extension SSRF protection** -- `ctx.fetch()` in extension sandbox now validates URLs via `validateOutboundUrl()`, blocking private/reserved IPs and cloud metadata endpoints (169.254.169.254). Applied to both QuickJS runtime and route-level fetch.
- **GDPR cascade delete completion** -- `DELETE /v1/owners/:name` now deletes all data categories: GHII-level memory, consents, organism memberships, matches (by GHII), sessions, capabilities, scheduled jobs, device auth records, apps, extension instances, knowledge links, and knowledge reviews. Previously only agents, their memories, actions, and transactions were deleted.
- **Admin password removed from logs** -- no longer logged via `logger.info()`. Auto-generated secrets written to stderr only.
- **Login brute-force protection** -- per-route rate limit + per-account progressive lockout after configurable N failed attempts (default: 5 failures, 15-minute lockout).
- **Extension script content gated** -- `GET /v1/extensions/:name?full=true` now requires authenticated owner/operator. Unauthenticated callers get metadata only. Does not affect cortex-to-extension calls (which use action invocation, not script reading).
- **Extension email authorization** -- three-tier model: Tier 0 (default) allows emailing only the caller's own verified email. Tier 1 allows consented recipients via `purpose: 'extension_email'`. Tier 2 (operator-granted `emailPolicy: 'unrestricted'`) allows arbitrary recipients.
- **Token refresh role revalidation** -- `POST /v1/auth/refresh` now re-reads roles from storage instead of copying from the old token, preventing stale privilege persistence after role changes.
- **Unauthenticated federation auth refresh deleted** -- `POST /v1/federation/auth/refresh` removed entirely (no consumers existed; client library explicitly refuses federated refresh).

#### Federation Auth Scope Configuration (new feature)
- **Node-level federation auth policy** -- `federationAuthPolicy` config: `disabled` (default), `all_peers`, or `specific_peers`. Controls whether users from other nodes can log in.
- **Per-peer auth settings** -- `allowFederatedAuth` and `federationAuthScopes` fields on each peer record, configurable from admin dashboard.
- **Receiving node determines scopes** -- home node attestation no longer dictates scopes. The receiving node applies its own per-peer or default scope policy.
- **Attestation signature verification** -- federated login now verifies the home node's Ed25519 signature on the attestation against the peer's known public key.
- **Admin dashboard UI** -- federation tab gains auth policy dropdown (disabled/all_peers/specific_peers), default scopes checkboxes, and per-peer "Allow Federated Login" toggle.

#### Medium Fixes
- **Registration rate limiting** -- `POST /v1/ghii` and `/v1/ghii/register-web` rate-limited (default: 5/min).
- **Admin setup rate limiting** -- `/v1/admin/setup/auth`, `/setup/register`, `/setup/token`, `/setup/initial-otk` all rate-limited (default: 5/min).
- **Timing-safe admin password** -- all admin password comparisons use `crypto.timingSafeEqual()`.
- **Strong admin passwords** -- setup wizard now enforces same password strength rules as regular registration (8+ chars, uppercase, lowercase, number, no common passwords).
- **Extension limits capped** -- `Math.min()` instead of `Math.max()` ensures extensions cannot exceed admin-configured memory/timeout/API-call limits.
- **Extension wallet spending cap** -- configurable per-call debit limit (default: 100 morsels, env: `AIMEAT_EXT_MAX_DEBIT`).
- **Consent expiry sweep** -- `expireConsents()` now performs actual bulk expiration query instead of being a no-op.
- **Unhandled rejection handler** -- `process.on('unhandledRejection')` prevents silent crashes from background services.
- **scrypt v2 parameters** -- new password hashes use N=32768 (up from 16384). Versioned hash format (`v2:salt:key`) with transparent upgrade on login. Old hashes work forever.
- **Relaxed CSP for test pages** -- generator/foundry test pages use `script-src 'unsafe-eval' 'unsafe-inline' https:` instead of removing CSP entirely.
- **Zod schema validation** -- added to `POST /v1/ghii`, `/v1/ghii/register-web`, `/v1/ghii/login`, `/v1/consent`, `/v1/flags`, `/v1/extensions` with field type/size constraints.

#### Low Fixes
- **Content-Disposition sanitization** -- filename quotes/backslashes escaped in download headers.
- **Interest storage identity** -- registration interests stored under owner GHII (was fabricated non-existent agent GAII). Directory service uses GHII-first lookup with agent GAII fallback for backward compatibility.
- **Extension notification identity** -- `notify()` uses `resolveIdentity()` instead of raw `req.auth!.sub`.
- **TOTP backup code entropy** -- increased from 4 bytes (8 hex chars) to 6 bytes (12 hex chars).
- **Transaction IDs** -- all 23 sites migrated from `Math.random()` to `crypto.randomUUID()`.
- **Rate limiter fallback** -- added `req.socket.remoteAddress` to key chain + stats counter for unknown key fallback.
- **Security headers on all responses** -- X-Content-Type-Options, X-Frame-Options, Referrer-Policy, HSTS applied globally (was only when public directory existed).
- **Generic upload error** -- internal error details no longer leaked to clients.
- **JSON body limit** -- reduced default from 15MB to 5MB. Apps/extensions/cortex routes keep 15MB.
- **Startup warnings** -- TOTP encryption key missing, dev mode on non-local config, Windows node key unencrypted.

#### Configurable Security Settings (all via .env + admin dashboard)
All security limits are runtime-configurable via environment variables and the admin dashboard Config tab under the "Security" group:
- `AIMEAT_LOGIN_RATE_LIMIT_MAX` / `_WINDOW_MS` (default: 15 / 60000)
- `AIMEAT_REGISTRATION_RATE_LIMIT_MAX` / `_WINDOW_MS` (default: 5 / 60000)
- `AIMEAT_ADMIN_AUTH_RATE_LIMIT_MAX` / `_WINDOW_MS` (default: 5 / 60000)
- `AIMEAT_PASSWORD_LOCKOUT_ATTEMPTS` / `_MINUTES` (default: 5 / 15)
- `AIMEAT_JSON_BODY_LIMIT_MB` / `_LARGE_MB` (default: 5 / 15)
- `AIMEAT_EXT_MAX_DEBIT` (default: 100)
- `AIMEAT_FEDERATION_AUTH_POLICY` (default: disabled)
- `AIMEAT_FEDERATION_DEFAULT_SCOPES` (default: memory:read,catalogue:read)

### Changed
- **Password validation** extracted to shared `src/utils/password-validation.ts` (was private in ghii.ts).
- **ConsentCreateSchema** scope enum now includes `'auth'` (was missing, needed for federation auth consents).
- **Federation auth verify** rate limit increased from 10/min to configurable (default: 15/min).

## [1.6.0] - 2026-05-21

### Added
- **Notification Statistics** -- email, push, and mailbox notification counters with type-level breakdown for operational visibility and abuse detection.
  - **Email counters** -- `email_sent`, `email_failed`, `email_retried` tracked per type (verification, magic_link, notification, match_suggestion, group_send).
  - **Push counters** -- `push_sent`, `push_failed`, `push_expired_subs` tracked per type.
  - **Mailbox notification counters** -- `mailbox_notif_sent`, `mailbox_notif_failed` per channel (push, email), `mailbox_notif_blocked` per reason (cooldown, quiet_hours, disabled).
  - **`incrementTyped(name, type)` API** -- new `StatsCollector` method stores typed counters as `name:type`, with automatic grouping in `snapshot()` into `{base}` totals and `{base}_by_type` breakdowns.
- **Stats Persistence** -- all counters survive server restarts via periodic flush (every 60s) to storage.
  - **`StatsRepository` interface** -- `flushStats`, `loadStats`, `flushDailyHistory`, `loadDailyHistory` methods added to the storage layer.
  - **SQLite backend** -- `stats_counters` and `stats_daily_history` tables with upsert and 90-day pruning.
  - **MongoDB backend** -- `StatsCounter` and `StatsDailyHistory` Prisma models with composite unique constraints.
  - **Graceful shutdown** -- `stats.shutdown()` flushes final counter state on SIGTERM/SIGINT.
- **Time-Range Filtered Stats API** -- `GET /v1/stats?from=YYYY-MM-DD&to=YYYY-MM-DD` returns summed counters and per-day breakdown for the selected range. Backward compatible (no params = lifetime totals).
  - **Gauges** -- `tunnel_connections_active`, `mailbox_items_total`, `mailbox_bytes_total`, `mailbox_oldest_item_age_seconds` always return current values regardless of time range.
- **Stats Tab UI** -- admin dashboard Stats tab gains three new sections and a time range selector.
  - **Time range selector** -- preset buttons (Today, This Week, 7 Days, 30 Days, All) plus custom date range. Default: 7 Days. Re-fetches data on change.
  - **Email Delivery section** -- 4 stat cards (Sent, Failed, Retried, Success Rate), breakdown table by type, per-day bar chart.
  - **Push Notification section** -- 4 stat cards (Sent, Failed, Expired Subs, Success Rate), breakdown table by type, per-day bar chart.
  - **Mailbox Notifications section** -- 3 stat cards (Sent, Failed, Blocked), inline breakdowns by blocked reason and channel.
  - **Live badge** -- gauge values show a "live" indicator badge.
- **i18n** -- 51 new translation keys added to both `en.json` and `fi.json` (section headers, stat cards, type labels, time range presets, weekday abbreviations).

### Tests
- **12 new unit tests** -- typed counter grouping (5 tests), persistence init/flush/shutdown (7 tests) including prefixed counter deserialization, error recovery, and timer cleanup.
- **5 new Playwright tests** -- admin stats tab: time range selector rendering, button switching, email/push/mailbox section rendering with stat card verification.
- **E2E stats tests** -- time-range-filtered `GET /v1/stats` with `totals`, `daily`, `gauges` key verification, empty range handling.

## [1.5.0] - 2026-05-21

### Added
- **Federation Mesh Network** -- complete mesh networking across AIMEAT nodes with 4 layers of functionality:

#### Per-Peer Policy + Federate Flags (Phase 1)
- **Per-peer policy controls** -- each federation peer connection has configurable `shareCatalogue`, `replicateMemory`, `allowRouting` flags and a `peerMode` (federation/private). Private P2P peers are excluded from the public federation directory.
- **Federate flag on all catalogue types** -- `ActionRecord`, `AgentRecord`, `BoardRecord`, `StorageFileRecord` each have a `federate` boolean. Only items explicitly marked for federation are shared across the network. `CsmRecord` and `MsmRecord` already had this.
- **Policy enforcement** -- catalogue sync, memory replication, and multi-hop routing check peer policies before proceeding. Returns 403 `POLICY_DENIED` when blocked.
- **Admin UI peer policy toggles** -- Live Peers table in the federation tab has per-peer checkboxes and mode selector.
- **Profile UI federate badges** -- agents, boards, and knowledge tabs show interactive federate toggle badges.

#### Network Directory (Phase 2)
- **Service summary endpoint** -- `GET /v1/federation/service-summary` returns a compact catalogue of all federated items on a node, with a SHA-256 hash for change detection.
- **Heartbeat-driven discovery** -- hub nodes detect service summary hash changes during heartbeat and automatically fetch updated summaries from peers. Summaries stored in-memory, cleaned up when peers go offline.
- **Cross-catalogue network source** -- `GET /v1/federation/cross-catalogue` extended with `source_type: 'network'` entries aggregated from all peer summaries.
- **Admin UI network directory browser** -- searchable table in the federation tab showing all services/data available across the federation.

#### Federated Login (Phase 3)
- **`POST /v1/federation/auth/verify`** -- home node verifies credentials for a remote node. Checks password (scrypt) and requires an active auth consent (`scope: 'auth'`) for the requesting node. Returns a signed Ed25519 attestation.
- **`POST /v1/federation/auth/refresh`** -- re-verify a federated session without password. Checks user exists and auth consent still active.
- **Auth consent isolation** -- `scope: 'auth'` is distinct from `scope: 'federation'`. Sharing data with a node does NOT grant login access. New `ConsentRecord.scope` value added to the type.
- **Federated JWT claims** -- JWT extended with `federated`, `homeNode`, `homeUrl` claims. Short TTL (max 1 hour).
- **Restricted federated sessions** -- federated users cannot perform operator actions, create agents, or manage consents. `requireLocalSession()` middleware added.
- **Server-side federated login flow** -- `POST /v1/ghii/login` detects `@remote-node` in username, routes verification to the home node, and issues a local federated JWT on success.
- **Client-side federated login** -- login modal sends full `user@node` to server. Shows "Connecting to home node..." during federation. "Federated" badge on logged-in state. Session stores federation info.
- **Access tab Federation Access section** -- manage which nodes can authenticate you. Add/remove per-node auth consents. "Allow all federation nodes" wildcard toggle with warning.

#### Cross-Node Data Access (Phase 4)
- **`POST /v1/memory/pull`** -- copy a memory entry from the home node to the current (remote) node. Stores locally with `visibility: private` and `pulled-from:` tag.
- **`POST /v1/memory/push-home`** -- save a local memory entry back to the home node via the federation replication protocol.
- **Federation proxy utility** -- `middleware/federation-proxy.ts` routes requests from federated sessions to the home node with SSRF protection.
- **Memory tab pull/push UI** -- federated sessions see a banner and per-entry "Copy from home" / "Save to home" buttons.

#### Additional UI Enhancements
- **Knowledge tab** -- interactive federate toggle creates/revokes federation consent per package.
- **Data Wallet tab** -- distinct badges for federation (blue) and auth/login (purple) consent scopes. Scope filter buttons (All / Federation / Login Access).
- **Memory tab** -- "Synced" badge on entries with active federation consent. Share/Unshare buttons for all sessions.
- **Profile card** -- federation status indicator shows "Connected to X nodes" or "Standalone".

### Fixed
- **Multi-hop relay didn't forward auth headers** -- `POST /v1/federation/route` now includes the `Authorization` header when relaying through intermediate nodes, enabling B->A->C routing.
- **Private peers visible in public directory** -- `GET /v1/federation/directory` now excludes peers with `peerMode: 'private'`.
- **Federation sidebar count inflated by history** -- sidebar showed peering request history count when no live peers existed. Now shows only live peer count.
- **Peering request history not deletable** -- added `DELETE /v1/admin/peering/requests/:id` endpoint and delete buttons in the admin federation tab.

### Tests
- **129 federation tests** -- 44 single-node E2E (peer policies, federate flags, service summary, auth verify, data access), 45 multi-node integration (3 nodes: hub + 2 contributors), 40 original federation tests.
- **Multi-node integration suite** -- `test/federation-multinode.ts` boots 3 AIMEAT servers and tests service discovery through hub, cross-node routing (direct + multi-hop), federated login with consent isolation, private peer filtering, and routing fee verification.

## [1.4.8] - 2026-05-20

### Fixed
- **Owners tab showed wrong list and counts** -- the admin dashboard built the owners list by extracting unique names from agents, so owners with zero agents were invisible. Sidebar count (from `listOwners()`) didn't match the tab data. Added `GET /v1/admin/owners` endpoint that returns all owners directly from storage with roles and agent counts. Sidebar count now updates from the same source.
- **Owner roles missing from API response** -- `GET /v1/owners/:name` did not include the `roles` field, so the admin owners tab always showed "--" for roles and the "Grant Operator" button appeared even for existing operators.
- **Federation login showed "wrong password" instead of proper error** -- entering `user@remote-node` in the login form stripped the `@node-id` client-side before the server could check, so the server tried local auth and failed with a misleading error. Now checks the node-id client-side and shows "Federated login is not yet supported" with both node IDs.
- **Federation peers lost on server restart** -- the `peers` Map was in-memory only. Added `federation_peers` table (SQLite) and `FederationPeer` Prisma model (MongoDB). Peers are persisted on every mutation (add, activate, update, remove, heartbeat status change) and loaded on startup.
- **Federation peering was one-directional** -- when genesis node A approved peering with node B, only A recorded B as a peer. B never added A back. Fixed by: (1) including `node_url` in key exchange payload, (2) auto-adding the sender as a peer during key exchange if they match our genesis config or an approved peering request, (3) storing a local peering request when joining a genesis network so the returning key exchange is recognized.
- **MongoDB replication queue lost on restart** -- the MongoDB storage used an in-memory `Map` for the replication queue instead of persisting to the database (SQLite already used a proper table). Replaced with Prisma-backed `ReplicationQueue` model. Federation sync state now survives restarts on both backends.

## [1.4.7] - 2026-05-20

### Added
- **Edit Profile modal** -- "edit profile" link in the profile card now opens a modal to update display name, bio, avatar, and language. Calls `PUT /v1/ghii` and updates the session immediately.
- **Change Password modal** -- "change password" link next to edit profile opens a separate modal with current/new/confirm password fields. New `POST /v1/ghii/password/change` endpoint validates the current password and enforces strength requirements.
- **`displayName` in session** -- the login and register flows now include `displayName` in the session object and localStorage, so the profile card shows the real name instead of falling back to the username.
- **Profile API service functions** -- `getProfile()`, `updateProfile()`, `changePassword()` added to the frontend auth service (`public/js/services/auth.js`).
- **`GET /v1/ghii/me` endpoint** -- authenticated endpoint that returns the user's own profile including private fields (`notification_email`, `email_verified_at`). Used by edit profile modal and email tab.
- **Email shown in profile** -- email-tab now displays the verified email address (was only showing "Email verified" without the address). Edit profile modal shows email as read-only with a hint to change it in the Email tab.

### Fixed
- **Login with full GHII corrupted session** -- entering `user@node-id` in the login form leaked the full GHII into JWT claims (`sub`, `owner`), the session `owner` field, and all downstream operations (owner lookup, key update, token refresh). Root cause: `POST /v1/ghii/login` stripped `@node-id` into `loginName` for the GHII lookup but used the raw `username` from req.body for JWT issuance, storage updates, and the API response. Now all 8 occurrences use `loginName`. Registration endpoints also strip `@node-id` from both `username` and `display_name`. Frontend strips `@node-id` and skips the register-first flow when a GHII is detected.
- **Password reset never sent email (MongoDB)** -- `notificationEmail` field was missing from the Prisma schema and MongoDB storage mapping. The email verification flow set `emailVerifiedAt` but silently failed to store the email address, so password reset always skipped sending because `notificationEmail` was null. Added the field to `schema.prisma`, `createGHII`, and `toGHIIRecord`. Users who previously verified their email on MongoDB need to re-verify once for the address to be stored.

### Improved
- **Password reset logging** -- `POST /v1/ghii/password/reset-request` now logs whether the email was sent, failed, or skipped (and why), making it possible to diagnose "forgot password" issues from server logs.

## [1.4.4] - 2026-05-20

### Fixed
- **Setup wizard still broken after 1.4.3** -- the root cause was in `middleware-guards.ts`: the first-run guard served `wizard.html` directly without injecting the CSP nonce into `<script>`/`<style>` tags. The 1.4.3 onclick fix was necessary but insufficient because the nonce was never reaching the HTML. Now uses the same `res.locals.cspNonce` injection pattern as all other HTML-serving routes.
- **`aimeat --version` showed hardcoded `v1.2.0`** -- now reads version from `package.json` at runtime.
- **Crash on Mac ARM (Apple Silicon) with memory backend** -- `better-sqlite3` native bindings may not have prebuilts for newer Node.js versions on `darwin/arm64`. Previously crashed with an opaque bindings error. Now catches the failure and shows clear fix instructions (rebuild, use MongoDB, or reinstall).
- **Login rejects full GHII identity** -- entering `username@node-id` in the sign-in form failed because the `@` character was rejected by registration validation, and the backend constructed a double-suffixed key. Both frontend and backend now parse the `@node-id` suffix: the username portion is extracted for login, and if the node-id doesn't match the local node, a clear "federated login not yet supported" error is returned. Full GHII input also skips the register-first flow and goes straight to login.

## [1.4.3] - 2026-05-20

### Fixed
- **Setup wizard inline onclick handlers blocked by CSP** -- replaced all 17 inline `onclick` event handlers in `wizard.html` with `addEventListener` calls inside the nonce-protected `<script>` block. Inline event handlers require `unsafe-inline` regardless of nonce.

## [1.4.2] - 2026-05-16

### Fixed
- **Owner cannot modify agent-created knowledge packages** -- PATCH sharing/visibility endpoints used `resolve(req)` which returns GHII for owner sessions, but packages created by agents are stored under their GAII. Added `findOwnerScopeMemory()` helper that searches GHII + all same-owner agents. Also fixed GET /v1/knowledge/:id to search GHII namespaces for public packages.
- **Unknown content type shows raw i18n key** -- content type badge fell back to `KNOWLEDGE.CONTENTTYPES.GUIDE` for types not in the translation file. Badge now falls back to uppercase raw value for unknown types.

### Added
- **`guide` content type** for knowledge packages -- added to schema, English and Finnish locale files.

## [1.4.1] - 2026-05-16

### Fixed
- **Knowledge packages invisible to agents** -- catalogue endpoint only searched agent GAIIs, missing packages stored under owner GHII (web UI imports). Now searches both GHII and GAII namespaces.
- **MCP `aimeat_knowledge_list` returned empty** -- tool only queried the calling agent's own memory. Now aggregates owner scope (GHII + all same-owner agents), matching the REST API behavior.
- **Knowledge package import rejected `null` URLs** -- AI chats produce `"url": null` for offline references (books, local files). Schema kept strict (string required) as a prompt quality forcing function; the packager prompt now instructs LLMs to use descriptive prefixes (`offline:`, `local:`, `email:`) instead of null.
- **`KNOWLEDGE.VISIBILITY.SHARED` shown as raw i18n key** -- frontend preview rendered AI-generated `"visibility": "shared"` before server normalization. Preview now normalizes `shared` to `owner` before rendering. Added `shared` fallback key to both locale files.
- **Misleading "Shared/Jaettu" label for `owner` visibility** -- renamed to "My Agents/Omat agentit" across all locale files to clarify that `owner` means same-owner agent access, not cross-user sharing.

### Added
- **REST API mapping in bootstrap** (`GET /`) -- new `rest_api_without_mcp` section maps all 17 MCP tool names to their REST equivalents, with notes on `owner_scope`, catalogue vs memory endpoints, and the `/v1/packages` (app store) vs `/v1/catalogue/knowledge` distinction. Agents without MCP support now discover correct endpoints automatically.
- **Knowledge packager prompt improvements** -- visibility descriptions expanded (PUBLIC/OWNER/PRIVATE with scope explanations), `"shared"` explicitly forbidden, new rule #8 for offline reference URL format.

## [1.4.0] - 2026-05-06

### Added
- **"Create Package with AI" prompt** in the Packages tab -- copy-pasteable prompt for Claude Code, VS Code Copilot, or any AI chat that interviews the user, builds and tests components on a live node, and packages the result as a distributable ZIP
- **Package update flow** -- "Check Update" now shows a confirm dialog to apply updates, preserving user data (memory, settings) while replacing apps, extensions, and schemas
- **Packages tab intro section** with title and description (matching all other profile tabs)
- **i18n for package categories** and featured badge in template gallery
- **Auto-activation** of cortex and server extensions on package install (no manual activation needed)
- **Rotation settings** for digital signage -- toggle auto-rotation on/off, configurable speed in seconds

### Fixed
- **Broken `packages.gallery` translation** -- duplicate key in locale files caused "packages.gallery" to render as literal text
- **Instance status renamed** from "active" to "installed" -- avoids confusion with cortex/extension activation status (updated across types, storage, API, OpenAPI spec, CSS, tests, docs)
- **Instance removal now cleans up all components** -- apps, cortex (including lib files, prompts, seed data), CSM, memory, translations are deleted. Previously `removeComponents` was sent as query param but backend read from body; now supports both. Frontend defaults to `true`.
- **ownerGaii mismatch** in package install/delete/migration -- was using bare username instead of full GHII, causing component lookups to fail. Fixed across install, delete, status check, and migration flows.
- **App delete backward compat** -- DELETE/PATCH endpoints fall back to bare owner name for apps created before the GAII fix
- **Admin panel syntax error** in digital signage seed -- `\n` in template literal produced actual newlines breaking inline JS strings
- **App catalog shows empty on first visit** -- `aimeatUrl` defaulted to empty string, now defaults to `window.location.origin` so server apps load without localStorage
- **Upload ZIP button** didn't trigger file picker (HTM template literal handler binding issue)
- **ZIP import auto-publishes** -- uploaded packages now get status `published` instead of `draft`
- **Browse Packages** shows all user's packages, not just published
- **Prompt seeder** now syncs content for both `generator` and `builders` groups on restart

### Improved
- **Digital signage cortex manifest** rewritten with proper `components:` array, `.js` lib filenames, tags, exports, and `api_surface` metadata -- "What's included" section now shows library details
- **Component registrar** preserves lib component fields (filename, exports, api_surface) in cortex registration; passes package metadata (category, tags, description) through to app manifests
- **Cortex component delete** now cleans up lib files, prompts, ontologies, and seed data (previously only deleted the record)

## [1.3.4] - 2026-05-03

### Fixed
- App REST handlers (POST, PATCH, DELETE) now use `resolveIdentity()` to convert bare owner username to full GHII -- fixes 404 on delete for MCP-published apps
- Extension GET endpoint supports `?full=true` for operator export (includes scriptContent)

## [1.3.3] - 2026-05-02

### Added
- **Presigned upload URLs for MCP tools** -- files transfer directly from agent's filesystem to server over HTTPS without passing through the AI context window
  - `aimeat_app_publish`: omit `content_base64` to get upload URL (PUT raw HTML)
  - `aimeat_storage_upload`: omit `data_base64` to get upload URL (PUT raw file)
  - `aimeat_extension_install`: omit manifest/scripts to get upload URL (PUT ZIP)
  - `aimeat_cortex_install`: omit manifest/libs to get upload URL (PUT ZIP)
  - Single-use tokens with 60-minute TTL, size-capped, Ed25519 signed
  - Inline fallback preserved for backward compatibility
- REST routes `POST /v1/apps` and `POST /v1/storage` support `mode: "presigned"` for same flow
- New endpoint: `PUT /v1/upload/:token` -- generic presigned upload receiver
- ZIP format for extension/cortex uploads (manifest.yaml + scripts/ or libs/)
- E2E test suite: 13 tests covering full presigned upload flow
- Developer guide: `docs/coding-guidelines/mcp-uploads.md`

## [1.3.2] - 2026-05-02

### Fixed
- App catalog delete used anonymous token instead of owner JWT -- DELETE always returned 404. Now uses logged-in user's session token for both PORTAL and MCP app removal.

## [1.3.1] - 2026-05-02

### Fixed
- App catalog Published Apps section now shows Remove button for MCP-published apps
- Renamed source badges: "local/server" -> "PORTAL/MCP" (clearer -- both are on server, badge shows where it was published from)
- App publish via MCP uses owner GHII for correct catalog visibility

## [1.3.0] - 2026-05-02

### Added
- **Capability Layer** -- unified abstraction over extensions, cortex, and actions
  - REST API: CRUD, discovery, invoke proxy, telemetry, vouch, test endpoints
  - Storage: SQLite + MongoDB with 38 E2E tests passing on both backends
  - Aggregator: auto-creates capabilities from active extensions/cortex (runs at startup + every 5 min)
  - SDK library: `aimeat-capabilities.js` for browser apps
  - 3 MCP tools: `aimeat_capabilities_list`, `aimeat_capabilities_get`, `aimeat_capabilities_invoke`
  - Admin dashboard tab with detail view, override panel, stats
  - Profile tab with node capabilities listing, source filter, policy display
  - 130+ capabilities auto-aggregated on aimeat.io from 21 extensions + 15 cortex modules

- **19 new MCP tools** (52 -> 72 total)
  - Extension lifecycle: `install`, `get`, `activate`, `deactivate`, `delete` (5)
  - Cortex lifecycle: `list`, `install`, `activate`, `deactivate`, `delete` (5)
  - Capability CRUD: `create`, `update`, `delete`, `vouch` (4)
  - App management: `publish`, `list`, `get`, `delete`, `versions` (5)

- **App catalog server integration** -- Published Apps section now fetches from server, shows apps published via MCP or other devices with source badges (local/server/both)

### Fixed
- `ctx.log` in extension sandbox now callable as function (was object-only, caused "not a function" for scripts using `ctx.log("msg")`)
- Stale closure in extensions-tab.js `onSrvManifestChange` (script code lost when manifest edited)
- YAML quote stripping for auto-extracted script filenames
- Capability aggregator errors now logged instead of silently swallowed
- Capability aggregation runs at startup, not just on cron schedule
- App publish via MCP uses owner GHII (not agent GAII) for correct catalog visibility

### Changed
- Capabilities tab redesigned: shows all node capabilities with source filter, policy settings, how-created explanation (was bare CRUD form)
- Capabilities MenuItem added to profile landing page (new + active/experienced tiers)
- GET /v1/capabilities response includes `policy` object (publishing, publishers, webhooks settings)

## [1.2.6] - 2026-04-30

Previous release.
