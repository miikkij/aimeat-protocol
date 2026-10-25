/**
 * @file src/cli/connect/command-trust.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Which local commands the connector may run: an agent's `runner` (spawned for each
 *   task) and `wake.command` (passed to a shell on new work). A command the person confirmed once
 *   runs; any other is held back until they confirm it, in plain words, with the command shown.
 *
 *   WHY. With no AIMEAT_HOME the connector home is `<cwd>/.aimeat`, the folder the command runs in.
 *   A folder that came from somewhere else (a cloned project, a received archive) can carry
 *   `.aimeat/agents/.../config.yaml` with a runner or wake command, and `aimeat connect` then
 *   `aimeat connect serve` in that folder ran it with the agent's token in its environment, with
 *   nothing shown and nobody asked (secaudit2026oct22, home-dir.ts:resolveConnectorHome:cwd-home-executable-settings;
 *   developer decision 2026-10-25).
 *
 *   THE RECORD. A hash of the connector home's absolute path and the commands (the whole runner block
 *   and wake.command), kept in a file OUTSIDE every connector home:
 *   `~/.config/aimeat/trusted-commands.json` (AIMEAT_COMMAND_TRUST_FILE overrides it, for tests). A
 *   folder cannot bring its own approval with it, because the record is not in the folder. The home's
 *   path is in the hash, so a relative command (`./run.sh`) approved in one project is asked again in
 *   another. The agent's name is not, so the same command for many agents of one home is asked once,
 *   and the connector's own copies of a confirmed command (a re-connect keeps the runner, the move
 *   to the per-owner layout copies it) stay confirmed without a write here.
 *
 *   WHERE IT IS ASKED. heldBackCommands() takes the commands out of a config that has unconfirmed
 *   ones and says what it held back; config.ts loadAllAgents and the enrolment attach use it, so no
 *   path hands an unconfirmed command to the runner or the wake adapter. `aimeat connect serve` in a
 *   terminal asks at start (confirmHeldCommands); in stdio mode, or with no terminal, it says how to
 *   confirm, and `aimeat connect trust` asks.
 * @structure HeldCommands · commandTrustFile · commandHash · isTrustedCommand · trustCommand ·
 *   heldBackCommands · describeHeld · confirmHeldCommands
 * @usage const { config, held } = heldBackCommands(perAgent, getConfigDir());
 * @version-history
 *   v1.0.0 -- 2026-10-25 -- Initial (secaudit2026oct22, lead 4763).
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { logger } from '../../utils/logger.js';

// The parts of a per-agent config this file reads and changes. config.ts AimeatPerAgentConfig and
// RunnerConfig have them; they are written out here so this file imports nothing from config.ts,
// which imports it (check:deps no-circular).
interface RunnerConfig { command: string; args?: string[]; cwd?: string; env?: Record<string, string> }
interface AimeatPerAgentConfig { runner?: RunnerConfig; wake?: { command?: string; webhook?: string; strategy?: string } }

/** The commands one agent's config would have the connector run, held back until confirmed. */
export interface HeldCommands {
  hash: string;
  home: string;
  runner?: RunnerConfig;
  wakeCommand?: string;
}

/** Where the confirmed commands are recorded: outside every connector home. */
export function commandTrustFile(env: NodeJS.ProcessEnv = process.env): string {
  return env.AIMEAT_COMMAND_TRUST_FILE?.trim() || join(homedir(), '.config', 'aimeat', 'trusted-commands.json');
}

/** JSON with sorted keys, so one command is one hash whatever order its fields were written in. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v as Record<string, unknown>).sort().filter(k => (v as Record<string, unknown>)[k] !== undefined)
      .map(k => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

/** The hash of a home's commands. */
export function commandHash(home: string, runner: RunnerConfig | undefined, wakeCommand: string | undefined): string {
  return createHash('sha256').update(canonical({ home: resolve(home), runner: runner ?? null, wake: wakeCommand ?? null })).digest('hex');
}

function readTrust(file: string): { hashes: Record<string, { at: string; what: string }> } {
  if (!existsSync(file)) return { hashes: {} };
  try {
    const v = JSON.parse(readFileSync(file, 'utf-8')) as { hashes?: Record<string, { at: string; what: string }> };
    return { hashes: v.hashes && typeof v.hashes === 'object' ? v.hashes : {} };
  } catch (err) {
    // A record that does not parse confirms nothing; the person is asked again, and the next
    // confirmation writes a whole file.
    logger.warn('connector: the record of confirmed commands could not be read; every command is asked again', { file, error: String(err) });
    return { hashes: {} };
  }
}

export function isTrustedCommand(hash: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return Object.prototype.hasOwnProperty.call(readTrust(commandTrustFile(env)).hashes, hash);
}

