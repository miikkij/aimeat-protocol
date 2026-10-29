/**
 * @file src/cli/connect/command-trust.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Which local commands the connector runs: an agent's `runner` (spawned for each task)
 *   and `wake.command` (passed to a shell on new work).
 *
 *   WHY. With no AIMEAT_HOME the connector home is `<cwd>/.aimeat`, the folder the command runs in.
 *   A folder that came from somewhere else (a cloned project, a received archive) can carry
 *   `.aimeat/agents/.../config.yaml` with a runner or a wake command, and `aimeat connect serve` in
 *   that folder ran it with the agent's token in its environment (secaudit2026oct22,
 *   home-dir.ts:resolveConnectorHome:cwd-home-executable-settings).
 *
 *   THE RULE (developer decision 2026-10-25: "jos käyttäjä yhdistää tuon niin se on silloin myös
 *   hyväksynyt sen"):
 *   1. A command the connector's own connect flow writes (`aimeat connect`, an enrolment the person
 *      approved) is trusted by that act: trustWrittenCommands() records it as it is written.
 *   2. Every command an install already has at the first start after this update is adopted once
 *      (adoptExistingCommands): a config file older than the record's `firstRunAt`, which the first
 *      start writes. No existing fleet or unattended daemon stops, and nobody is asked. A record
 *      that exists but cannot be read, or has no `firstRunAt`, adopts nothing and gets no new
 *      `firstRunAt`: its commands are held as in 3 until `aimeat connect` takes each one into use.
 *   3. Any other command, one in a folder that arrived after that first start and that nobody
 *      connected through the connector, does not run: heldBackCommands() takes it out of the config,
 *      and heldNotices() gives one plain line that names it and says that `aimeat connect` in that
 *      folder connects it. Running `aimeat connect` there is the approval.
 *
 *   THE RECORD. A hash of the connector home's absolute path and the commands (the whole runner block
 *   and wake.command), kept in a file OUTSIDE every connector home: `~/.config/aimeat/trusted-commands.json`
 *   (AIMEAT_COMMAND_TRUST_FILE overrides it, for tests). A folder cannot bring its own record. The
 *   home's path is in the hash, so a relative command (`./run.sh`) recorded in one project is not
 *   trusted in another; the agent's name is not, so a fleet with one runner is one entry, and the
 *   connector's own copies of a recorded command (the move to the per-owner layout) stay trusted.
 *
 *   A RELATIVE PROGRAM PATH. A runner command or the first word of a wake command with a directory
 *   part that is not absolute (`./run.sh`, `bin/agent`) is resolved to an absolute path in the
 *   directory it runs in (runner.cwd, else the daemon's working directory), and that absolute path is
 *   in the hash. With AIMEAT_HOME set the home does not say which directory that is, so a start in
 *   another directory holds the command until `aimeat connect` there takes it into use. A record
 *   from before this rule (the command text only) is bound once, at the first start in a directory
 *   that holds the program (secaudit2026oct26 round 8c, home-bound-not-resolution-directory).
 *   Absolute paths and bare names keep the hash they had.
 *
 *   KNOWN RESIDUAL. Adoption reads file times. An archive that keeps the times of its files, older
 *   than this machine's first start after the update, is adopted as an existing install would be.
 *   A machine with no record at all treats its first start as the first start after the update.
 * @structure HeldCommands · commandTrustFile · commandHash · isTrustedCommand · trustWrittenCommands ·
 *   adoptExistingCommands · heldBackCommands · heldNotices
 * @usage adoptExistingCommands(home); const { config, held } = heldBackCommands(perAgent, home);
 * @version-history
 *   v2.2.0 -- 2026-10-29 -- A record that cannot be read, or has no firstRunAt, adopts nothing and gets
 *     no new firstRunAt (secaudit2026oct26 round 8c, mtime-cutoff-not-bound-to-update). A relative
 *     program path is resolved where it runs and the hash binds the absolute path; a record from
 *     before is bound once (secaudit2026oct26 round 8c, home-bound-not-resolution-directory).
 *   v2.1.0 -- 2026-10-27 -- enrolmentTookHeldNotice: an enrolment the owner approved on the node that
 *     takes held commands into use says so in one line, printed by the daemon and kept in its log
 *     (secaudit2026oct26, node-offer-trusts-held-commands; designed use, decision 2026-10-27). Each
 *     adopted command is logged with its file and home, and the readTrust comment says what an
 *     unreadable record does (secaudit2026oct26, mtime-cutoff-not-bound-to-update).
 *   v2.0.0 -- 2026-10-25 -- Connecting is the approval: no question and no `aimeat connect trust`. The
 *     connect flow records what it writes, the first start after the update adopts what an install
 *     has, and a folder nobody connected gets one line (developer decision 2026-10-25).
 *   v1.0.1 -- 2026-10-25 -- The config shapes it reads are written out here (check:deps no-circular).
 *   v1.0.0 -- 2026-10-25 -- Initial (secaudit2026oct22, lead 4763).
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve, isAbsolute } from 'node:path';
import { parse } from 'yaml';
import { logger } from '../../utils/logger.js';

// The parts of a per-agent config this file reads and changes. config.ts AimeatPerAgentConfig and
// RunnerConfig have them; they are written out here so this file imports nothing from config.ts,
// which imports it (check:deps no-circular).
interface RunnerConfig { command: string; args?: string[]; cwd?: string; env?: Record<string, string> }
interface AimeatPerAgentConfig { runner?: RunnerConfig; wake?: { command?: string; webhook?: string; strategy?: string } }

/** The commands one agent's config names that the connector does not run. */
export interface HeldCommands {
  hash: string;
  home: string;
  runner?: RunnerConfig;
  wakeCommand?: string;
  /** The absolute paths a relative program path resolves to in the directory the commands run in. */
  programs?: { runner?: string; wake?: string };
}

