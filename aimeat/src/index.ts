#!/usr/bin/env node
/**
 * @file index.ts
 * @description Main AIMEAT CLI entry point, including node management commands and agent connector dispatch.
 * @structure Parses top-level CLI flags, routes subcommands, starts the server, and delegates connector commands.
 * @usage Executed through the published `aimeat` binary.
 * @version-history v1.9.4 — 2026-05-28 — Allow agent connector flags and drain async auth handles before exit.
 * @version-history v1.9.5 — 2026-05-28 — Drain async handles before exiting one-shot connector commands on Windows.
 * @version-history v1.9.6 — 2026-05-28 — Print extracted skill bundle guidance after refresh.
 * @version-history v1.9.7 — 2026-05-28 — Add connector-specific help and prevent `aimeat connect help` from starting auth.
 * @version-history v1.9.8 — 2026-05-28 — Add connector CLI tools/schema/call fallback commands.
 * @version-history v1.9.9 — 2026-05-28 — Allow connector fallback flags through top-level parsing.
 * @version-history v1.9.10 — 2026-05-28 — Narrow permissive parseArgs values before applying node CLI string flags.
 */
import { parseArgs } from 'node:util';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { createServer } from './server.js';
import { loadConfig } from './config.js';
import { logger } from './utils/logger.js';

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', {
    reason: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  });
});

const { values, positionals } = parseArgs({
  allowPositionals: true,
  // Connector subcommands parse their own flags so tool input flags can evolve without touching the node CLI parser.
  strict: false,
  options: {
    port: { type: 'string', short: 'p' },
    db: { type: 'string' },
    'db-url': { type: 'string' },
    'db-path': { type: 'string' },
    'node-id': { type: 'string' },
    'admin-password': { type: 'string' },
    config: { type: 'string', short: 'c' },
    consul: { type: 'string' },
    'consul-prefix': { type: 'string' },
    'consul-token': { type: 'string' },
    format: { type: 'string' },
    file: { type: 'string' },
    from: { type: 'string' },
    url: { type: 'string' },
    owner: { type: 'string' },
    agent: { type: 'string' },
    to: { type: 'string' },
    body: { type: 'string' },
    help: { type: 'boolean', short: 'h' },
    version: { type: 'boolean', short: 'v' },
  },
});

function stringFlag(value: string | boolean | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

const HELP_TEXT = `
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
  aimeat backup  [FILE]          Export all data to JSON
  aimeat restore <FILE>          Import data from JSON backup

START OPTIONS
  --db <type>              Storage type: mongodb, postgresql, sqlite, memory
  --db-url <url>           Database connection URL (MongoDB)
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
  1. aimeat start --db mongodb --db-url mongodb://localhost:27017/aimeat
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

const CONNECT_HELP_TEXT = `
AIMEAT Agent Connector

USAGE
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

if (values.help) {
  console.log(positionals[0] === 'connect' ? CONNECT_HELP_TEXT : HELP_TEXT);
  process.exit(0);
}

// Package root: from dist/src/index.js -> go up 2 levels to aimeat/
const __pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

if (values.version) {
  try {
    const pkg = JSON.parse(readFileSync(join(__pkgRoot, 'package.json'), 'utf-8'));
    console.log(`aimeat v${pkg.version}`);
  } catch {
    console.log('aimeat (version unknown)');
  }
  process.exit(0);
}

// Load .env into process.env if not already loaded by bin/aimeat.ts.
// Search: CWD first, then package root (aimeat/ directory).
const envPath = existsSync('.env') ? '.env'
  : existsSync(join(__pkgRoot, '.env')) ? join(__pkgRoot, '.env')
    : null;

if (envPath) {
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    // Handle quoted values: extract content between first pair of quotes
    if (val.startsWith('"')) {
      const closeIdx = val.indexOf('"', 1);
      val = closeIdx > 0 ? val.slice(1, closeIdx) : val.slice(1);
    } else if (val.startsWith("'")) {
      const closeIdx = val.indexOf("'", 1);
      val = closeIdx > 0 ? val.slice(1, closeIdx) : val.slice(1);
    } else {
      // Unquoted: strip inline comments
      const hashIdx = val.indexOf('#');
      if (hashIdx >= 0) val = val.slice(0, hashIdx).trim();
    }
    if (!(key in process.env)) {
      process.env[key] = val;
    }
  }
}

