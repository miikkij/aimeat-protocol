/**
 * @file scripts/lib/prune-mode.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Reads the arguments of a stats-or-prune maintenance script, where the command's
 *   name decides the action. package.json passes a mode word first: `stats` (read only) or `prune`
 *   (delete). Before 2026-11-13 both commands ran the same file with no word and the flags chose,
 *   so `pnpm telemetry:prune` with no flag printed statistics and deleted nothing, and
 *   `pnpm telemetry:stats --clear` deleted every row. Now `stats` refuses a delete flag and
 *   `prune` without `--older-than` or `--clear` prints its usage; both exit 2. A call without a
 *   mode word (the file run by hand) keeps the old behaviour, where the flags choose.
 * @structure PruneArgs · readPruneArgs(argv, command)
 * @usage import { readPruneArgs } from './lib/prune-mode.js';
 *   const a = readPruneArgs(process.argv.slice(2), 'telemetry');   // exits 2 on a wrong call
 * @version-history
 *   v1.0.0 — 2026-11-13 — Initial (structure programme 2026-11, unit 6: one name, one action).
 */

export interface PruneArgs {
  force: boolean;
  clear: boolean;
  vacuum: boolean;
  olderThanDays: number | null;
  willMutate: boolean;
}

function usage(command: string): string {
  return [
    `Usage:`,
    `  pnpm ${command}:stats                        report count and size only (no changes)`,
    `  pnpm ${command}:prune --older-than=<days>    delete entries older than <days> days`,
    `  pnpm ${command}:prune --clear                delete ALL entries`,
    `  add --force to skip the confirmation prompt, and (sqlite only) --vacuum to reclaim file space`,
  ].join('\n');
}

/** Reads argv; on a call the command's name does not allow, prints why and exits 2. */
export function readPruneArgs(argv: string[], command: string): PruneArgs {
  const mode = argv[0] === 'stats' || argv[0] === 'prune' ? argv[0] : null;
  const rest = mode ? argv.slice(1) : argv;
  const clear = rest.includes('--clear');
  const olderThanArg = rest.find((a) => a.startsWith('--older-than='));
  const olderThanDays = olderThanArg ? Number(olderThanArg.split('=')[1]) : null;
  const willMutate = clear || olderThanDays !== null;

  if (mode === 'stats' && willMutate) {
    console.error(`${command}:stats only reads. To delete, run ${command}:prune with the same flag.\n\n${usage(command)}`);
    process.exit(2);
  }
  if (mode === 'prune' && !willMutate) {
    console.error(`${command}:prune needs --older-than=<days> or --clear. To see the counts, run ${command}:stats.\n\n${usage(command)}`);
    process.exit(2);
  }
  return {
    force: rest.includes('--force') || rest.includes('-f'),
    clear,
    vacuum: rest.includes('--vacuum'),
    olderThanDays,
    willMutate,
  };
}
