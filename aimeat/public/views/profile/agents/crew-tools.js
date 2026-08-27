/**
 * @file crew-tools.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The fixed tool menu a JSON crew definition may draw from, grouped for the Crew tab:
 *   nine core tools, one Exchange bundle, and the thirteen Exchange verbs the bundle expands to.
 *   The ids mirror crewaimeat `crew_def.py` TOOL_REGISTRY; the runtime's validator is still the one
 *   that decides, this list only keeps the person from typing a name that cannot resolve. When a
 *   bundle is added there, it is added here.
 * @structure CORE_TOOLS · EXCHANGE_BUNDLE · EXCHANGE_VERBS · ALL_TOOL_IDS · toolLabelKey()
 * @version-history
 *   v1.0.0 -- 2026-08-28 -- Initial (JSON-agent Crew tab).
 */

/** The nine core tools, one row each. */
export const CORE_TOOLS = [
  'memory', 'web', 'article_fetch', 'schedule', 'dm', 'delegate', 'image', 'app_build', 'local_memory',
];

/** The whole Exchange bundle as one pick. */
export const EXCHANGE_BUNDLE = 'exchange';

/** The individual Exchange verbs, for people who want fewer than the bundle. */
export const EXCHANGE_VERBS = [
  'exchange_browse', 'exchange_detail', 'exchange_accept', 'exchange_run', 'exchange_post_need',
  'exchange_bid', 'exchange_proposals', 'exchange_proposal_decide', 'exchange_work_list',
  'exchange_work_start', 'exchange_work_deliver', 'exchange_match_score', 'exchange_band_decide',
];

export const ALL_TOOL_IDS = [...CORE_TOOLS, EXCHANGE_BUNDLE, ...EXCHANGE_VERBS];

/** The locale key carrying a tool's one-line purpose. */
export function toolLabelKey(id) {
  return id === EXCHANGE_BUNDLE ? 'profile.agents.detail.crew.tools.exchangeBundle' : `profile.agents.detail.crew.tools.${id}`;
}