// Build CLI overrides from flags (dot-path keyed for unified config)
const cliOverrides: Record<string, string> = {};
const portFlag = stringFlag(values.port);
const dbFlag = stringFlag(values.db);
const dbUrlFlag = stringFlag(values['db-url']);
const dbPathFlag = stringFlag(values['db-path']);
const nodeIdFlag = stringFlag(values['node-id']);
const adminPasswordFlag = stringFlag(values['admin-password']);
const consulFlag = stringFlag(values.consul);
const consulPrefixFlag = stringFlag(values['consul-prefix']);
const consulTokenFlag = stringFlag(values['consul-token']);

if (portFlag) cliOverrides['node.port'] = portFlag;
if (dbFlag) cliOverrides['storage.type'] = dbFlag;
if (dbUrlFlag) cliOverrides['database_url'] = dbUrlFlag;
if (dbPathFlag) cliOverrides['sqlite_path'] = dbPathFlag;
if (nodeIdFlag) cliOverrides['node.id'] = nodeIdFlag;
if (adminPasswordFlag) cliOverrides['admin_password'] = adminPasswordFlag;
if (consulFlag) {
  cliOverrides['consul.enabled'] = 'true';
  cliOverrides['consul.url'] = consulFlag;
}
if (consulPrefixFlag) cliOverrides['consul.prefix'] = consulPrefixFlag;
if (consulTokenFlag) cliOverrides['consul.token'] = consulTokenFlag;

const { config, envKeys, fileKeys, cliKeys, fileName } = loadConfig({
  configPath: stringFlag(values.config),
  cliOverrides: Object.keys(cliOverrides).length > 0 ? cliOverrides : undefined,
});
const subcommand = positionals[0];

