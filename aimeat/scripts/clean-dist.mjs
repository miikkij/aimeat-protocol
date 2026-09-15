/**
 * @file scripts/clean-dist.mjs
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The first step of `pnpm build`: remove dist/ so the build starts from nothing.
 *
 *   WITHOUT IT, EVERY FILE EVER BUILT STAYED. tsc writes over what it emits and never removes what
 *   it no longer emits, and copy-dist-assets copies over the top of the previous copy. The package
 *   is published from a developer's machine (`prepublishOnly` runs this build), and `files:
 *   ["dist/"]` ships whatever dist/ holds, so the 3.15.0 tarball carried 922 files whose source had
 *   been deleted: the MongoDB provider and the Prisma client removed in July, the Generator, the
 *   Foundry, Secretary and the matching tab. An operator of another node found two of them on
 *   2026-09-15 as broken imports. Nothing loaded them, which is why nothing noticed.
 *
 *   Plain .mjs, matching the other build steps: it runs without tsx.
 * @usage node scripts/clean-dist.mjs   # the `build` script runs this before tsc
 * @version-history
 *   v1.0.0 — 2026-09-15 — Initial.
 */
import { rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
rmSync(join(ROOT, 'dist'), { recursive: true, force: true });
