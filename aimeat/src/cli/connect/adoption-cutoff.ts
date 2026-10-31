/**
 * @file src/cli/connect/adoption-cutoff.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The release time of the first node version whose connector keeps a record of trusted
 *   commands. adoptExistingCommands (command-trust.ts) adopts only a config file older than this, so
 *   a fresh install made after that release adopts no command it did not write: a folder that
 *   arrives later, even before the connector's first start, is held until `aimeat connect` in it
 *   takes its commands into use. An install made with an earlier version, which kept no record, is
 *   older than this and keeps running what it ran.
 *
 *   WHO WRITES IT. `pnpm release:bump` writes the time it runs when the value is null, and
 *   `pnpm release:trust-cutoff` does the same alone; scripts/lib/adoption-cutoff.mjs holds both.
 *   scripts/release-ready.mjs refuses a node release while it is null, so the first release that
 *   keeps a record carries its own time. Once written it never changes: a later release would
 *   otherwise move the cut-off forward and adopt what arrived in between.
 *
 *   NULL (source checkouts before that release): adoption reads the record's first start only, as
 *   before (secaudit2026oct26 round 8c, mtime-cutoff-not-bound-to-update; Jouni chose option A on
 *   2026-10-30).
 * @usage import { ADOPTION_CUTOFF } from './adoption-cutoff.js';
 * @version-history
 *   v1.0.0 -- 2026-10-30 -- Initial (secaudit2026oct26 round 8c, connector-04).
 */

/** ISO 8601 time of the first release that keeps a trust record, or null until that release. */
export const ADOPTION_CUTOFF: string | null = '2026-10-30T17:52:09.106Z';
