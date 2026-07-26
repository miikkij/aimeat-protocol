/**
 * @file config.ts
 * @description Configuration for the AIMEAT connector. Two layers:
 *
 *   - **Global** at `~/.aimeat/config.yaml` -- shared defaults (default node URL,
 *     poll interval). Also kept for backwards compatibility with the original
 *     single-agent layout (its `agent`/`owner` fields point at the primary agent).
 *
 *   - **Per-agent** at `~/.aimeat/agents/{agent}/config.yaml` -- one file per
 *     connected agent. Contains the agent's identity (agent, owner, node_url),
 *     optional wake adapter (command/webhook to fire on new work), and optional
 *     `runner` block that turns the agent into a task-runner: when a task
 *     arrives the connector launches the configured subprocess instead of (or
 *     in addition to) firing the wake adapter.
 *
 * @structure
 *   - `loadConfig()` / `saveConfig()` -- legacy single-agent global file
 *   - `loadPerAgentConfig()` / `savePerAgentConfig()` -- new per-agent file
 *   - `loadAllAgents()` -- iterate every stored token and load its per-agent
 *     config (or synthesize one from the global config for legacy installs)
 *
 * @version-history
 *   v1.0.0 -- original single-agent config
 *   v1.1.0 -- 2026-05-28 -- Security warning on wake.command (executes via exec)
 *   v2.0.0 -- 2026-05-29 -- Per-agent config layout + runner block + loadAllAgents
 *   v2.1.0 -- 2026-06-10 -- AIMEAT_HOME env override for the connector home dir
 *   v2.2.0 -- 2026-06-17 -- Default home is now <cwd>/.aimeat (directory-scoped)
 *                           instead of the global ~/.aimeat, so two projects on
 *                           one machine get independent daemons / tokens /
 *                           serve.json instead of colliding. AIMEAT_HOME still
 *                           overrides; set it to ~/.aimeat for the old global mode.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';
import { listAllTokens } from './keychain.js';
import { logger } from '../../utils/logger.js';

// Connector home resolution (directory-scoped):
//   1. AIMEAT_HOME env var — explicit override, always wins.
//   2. else <cwd>/.aimeat — the directory the `aimeat` command was launched
//      from. This keeps each project's daemon, tokens and serve.json isolated
//      so running `aimeat connect serve` from two projects on one machine no
//      longer fights over a single global ~/.aimeat (last-writer / refused
//      daemon / wrong-agent routing). Set AIMEAT_HOME=~/.aimeat for the old
//      global behaviour. Captured once at module load = the launch directory.
const CONFIG_DIR = process.env.AIMEAT_HOME ?? join(process.cwd(), '.aimeat');
const CONFIG_FILE = join(CONFIG_DIR, 'config.yaml');

export function getConfigDir(): string { return CONFIG_DIR; }

/* ───────── Global config (legacy single-agent) ───────── */

export interface AimeatConnectConfig {
  node_url: string;
  agent: string;
  owner: string;
  // SECURITY: `wake.command` is passed to child_process.exec — anyone able to
  // write this file (or anyone who tricks the user into pasting a config) gets
  // code execution on every poll cycle. Prefer `webhook` when the local config
  // is not fully under the operator's control.
  wake?: WakeConfig;
  poll_interval?: number;
}

export interface WakeConfig {
  command?: string;
  webhook?: string;
  strategy?: 'command_first' | 'webhook_first' | 'command_only' | 'webhook_only';
}

export function loadConfig(): AimeatConnectConfig | null {
  if (!existsSync(CONFIG_FILE)) return null;
  const raw = readFileSync(CONFIG_FILE, 'utf-8');
  return parse(raw) as AimeatConnectConfig;
}

export function saveConfig(config: AimeatConnectConfig): void {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, stringify(config), 'utf-8');
}

/* ───────── Per-agent config ───────── */

export interface AimeatPerAgentConfig {
  /** Required: agent name (e.g. "marketing-crew"). */
  agent: string;
  /** Required: owner name (e.g. "happydude500001"). */
  owner: string;
  /** Required: AIMEAT node URL the agent is registered with. */
  node_url: string;
  /**
   * Optional: mark this agent as the default when multiple agents are loaded
   * and a tool call does not specify `agent_name`. Typically set on the
   * primary interactive agent (e.g. Claude Code), not on task-runner agents.
   */
  primary?: boolean;
  /**
   * Server-side operational mode this agent was registered with. Mirrors the
   * value the AIMEAT node stores on `AgentRecord.mode`. Used by `connect list`
   * to label the agent without an extra REST call, and by docs/CHANGELOG to
   * tell operators which onboarding flow the agent went through. Distinct from
   * `runner` -- `mode: task-runner` says the SERVER treats this agent as a
   * task-runner (reduced 5-step Hello Integration), while `runner: {...}`
   * configures the local connector to actually spawn a subprocess. Both are
   * needed for a working task-runner agent.
   */
  mode?: 'autonomous' | 'interactive' | 'task-runner' | 'coordinator' | 'workstation';
  /** Optional: poll interval in seconds (default: 30). */
  poll_interval?: number;
  /** Optional: per-agent wake adapter (overrides global). See SECURITY note. */
  wake?: WakeConfig;
  /**
   * Optional: makes the agent a task-runner. When a queued task arrives for
   * this agent, the connector launches `runner.command` as a subprocess with
   * the task prompt provided via env vars. The subprocess produces a
   * deliverable on stdout (or a file), which is posted back as the task's
   * completion summary. See `task-runner.ts` for the lifecycle.
   *
   * SECURITY: like `wake.command`, this runs whatever string the local config
   * holds. Treat ~/.aimeat/ as a credential location and do not paste
   * untrusted configs.
   */
  runner?: RunnerConfig;
}