/** Record that the person confirmed these commands. tmp-then-rename, so a half-written file cannot exist. */
export function trustCommand(held: HeldCommands, env: NodeJS.ProcessEnv = process.env): void {
  const file = commandTrustFile(env);
  const now = readTrust(file);
  now.hashes[held.hash] = { at: new Date().toISOString(), what: describeHeld(held).slice(0, 500) };
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(now, null, 2), { encoding: 'utf-8', mode: 0o600 });
  renameSync(tmp, file);
}

/**
 * The config with any unconfirmed runner and wake.command taken out, and what was taken out. A
 * config with no command, or with confirmed ones, comes back unchanged and `held` is null. A wake
 * webhook is not a command and stays.
 */
export function heldBackCommands<T extends AimeatPerAgentConfig>(config: T, home: string, env: NodeJS.ProcessEnv = process.env): { config: T; held: HeldCommands | null } {
  const runner = config.runner?.command ? config.runner : undefined;
  const wakeCommand = config.wake?.command || undefined;
  if (!runner && !wakeCommand) return { config, held: null };
  const hash = commandHash(home, runner, wakeCommand);
  if (isTrustedCommand(hash, env)) return { config, held: null };
  const wake = config.wake ? { ...config.wake, command: undefined } : undefined;
  return {
    config: { ...config, runner: undefined, ...(wake ? { wake } : {}) },
    held: { hash, home: resolve(home), ...(runner ? { runner } : {}), ...(wakeCommand ? { wakeCommand } : {}) },
  };
}

/** The held commands as the person reads them: what runs, when, and from which folder. */
export function describeHeld(held: HeldCommands): string {
  const lines: string[] = [];
  if (held.runner) {
    const r = held.runner;
    lines.push(`  for each task: ${[r.command, ...(r.args ?? [])].join(' ')}`
      + (r.cwd ? ` (in ${r.cwd})` : '') + (r.env && Object.keys(r.env).length ? ` (with the settings ${Object.keys(r.env).join(', ')})` : ''));
  }
  if (held.wakeCommand) lines.push(`  on new work: ${held.wakeCommand}`);
  return lines.join('\n');
}

/** The sentence that says what was held back and how to confirm it, for a run that cannot ask. */
export function heldNotice(agents: string[], held: HeldCommands): string {
  return `The settings in ${held.home} ask this connector to run a command for ${agents.join(', ')}:\n${describeHeld(held)}\n`
    + 'The connector did not write this setting, so it does not run it. If you wrote it yourself, run `aimeat connect trust` in a terminal in this folder to allow it once.';
}

/** One notice per distinct held command, naming every agent it was held for. */
export function heldNotices(agents: Array<{ agent: string; owner: string; heldCommands?: HeldCommands | null }>): string[] {
  const byHash = new Map<string, { held: HeldCommands; names: string[] }>();
  for (const a of agents) {
    if (!a.heldCommands) continue;
    const g = byHash.get(a.heldCommands.hash) ?? { held: a.heldCommands, names: [] };
    g.names.push(`${a.agent}@${a.owner}`);
    byHash.set(a.heldCommands.hash, g);
  }
  return [...byHash.values()].map(g => heldNotice(g.names, g.held));
}

/**
 * Ask the person, one question per distinct command, whether it may run. Yes records it and the
 * commands are put back into each agent's config; anything else leaves them out. Returns how many
 * were allowed. `input` and `output` default to the terminal; the question is plain words with the
 * command shown.
 */
export async function confirmHeldCommands(
  agents: Array<{ agent: string; owner: string; config: AimeatPerAgentConfig; heldCommands?: HeldCommands | null }>,
  io: { input?: NodeJS.ReadableStream; output?: NodeJS.WritableStream; env?: NodeJS.ProcessEnv } = {},
): Promise<number> {
  const byHash = new Map<string, { held: HeldCommands; who: typeof agents }>();
  for (const a of agents) {
    if (!a.heldCommands) continue;
    const g = byHash.get(a.heldCommands.hash) ?? { held: a.heldCommands, who: [] };
    g.who.push(a);
    byHash.set(a.heldCommands.hash, g);
  }
  if (byHash.size === 0) return 0;
  const rl = createInterface({ input: io.input ?? process.stdin, output: io.output ?? process.stderr, terminal: false });
  let allowed = 0;
  try {
    for (const { held, who } of byHash.values()) {
      const names = who.map(w => `${w.agent}@${w.owner}`).join(', ');
      const answer = await rl.question(
        `\nThe settings in ${held.home} ask this connector to run a command on this computer for ${names}:\n${describeHeld(held)}\n`
        + 'The connector did not write this setting. It may have come with the folder, for example in a cloned project.\n'
        + 'The command runs with the agent\'s access to your AIMEAT account. Allow it? Type yes to allow it, or press Enter to leave it off: ');
      if (answer.trim().toLowerCase() !== 'yes') continue;
      trustCommand(held, io.env);
      for (const w of who) {
        w.config.runner = held.runner;
        if (held.wakeCommand) w.config.wake = { ...(w.config.wake ?? {}), command: held.wakeCommand };
        w.heldCommands = null;
      }
      allowed++;
    }
  } finally {
    rl.close();
  }
  return allowed;
}
