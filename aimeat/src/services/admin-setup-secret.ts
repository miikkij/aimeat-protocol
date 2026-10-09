/**
 * @file src/services/admin-setup-secret.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Where the generated admin setup secret is kept while a node has no owner, and when
 *   that file is written or deleted.
 *
 *   A node started without AIMEAT_ADMIN_PASSWORD generates a random secret at each boot. The secret
 *   opens POST /v1/admin/setup/register, which creates an owner with the operator role. Until
 *   2026-10-09 the boot wrote the secret to stderr, so anyone who could read the server log
 *   (journald, docker logs) could make themselves an operator (secrets audit 2026-10-09, 1.4).
 *   Ruling (Jouni, 2026-10-09): the secret is not written to any log; it is written to a file with
 *   mode 0600, and only while the node has no owner. The register route itself closes once an
 *   operator exists (routes/admin.ts).
 *
 *   THE DIRECTORY. The node has no data-directory setting. A SQLite node keeps the file beside its
 *   database file (the directory of sqlitePath); every other node (Postgres, in-memory SQLite) uses
 *   ./data under the working directory, the same place the SQLite and refusal-log defaults use.
 *
 *   THE WRITE. A file left from an earlier boot is deleted first and the new one is created with the
 *   exclusive flag, so the mode applies on create and a symbolic link at that path is never followed.
 *   chmodSync then sets 0600 exactly, whatever the process umask removed. Windows ignores the mode.
 * @structure ADMIN_SETUP_SECRET_FILE · adminSetupSecretDir() · syncAdminSetupSecretFile() · removeAdminSetupSecretFile()
 * @usage
 *   const r = syncAdminSetupSecretFile({ dir: adminSetupSecretDir(config), secret, hasOwner });
 * @version-history
 *   v1.0.0 — 2026-10-09 — Initial (secrets audit 2026-10-09, 1.4): the generated secret goes to a
 *     0600 file while the node has no owner, never to stderr.
 */

import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { AimeatConfig } from '../config-types.js';

/** The file name inside the directory adminSetupSecretDir() returns. */
export const ADMIN_SETUP_SECRET_FILE = 'admin-setup-secret';

/**
 * The directory the secret file goes in: beside the SQLite database file on a SQLite node, else
 * ./data under `cwd`.
 */
export function adminSetupSecretDir(
  config: Pick<AimeatConfig, 'storageProvider' | 'sqlitePath'>,
  cwd: string = process.cwd(),
): string {
  const path = config.sqlitePath?.trim() ?? '';
  if (config.storageProvider === 'sqlite' && path && path !== ':memory:') {
    return dirname(resolve(cwd, path));
  }
  return resolve(cwd, 'data');
}

export interface AdminSetupSecretResult {
  /** written: the file now holds the secret. removed: a file was deleted. none: no file, nothing done. */
  action: 'written' | 'removed' | 'none';
  /** The absolute path of the file, whether or not it exists. */
  path: string;
}

/** Delete the secret file in `dir` if it exists. */
export function removeAdminSetupSecretFile(dir: string): AdminSetupSecretResult {
  const path = join(dir, ADMIN_SETUP_SECRET_FILE);
  if (!existsSync(path)) return { action: 'none', path };
  rmSync(path, { force: true });
  return { action: 'removed', path };
}

/**
 * Write the secret to `<dir>/admin-setup-secret` with mode 0600 when the node has no owner and the
 * secret was generated at this boot; otherwise delete a file left from an earlier boot.
 *
 * @param opts.dir the directory, from adminSetupSecretDir()
 * @param opts.secret the generated secret, or null when the operator set AIMEAT_ADMIN_PASSWORD
 * @param opts.hasOwner whether the node has an owner other than the anonymous system owner
 * @throws when the directory or the file cannot be written; the caller logs it and boots on
 */
export function syncAdminSetupSecretFile(opts: { dir: string; secret: string | null; hasOwner: boolean }): AdminSetupSecretResult {
  const { dir, secret, hasOwner } = opts;
  if (!secret || hasOwner) return removeAdminSetupSecretFile(dir);

  const path = join(dir, ADMIN_SETUP_SECRET_FILE);
  mkdirSync(dir, { recursive: true });
  rmSync(path, { force: true });
  writeFileSync(path, secret + '\n', { mode: 0o600, flag: 'wx' });
  chmodSync(path, 0o600);
  return { action: 'written', path };
}
