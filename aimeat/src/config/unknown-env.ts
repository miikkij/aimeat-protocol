/**
 * @file src/config/unknown-env.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The warnings a node prints at start about AIMEAT_* variables that do nothing.
 *
 *   WHY. `AIMEAT_DB` and `AIMEAT_DB_PATH` are the names of the CLI flags --db and --db-path, and as
 *   environment variables no code of the node reads them. A scratch node started from an env file
 *   that set only those two took AIMEAT_STORAGE and DATABASE_URL from aimeat/.env (src/index.ts
 *   fills every absent key from it) and wrote test data into the developer's dev database while
 *   every line the person wrote said sqlite (docs/pitfalls.md §23 until 2026-11-21). A warning, not
 *   a refusal: the E2E runner and the test helpers set AIMEAT_DB beside AIMEAT_STORAGE on purpose,
 *   and an operator's environment may carry a retired name that harms nothing.
 *
 *   TWO KINDS. A flag-shaped variable that disagrees with what the node actually uses (AIMEAT_DB
 *   names sqlite, the node opens PostgreSQL) is named with the variable that decides. Any other
 *   AIMEAT_* name the repository never mentions (src/config/known-env-names.ts, generated) is
 *   named as unread, which is how a typo shows itself.
 * @structure envWarnings(env, used) → string[]
 * @usage for (const w of envWarnings(process.env, { storageProvider, sqlitePath })) log.warn(w);
 * @version-history
 *   v1.0.0 — 2026-11-21 — Initial.
 */
import { KNOWN_ENV_NAMES } from './known-env-names.js';

/** Names read by prefix: AIMEAT_SITE_KV_<key> (config/runtime.ts). */
const PREFIXES = ['AIMEAT_SITE_KV_'];

/** What the node is actually using, from its loaded configuration. */
export interface UsedStorage {
  storageProvider: string;
  sqlitePath: string;
}

/** The start-time warnings for `env`, one sentence each; [] when there is nothing to say. */
export function envWarnings(env: NodeJS.ProcessEnv, used: UsedStorage, known: ReadonlySet<string> = KNOWN_ENV_NAMES): string[] {
  const out: string[] = [];
  const db = env.AIMEAT_DB?.trim();
  if (db && db !== used.storageProvider) {
    out.push(`AIMEAT_DB=${db} is the name of the --db flag, and the node does not read it as a variable: `
      + `it is using ${used.storageProvider}, which AIMEAT_STORAGE decides (or --db on the command line).`);
  }
  const dbPath = env.AIMEAT_DB_PATH?.trim();
  if (dbPath && used.storageProvider === 'sqlite' && dbPath !== used.sqlitePath) {
    out.push(`AIMEAT_DB_PATH=${dbPath} is the name of the --db-path flag, and the node does not read it as a variable: `
      + `it opens ${used.sqlitePath}, which AIMEAT_SQLITE_PATH decides.`);
  } else if (dbPath && used.storageProvider !== 'sqlite') {
    out.push(`AIMEAT_DB_PATH=${dbPath} is the name of the --db-path flag and does nothing as a variable; `
      + `this node is on ${used.storageProvider}. A sqlite node needs AIMEAT_STORAGE=sqlite and AIMEAT_SQLITE_PATH.`);
  }
  const unread = Object.keys(env)
    .filter(k => k.startsWith('AIMEAT_') && !known.has(k) && !PREFIXES.some(p => k.startsWith(p)))
    .sort();
  if (unread.length > 0) {
    out.push(`${unread.join(', ')} ${unread.length === 1 ? 'is' : 'are'} set, and nothing in this node reads `
      + `${unread.length === 1 ? 'it' : 'them'}: a misspelt or retired setting has no effect.`);
  }
  return out;
}