// Handle subcommands
if (subcommand === 'config') {
  const configAction = positionals[1]; // export | import | undefined (show)

  if (configAction === 'export') {
    const format = (values.format as string) || 'env';
    if (!['env', 'ini', 'json', 'consul'].includes(format)) {
      console.error(`Unknown export format: ${format}. Use: env, ini, json, consul`);
      process.exit(1);
    }
    const { runConfigExport } = await import('./cli/config-export.js');
    await runConfigExport(config, format as 'env' | 'ini' | 'json' | 'consul');
    process.exit(0);
  }

  if (configAction === 'import') {
    const { runConfigImport } = await import('./cli/config-import.js');
    await runConfigImport(config, {
      file: values.file as string | undefined,
      from: values.from as string | undefined,
    });
    process.exit(0);
  }

  // Default: show config
  const { formatConfig } = await import('./utils/env-config.js');
  const { ConfigProvenance } = await import('./services/config-provenance.js');
  const { ALL_CONFIG_MAP } = await import('./services/config-schema.js');
  const prov = new ConfigProvenance();
  prov.initDefaults(Object.keys(ALL_CONFIG_MAP));
  if (envKeys.length > 0) prov.markEnv(envKeys);
  if (fileKeys.length > 0) prov.markFile(fileKeys);
  if (cliKeys.length > 0) prov.markEnv(cliKeys); // CLI overrides show as 'env' in display
  console.log(formatConfig(config, prov));
  process.exit(0);
} else if (subcommand === 'init') {
  const { runInitWizard } = await import('./cli/init-wizard.js');
  await runInitWizard(config);
  process.exit(0);
} else if (subcommand === 'update') {
  const { scaffoldFiles: doScaffold, findPackageRoot } = await import('./cli/scaffold.js');
  const pkgRoot = findPackageRoot(dirname(fileURLToPath(import.meta.url)));
  if (!pkgRoot) {
    console.error('Could not locate package assets. Is aimeat installed correctly?');
    process.exit(1);
  }
  const pkgJsonPath = join(pkgRoot, 'package.json');
  const pkgVersion = existsSync(pkgJsonPath)
    ? JSON.parse(readFileSync(pkgJsonPath, 'utf-8')).version as string
    : '0.0.0';
  const result = doScaffold(pkgRoot, process.cwd(), pkgVersion);
  console.log(`Assets updated: ${result.copied} new, ${result.updated} updated, ${result.skippedModified} skipped (user-modified)`);
  for (const file of result.modifiedFiles) {
    console.log(`  Skipped (modified): ${file}`);
  }
  if (result.skippedUnchanged > 0) {
    console.log(`  ${result.skippedUnchanged} files unchanged`);
  }
  process.exit(0);
} else if (subcommand === 'validate' || subcommand === 'check') {
  const { validateEnv, formatValidationResults } = await import('./utils/env-validator.js');
  const results = validateEnv();
  console.log(formatValidationResults(results));
  const hasErrors = results.some(r => r.level === 'error');
  process.exit(hasErrors ? 1 : 0);
} else if (subcommand === 'join') {
  const { runFederationJoin } = await import('./cli/federation-join.js');
  await runFederationJoin(config, positionals[1] ?? config.genesisUrl ?? undefined);
  process.exit(0);
} else if (subcommand === 'maintenance') {
  const action = positionals[1]; // on | off | undefined (show status)
  const { createStorage } = await import('./storage/storage-factory.js');
  const storage = await createStorage({
    provider: config.storageProvider,
    sqlitePath: config.sqlitePath,
    dbUrl: config.dbUrl ?? undefined,
  });

  if (action === 'on') {
    const message = positionals.slice(2).join(' ') || 'Maintenance';
    await storage.setMaintenanceMode({
      enabled: true,
      message,
      enabledAt: new Date().toISOString(),
      enabledBy: 'cli',
    });
    console.log(`Maintenance mode ON: "${message}"`);
  } else if (action === 'off') {
    await storage.setMaintenanceMode({
      enabled: false,
      message: '',
      enabledAt: null,
      enabledBy: null,
    });
    console.log('Maintenance mode OFF');
  } else {
    const state = await storage.getMaintenanceMode();
    if (state?.enabled) {
      console.log('Maintenance mode: ON');
      console.log(`  Message:    ${state.message || '(none)'}`);
      console.log(`  Enabled at: ${state.enabledAt ?? 'unknown'}`);
      console.log(`  Enabled by: ${state.enabledBy ?? 'unknown'}`);
    } else {
      console.log('Maintenance mode: OFF');
    }
  }
  process.exit(0);
} else if (subcommand === 'backup') {
  const outArg = positionals[1] ?? 'aimeat-backup.json';
  const { app } = await createServer(config);
  // Start server temporarily to access storage
  const server = app.listen(0, async () => {
    try {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      const resp = await fetch(`http://localhost:${port}/v1/admin/backup`, {
        headers: config.adminPassword
          ? { Authorization: `Bearer operator:${config.adminPassword}` }
          : {},
      });
      const data = await resp.json();
      writeFileSync(outArg, JSON.stringify(data, null, 2));
      logger.info(`Backup written to ${outArg}`);
    } catch (err) {
      logger.error('Backup failed', { error: err });
    } finally {
      server.close();
    }
  });
} else if (subcommand === 'restore') {
  const fromArg = positionals[1];
  if (!fromArg) {
    console.error('Usage: aimeat restore <file.json>');
    process.exit(1);
  }
  const { app } = await createServer(config);
  const server = app.listen(0, async () => {
    try {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      const body = readFileSync(fromArg, 'utf-8');
      const parsed = JSON.parse(body);
      const payload = parsed.data ?? parsed; // handle envelope or raw
      const resp = await fetch(`http://localhost:${port}/v1/admin/restore`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(config.adminPassword
            ? { Authorization: `Bearer operator:${config.adminPassword}` }
            : {}),
        },
        body: JSON.stringify(payload),
      });
      const result = await resp.json();
      logger.info('Restore complete', result);
    } catch (err) {
      logger.error('Restore failed', { error: err });
    } finally {
      server.close();
    }
  });
} else if (subcommand === 'connect') {
  const connectAction = positionals[1];
  let shouldExitAfterConnect = true;
  const connectExitDelayMs = 250;
  // Parse connector flags from raw argv. Boolean flags are stored as "true".
  const rawArgs = process.argv.slice(2);
  const connectFlags: Record<string, string> = {};
  for (let i = 0; i < rawArgs.length; i++) {
    if (rawArgs[i].startsWith('--')) {
      if (rawArgs[i + 1] && !rawArgs[i + 1].startsWith('--')) {
        connectFlags[rawArgs[i].slice(2)] = rawArgs[++i];
      } else {
        connectFlags[rawArgs[i].slice(2)] = 'true';
      }
    }
  }

  if (connectAction === 'help') {
    console.log(CONNECT_HELP_TEXT);
  } else if (connectAction === 'serve') {
    const { runServe } = await import('./cli/connect/mcp/server.js');
    await runServe(connectFlags);
    shouldExitAfterConnect = false;
  } else if (connectAction === 'inbox') {
    const { runInbox } = await import('./cli/connect/inbox.js');
    await runInbox();
  } else if (connectAction === 'tasks') {
    const { runTasks } = await import('./cli/connect/tasks.js');
    await runTasks();
  } else if (connectAction === 'send') {
    const { runSend } = await import('./cli/connect/send.js');
    await runSend(connectFlags);
  } else if (connectAction === 'status' || connectAction === 'whoami') {
    const { runStatus } = await import('./cli/connect/status.js');
    await runStatus();
  } else if (connectAction === 'docs') {
    const { runDocs } = await import('./cli/connect/docs.js');
    await runDocs(positionals[2]);
  } else if (connectAction === 'tools') {
    const { runToolList } = await import('./cli/connect/tool-call.js');
    runToolList(connectFlags);
  } else if (connectAction === 'schema') {
    const { runToolSchema } = await import('./cli/connect/tool-call.js');
    runToolSchema(positionals[2]);
  } else if (connectAction === 'call') {
    const { runToolCall } = await import('./cli/connect/tool-call.js');
    await runToolCall(positionals[2], connectFlags);
  } else if (connectAction === 'refresh') {
    const { AimeatClient } = await import('./cli/connect/api-client.js');
    const { downloadSkillBundle, readSkillBundleGuide } = await import('./cli/connect/skill-bundle.js');
    const { loadConfig, loadAgentByName } = await import('./cli/connect/config.js');
    // Per-agent refresh: if --agent is given, refresh THAT agent's bundle using
    // that agent's token + node URL. Without --agent, fall back to the global
    // primary config (single-agent installs work unchanged). The previous
    // behaviour silently routed every `refresh --agent X` through the primary,
    // so multi-agent installs never got per-agent bundle updates.
    let bundleAgent: string;
    let cl: InstanceType<typeof AimeatClient>;
    if (connectFlags.agent) {
      const loaded = await loadAgentByName(connectFlags.agent, connectFlags.owner || undefined);
      if (!loaded) {
        console.error(`Agent "${connectFlags.agent}" not found in connector. Run: aimeat connect list`);
        process.exit(1);
      }
      bundleAgent = loaded.agent;
      cl = new AimeatClient(loaded.config.node_url, loaded.token);
    } else {
      const cfg = loadConfig();
      if (!cfg) { console.error('Not configured. Run: npx aimeat connect'); process.exit(1); }
      bundleAgent = cfg.agent;
      cl = await AimeatClient.fromConfig();
    }
    try {
      const bundle = await downloadSkillBundle(cl, bundleAgent);
      console.log(`Skill bundle for ${bundleAgent} downloaded and extracted to ${bundle.bundleDir}/`);
      console.log(`Main skill file: ${bundle.skillPath}`);
      console.log('');
      console.log(readSkillBundleGuide(bundle));
    } catch (e) {
      console.error((e as Error).message);
      process.exit(1);
    }
  } else if (connectAction === 'logout') {
    const { deleteToken } = await import('./cli/connect/keychain.js');
    const { loadConfig } = await import('./cli/connect/config.js');
    const cfg = loadConfig();
    if (cfg) { await deleteToken(cfg.agent, cfg.owner); console.log('Credentials removed.'); }
    else console.log('Not configured.');
  } else if (connectAction === 'config') {
    const { loadConfig, getConfigDir } = await import('./cli/connect/config.js');
    const c = loadConfig();
    if (c) console.log(JSON.stringify(c, null, 2));
    else console.log(`No config found. Expected at: ${getConfigDir()}/config.yaml`);
  } else if (connectAction === 'list') {
    const { listAllTokens } = await import('./cli/connect/keychain.js');
    const { loadPerAgentConfig } = await import('./cli/connect/config.js');
    const tokens = await listAllTokens();
    if (tokens.length === 0) { console.log('No agents connected. Run: aimeat connect'); }
    else {
      console.log(`Connected agents (${tokens.length}):`);
      for (const t of tokens) {
        const pa = loadPerAgentConfig(t.agent);
        // Server-side mode (what AIMEAT thinks this agent is) -- written by
        // `connect add --mode <mode>`. Falls back to deriving from runner block
        // for agents registered before the mode field existed.
        const mode = pa?.mode ?? (pa?.runner?.command ? 'task-runner' : 'interactive');
        // Runner readiness: task-runner mode alone is not enough; the connector
        // needs a `runner:` block to actually spawn the subprocess.
        const runnerReady = Boolean(pa?.runner?.command);
        const needsRunner = mode === 'task-runner' && !runnerReady;
        const primary = pa?.primary ? ' (primary)' : '';
        const nodeUrl = pa?.node_url ?? '(no per-agent config)';
        const warn = needsRunner ? '  [missing runner: block]' : '';
        console.log(`  - ${t.agent}@${t.owner} [${mode}]${primary}${warn}  ->  ${nodeUrl}`);
        if (pa?.runner) console.log(`      runner: ${pa.runner.command} ${(pa.runner.args ?? []).join(' ')}`);
      }
    }
  } else if (connectAction === 'remove') {
    const target = positionals[2];
    if (!target) {
      console.error('Usage: aimeat connect remove <agent-name> [--owner <owner>]');
      process.exit(1);
    }
    const ownerHint = connectFlags.owner;
    const { listAllTokens, deleteToken } = await import('./cli/connect/keychain.js');
    const { perAgentConfigPath } = await import('./cli/connect/config.js');
    const fs = await import('node:fs');
    const path = await import('node:path');
    const tokens = await listAllTokens();
    const matches = tokens.filter(t => t.agent === target && (!ownerHint || t.owner === ownerHint));
    if (matches.length === 0) { console.error(`Agent '${target}' not found.`); process.exit(1); }
    if (matches.length > 1) {
      console.error(`Multiple agents named '${target}' found under different owners. Re-run with --owner to disambiguate:`);
      for (const m of matches) console.error(`  - owner: ${m.owner}`);
      process.exit(1);
    }
    const m = matches[0];
    await deleteToken(m.agent, m.owner);
    // Remove per-agent config directory (best-effort)
    try {
      const dir = path.dirname(perAgentConfigPath(m.agent));
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    } catch { /* ignore */ }
    console.log(`Removed ${m.agent}@${m.owner}.`);
  } else if (connectAction === 'add') {
    // Alias for the default `aimeat connect` flow -- explicit subcommand for clarity in docs.
    const { runAuth } = await import('./cli/connect/auth.js');
    await runAuth({
      url: connectFlags.url,
      owner: connectFlags.owner,
      agent: connectFlags.agent,
      mode: connectFlags.mode,
    });
  } else {
    // Default: run auth
    const { runAuth } = await import('./cli/connect/auth.js');
    await runAuth({
      url: connectFlags.url,
      owner: connectFlags.owner,
      agent: connectFlags.agent,
      mode: connectFlags.mode,
    });
  }
  if (shouldExitAfterConnect) {
    if (connectExitDelayMs > 0) await new Promise(resolve => setTimeout(resolve, connectExitDelayMs));
    process.exit(process.exitCode ?? 0);
  }
} else if (subcommand === 'seed') {
  const baseUrl = `http://localhost:${config.port}`;
  const adminPw = config.adminPassword ?? '';
  console.log('\n=== AIMEAT Example Package Seeder ===\n');
  console.log(`  Server: ${baseUrl}`);
  try {
    const probe = await fetch(`${baseUrl}/v1/health`);
    if (!probe.ok) throw new Error(`HTTP ${probe.status}`);
  } catch {
    console.error(`\n  Server not reachable at ${baseUrl}`);
    console.error('  Start the server first: aimeat start\n');
    process.exit(1);
  }
  if (!adminPw) {
    console.error('\n  AIMEAT_ADMIN_PASSWORD not found in .env or environment.\n');
    process.exit(1);
  }
  console.log('  Seeding example packages via admin API...\n');
  const seedResp = await fetch(`${baseUrl}/v1/admin/seed-examples`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-password': adminPw },
  });
  const seedData = await seedResp.json() as { ok: boolean; data?: { seeded?: Array<{ name: string; templateId: string; packageGroupId: string }> }; error?: { message?: string } };
  if (!seedData.ok) {
    console.error(`  Failed: ${seedData.error?.message ?? JSON.stringify(seedData)}`);
    process.exit(1);
  }
  for (const pkg of seedData.data?.seeded ?? []) {
    const status = pkg.templateId === '(already exists)' ? 'already exists' : 'created';
    console.log(`  ${status === 'created' ? '+' : '='} ${pkg.name} (${status})`);
  }
  console.log('\n  Done!\n');
  process.exit(0);
} else if (subcommand === 'start' || subcommand === 'serve') {
  // Start the server
  // Auto-generate admin password if not set
  if (!config.adminPassword) {
    config.adminPassword = randomBytes(16).toString('base64url');
  }
  const { app, tunnelManager, connectTunnelManager, realtimeManager, storage } = await createServer(config, { envKeys, fileKeys, cliKeys, fileName });
  const server = app.listen(config.port, () => {
    // ── Node type banner ──
    const bannerLabel =
      config.federationRole === 'operator' ? 'GENESIS-OPERATOR NODE' :
        config.federationRole === 'contributor' ? 'FEDERATION NODE' :
          config.nodeType === 'personal' ? 'PRIVATE NODE' :
            config.devMode ? 'DEV NODE' :
              'STANDALONE NODE';
    const pad = 4;
    const inner = bannerLabel.length + pad * 2;
    const line = '─'.repeat(inner + 2);
    logger.info('');
    logger.info(`   ┌${line}┐`);
    logger.info(`   │${' '.repeat(pad)}${bannerLabel}${' '.repeat(pad)}│`);
    logger.info(`   └${line}┘`);
    logger.info('');

    logger.info(`   ❤️  AIMEAT node started`);
    logger.info(`   Node ID:   ${config.nodeId}`);
    logger.info(`   Port:      ${config.port}`);
    logger.info(`   Storage:   ${config.storageProvider}${config.storageProvider === 'sqlite' ? ` (${config.sqlitePath})` : ''}`);
    logger.info(`   URL:       ${config.baseUrl}/`);
    logger.info(`   Protocol:  AIMEAT v1.3 | License: MIT`);
    if (config.devMode) {
      logger.info(`   ⚠ DEV MODE: OTK validation bypassed on micro-memory`);
    }
    if (config.anonymousMode) {
      logger.info(`   ⚠ ANONYMOUS MODE: No auth required — all agents share one memory space`);
      logger.info(`   Anonymous prompt: ${config.baseUrl}/v1/prompts/anonymous`);
      logger.info(`   Share with others: ${config.baseUrl}/v1/prompts/anonymous/share?format=text`);
    }
    if (tunnelManager) {
      logger.info(`   🔌 Personal Node tunnel: ws://localhost:${config.port}/v1/personal/tunnel`);
    }
    if (realtimeManager) {
      logger.info(`   📡 Realtime P2P rooms: ws://localhost:${config.port}/v1/realtime/ws`);
    }
    if (connectTunnelManager) {
      logger.info(`   🔗 Connector forward tunnel: ws://localhost:${config.port}/v1/connect/tunnel`);
    }
    logger.info(``);
    logger.info(`   Admin Setup: ${config.baseUrl}/v1/admin/setup`);
    if (!process.env.AIMEAT_ADMIN_PASSWORD) {
      process.stderr.write(`   Admin Secret: ${config.adminPassword}\n`);
    }
    logger.info(`──────────────────────────────────────────────────────────`);

    // Security warnings
    if (config.totpEnabled && !config.totpSecretEncryptionKey) {
      logger.warn('SECURITY: TOTP is enabled but AIMEAT_TOTP_ENCRYPTION_KEY is not set. TOTP secrets are stored in plaintext.');
    }
    if (config.devMode) {
      const looksProduction = config.storageProvider !== 'memory' ||
        (config.baseUrl && !config.baseUrl.includes('localhost') && !config.baseUrl.includes('127.0.0.1'));
      if (looksProduction) {
        logger.warn('SECURITY: Dev mode is ON with non-local configuration. Dev mode allows account wipe on duplicate registration.');
      }
    }
    if (process.platform === 'win32' && !process.env.AIMEAT_KEY_PASSPHRASE) {
      logger.warn('SECURITY: Node key is stored unencrypted. Windows does not enforce Unix file permissions. Set AIMEAT_KEY_PASSPHRASE to encrypt.');
    }

    // Log active service extensions and their instances
    storage.listExtensions().then(async (extensions) => {
      const active = extensions.filter(e => e.status === 'active');
      if (active.length === 0) return;

      logger.info('');
      for (const ext of active) {
        const instances = ext.instances?.supported
          ? await storage.listExtensionInstances(ext.name).catch(() => [])
          : [];
        const activeInstances = instances.filter(i => i.status === 'active');
        const actionIds = ext.actions.map(a => a.id).join(', ');

        logger.info(`   ────────────────────────────────────────────────────`);
        logger.info(`   Extension: ${ext.name} v${ext.version} [active]`);
        logger.info(`   Actions:   ${actionIds}`);
        if (ext.instances?.supported) {
          logger.info(`   Instances:  ${activeInstances.length} active / ${instances.length} total`);
          for (const inst of activeInstances) {
            const vis = (inst.config as Record<string, unknown>)?.visibility || 'public';
            logger.info(`     - ${inst.id} (${vis})`);
          }
        }
      }
      logger.info(`   ────────────────────────────────────────────────────`);
      logger.info('');
    }).catch(() => { /* ignore */ });

    // Check and display maintenance mode warning
    storage.getMaintenanceMode().then(state => {
      if (state?.enabled) {
        logger.info('');
        logger.info(`   ┌──────────────────────────────────────────────────────┐`);
        logger.info(`   │  🚧 MAINTENANCE MODE IS ON                          │`);
        logger.info(`   │  Message: ${(state.message || '(none)').padEnd(41)}│`);
        logger.info(`   │  Since:   ${(state.enabledAt ?? 'unknown').padEnd(41)}│`);
        logger.info(`   │                                                      │`);
        logger.info(`   │  Run "aimeat maintenance off" to disable             │`);
        logger.info(`   └──────────────────────────────────────────────────────┘`);
        logger.info('');
      }
    }).catch(() => { /* ignore */ });
  });

  // WebSocket upgrade handling for personal node tunnels + realtime P2P + connector forward tunnel
  if (tunnelManager || realtimeManager || connectTunnelManager) {
    const { WebSocketServer } = await import('ws');
    const { verifyJWT } = await import('./auth/jwt.js');
    const { isAnonymousMode } = await import('./auth/middleware.js');
    const { CONNECT_TUNNEL_PATH } = await import('./services/connect-tunnel.js');
    const tunnelWss = tunnelManager ? new WebSocketServer({ noServer: true }) : null;
    const realtimeWss = realtimeManager ? new WebSocketServer({ noServer: true }) : null;
    // Cap forward-tunnel frame size (ws defaults to 100 MiB). An authenticated
    // agent could otherwise buffer huge frames in memory (cheap DoS). Sized a
    // little above the largest JSON body the routes accept; bulk uploads use
    // presigned URLs, not the tunnel.
    const connectMaxPayload = (config.jsonBodyLimitLargeMb + 1) * 1024 * 1024;
    const connectWss = connectTunnelManager ? new WebSocketServer({ noServer: true, maxPayload: connectMaxPayload }) : null;

    // Echat anonymous connection rate limiter (10 connections per IP per minute)
    const echatIpCounts = new Map<string, { count: number; resetAt: number }>();
    function echatRateCheck(ip: string): boolean {
      const now = Date.now();
      const entry = echatIpCounts.get(ip);
      if (!entry || now > entry.resetAt) {
        echatIpCounts.set(ip, { count: 1, resetAt: now + 60_000 });
        return true;
      }
      if (entry.count >= 10) return false;
      entry.count++;
      return true;
    }

    server.on('upgrade', async (request, socket, head) => {
      const url = new URL(request.url ?? '', `http://${request.headers.host}`);

      // ── Personal tunnel upgrade ──
      if (url.pathname === '/v1/personal/tunnel' && tunnelManager && tunnelWss) {
        const authHeader = request.headers.authorization;
        const tokenParam = url.searchParams.get('token');
        const token = authHeader?.startsWith('Bearer ')
          ? authHeader.slice(7)
          : tokenParam;

        if (!token) {
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }

        try {
          const payload = await verifyJWT(token);
          if (!payload || !payload.sub) {
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
            socket.destroy();
            return;
          }

          const ownerName = (payload.owner as string) ?? '';
          const personalNode = await storage.getPersonalNodeByOwner(ownerName);
          if (!personalNode) {
            socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
            socket.destroy();
            return;
          }

          tunnelWss.handleUpgrade(request, socket, head, (ws) => {
            tunnelManager.handleConnection(ws, personalNode.nodeId, ownerName, personalNode.agentGaiis);
          });
        } catch {
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
        }
        return;
      }

      // ── Connector forward tunnel upgrade ──
      // Agent JWT (roles include 'agent') validated here; identity pinned to the
      // socket and the same raw token reused as the forward bearer. Express
      // middleware can't run on the raw upgrade, so verify manually like the
      // personal tunnel above.
      if (url.pathname === CONNECT_TUNNEL_PATH && connectTunnelManager && connectWss) {
        const authHeader = request.headers.authorization;
        const token = authHeader?.startsWith('Bearer ')
          ? authHeader.slice(7)
          : url.searchParams.get('token');

        if (!token) {
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }

        try {
          const payload = await verifyJWT(token);
          if (!payload || !payload.sub) {
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
            socket.destroy();
            return;
          }
          // Only scoped external principals (agent OR ecosystem app) may hold a forward tunnel.
          // Owner/operator sessions bypass scopes and are not the connector's transport. The
          // tunnel manager keys by identity.sub, so a GEAI tunnel needs no further change.
          if (!payload.roles?.includes('agent') && !payload.roles?.includes('ecosystem')) {
            socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
            socket.destroy();
            return;
          }

          connectWss.handleUpgrade(request, socket, head, (ws) => {
            connectTunnelManager.handleConnection(ws, payload, token);
          });
        } catch {
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
        }
        return;
      }

      // ── Realtime P2P upgrade ──
      if (url.pathname === '/v1/realtime/ws' && realtimeManager && realtimeWss) {
        // ── Echat anonymous connection ──
        const isEchat = url.searchParams.get('echat') === '1';
        if (isEchat) {
          const roomName = url.searchParams.get('room');
          if (!roomName) {
            socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
            socket.destroy();
            return;
          }
          if (!config.echatAnonymous) {
            socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
            socket.destroy();
            return;
          }
          // Rate limit anonymous echat connections per IP
          const clientIp = request.socket.remoteAddress ?? 'unknown';
          if (!echatRateCheck(clientIp)) {
            socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n');
            socket.destroy();
            return;
          }
          try {
            const room = await realtimeManager.getOrCreateRoomByName(
              roomName,
              'echat-anonymous',
            );
            const anonNick = 'anon-' + Math.random().toString(16).slice(2, 6);
            realtimeWss.handleUpgrade(request, socket, head, (ws) => {
              realtimeManager.handleUpgrade(ws, room.id, anonNick);
            });
          } catch (err: unknown) {
            if (err instanceof Error && err.message === 'ROOM_LIMIT_REACHED') {
              socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n');
            } else if (err instanceof Error && err.message === 'INVALID_ROOM_NAME') {
              socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
            } else {
              socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
            }
            socket.destroy();
          }
          return;
        }

        const roomId = url.searchParams.get('room');
        const nick = url.searchParams.get('nick') ?? 'anonymous';

        if (!roomId) {
          socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
          socket.destroy();
          return;
        }

        // Authenticate: JWT from ?token= or Authorization header
        const authHeader = request.headers.authorization;
        const tokenParam = url.searchParams.get('token');
        const token = authHeader?.startsWith('Bearer ')
          ? authHeader.slice(7)
          : tokenParam;

        if (!token) {
          // Allow anonymous mode without token for realtime WS
          if (isAnonymousMode()) {
            const room = realtimeManager.getRoom(roomId);
            if (!room) {
              socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
              socket.destroy();
              return;
            }
            realtimeWss.handleUpgrade(request, socket, head, (ws) => {
              realtimeManager.handleUpgrade(ws, roomId, nick);
            });
            return;
          }
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }

        try {
          const payload = await verifyJWT(token);
          if (!payload || !payload.sub) {
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
            socket.destroy();
            return;
          }

          // Verify room exists
          const room = realtimeManager.getRoom(roomId);
          if (!room) {
            socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
            socket.destroy();
            return;
          }

          realtimeWss.handleUpgrade(request, socket, head, (ws) => {
            realtimeManager.handleUpgrade(ws, roomId, nick);
          });
        } catch {
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
        }
        return;
      }

      // Unknown WebSocket path
      socket.destroy();
    });

    if (tunnelManager) logger.info('WebSocket upgrade handler registered for /v1/personal/tunnel');
    if (realtimeManager) logger.info('WebSocket upgrade handler registered for /v1/realtime/ws');
    if (connectTunnelManager) logger.info('WebSocket upgrade handler registered for /v1/connect/tunnel');
  }

  // Graceful shutdown handler -- flush stats and close connections
  const { getStats: getStatsInstance } = await import('./services/stats.js');
  const handleShutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down...`);
    const statsInstance = getStatsInstance();
    if (statsInstance) await statsInstance.shutdown();
    if (tunnelManager) await tunnelManager.shutdown();
    if (connectTunnelManager) await connectTunnelManager.shutdown();
    if (realtimeManager) await realtimeManager.shutdown();
    server.close(() => {
      logger.info('Server closed');
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 5000);
  };
  process.on('SIGTERM', () => void handleShutdown('SIGTERM'));
  process.on('SIGINT', () => void handleShutdown('SIGINT'));
} else if (subcommand) {
  console.error(`Unknown command: ${subcommand}\n`);
  console.log(HELP_TEXT);
  process.exit(1);
} else {
  // No subcommand — show help
  console.log(HELP_TEXT);
  process.exit(0);
}
