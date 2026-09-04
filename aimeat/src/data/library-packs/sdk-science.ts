/**
 * @file src/data/library-packs/sdk-science.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The science pack list, spread into SDK_PACKS by ./sdk.ts — and, as of this file's
 *   first commit, EMPTY ON PURPOSE.
 *
 *   c932f2f17 (feat(worksheet): aimeat-science, 2026-09-05) added `import { SCIENCE_PACKS } from
 *   './sdk-science.js'` to sdk.ts and committed the lib the pack describes — /v1/libs/aimeat-science.js,
 *   source under src/static/sdk-libs/science/, KaTeX at /lib/katex@0/ — without committing this
 *   file. The author's pre-commit hook passed because it reads the worktree, where the untracked
 *   file existed; every other checkout then failed to BOOT, because a value import of a missing
 *   module throws at load and this module sits on the server's start path.
 *
 *   The pack ENTRY is authored data that exists only in the author's uncommitted file: the id, the
 *   aiDoc an AI reads before using AIMEAT.science, the interview triggers, the proofs. Inventing it
 *   here would put words in the author's catalogue, so this exports an empty list instead. What that
 *   costs until the real entry lands: aimeat-science does not appear in the library index, the
 *   catalogue or the pack pickers, and dependency-map / appdev-overview do not know it. The lib
 *   itself is served and works; only its listing is missing. Replace this file's export with the
 *   real entry and delete this header.
 * @version-history
 *   v1.0.0 — 2026-09-05 — Placeholder so main boots; the real list is with the author of c932f2f17.
 */
import type { LibraryPack } from './types.js';

export const SCIENCE_PACKS: LibraryPack[] = [];
