# MCP Tool Unification Plan

Date: 2026-05-28

## Purpose

AIMEAT currently has two MCP tool surfaces that are implemented separately:

- Public node MCP: `POST /v1/mcp`, implemented in `src/mcp/*`, exposed by a node such as `https://aimeat.io/v1/mcp`.
- Local connector MCP: `aimeat connect serve`, implemented in `src/cli/connect/mcp/tools/*`, exposed over stdio for local runtimes.

They should behave like two transports for one AIMEAT tool catalog. Today they overlap heavily, but onboarding, telemetry, task helpers, and some naming/signature details can drift.

## Goals

1. Keep `/v1/mcp` as the official public network MCP endpoint.
2. Keep `aimeat connect serve` as the local bridge for runtimes that prefer stdio or cannot complete remote MCP OAuth cleanly.
3. Add a CLI fallback for shell-capable agents so agents can use `aimeat connect tools`, `aimeat connect schema`, and `aimeat connect call` instead of raw curl/token handling.
4. Use direct REST API guidance only as the last fallback via handbook and `/llms.txt` style documentation.
5. Make Hello Integration mandatory and available on both MCP surfaces.
6. Prevent future drift with an audit script and eventually a shared tool definition registry.

## Current Architecture

```text
src/mcp/*
  -> public Streamable HTTP MCP at /v1/mcp
  -> uses Storage/config directly
  -> best for remote MCP clients with OAuth support

src/cli/connect/mcp/tools/*
  -> local stdio MCP from aimeat connect serve
  -> uses AimeatClient and stored connector token
  -> best for local runtimes such as Hermes, Claude Code, and shell agents

src/cli/connect/*.ts
  -> thin shell fallback today: status, inbox, tasks, send, docs, refresh, logout
```

## Phase 0: Drift Visibility

Status: started.

- Add `pnpm audit:mcp-tools` to extract `mcp.tool()` registrations from both surfaces.
- Use the report before and after MCP-related changes.
- Track server-only, connector-only, and shared tool names.
- Keep this audit lightweight; it is not a replacement for behavior tests.

## Phase 1: Lifecycle Parity

Status: started.

- Add Hello Integration onboarding tools to public `/v1/mcp`:
  - `aimeat_onboarding_status`
  - `aimeat_onboarding_identify_platform`
  - `aimeat_onboarding_confirm_skill_installed`
  - `aimeat_onboarding_confirm_directives_read`
  - `aimeat_onboarding_declare_services`
- Add telemetry reporting to public `/v1/mcp`:
  - `aimeat_agent_telemetry_report`
- Keep connector versions of those tools available.
- Do not restore agent-side `aimeat_task_start`; agents propose TODOs, owners start normal tasks, and Hello Integration can auto-start its test task after TODO proposal.
- Add `aimeat_task_propose_todos` to public `/v1/mcp` so the agent task lifecycle has the same tool name on both MCP surfaces.
- Expected name-level audit after this phase: connector-only tools should be zero; `aimeat_admin_mint` should remain server-only because it is operator-gated node administration.

## Phase 2: Canonical Tool Metadata

Status: started.

Create a shared catalog that contains tool metadata without forcing one handler implementation for both environments.

Proposed shape:

```text
src/mcp/catalog/
  definitions.ts        # name, description, schema, role/scope, surface flags
  surfaces.ts           # public-mcp, connector-mcp, cli visibility rules
  audit.ts              # shared comparison helpers used by scripts/tests
```

Each tool definition should declare:

- `name`
- `description`
- input schema
- visibility: `publicMcp`, `connectorMcp`, `cliFallback`
- caller type: `agent`, `owner`, `operator`, or `public`
- required scopes or roles, where applicable
- canonical REST endpoint or service action, where applicable

The public MCP handler may continue to use storage/services directly. The connector MCP and CLI fallback should call REST APIs through `AimeatClient`. The shared catalog should make the contract common even when the execution adapter differs.

Initial implementation:

- `src/mcp/catalog/definitions.ts` defines transport-neutral metadata for the shared public/connector MCP surface and CLI fallback surface. The only public MCP tool intentionally left outside the connector/CLI fallback catalog is `aimeat_admin_mint`.
- `aimeat connect tools` and `aimeat connect schema` read their public metadata from that shared catalog.
- `pnpm audit:mcp-tools` reports CLI fallback catalog coverage, catalog names missing from either MCP surface, missing CLI handlers, and MCP names not yet represented in the shared catalog.

## Phase 3: Signature Normalization

Normalize the tools that currently have the highest drift risk:

- Tasks: keep `list`, `get`, `propose_todos`, `event`, `todo`, `complete`, and `fail` on both agent surfaces.
- Messages: keep `content`, optional `linked_task_id`, and optional `metadata` aligned.
- Capabilities: keep `aimeat_agent_capabilities_report` for self-reporting and `aimeat_agent_activity` for reading activity.
- Apps/extensions/cortex: standardize presigned upload mode plus inline fallback across public MCP, connector MCP, and CLI fallback.
- Sharing groups: decide whether `aimeat_group_*` or `aimeat_sharing_group_*` is canonical, then keep aliases only during migration.

## Phase 4: CLI-Complete Fallback

Status: started.

Add shell commands for agents that cannot use MCP reliably:

```text
aimeat connect tools
aimeat connect schema <tool-name>
aimeat connect call <tool-name> --json input.json
aimeat connect call <tool-name> --stdin
```

The CLI fallback should:

- use the same catalog metadata as MCP surfaces;
- call the same REST APIs as connector MCP tools;
- support `@file:path` references for upload-capable tools;
- print structured JSON by default;
- never ask agents to handle bearer tokens manually.

Initial implementation covers the Hello Integration path, agent task/message lifecycle tools, core memory/work/wallet/board/storage/admin wrappers, app/extension/cortex lifecycle wrappers, and the remaining shared connector/public wrappers for extended boards, groups, knowledge, flags, catalogue, capabilities, instances, organisms, consent, public memory reads, and wallet transactions. The remaining work is robust upload-capable file helpers and deeper behavior/signature tests beyond name-level parity.

## Phase 5: Tests And Release Safety

Before claiming the full unification complete:

- Run `pnpm audit:mcp-tools` and review intended differences.
- Run focused MCP tests for public `/v1/mcp`.
- Run connector smoke tests for `aimeat connect serve` and CLI fallback.
- For a major completed change, run the required E2E suites on SQLite and MongoDB.
- For profile/frontend prompt changes, run the required Playwright suite.

## Intended End State

```text
One canonical AIMEAT tool catalog
  -> public /v1/mcp transport
  -> local aimeat connect serve transport
  -> shell CLI fallback
  -> direct API docs as last resort
```

The user-facing story becomes simple: use public MCP when the runtime supports remote MCP OAuth, use `aimeat connect serve` for local stdio runtimes, use `aimeat connect call` when only shell is available, and use direct REST only when none of those work.
