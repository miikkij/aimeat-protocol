/**
 * @file src/config-types-hooks.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The extension hook names an operator can attach extensions to. PURE EXTRACTION from
 *   config-types.ts on 2026-10-09 to keep that file under the 800-line ceiling; config-types.ts
 *   re-exports both names, so no consumer import changes.
 * @structure ExtensionHooks · HookName
 * @usage import type { ExtensionHooks, HookName } from './config-types.js';
 * @version-history
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
}

export type HookName = keyof ExtensionHooks;
