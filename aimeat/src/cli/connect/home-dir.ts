/**
 * @file src/cli/connect/home-dir.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Which folder is the connector's home, and how it is kept private: the agent tokens,
 *   the agent keys and the serve daemon's secret live there.
 *
 *   WHERE. AIMEAT_HOME when set, otherwise `<cwd>/.aimeat`, the folder the command ran in, so two
 *   projects on one machine get two daemons (the 2026-06-17 ruling, kept on 2026-10-09).
 *
 *   KEPT OUT OF GIT. A home inside a project could be committed with the project when the project's
 *   own .gitignore did not name it, and with it every token and key (secrets audit 2026-10-09, node
 *   configuration S4). prepareConnectorHome() runs before every write into the home: it makes the
 *   folder 0700 and makes sure `<home>/.gitignore` holds `*`, so git sees nothing inside the folder,
 *   the .gitignore itself included, whatever the project's .gitignore says.
 *
 *   PERMISSIONS. Files in the home are written 0600 and folders 0700 on every write
 *   (utils/private-file.ts). On Windows Node keeps only the read-only attribute from a mode, so
 *   nothing here limits who can read the folder; it inherits the project folder's access list, and
 *   the serve daemon warns at start when other accounts can read it (home-access.ts).
 * @structure ConnectorHome · resolveConnectorHome · getConfigDir · GITIGNORE_BODY · prepareConnectorHome
 * @usage const { dir } = resolveConnectorHome(); prepareConnectorHome(dir); writePrivateFile(join(dir, 'x'), data);
 * @version-history
 *   2026-11-13 — getConfigDir and the launch directory it reads moved here unchanged from config.ts,
 *     which re-exports it, so keychain.ts and agent-key.ts no longer import config.ts and the three
 *     files form no import cycle (structure programme 2026-11, unit 4).
 *   v1.0.0 — 2026-10-09 — Initial (secrets audit 2026-10-09, S4).
 */
import { existsSync, readFileSync, appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ensurePrivateDir } from '../../utils/private-file.js';
import { logger } from '../../utils/logger.js';

export interface ConnectorHome {
  dir: string;
  /** `env`: AIMEAT_HOME. `cwd`: the default, `<cwd>/.aimeat`. */
  source: 'env' | 'cwd';
}

export function resolveConnectorHome(env: NodeJS.ProcessEnv = process.env, cwd: string = process.cwd()): ConnectorHome {
  const explicit = env.AIMEAT_HOME?.trim();
  if (explicit) return { dir: explicit, source: 'env' };
  return { dir: join(cwd, '.aimeat'), source: 'cwd' };
}

// The launch directory is captured once at module load. AIMEAT_HOME is read on every call, not at
// module load: `aimeat connect client` sets it after this module may already be loaded, and a value
// captured at load time sent the token to <cwd>/.aimeat while the command looked for it in the
// client's home, so it ended with "No credential was stored" after the agent had been created on the
// node (feature-list audit #6). Moved here from config.ts so keychain.ts and agent-key.ts read the
// home without importing config.ts, which imports both of them.
const LAUNCH_CWD = process.cwd();

export function getConfigDir(): string { return resolveConnectorHome(process.env, LAUNCH_CWD).dir; }

/** What `<home>/.gitignore` holds: everything in the folder is ignored. */
export const GITIGNORE_BODY = '# Written by the AIMEAT connector: this folder holds agent tokens and keys. Never commit it.\n*\n';

/**
 * Make the home ready for a write: the folder exists at 0700, and its .gitignore ignores everything.
 * A .gitignore that is there without a `*` line gets one appended; one that has it is left as it is.
 * A failure to write the .gitignore is logged and the write goes ahead: losing the token is worse.
 */
export function prepareConnectorHome(dir: string): void {
  ensurePrivateDir(dir);
  const file = join(dir, '.gitignore');
  try {
    if (!existsSync(file)) {
      writeFileSync(file, GITIGNORE_BODY, 'utf-8');
    } else if (!readFileSync(file, 'utf-8').split(/\r?\n/).some(line => line.trim() === '*')) {
      appendFileSync(file, '\n*\n', 'utf-8');
    }
  } catch (err) {
    logger.warn('connector: could not write the .gitignore that keeps the home out of git', { dir, error: (err as Error).message });
  }
}
