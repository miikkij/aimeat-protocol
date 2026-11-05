/**
 * @file scripts/check-services-flat.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Holds the number of flat files in src/services/ at its baseline, so new service
 *   code lands in a domain folder (src/services/<domain>/) and not beside the 900 files already
 *   in the top level.
 *
 *   WHY. src/services/ grew 66 % in the four weeks before 2026-11-03, and half of the 646 new
 *   files went straight into the top level, where a name prefix stands in for a folder (136 prefixes
 *   had one file each). A folder is what a dependency rule can name; a prefix is not. The compliance-*.ts
 *   and ai-*.ts files moved into services/compliance/ and services/ai/ on 2026-11-05, and the count
 *   after those moves is the baseline.
 *
 *   WHAT IT COUNTS. The .ts files directly in src/services/ (a .test.ts file there would not count;
 *   none exists today). Files in subfolders do not count. It fails only when the count rises ABOVE
 *   the baseline. A count below it passes and prints the number to lower BASELINE to; lowering it is
 *   the point, raising it is never maintenance.
 *
 *   WHAT TO DO ON A REFUSAL. Put the new file in the domain folder it belongs to
 *   (src/services/<domain>/, an existing one such as ai/, compliance/, workflow/ or classification/,
 *   or a new one), not in the top level of src/services/.
 * @structure BASELINE · flatServiceFiles() · main()
 * @usage
 *   cd aimeat && pnpm check:services-flat
 * @version-history
 *   v1.0.0 — 2026-11-05 — Initial (codebase analysis 2026-11-03, item D-h).
 */
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVICES = path.join(ROOT, 'src', 'services');

/** The flat-file count on 2026-11-05, after the compliance and ai moves. It may only fall. */
const BASELINE = 909;

/** The .ts files directly in src/services/, test files left out. */
function flatServiceFiles(): string[] {
  return readdirSync(SERVICES)
    .filter(name => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .filter(name => statSync(path.join(SERVICES, name)).isFile())
    .sort();
}

function main(): void {
  const count = flatServiceFiles().length;
  if (count > BASELINE) {
    console.error(`✗ src/services/ has ${count} flat .ts files, above the baseline of ${BASELINE}.`);
    console.error('  Put new service code in a domain folder, src/services/<domain>/ (for example ai/,');
    console.error('  compliance/, workflow/ or classification/, or a new folder for a new domain), not in the');
    console.error('  top level of src/services/.');
    process.exit(1);
  }
  if (count < BASELINE) {
    console.log(`✓ src/services/ has ${count} flat .ts files, below the baseline of ${BASELINE}: lower BASELINE in scripts/check-services-flat.ts to ${count}.`);
    return;
  }
  console.log(`✓ src/services/ has ${count} flat .ts files, at the baseline; new service code goes in a domain folder.`);
}

main();
