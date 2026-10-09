/**
 * @file src/cli/connect/home-dir.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Which folder is the connector's home: where `aimeat connect` keeps the agent tokens,
 *   the agent keys and the serve daemon's secret.
 *
 *   WHY IT MOVED. From 2026-06-17 the default was `<cwd>/.aimeat`, the folder the command ran in, so
 *   that two projects on one machine got two daemons. That put the credentials inside a project,
 *   where the project's .gitignore does not cover them and its other users and tools can read them
 *   (secrets audit 2026-10-09, node configuration S4). The default is now `.aimeat` in the user's
 *   home directory. On Windows that is under the user profile, which is private to its account by
 *   default, where a project folder on another drive is usually readable by every signed-in user.
 *
 *   THE ORDER.
 *   1. AIMEAT_HOME, when set: an explicit choice, always first. Two projects that want two daemons
 *      set it, as `aimeat connect client` already does for each client it configures.
 *   2. `<cwd>/.aimeat` when it already holds connector state (tokens/, keys/, agents/, config.yaml
 *      or serve.json): an install made before this change keeps working where it is. DEPRECATED:
 *      read until 3.27.0, with a warning naming the move; then only 1 and 3.
 *   3. `<home>/.aimeat`.
 * @structure ConnectorHome · LEGACY_HOME_MARKERS · resolveConnectorHome
 * @usage const { dir, source } = resolveConnectorHome();
 * @version-history
 *   v1.0.0 — 2026-10-09 — Initial (secrets audit 2026-10-09, S4).
 */
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export interface ConnectorHome {
  dir: string;
  /** `env`: AIMEAT_HOME. `cwd-legacy`: an existing `<cwd>/.aimeat` (deprecated). `home`: the default. */
  source: 'env' | 'cwd-legacy' | 'home';
}

/** What makes a `<cwd>/.aimeat` a connector home rather than an unrelated folder of that name. */
export const LEGACY_HOME_MARKERS: readonly string[] = ['tokens', 'keys', 'agents', 'config.yaml', 'serve.json'];

export function resolveConnectorHome(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
  home: string = homedir(),
): ConnectorHome {
  const explicit = env.AIMEAT_HOME?.trim();
  if (explicit) return { dir: explicit, source: 'env' };
  const user = join(home, '.aimeat');
  const legacy = join(cwd, '.aimeat');
  if (resolve(legacy) !== resolve(user) && LEGACY_HOME_MARKERS.some(m => existsSync(join(legacy, m)))) {
    return { dir: legacy, source: 'cwd-legacy' };
  }
  return { dir: user, source: 'home' };
}
