/**
 * @file src/utils/private-file.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Write a file that holds a secret so that only the account that runs the process can
 *   read it: the node's .env, the connector's tokens and keys, and the folders they live in.
 *
 *   WHY A HELPER. `writeFileSync(path, data, { mode: 0o600 })` applies the mode only when the call
 *   CREATES the file. An existing file keeps the mode it had, so a .env written once at 0644 by an
 *   editor, or a token file a previous version wrote with defaults, stayed readable to every account
 *   on the machine however many times it was rewritten. Each function here sets the mode on create
 *   AND calls chmod afterwards, so the result is the same whether the file existed or not
 *   (secrets audit 2026-10-09, node configuration S4d and the CLI credential files).
 *
 *   WINDOWS. Node maps a mode to the read-only attribute only; the file's access list is inherited
 *   from its folder, and chmod does not change it. What protects a secret there is the folder's
 *   access list, which these functions do not change; cli/connect/home-access.ts warns at daemon
 *   start when the connector home's access list lets other accounts read it.
 *
 *   A chmod that fails (a file system without Unix modes, a file another account owns) is logged and
 *   the write stands: the data is on disk either way, and refusing after the write would only lose it.
 * @structure PRIVATE_FILE_MODE · PRIVATE_DIR_MODE · writePrivateFile · appendPrivateFile ·
 *   ensurePrivateDir
 * @usage writePrivateFile(envPath, content); ensurePrivateDir(join(home, 'tokens'));
 * @version-history
 *   v1.0.0 — 2026-10-09 — Initial (secrets audit 2026-10-09).
 */
import { appendFileSync, chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { logger } from './logger.js';

/** Read and write for the owning account, nothing for anyone else. */
export const PRIVATE_FILE_MODE = 0o600;
/** List, enter and write for the owning account, nothing for anyone else. */
export const PRIVATE_DIR_MODE = 0o700;

function tighten(path: string, mode: number): void {
  try {
    chmodSync(path, mode);
  } catch (err) {
    logger.warn('private-file: could not set the mode; other accounts may be able to read it', {
      path, mode: mode.toString(8), error: (err as Error).message,
    });
  }
}

/** Write (create or replace) `path` and leave it at 0600, whether or not it existed. */
export function writePrivateFile(path: string, data: string | Uint8Array): void {
  writeFileSync(path, data, { mode: PRIVATE_FILE_MODE });
  tighten(path, PRIVATE_FILE_MODE);
}

/** Append to `path` (creating it) and leave it at 0600, whether or not it existed. */
export function appendPrivateFile(path: string, data: string): void {
  appendFileSync(path, data, { mode: PRIVATE_FILE_MODE });
  tighten(path, PRIVATE_FILE_MODE);
}

/** Make `dir` (and its parents) exist and leave `dir` itself at 0700. */
export function ensurePrivateDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: PRIVATE_DIR_MODE });
  tighten(dir, PRIVATE_DIR_MODE);
}
