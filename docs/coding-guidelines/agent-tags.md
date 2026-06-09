# Agent Tags & Modes

Agents have two distinct metadata mechanisms for owner-side classification: **mode** (fundamental agent type) and **tags** (free-form owner labels). They do different jobs and live in different fields. Do not collapse them.

## Mode (fundamental type)

Field: `AgentRecord.mode: 'autonomous' | 'interactive' | 'task-runner' | 'coordinator' | 'workstation'`.

Set at registration (`POST /v1/agents/device-authorize`, body field `mode`) and changed later by the owner (`PATCH /v1/agents/:name/mode` or MCP tool `aimeat_agent_mode_set`). The union is closed -- agents cannot pick arbitrary modes.

| Mode | Definition | Hello Integration |
|------|-----------|---------|
| `autonomous` | Runs continuously, decides when to act, monitors environment (Hermes, OpenClaw, Auto-GPT-style). | Full 13-step flow |
| `interactive` | Responds to user requests in a chat or IDE session (Claude Code, Cursor, Cline, Falcon). | Full 13-step flow |
| `task-runner` | Triggered by a task, runs it, exits. No interactive command surface, no continuous presence (CrewAI crews, Inngest-style workers). | Reduced 7-step flow -- `authenticate`, `identify_platform`, `install_skill`, `report_capabilities`, `accept_test_task`, `complete_test_task`, `publish_config`. The test-task pair is kept as the runner's smoke test; the omitted steps are not in the record at all -- not pending, not skipped. |
| `coordinator` | Orchestrates other agents (Claude Desktop with MCP, LangGraph supervisor, CrewAI Manager Agent). Treated as interactive for onboarding. | Full 13-step flow |
| `workstation` | Node-visiting agent that lives in the user's own environment (VSCode, Claude Desktop) and uses MCP directly -- not node-resident, so it has no runtime config, slash commands, telemetry, or task queue. | Narrowest 4-step flow -- `authenticate`, `identify_platform`, `report_capabilities`, `read_directives`. The MCP round-trip it already made to authenticate + report capabilities is its smoke test, so no test task is created. The omitted steps are not in the record at all. |

Existing agents (created before this field existed) default to `interactive` -- they already went through the full flow. New agents declare a mode at registration; if omitted, the server treats it as `interactive`.

## Tags (owner labels)

Field: `AgentRecord.tags: string[]` (already existed -- this work surfaces them in the UI). Each tag is a lowercase string matching `[a-z0-9._-]+`, max 20 tags per agent.

### Conventions

The UI doesn't enforce these prefixes -- they're a convention so groups of agents stay grouped automatically. Owners are free to invent their own.

| Prefix | Purpose | Example |
|--------|---------|---------|
| `crew:<name>` | Agent belongs to a multi-agent crew. | `crew:marketing-001` |
| `source:<name>` | Agent's underlying runtime/framework. | `source:crewai`, `source:hermes`, `source:claude-code` |
| `role:<name>` | Agent's role within a crew. | `role:researcher`, `role:editor` |
| `project:<name>` | Agent is dedicated to a specific project. | `project:comicland-v2` |

Common combos: `crew:* + role:*` lets the owner see "everyone in the marketing crew" and "all researchers across crews" with a single tag filter.

### Setting tags

- UI: Data Access tab on the expanded agent card.
- MCP: `aimeat_agent_tags_set` (owner-only) -- replaces the tag list.
- REST: `PATCH /v1/agents/:name/tags` body `{ tags: string[] }` (owner-only).

Empty array clears all tags. Sending an unchanged list is a no-op.

## UI behaviour (Your Agents tab)

- **Mode badge** on every card (collapsed + expanded), distinct color per mode.
- **Tag chip strip** above the capabilities row on expanded cards.
- **Filter bar** at the top of the list: each unique tag becomes a clickable chip. Multi-select = AND filter (agent must have *all* selected tags). A "Clear" link appears when any tag is active.
- **Group-by selector** with three options: `none` (default flat list), `tag` (one section per tag; agents with multiple tags appear under each one; an "Untagged" group catches the rest), `mode` (one section per mode in canonical order: autonomous, interactive, task-runner, coordinator, workstation).

The filter applies before grouping. Filtering to a tag and then grouping by mode shows the mode breakdown of just that tag's agents.

## Don't

- Don't make tags carry semantics the backend depends on (e.g. don't gate scopes by `tag === 'admin'`). Tags are owner UI labels only.
- Don't use mode for grouping things tags should handle (which crew, which project). Mode is one-of-four, tags are free-form.
- Don't add a fifth mode without a corresponding doc + UI + onboarding-step decision in the same PR.
