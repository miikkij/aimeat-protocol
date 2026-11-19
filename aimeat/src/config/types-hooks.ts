/**
 * @file src/config/types-hooks.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The extension hook names an operator can attach extensions to. PURE EXTRACTION from
 *   config-types.ts on 2026-10-09 to keep that file under the 800-line ceiling; config-types.ts
 *   re-exports both names, so no consumer import changes.
 * @structure ExtensionHooks · HookName · HookWhenMissing
 * @usage import type { ExtensionHooks, HookName } from '../config-types.js';
 * @version-history
 *   v1.2.0 — 2026-11-19 — HookWhenMissing: a blocking hook's choice when its bound action is missing.
 *   v1.1.0 — 2026-11-14 — post_help_question and post_help_solved (Ask someone who knows).
 *   v1.0.0 — 2026-10-09 — Moved from config-types.ts unchanged.
 */

export interface ExtensionHooks {
  pre_owner_registration: string[];
  post_owner_registration: string[];
  pre_agent_registration: string[];
  post_agent_registration: string[];
  owner_recovery: string[];
  agent_rekey: string[];
  pre_work_request: string[];
  post_work_delivery: string[];
  post_settlement: string[];
  pre_board_post: string[];
  pre_federation_peer: string[];
  /** A member's question was sent to a helper (Ask someone who knows). Told after, decides nothing. */
  post_help_question: string[];
  /** A question was marked solved (Ask someone who knows). Told after, decides nothing. */
  post_help_solved: string[];
}

export type HookName = keyof ExtensionHooks;

/** What a blocking hook does when its bound action is missing: let the event through, or refuse it. */
export type HookWhenMissing = 'pass' | 'refuse';
