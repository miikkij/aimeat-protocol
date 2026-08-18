/**
 * @file src/index-help.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description CLI help text constants (top-level + connector) for the aimeat binary. Extracted from index.ts to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from index.ts (max-file-lines)
 */

export const HELP_TEXT = `
aimeat — AI Memory Exchange and Action Transfer protocol node

USAGE
  aimeat start [options]         Start the node
  aimeat serve [options]         Alias for start
  aimeat config                  Show all settings and their current values
  aimeat config export [opts]    Export config (--format env|ini|json|consul)
  aimeat config import [opts]    Import config to database (--file <path> | --from consul)
  aimeat validate                Validate configuration (env, files, database)
  aimeat check                   Alias for validate
  aimeat init                    Interactive config wizard (generates .env, .ini, or .json)
  aimeat update                  Re-scaffold runtime files (safe update)
  aimeat join [URL]              Join a federation network
  aimeat maintenance on [MSG]    Enable maintenance mode (optional message)
  aimeat maintenance off         Disable maintenance mode
  aimeat maintenance             Show maintenance status
  aimeat connect [opts]          Connect an AI agent (device auth flow)
  aimeat connect client <id>     Point a chat client at this node in one command
                                 (goose | claude-code | cursor | vscode | claude-desktop):
                                 authorizes a dedicated agent, writes that client's MCP
                                 config, and leaves a launcher that supplies the token.
  aimeat connect add [opts]      Add another agent to the connector pool
  aimeat connect list            Show all connected agents
  aimeat connect remove <name>   Remove a connected agent
  aimeat connect serve [--surface <role>] [--http]
                                 Start MCP server (stdio). --surface appdev|agent|service|admin
                                 exposes only that purpose-scoped tool set (see "aimeat connect").
                                 --http runs a long-lived loopback daemon instead (one WS per agent
                                 + local /v1/mcp, REST proxy, push) -- for crews / many calls.
  aimeat connect status          Show agent connection status
  aimeat connect inbox           Check message inbox
  aimeat connect tasks           List assigned tasks
  aimeat connect send [opts]     Send a message (--to GAII --body "text")
  aimeat connect docs [module]   View agent handbook / module docs
  aimeat connect refresh         Re-download skill bundle
  aimeat connect logout          Remove stored credentials
  aimeat seed                    Seed example packages (digital signage, etc.)
  aimeat screenshot-worker [opts] Backfill missing app screenshots (operator; uses system Edge/Chrome)
  aimeat backup  [FILE]          Export all data to JSON
  aimeat restore <FILE>          Import data from JSON backup

START OPTIONS
  --db <type>              Storage type: postgres-kysely, sqlite, memory
  --db-url <url>           Database connection URL (PostgreSQL)
  --db-path <path>         SQLite database file path
  -p, --port <port>        HTTP port (default: 40050)
  --node-id <id>           Node identity string
  --admin-password <pw>    Operator admin secret
  -c, --config <path>      Config file path (JSON)
  --consul <url>           Enable Consul and set URL (e.g., http://consul:8500)
  --consul-prefix <prefix> Consul KV prefix (default: aimeat/config)
  --consul-token <token>   Consul ACL token
  -h, --help               Show this help
  -v, --version            Show version

CONFIG EXPORT OPTIONS
  --format <fmt>           Output format: env, ini, json, consul

CONFIG IMPORT OPTIONS
  --file <path>            Import from file (.env, .ini, or .json)
  --from consul            Import from Consul KV into database

QUICK START
  1. Run "aimeat init" to create a config (interactive wizard)
  2. Run "aimeat validate" to check for problems
  3. Run "aimeat start" to launch the node

MIGRATION: .env to database
  1. aimeat start --db postgres-kysely --db-url postgresql://localhost:5432/aimeat
  2. aimeat config import --file .env
  3. Manage config via admin dashboard (changes persist to database)

CONFIG SOURCES (highest priority first)
  1. CLI args (--port, --db, etc.)
  2. Database (admin dashboard changes, persistent)
  3. Consul KV (fleet management, live reload)
  4. aimeat.ini / aimeat.json (in working directory)
  5. .env file / environment variables
  6. Built-in defaults

MULTIPLE ENVIRONMENTS
  aimeat init creates .env (default) or named config files.
  Use config files to manage multiple environments on one machine:
    aimeat start --config production.json
    aimeat start --config staging.json
`;

