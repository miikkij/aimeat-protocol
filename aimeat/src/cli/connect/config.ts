/**
 * @file config.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
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
 *   v2.3.0 -- 2026-08-31 -- loadAllAgents() also scans `keys/`: an Agent v2 principal holds an
 *                           Ed25519 key and no bearer, so a restarting daemon that only read
 *                           `tokens/` would silently stop serving every agent the basic-agents
 *                           button created. `token` is empty for those; agent-key.ts resolveToken()
 *                           mints one per use.
 *   v2.2.0 -- 2026-06-17 -- Default home is now <cwd>/.aimeat (directory-scoped)
 *                           instead of the global ~/.aimeat, so two projects on
 *                           one machine get independent daemons / tokens /
 *                           serve.json instead of colliding. AIMEAT_HOME still
 *                           overrides; set it to ~/.aimeat for the old global mode.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';
import { listAllTokens } from './keychain.js';
import { listAllAgentKeys } from './agent-key.js';
import { gaiiFromToken, isGaii } from './agent-gaii.js';
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

/**
 * What the connector keeps on disk for ONE agent.
 *
 * THE BOUNDARY, and it decides every field below. The NODE holds who an agent is, what it may do,
 * its mode and its run mode, in the database, authoritatively. The RUNTIME holds what the agent
 * does when it runs — crewaimeat's `crew_defs/` and its spawner settings, on its own disk, not
 * ours. This file holds only what is needed to REACH the node and to EXECUTE locally, and nothing
 * that either of the other two already holds.
 *
 * WHAT WAS REMOVED AND WHY. `agent`, `owner` and `mode` were mirrors. Identity comes from the
 * credential — the token filename is owner-qualified and a v2 key file carries the GAII outright —
 * so the copy here was a second statement of one fact, and it was the wrong one whenever two
 * owners shared a file: `bob.owner` was 'bob' while `bob.config.owner` said 'alice'. `mode` was a
 * declared mirror of `AgentRecord.mode`; the node serves it, along with `run_mode`,
 * `identity_version` and `card_enrolled`, in one listing.
 *
 * They are still TOLERATED in the type, because old files carry them and a field nobody reads is
 * harmless. Nothing reads them and nothing writes them for a new agent. There is deliberately no
 * migration that rewrites every install to delete three lines.
 */
export interface AimeatPerAgentConfig {
  /**
   * BOOTSTRAP. The one thing that cannot come from the node, because you cannot ask the node where
   * the node is.
   */
  node_url: string;
  /**
   * Optional: the default agent when a tool call names none. PER OWNER — one global default across
   * two owners is the same category error as keying the registry by a bare name: "which is the
   * default" only means something inside one account. With two owners each holding a primary and a
   * caller naming neither, that is ambiguous and refuses.
   */
  primary?: boolean;
  /** Optional: poll interval in seconds (default: 30). LOCAL EXECUTION. */
  poll_interval?: number;
  /**
   * Optional: per-agent wake adapter. LOCAL EXECUTION.
   *
   * SECURITY, and this is why it cannot come from the node: `wake.command` is handed to a shell on
   * THIS machine. A node that could dictate it would have arbitrary code execution on every
   * connector that talks to it. It stays local, it is read only from this file, and no code path
   * may ever populate it from a server response. Do not "simplify" this by fetching it.
   */
  wake?: WakeConfig;
  /**
   * Optional: makes the agent a task-runner. When a queued task arrives for this agent, the
   * connector launches `runner.command` as a subprocess with the task prompt provided via env vars.
   * The subprocess produces a deliverable on stdout (or a file), which is posted back as the task's
   * completion summary. See `task-runner.ts` for the lifecycle.
   *
   * SECURITY: exactly as `wake` above — `runner.command` is exec'd locally, so it must never come
   * from the node. Treat the connector home as a credential location and do not paste untrusted
   * configs.
   */
  runner?: RunnerConfig;

