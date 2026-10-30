/**
 * @file scripts/lib/adoption-cutoff.mjs
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Reads and writes ADOPTION_CUTOFF in src/cli/connect/adoption-cutoff.ts: the release
 *   time of the first node version whose connector keeps a record of trusted commands. The connector
 *   adopts only a config file older than it (secaudit2026oct26 round 8c, connector-04).
 *
 *   Three callers: `pnpm release:bump` writes it when it is null, `pnpm release:trust-cutoff` (this
 *   file run directly) writes it alone, and scripts/release-ready.mjs refuses a node release while it
 *   is null. A value once written is never changed: a later release would move the cut-off forward
 *   and adopt what arrived in between.
 *
 *   Plain .mjs, like ci-runs.mjs: release-ready.mjs runs in prepublishOnly without tsx.
 * @structure CUTOFF_FILE · CUTOFF_PATH · readAdoptionCutoff(text) · stampAdoptionCutoff(text, when) · main
 * @usage node scripts/lib/adoption-cutoff.mjs        # pnpm release:trust-cutoff: writes now when null
 * @version-history
 *   v1.0.0 -- 2026-10-30 -- Initial (secaudit2026oct26 round 8c, connector-04).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** src/cli/connect/adoption-cutoff.ts on disk, from this file. */
export const CUTOFF_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'cli', 'connect', 'adoption-cutoff.ts');
/** The same file as a path in the repository, for `git show <commit>:<path>`. */
export const CUTOFF_PATH = 'aimeat/src/cli/connect/adoption-cutoff.ts';

const LINE = /^(export const ADOPTION_CUTOFF: string \| null = )(null|'([^']*)');$/m;

/** The cut-off the file holds: an ISO time, or null. Throws when the declaration line is not there. */
export function readAdoptionCutoff(text) {
  const m = LINE.exec(text);
  if (!m) throw new Error('adoption-cutoff.ts: the ADOPTION_CUTOFF line was not found');
  return m[2] === 'null' ? null : m[3];
}

/**
 * The file's text with ADOPTION_CUTOFF set to `when` when it is null, and whether it changed. A value
 * already written stays as it is.
 */
export function stampAdoptionCutoff(text, when) {
  if (readAdoptionCutoff(text) !== null) return { text, changed: false };
  const iso = new Date(when).toISOString();
  return { text: text.replace(LINE, `$1'${iso}';`), changed: true };
}

/** Write the cut-off into the file when it is null; returns the value the file holds afterwards. */
export function stampAdoptionCutoffFile(when = Date.now(), file = CUTOFF_FILE) {
  const { text, changed } = stampAdoptionCutoff(readFileSync(file, 'utf-8'), when);
  if (changed) writeFileSync(file, text);
  return { cutoff: readAdoptionCutoff(text), changed };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { cutoff, changed } = stampAdoptionCutoffFile();
  console.log(changed
    ? `✓ ADOPTION_CUTOFF is now ${cutoff}. Commit src/cli/connect/adoption-cutoff.ts with the release.`
    : `ADOPTION_CUTOFF is already ${cutoff}; it is never changed.`);
}
