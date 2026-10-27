/**
 * @file src/cli/connect/command-path.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Which program a trusted runner or wake command names, when the working directory
 *   holds a file of the same name.
 *
 *   WHY. On Windows both spawn (libuv) and cmd.exe look for a bare program name (`python`,
 *   `claude`) in the working directory before PATH, unless NoDefaultCurrentDirectoryInExePath is
 *   set in the daemon's own environment (measured 2026-10-27 on Node 24.12: a copy of a program
 *   placed in the working directory under a PATH program's name ran instead of it). The trust
 *   record (command-trust.ts) binds the connector home and the command text. With AIMEAT_HOME set,
 *   the home does not say which directory the daemon runs in, so a folder the daemon is started in
 *   could put its own program in place of the one the person approved
 *   (secaudit2026oct26, commandHash:home-bound-not-resolution-directory).
 *
 *   THE RULE. Only on Windows, only for a bare name, only with AIMEAT_HOME set and no runner.cwd,
 *   and only when the working directory holds a file of that name AND PATH holds the program too:
 *   the PATH program runs. When the name is only in the working directory, nothing changes, so a
 *   command that has always run from there keeps running from there.
 * @structure pathPreferredProgram · wakeEnvPreferringPath
 * @usage const exe = pathPreferredProgram(cmd); spawn(exe ?? cmd, args, ...)
 * @version-history
 *   v1.0.0 -- 2026-10-27 -- Initial (secaudit2026oct26, commandHash:home-bound-not-resolution-directory).
 */
import { statSync } from 'node:fs';
import { join, delimiter } from 'node:path';
import { logger } from '../../utils/logger.js';

interface Where {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  platform?: NodeJS.Platform;
}

function isFile(p: string): boolean {
  try {
    return Boolean(statSync(p, { throwIfNoEntry: false })?.isFile());
  } catch (err) {
    logger.warn('connector: a PATH or working-directory entry could not be read while looking up a command', { path: p, error: String(err) });
    return false;
  }
}

/** A bare program name: no directory part and no drive. */
function isBareName(command: string): boolean {
  return command.length > 0 && !/[\\/:]/.test(command);
}

/** The names a lookup tries for `name`: as written, then with each extension appended. */
function candidates(name: string, exts: string[]): string[] {
  return [name, ...exts.map(e => name + e)];
}

/** The first PATH directory entry that holds one of the candidates, as an absolute path. */
function onPath(names: string[], env: NodeJS.ProcessEnv): string | null {
  const path = env.PATH ?? env.Path ?? '';
  for (const dir of path.split(delimiter)) {
    if (!dir.trim()) continue;
    for (const n of names) {
      const full = join(dir.trim(), n);
      if (isFile(full)) return full;
    }
  }
  return null;
}

/** True when the lookup applies: Windows, AIMEAT_HOME set, the system default lookup order in effect. */
function applies(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): boolean {
  return platform === 'win32' && Boolean(env.AIMEAT_HOME?.trim()) && !env.NoDefaultCurrentDirectoryInExePath;
}

/**
 * For spawn (libuv tries the name, then `.com` and `.exe`): the absolute PATH program when the
 * working directory holds a file of the same name and PATH holds the program; null otherwise, and
 * the caller spawns the command as written.
 */
export function pathPreferredProgram(command: string, where: Where = {}): string | null {
  const env = where.env ?? process.env;
  const platform = where.platform ?? process.platform;
  if (!applies(env, platform) || !isBareName(command)) return null;
  const names = candidates(command, ['.com', '.exe']);
  const cwd = where.cwd ?? process.cwd();
  if (!names.some(n => isFile(join(cwd, n)))) return null;
  return onPath(names, env);
}

/**
 * For a wake command run through cmd.exe: an environment with NoDefaultCurrentDirectoryInExePath
 * set when the command's first word is a bare name that the working directory and PATH both hold
 * (PATHEXT extensions included), so cmd.exe takes the PATH program. Null otherwise: the command
 * runs with the daemon's environment as before.
 */
export function wakeEnvPreferringPath(command: string, where: Where = {}): NodeJS.ProcessEnv | null {
  const env = where.env ?? process.env;
  const platform = where.platform ?? process.platform;
  if (!applies(env, platform)) return null;
  const first = /^\s*"?([^\s"]+)/.exec(command)?.[1] ?? '';
  if (!isBareName(first)) return null;
  const exts = (env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').map(e => e.trim().toLowerCase()).filter(Boolean);
  const names = candidates(first, exts);
  const cwd = where.cwd ?? process.cwd();
  if (!names.some(n => isFile(join(cwd, n)))) return null;
  if (!onPath(names, env)) return null;
  return { ...env, NoDefaultCurrentDirectoryInExePath: '1' };
}
