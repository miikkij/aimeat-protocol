/**
 * @file scripts/check-services-flat.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Holds three counts of flat files at their baselines, so new code lands in a domain
 *   folder and not beside the hundreds of files already in a top level: the .ts files directly in
 *   src/services/, the .ts files directly in src/routes/, and the config-*.ts files directly in src/.
 *
 *   WHY. src/services/ grew 66 % in the four weeks before 2026-11-03, and half of the 646 new
 *   files went straight into the top level, where a name prefix stands in for a folder (136 prefixes
 *   had one file each). A folder is what a dependency rule can name; a prefix is not. The compliance-*.ts
 *   and ai-*.ts files moved into services/compliance/ and services/ai/ on 2026-11-05, and the count
 *   after those moves was the first baseline. src/routes/ and the config-<topic>.ts files beside
 *   src/config.ts collect the same way, and nothing counted them until 2026-11-13 (structure
 *   programme 2026-11, unit 5).
 *
 *   WHAT IT COUNTS. Per place, the matching files directly in that folder, test files left out.
 *   Files in subfolders do not count. Each count fails only when it rises ABOVE its own baseline.
 *   A count below its baseline passes and prints the number to lower that baseline to; lowering it
 *   is the point, raising it is never maintenance.
 *
 *   WHAT TO DO ON A REFUSAL. Put the new file in the domain folder it belongs to
 *   (src/services/<domain>/, src/routes/<domain>/ or src/config/), an existing one or a new one,
 *   not in the top level.
 * @structure PLACES · flatFiles(root, place) · evaluate(counts) · main()
 * @usage
 *   cd aimeat && pnpm check:services-flat
 * @version-history
 *   v1.0.0 — 2026-11-05 — Initial (codebase analysis 2026-11-03, item D-h).
 *   v1.1.0 — 2026-11-13 — Three counts, each with its own baseline: src/services/, src/routes/ and
 *     src/config-*.ts (structure programme 2026-11, unit 5).
 */
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** One place where flat files collect. */
export interface Place {
  /** The name a message uses. */
  label: string;
  /** The folder, relative to aimeat/. */
  dir: string;
  /** Which file names in that folder count. */
  matches: (name: string) => boolean;
  /** The count it may not rise above. It may only fall. */
  baseline: number;
  /** Where a new file goes instead. */
  instead: string;
}

const isSource = (name: string): boolean => name.endsWith('.ts') && !name.endsWith('.test.ts');

export const PLACES: readonly Place[] = [
  {
    label: 'src/services/',
    dir: 'src/services',
    matches: isSource,
    baseline: 651,
    instead: 'a domain folder, src/services/<domain>/ (for example ai/, compliance/, workflow/ or classification/, or a new folder for a new domain)',
  },
  {
    label: 'src/routes/',
    dir: 'src/routes',
    matches: isSource,
    baseline: 258,
    instead: 'a domain folder, src/routes/<domain>/ (for example admin/, agents/ or memory/, or a new folder for a new domain)',
  },
  {
    label: 'src/config-*.ts',
    dir: 'src',
    matches: name => name.startsWith('config-') && isSource(name),
    baseline: 2,
    instead: 'src/config/; src/config.ts and src/config-types.ts stay where they are',
  },
];

/** The files directly in a place's folder that match it, sorted. */
export function flatFiles(root: string, place: Place): string[] {
  const dir = path.join(root, place.dir);
  return readdirSync(dir)
    .filter(place.matches)
    .filter(name => statSync(path.join(dir, name)).isFile())
    .sort();
}

/** One line per place, and whether any count rose above its baseline. */
export function evaluate(counts: readonly { place: Place; count: number }[]): { ok: boolean; lines: string[] } {
  const lines: string[] = [];
  let ok = true;
  for (const { place, count } of counts) {
    if (count > place.baseline) {
      ok = false;
      lines.push(`✗ ${place.label} has ${count} flat files, above the baseline of ${place.baseline}. Put the new file in ${place.instead}, not in the top level.`);
    } else if (count < place.baseline) {
      lines.push(`✓ ${place.label} has ${count} flat files, below the baseline of ${place.baseline}: lower its baseline in scripts/check-services-flat.ts to ${count}.`);
    } else {
      lines.push(`✓ ${place.label} has ${count} flat files, at the baseline; a new file goes in a domain folder.`);
    }
  }
  return { ok, lines };
}

function main(): void {
  const { ok, lines } = evaluate(PLACES.map(place => ({ place, count: flatFiles(ROOT, place).length })));
  for (const line of lines) (line.startsWith('✗') ? console.error : console.log)(line);
  if (!ok) process.exit(1);
}

const invokedDirectly = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main();
