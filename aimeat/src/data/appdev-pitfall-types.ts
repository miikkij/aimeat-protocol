/**
 * @file appdev-pitfall-types.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The shape of a curated appdev pitfall: AppdevPitfallScope and AppdevPitfallEntry,
 *   moved verbatim from appdev-pitfalls.ts on 2026-10-17 to keep that registry under 800 lines when
 *   team-data-in-personal-memory joined it. appdev-pitfalls.ts re-exports both, so every importer
 *   keeps its import.
 * @structure AppdevPitfallScope · AppdevPitfallEntry
 * @usage import type { AppdevPitfallEntry } from './appdev-pitfall-types.js';
 * @version-history
 *   v1.0.0 — 2026-10-17 — Moved verbatim from appdev-pitfalls.ts.
 */

/** Facet a pitfall applies to. Kept small and app-build-shaped on purpose. */
export type AppdevPitfallScope =
  | 'app'       // single-file HTML app itself
  | 'auth'      // login / session / identity from an app origin
  | 'ext'       // sandboxed extensions
  | 'cortex'    // cortex layer / libs
  | 'iam'       // apps with their own users/roles (aimeat-iam)
  | 'realtime'  // AimeatRealtime multiplayer
  | 'ai'        // AI calls from apps
  | 'mobile'    // mobile / viewport / keyboard
  | 'publish';  // publishing & updating apps over MCP

export interface AppdevPitfallEntry {
  /** Stable kebab-case id (referenced from prompts and learned-KB dedup). */
  id: string;
  title: string;
  /** What the builder observes when they hit it. */
  symptom: string;
  /** What to do instead. */
  fix: string;
  appliesTo: AppdevPitfallScope[];
  severity: 'info' | 'warn' | 'critical';
  source: 'curated';
  /** Entries can be superseded without deletion: outdated drops from default views. */
  status?: 'active' | 'outdated';
  /** Pointer into repo docs for maintainers (not served meaningfully to agents). */
  docRef?: string;
  updatedAt: string;
  /**
   * The day somebody last checked this entry against the platform code, and the node version that
   * code was. `updatedAt` says when the WORDS changed; these say whether the words are still true.
   * A registry nobody re-reads goes stale in silence: on 2026-09-13 one learned entry of 166 was
   * marked outdated, while three that described fixed code were still telling builders to work
   * around it.
   */
  verifiedAt?: string;
  verifiedVersion?: string;
}