export const CONNECT_HELP_TEXT = `
AIMEAT Agent Connector

USAGE
  aimeat connect client <goose|claude-code|cursor|vscode|claude-desktop> [options]
      Point a chat client at this node in ONE command: authorize a dedicated agent
      into its own connector home, write that client's MCP config (merging, never
      replacing what is already there), and leave a launcher that supplies the
      token at run time so it never lands in a config file.
      Options: --url --owner --agent --workdir --home --surface --name --reuse
      e.g. aimeat connect client goose --url https://aimeat.io --owner alice

      Interactive clients reach the node over its HTTP MCP endpoint (/v1/mcp).
      Claude Desktop is the exception: its config file cannot carry a remote URL,
      so it is wired through the local connector over stdio.

  aimeat connect --url <node-url> --owner <owner> [--agent <name>]
      Authenticate an AI agent with OAuth device authorization.

  aimeat connect serve [--surface <appdev|agent|service|admin>] [--http]
      Start the local MCP server for the connected agent. Configure your AI
      runtime to launch this command so it can see AIMEAT tools.
      --surface restricts the exposed tools to one purpose-scoped set (focuses
      the agent, fewer tools = less confusion). Omit for the full toolset.
      e.g. aimeat connect serve --surface agent

      --http (a.k.a. --daemon) runs a long-lived loopback daemon on 127.0.0.1
      instead of the default stdio transport. It holds ONE persistent WebSocket
      per agent to the node (forward API calls + realtime task delivery, no
      polling) and exposes a local Streamable-HTTP MCP endpoint (/v1/mcp), a
      REST proxy (/v1/*), and a long-poll push surface (/local/tasks/next),
      advertised via the discovery file <AIMEAT_HOME>/serve.json. Prefer this
      for CrewAI crews / clients that make many calls; the default stdio mode
      stays for one-shot and CI/serverless use.
      e.g. aimeat connect serve --http

  aimeat connect status
      Show the connected agent, owner, node, and token status.

  aimeat connect inbox
      Show pending agent messages.

  aimeat connect tasks
      List assigned tasks.

  aimeat connect send --body "message"
      Send an outbound message from the connected agent.

  aimeat connect docs [module]
      Print the agent handbook or one module: tasks, messages, work, services,
      memory, activity, social, collaboration, appdev, or mcp.

    aimeat connect tools [--json]
      List shell-callable AIMEAT tools for runtimes without MCP access.

    aimeat connect schema <tool-name>
      Print JSON input metadata for a shell-callable tool.

    aimeat connect call <tool-name> --json input.json
      Call a shell-callable tool using the stored connector token. Use --stdin
      to read the JSON object from standard input.

  aimeat connect refresh
      Re-download and extract the local skill bundle.

  aimeat connect logout
      Remove stored credentials for the configured agent.

  aimeat connect add [--url <node-url> --owner <owner> --agent <name>] [--mode <mode>]
      Alias for the default \`aimeat connect\` flow -- adds another agent to
      the connector so a single \`aimeat connect serve\` process can serve
      multiple agents (e.g. one Claude Code interactive agent plus several
      CrewAI task-runner agents) from one local MCP server.

      --mode <mode>   one of: autonomous | interactive | task-runner | coordinator | workstation
                      Default: interactive. Use task-runner for CrewAI crews
                      / triggered workers -- the agent gets the reduced
                      5-step Hello Integration (no commands, no test task,
                      no test message) and is treated as a subprocess
                      target. You must still add a \`runner:\` block to
                      ~/.aimeat/agents/<name>/config.yaml to wire the
                      subprocess; mode alone does not configure execution.

  aimeat connect list
      Show every agent registered with the connector, including their mode
      (interactive vs task-runner) and which one is marked as primary.

  aimeat connect remove <agent-name> [--owner <owner>]
      Remove an agent's stored token and per-agent config. \`--owner\` is only
      needed if the same agent name exists under multiple owners.

SURFACES (--surface <role>)
  A surface is a purpose-scoped tool set. Pick the one that matches what this
  agent is for — fewer, focused tools = less confusion, less context, fewer
  mistakes. The same surfaces are served remotely at <node>/v2/mcp/<role>.

    agent    The owner's personal agent (DEFAULT choice for most setups).
             Memory, tasks, messages, knowledge, discovery, board reading.
    appdev   Build & publish apps, extensions, and cortex for the node
             (e.g. an MCP in VSCode). Storage + component tools only.
    service  Provide a service / do marketplace: boards, work queue, wallet,
             capabilities, organisms.
    admin    Operator/owner governance: node admin, moderation, sharing
             groups, consent, agent mode/tags.

  Omit --surface for the full toolset (everything). Each surface has its own
  handbook — call aimeat_handbook_get with surface:"<role>" (or GET
  <node>/v1/agents/me/handbook/surface/<role>) to read how to operate it.
  e.g.  aimeat connect serve --surface agent

EXAMPLES
  aimeat connect --url http://localhost:40050 --owner happyadmin --agent hermes
  aimeat connect serve --surface agent
  aimeat connect add --agent marketing-crew --mode task-runner --url http://localhost:40050 --owner happyadmin
  aimeat connect list
  aimeat connect serve
  aimeat connect docs tasks
  aimeat connect call aimeat_onboarding_status

NOTES
  MCP tool names such as aimeat_handbook_get are not terminal commands. They
  appear inside an AI runtime after it attaches to \`aimeat connect serve\`.

  Multi-agent: \`aimeat connect serve\` loads every token in ~/.aimeat/tokens/
  and exposes one MCP surface for all of them. In multi-agent mode, MCP tool
  calls accept an optional \`agent_name\` parameter; when omitted, the agent
  marked \`primary: true\` in its per-agent config (~/.aimeat/agents/{name}/
  config.yaml) is used. The first agent connected is marked primary by default.

  Task runner: add a \`runner:\` block to a per-agent config to turn that agent
  into a subprocess runner. When a task arrives for it, the connector launches
  the configured executable with the task prompt provided via env vars and
  posts whatever the subprocess prints (or writes to a file) as the task
  completion summary. See docs/integrations/crewai.md for the full pattern.
`;