interface TrustRecord { firstRunAt?: string; hashes: Record<string, { at: string; how: 'connected' | 'adopted' }> }

/** Where the trusted commands are recorded: outside every connector home. */
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

/** A program path with a directory part that is not absolute: `./run.sh`, `bin/agent`. Not a bare name. */
function isRelativeProgram(program: string): boolean {
  return /[\\/]/.test(program) && !isAbsolute(program);
}

/** The program a wake command starts: its first word, without quotes. */
function wakeProgram(wakeCommand: string): string {
  const m = /^\s*(?:"([^"]+)"|(\S+))/.exec(wakeCommand);
  return m?.[1] ?? m?.[2] ?? '';
}

/**
 * The absolute paths of the programs the commands name by a relative path, resolved where each runs:
 * a runner in runner.cwd (itself resolved in `dir`), else in `dir`; a wake command in `dir`. Null when
 * no program is named by a relative path, so the hash of such commands is the one they always had.
 */
function relativePrograms(runner: RunnerConfig | undefined, wakeCommand: string | undefined, dir: string): { runner?: string; wake?: string } | null {
  const out: { runner?: string; wake?: string } = {};
  if (runner?.command && isRelativeProgram(runner.command)) out.runner = resolve(dir, runner.cwd ?? '.', runner.command);
  const wp = wakeCommand ? wakeProgram(wakeCommand) : '';
  if (wp && isRelativeProgram(wp)) out.wake = resolve(dir, wp);
  return out.runner || out.wake ? out : null;
}

function hashOf(home: string, runner: RunnerConfig | undefined, wakeCommand: string | undefined, programs: { runner?: string; wake?: string } | null): string {
  return createHash('sha256').update(canonical({ home: resolve(home), runner: runner ?? null, wake: wakeCommand ?? null, ...(programs ? { programs } : {}) })).digest('hex');
}

/**
 * The hash of a home's commands. A relative program path is resolved in `dir`, the directory the
 * command runs in (the daemon's working directory), and the absolute path is part of the hash.
 */
export function commandHash(home: string, runner: RunnerConfig | undefined, wakeCommand: string | undefined, dir: string = process.cwd()): string {
  return hashOf(home, runner, wakeCommand, relativePrograms(runner, wakeCommand, dir));
}

/** True when a file the program path names exists, with the extensions Windows tries for it. */
function programExists(path: string): boolean {
  const exts = process.platform === 'win32' ? ['', '.com', '.exe', '.bat', '.cmd'] : [''];
  return exts.some(e => {
    try { return Boolean(statSync(path + e, { throwIfNoEntry: false })?.isFile()); } catch (err) {
      logger.warn('connector: a program path could not be read while binding a trusted command', { path: path + e, error: String(err) });
      return false;
    }
  });
}

/**
 * A record from before relative program paths were bound holds the hash of the command text only.
 * The first time such a command is met in a directory that holds its program, the record is bound to
 * the absolute path there: the new hash is added and the text-only one removed, so it is resolved
 * once. Returns true when the command may run here: bound now, or no program by that name is here
 * to run (the record then stays for the directory the command runs from).
 */
function bindTextOnlyRecord(file: string, record: TrustRecord, home: string, c: { runner?: RunnerConfig; wakeCommand?: string }, dir: string): boolean {
  const programs = relativePrograms(c.runner, c.wakeCommand, dir);
  if (!programs) return false;
  const old = hashOf(home, c.runner, c.wakeCommand, null);
  const entry = record.hashes[old];
  if (!entry) return false;
  if (!Object.values(programs).every(p => programExists(p!))) return true;
  const hash = hashOf(home, c.runner, c.wakeCommand, programs);
  record.hashes[hash] = { at: new Date().toISOString(), how: entry.how };
  delete record.hashes[old];
  try { writeTrust(file, record); } catch (err) {
    // The text-only record stays, and the next start binds it.
    logger.warn('connector: the record of trusted commands could not be written', { file, error: String(err) });
    return true;
  }
  logger.info('connector: a trusted command with a relative program path is bound to the program in this directory', { home: resolve(home), dir, programs });
  return true;
}