  // ── Tolerated, never read. Old files carry these; new ones do not get them. ──
  /** @deprecated Identity comes from the credential. Present in files written before 2026-09-01. */
  agent?: string;
  /** @deprecated Identity comes from the credential. Present in files written before 2026-09-01. */
  owner?: string;
  /** @deprecated The node holds this on AgentRecord.mode and serves it in GET /v1/agents. */
  mode?: 'autonomous' | 'interactive' | 'task-runner' | 'coordinator' | 'workstation';
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

/**
 * THE OLD LAYOUT: `agents/<agent>/config.yaml`, keyed by the bare agent name.
 *
 * Two owners who both have a `concierge` share one file, and its contents are whichever of them
 * enrolled last. Identity was never at risk (that comes from the credential), but the SETTINGS
 * were, and two of them badly: `node_url` sends one owner's calls to the other's node, and
 * `runner.command` / `wake.command` run one owner's command for the other owner's work.
 *
 * Still read, always, and never deleted automatically — a wrongly deleted credential directory is
 * gone, and one `existsSync` per agent per start costs nothing.
 */
function legacyPerAgentDir(agent: string): string {
  return join(CONFIG_DIR, 'agents', agent);
}

/** THE LAYOUT: `agents/<owner>/<agent>/config.yaml`. One directory per identity. */
function perAgentDir(agent: string, owner: string): string {
  return join(CONFIG_DIR, 'agents', owner, agent);
}

export function perAgentConfigPath(agent: string, owner: string): string {
  return join(perAgentDir(agent, owner), 'config.yaml');
}

export function legacyPerAgentConfigPath(agent: string): string {
  return join(legacyPerAgentDir(agent), 'config.yaml');
}

function readConfigFile(path: string): AimeatPerAgentConfig | null {
  if (!existsSync(path)) return null;
  try {
    return parse(readFileSync(path, 'utf-8')) as AimeatPerAgentConfig;
  } catch (err) {
    logger.warn('config: unreadable per-agent config, ignoring', { path, error: String(err) });
    return null;
  }
}

/**
 * This agent's settings, migrating an old-layout file into place on the way.
 *
 * COPY, NEVER MOVE, and that is the whole safety of it. An interrupted run leaves the old file
 * exactly where it was and at worst a partial new one, and the next read either finds a complete
 * new file or writes it again. A move leaves a state with neither.
 *
 * Two owners who shared one old file both get the SAME contents copied. That is the previous state
 * preserved, not an improvement: B's `node_url` is still A's until B re-enrols or edits it. A
 * migration cannot invent information that was never stored — it can only say so, which it does.
 */
export function loadPerAgentConfig(agent: string, owner: string): AimeatPerAgentConfig | null {
  const current = readConfigFile(perAgentConfigPath(agent, owner));
  if (current) return current;

  const legacy = readConfigFile(legacyPerAgentConfigPath(agent));
  if (!legacy) return null;

  // The old file names an owner. When it names a DIFFERENT one, this file was shared, and the
  // settings the other owner gets are not theirs — say so once, here, where it is discovered.
  if (legacy.owner && legacy.owner !== owner) {
    logger.warn('config: an old shared per-agent config was copied to a second owner; check its node_url and runner', {
      agent, owner, wasWrittenBy: legacy.owner, from: legacyPerAgentConfigPath(agent),
    });
  }
  savePerAgentConfig(agent, owner, legacy);
  logger.info('config: migrated a per-agent config to the per-owner layout', {
    agent, owner, from: legacyPerAgentConfigPath(agent), to: perAgentConfigPath(agent, owner),
  });
  return readConfigFile(perAgentConfigPath(agent, owner)) ?? legacy;
}

/**
 * Write this agent's settings. Only the fields that belong here reach the file: `agent`, `owner`
 * and `mode` are dropped on every write, so a migrated old file loses them the first time anything
 * saves, without a migration that rewrites installs just to delete three lines.
 *
 * tmp-then-rename, the same as serve.json: a half-written config is not a state that can exist.
 */
export function savePerAgentConfig(agent: string, owner: string, config: AimeatPerAgentConfig): void {
  const dir = perAgentDir(agent, owner);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const slim: AimeatPerAgentConfig = { node_url: config.node_url };
  if (config.primary !== undefined) slim.primary = config.primary;
  if (config.poll_interval !== undefined) slim.poll_interval = config.poll_interval;
  if (config.wake !== undefined) slim.wake = config.wake;
  if (config.runner !== undefined) slim.runner = config.runner;

  const target = perAgentConfigPath(agent, owner);
  const tmp = `${target}.tmp-${process.pid}`;
  writeFileSync(tmp, stringify(slim), 'utf-8');
  renameSync(tmp, target);
}

/**
 * Which agents are still only in the old layout, so `aimeat connect status` can say how many.
 *
 * Cleanup is an operator's visible choice, never a scheduled risk: the connector reads the old path
 * forever and deletes nothing, and this is what stops "forever" from meaning "invisible".
 */
export function agentsOnLegacyLayout(credentials: Array<{ agent: string; owner: string }>): string[] {
  return credentials
    .filter(c => !existsSync(perAgentConfigPath(c.agent, c.owner)) && existsSync(legacyPerAgentConfigPath(c.agent)))
    .map(c => `${c.agent}@${c.owner}`);
}

/* ───────── Load all agents (multi-agent serve) ───────── */

export interface LoadedAgent {
  agent: string;
  owner: string;
  /**
   * `agent#owner@node`. THE identity, and what every map that can hold more than one of these is
   * keyed by. Resolved from the credential itself — the key file for a v2 agent, the bearer's `sub`
   * for a v1 one — never assembled from the filename, because a filename is a naming convention and
   * this is an identity.
   */
  gaii: string;
  token: string;
  config: AimeatPerAgentConfig;
}

/**
 * Scan stored credentials, load per-agent config for each (synthesizing one from the
 * global config for legacy single-agent installs that have no per-agent file).
 * Returns the full set the connector should serve. Empty array if there are none.
 *
 * TWO KINDS OF CREDENTIAL, ONE LIST. A v1 agent has a long-lived bearer under `tokens/`; a v2 agent
 * has an Ed25519 key under `keys/` and no bearer at all, and mints one per use. Both are scanned,
 * and the union is what the daemon serves — an owner with one of each does not have to know which
 * is which, and the v1 half is untouched by the existence of the other.
 *
 * `token` is empty for a v2 agent. Everything that needs a live credential goes through
 * `resolveToken()` in agent-key.ts, which mints for a key-holder and reads the file for the other.
 */
export async function loadAllAgents(): Promise<LoadedAgent[]> {
  const credentials = await listAllTokens();
  const keyed = await listAllAgentKeys();
  if (credentials.length === 0 && keyed.length === 0) return [];

  const global = loadConfig();
  const out: LoadedAgent[] = [];
  const seen = new Set<string>();

  for (const cred of credentials) {
    seen.add(`${cred.agent}@${cred.owner}`);
    let perAgent = loadPerAgentConfig(cred.agent, cred.owner);
    if (!perAgent) {
      // Legacy install: synthesize per-agent config from the global config when
      // the global config points at this agent. Otherwise fall back to defaults.
      const isPrimary = global && global.agent === cred.agent && global.owner === cred.owner;
      perAgent = {
        node_url: isPrimary && global?.node_url ? global.node_url : 'https://aimeat.io',
        wake: isPrimary ? global?.wake : undefined,
        poll_interval: isPrimary ? global?.poll_interval : undefined,
      };
    }
    // The identity, from the credential. A v1 bearer carries it as `sub`; a token that does not is
    // one this daemon cannot place, and serving it under a bare name is exactly the defect this
    // resolves — so it is reported and skipped rather than guessed at.
    const gaii = gaiiFromToken(cred.token);
    if (!gaii) {
      logger.warn('loadAllAgents: a stored token carries no usable identity and will not be served', {
        agent: cred.agent, owner: cred.owner,
        hint: 'Re-run `aimeat connect` for this agent; the token predates identities or is not this node\'s.',
      });
      continue;
    }
    out.push({ agent: cred.agent, owner: cred.owner, gaii, token: cred.token, config: perAgent });
  }

  for (const k of keyed) {
    // A stray bearer alongside a key means this agent was migrated; the key wins, because it is the
    // credential the node will honour and the bearer is the thing being retired.
    if (seen.has(`${k.agent}@${k.owner}`)) continue;
    const perAgent = loadPerAgentConfig(k.agent, k.owner);
    if (!perAgent) {
      // Enrolment writes the key and the config together, so this only happens if one of the two
      // was lost. There is no default node URL to guess for a v2 agent — it never went through
      // `aimeat connect`, so the global config does not describe it — and serving it against the
      // wrong node would fail in a way that reads like a broken credential.
      logger.warn('loadAllAgents: an agent key has no per-agent config and cannot be served', { agent: k.agent, owner: k.owner });
      continue;
    }
    // Written beside the key at enrolment, so this is read rather than derived.
    if (!isGaii(k.key.gaii)) {
      logger.warn('loadAllAgents: an agent key carries no usable identity and will not be served', {
        agent: k.agent, owner: k.owner,
      });
      continue;
    }
    out.push({ agent: k.agent, owner: k.owner, gaii: k.key.gaii, token: '', config: perAgent });
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
