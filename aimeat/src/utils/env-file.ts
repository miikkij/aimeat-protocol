/**
 * @file src/utils/env-file.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One line of a .env file, written so that the value is exactly one value.
 *
 *   WHY. Three writers built .env lines with a template string: the first-run setup route
 *   (routes/setup.ts), `aimeat init` (cli/init-wizard/generate.ts) and `aimeat federation join`
 *   (cli/federation-join.ts). The setup route takes its values from an unauthenticated request on a
 *   node that has no owner yet, so a line break in `genesisUrl` added a variable of the caller's
 *   choosing to the file the node reads at its next start. One such variable is AIMEAT_AI_PROVIDERS,
 *   and a provider there may name any environment variable as its key, so the chain ended with the
 *   node sending DATABASE_URL or AIMEAT_ENCRYPTION_KEY to the caller's server (secrets audit
 *   2026-10-09, node configuration S1).
 *
 *   THE RULE. A value is written in double quotes and may not hold a double quote, a carriage
 *   return, a line feed or a NUL. Both readers of the file take a double-quoted value up to the next
 *   double quote (src/index.ts, and process.loadEnvFile in bin/aimeat.ts), so with those characters
 *   refused the line cannot end early and cannot start another one. A backslash is allowed, because
 *   a Windows path holds one, and neither reader turns it into a line break that starts a variable.
 *   A name is upper-case letters, digits and underscores.
 * @structure EnvValueError · ENV_NAME_RE · envValueProblem · envLine
 * @usage lines.push(envLine('AIMEAT_GENESIS_URL', genesisUrl));
 * @version-history
 *   v1.0.0 — 2026-10-09 — Initial (secrets audit 2026-10-09, S1).
 */

/** A value or a name that cannot be written as one .env line. */
export class EnvValueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnvValueError';
  }
}

export const ENV_NAME_RE = /^[A-Z_][A-Z0-9_]*$/;

/** Why `value` cannot be one quoted .env value, or null when it can. */
export function envValueProblem(value: string): string | null {
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c === 0x0a || c === 0x0d) return 'it holds a line break';
    if (c === 0x00) return 'it holds a NUL character';
    if (c === 0x22) return 'it holds a double quote';
  }
  return null;
}

/** `NAME="value"`, or an EnvValueError when the name or the value cannot be one line. */
export function envLine(name: string, value: string | number | boolean): string {
  if (!ENV_NAME_RE.test(name)) throw new EnvValueError(`${name} is not a variable name`);
  const text = String(value);
  const problem = envValueProblem(text);
  if (problem) throw new EnvValueError(`The value for ${name} cannot be written: ${problem}`);
  return `${name}="${text}"`;
}