/** The commands a config names, or null when it names none. A wake webhook is not a command. */
function commandsOf(config: AimeatPerAgentConfig | null | undefined): { runner?: RunnerConfig; wakeCommand?: string } | null {
  const runner = config?.runner?.command ? config.runner : undefined;
  const wakeCommand = config?.wake?.command || undefined;
  return runner || wakeCommand ? { runner, wakeCommand } : null;
}

function readTrust(file: string): TrustRecord | null {
  if (!existsSync(file)) return null;
  try {
    const v = JSON.parse(readFileSync(file, 'utf-8')) as Partial<TrustRecord>;
    return { ...(typeof v.firstRunAt === 'string' ? { firstRunAt: v.firstRunAt } : {}), hashes: v.hashes && typeof v.hashes === 'object' ? v.hashes : {} };
  } catch (err) {
    // A record that does not parse has no hashes and no firstRunAt. Adoption adopts nothing from it
    // and writes no firstRunAt, so every command is held until `aimeat connect` takes it into use;
    // that connect replaces the file with a whole one, still without firstRunAt (secaudit2026oct26
    // round 8c, mtime-cutoff-not-bound-to-update).
    logger.warn('connector: the record of trusted commands could not be read', { file, error: String(err) });
    return { hashes: {} };
  }
}

/** tmp-then-rename, so a half-written record cannot exist. */
function writeTrust(file: string, record: TrustRecord): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(record, null, 2), { encoding: 'utf-8', mode: 0o600 });
  renameSync(tmp, file);
}

export function isTrustedCommand(hash: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return Object.prototype.hasOwnProperty.call(readTrust(commandTrustFile(env))?.hashes ?? {}, hash);
}

/** Record that the connect flow wrote these commands in `home`: the person who connected approved them. */
export function trustWrittenCommands(config: AimeatPerAgentConfig, home: string, env: NodeJS.ProcessEnv = process.env, dir: string = process.cwd()): void {
  const c = commandsOf(config);
  if (!c) return;
  const file = commandTrustFile(env);
  const record = readTrust(file) ?? { firstRunAt: new Date().toISOString(), hashes: {} };
  const hash = commandHash(home, c.runner, c.wakeCommand, dir);
  if (record.hashes[hash]) return;
  record.hashes[hash] = { at: new Date().toISOString(), how: 'connected' };
  writeTrust(file, record);
}

/** The config files of one home: the per-owner layout, the old bare-name layout and the global file. */
function configFilesOf(home: string): string[] {
  const out: string[] = [];
  const add = (p: string) => { if (existsSync(p)) out.push(p); };
  add(join(home, 'config.yaml'));
  const agents = join(home, 'agents');
  if (!existsSync(agents)) return out;
  for (const a of readdirSync(agents, { withFileTypes: true })) {
    if (!a.isDirectory()) continue;
    add(join(agents, a.name, 'config.yaml'));
    for (const b of readdirSync(join(agents, a.name), { withFileTypes: true })) {
      if (b.isDirectory()) add(join(agents, a.name, b.name, 'config.yaml'));
    }
  }
  return out;
}

/**
 * The once-only adoption: the first start after this update writes `firstRunAt`, and every command
 * of this home whose config file is older than that is trusted, so an install keeps running what it
 * ran. A file written later (a folder cloned after the update) is not adopted. A record that exists
 * but cannot be read, or has no firstRunAt, adopts nothing and gets no firstRunAt: its commands are
 * held until `aimeat connect` takes each one into use. Never throws: a home that cannot be read
 * adopts nothing, and its commands do not run.
 */