export interface RunnerConfig {
  /** Executable to run (e.g. "uv", "python", "node"). */
  command: string;
  /** Arguments passed to the executable. */
  args?: string[];
  /** Working directory (default: cwd of the connector process). */
  cwd?: string;
  /** Max runtime in seconds before SIGTERM. Default: 3600. */
  timeout_seconds?: number;
  /** Env var name receiving the task prompt. Default: AIMEAT_TASK_PROMPT. */
  prompt_env?: string;
  /** Env var name receiving the task id. Default: AIMEAT_TASK_ID. */
  task_id_env?: string;
  /** Env var name receiving the agent name. Default: AIMEAT_AGENT_NAME. */
  agent_name_env?: string;
  /** Env var name receiving the AIMEAT bearer token. Default: AIMEAT_TOKEN. */
  token_env?: string;
  /** Env var name receiving the node URL. Default: AIMEAT_NODE_URL. */
  node_url_env?: string;
  /**
   * How to capture the deliverable.
   *   - "stdout" (default): everything printed to stdout becomes the task summary
   *   - "file:<path>": read the file at the given path after the subprocess exits
   */
  output_capture?: 'stdout' | string;
  /** What to do on non-zero exit. "report" (default) marks task as failed. "retry" not yet implemented. */
  on_failure?: 'report' | 'retry';
  /** Extra env vars passed verbatim to the subprocess. */
  env?: Record<string, string>;
}

function perAgentDir(agent: string): string {
  return join(CONFIG_DIR, 'agents', agent);
}

export function perAgentConfigPath(agent: string): string {
  return join(perAgentDir(agent), 'config.yaml');
}

export function loadPerAgentConfig(agent: string): AimeatPerAgentConfig | null {
  const p = perAgentConfigPath(agent);
  if (!existsSync(p)) return null;
  try {
    return parse(readFileSync(p, 'utf-8')) as AimeatPerAgentConfig;
  } catch (err) {
    logger.warn('config: suppressed failure, continuing', { error: String(err) });
    return null;
  }
}

export function savePerAgentConfig(agent: string, config: AimeatPerAgentConfig): void {
  const dir = perAgentDir(agent);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(perAgentConfigPath(agent), stringify(config), 'utf-8');
}

/* ───────── Load all agents (multi-agent serve) ───────── */

export interface LoadedAgent {
  agent: string;
  owner: string;
  token: string;
  config: AimeatPerAgentConfig;
}

/**
 * Scan stored tokens, load per-agent config for each (synthesizing one from the
 * global config for legacy single-agent installs that have no per-agent file).
 * Returns the full set the connector should serve. Empty array if no tokens.
 */
export async function loadAllAgents(): Promise<LoadedAgent[]> {
  const credentials = await listAllTokens();
  if (credentials.length === 0) return [];

  const global = loadConfig();
  const out: LoadedAgent[] = [];

  for (const cred of credentials) {
    let perAgent = loadPerAgentConfig(cred.agent);
    if (!perAgent) {
      // Legacy install: synthesize per-agent config from the global config when
      // the global config points at this agent. Otherwise fall back to defaults.
      const isPrimary = global && global.agent === cred.agent && global.owner === cred.owner;
      perAgent = {
        agent: cred.agent,
        owner: cred.owner,
        node_url: isPrimary && global?.node_url ? global.node_url : 'https://aimeat.io',
        wake: isPrimary ? global?.wake : undefined,
        poll_interval: isPrimary ? global?.poll_interval : undefined,
      };
    }
    out.push({ agent: cred.agent, owner: cred.owner, token: cred.token, config: perAgent });
  }

  return out;
}

/**
 * Find a single registered agent by name. Used by `aimeat connect call --agent <name>`
 * so the CLI can route the call through the right agent's token + node URL instead
 * of always falling back to the global "primary" config. Returns null if no token
 * is stored for that agent name, or if multiple owners have the same agent name and
 * `owner` was not specified to disambiguate.
 */
export async function loadAgentByName(agent: string, owner?: string): Promise<LoadedAgent | null> {
  const all = await loadAllAgents();
  const matches = all.filter(a => a.agent === agent && (!owner || a.owner === owner));
  if (matches.length === 0) return null;
  if (matches.length > 1) {
    throw new Error(`Agent "${agent}" exists under multiple owners (${matches.map(m => m.owner).join(', ')}). Pass --owner to disambiguate.`);
  }
  return matches[0];
}