export function adoptExistingCommands(home: string, env: NodeJS.ProcessEnv = process.env, dir: string = process.cwd()): void {
  try {
    const file = commandTrustFile(env);
    const found = readTrust(file);
    if (found && !found.firstRunAt) {
      logger.warn('connector: the record of trusted commands has no first-start time, so no command is adopted; a held command runs after `aimeat connect` in its folder', { file });
      return;
    }
    const record: TrustRecord = found ?? { firstRunAt: new Date().toISOString(), hashes: {} };
    const before = Date.parse(record.firstRunAt!);
    let changed = !found?.firstRunAt;
    for (const path of configFilesOf(home)) {
      if (statSync(path).mtimeMs >= before) continue;
      let c: ReturnType<typeof commandsOf>;
      try { c = commandsOf(parse(readFileSync(path, 'utf-8')) as AimeatPerAgentConfig); } catch (err) {
        logger.warn('connector: a config file could not be read for adoption; its commands do not run', { path, error: String(err) });
        continue;
      }
      if (!c) continue;
      const programs = relativePrograms(c.runner, c.wakeCommand, dir);
      const hash = hashOf(home, c.runner, c.wakeCommand, programs);
      if (record.hashes[hash]) continue;
      // A record from before relative program paths were bound is bound by heldBackCommands, once,
      // in a directory that holds the program. A relative program this directory does not hold is
      // adopted at a later start in the directory that does: its file stays older than firstRunAt.
      if (programs && record.hashes[hashOf(home, c.runner, c.wakeCommand, null)]) continue;
      if (programs && !Object.values(programs).every(p => programExists(p!))) continue;
      record.hashes[hash] = { at: new Date().toISOString(), how: 'adopted' };
      changed = true;
      // Each adoption is named in the log, so a command taken into use without a connect can be seen.
      logger.info('connector: a command this home already had is adopted and runs', {
        path, home: resolve(home), firstRunAt: record.firstRunAt,
        runner: c.runner ? [c.runner.command, ...(c.runner.args ?? [])].join(' ') : null,
        wake: c.wakeCommand ?? null,
      });
    }
    if (changed) writeTrust(file, record);
  } catch (err) {
    logger.warn('connector: the commands of this home could not be adopted', { home, error: String(err) });
  }
}

/**
 * The config with an untrusted runner and wake.command taken out, and what was taken out. A config
 * with no command, or with trusted ones, comes back unchanged and `held` is null. `dir` is the
 * directory the commands run in, where a relative program path is resolved.
 */
export function heldBackCommands<T extends AimeatPerAgentConfig>(config: T, home: string, env: NodeJS.ProcessEnv = process.env, dir: string = process.cwd()): { config: T; held: HeldCommands | null } {
  const c = commandsOf(config);
  if (!c) return { config, held: null };
  const hash = commandHash(home, c.runner, c.wakeCommand, dir);
  if (isTrustedCommand(hash, env)) return { config, held: null };
  const file = commandTrustFile(env);
  const record = readTrust(file);
  if (record && bindTextOnlyRecord(file, record, home, c, dir)) return { config, held: null };
  const wake = config.wake ? { ...config.wake, command: undefined } : undefined;
  const programs = relativePrograms(c.runner, c.wakeCommand, dir);
  return {
    config: { ...config, runner: undefined, ...(wake ? { wake } : {}) },
    held: {
      hash, home: resolve(home), ...(c.runner ? { runner: c.runner } : {}), ...(c.wakeCommand ? { wakeCommand: c.wakeCommand } : {}),
      ...(programs ? { programs } : {}),
    },
  };
}

/** The commands of a hold as text: `"cmd args" for each task and "wake" on new work`. */
function heldCommandText(held: HeldCommands): string {
  return [
    held.runner ? `"${[held.runner.command, ...(held.runner.args ?? [])].join(' ')}" for each task` : '',
    held.wakeCommand ? `"${held.wakeCommand}" on new work` : '',
  ].filter(Boolean).join(' and ');
}

/**
 * One plain line for an enrolment that took held commands into use: the owner's approval on the
 * node is the connect (rule 1, decision 2026-10-27), and this line makes that act visible at the
 * machine and in the daemon's log.
 */
export function enrolmentTookHeldNotice(gaii: string, held: HeldCommands): string {
  return `The enrolment of ${gaii} that the owner approved on the node took ${heldCommandText(held)} into use, as the settings in ${held.home} name them. Until now they did not run, because nobody had connected this folder through the connector.`;
}

/** One plain line per distinct command that does not run, naming the agents it was meant for. */
export function heldNotices(agents: Array<{ agent: string; owner: string; heldCommands?: HeldCommands | null }>): string[] {
  const byHash = new Map<string, { held: HeldCommands; names: string[] }>();
  for (const a of agents) {
    if (!a.heldCommands) continue;
    const g = byHash.get(a.heldCommands.hash) ?? { held: a.heldCommands, names: [] };
    g.names.push(`${a.agent}@${a.owner}`);
    byHash.set(a.heldCommands.hash, g);
  }
  return [...byHash.values()].map(({ held, names }) => {
    const cmds = heldCommandText(held);
    // A relative program path is trusted for the program it names in one directory: the line says
    // which program it names here.
    const here = held.programs ? ` In this directory it starts ${[held.programs.runner, held.programs.wake].filter(Boolean).join(' and ')}.` : '';
    return `The settings in ${held.home} name ${cmds} for ${names.join(', ')}, but nobody connected this folder through the connector, so the command does not run.${here} Run \`aimeat connect\` in this folder to connect it.`;
  });
}
