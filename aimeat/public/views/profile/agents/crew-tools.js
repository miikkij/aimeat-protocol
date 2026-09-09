/**
 * @file crew-tools.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The fixed tool menu a JSON crew definition may draw from, grouped for the Crew tab:
 *   nine core tools, one Exchange bundle, and the thirteen Exchange verbs the bundle expands to.
 *   The ids mirror crewaimeat `crew_def.py` TOOL_REGISTRY; the runtime's validator is still the one
 *   that decides, this list only keeps the person from typing a name that cannot resolve. When a
 *   bundle is added there, it is added here.
 *
 *   AND IT DRIFTS, because it is a list this node does not own. Measured 2026-09-08: eleven core
 *   names here against crewaimeat's twelve registry keys, so two real tools were invisible to the
 *   person building a definition. Check it against TOOL_REGISTRY whenever you touch this file.
 * @structure CORE_TOOLS · EXCHANGE_BUNDLE · EXCHANGE_VERBS · ALL_TOOL_IDS · toolLabelKey()
 * @version-history
 *   v1.1.0 -- 2026-09-09 -- app_tools and crew_registry, which crewaimeat has resolved all along.
 *   v1.0.0 -- 2026-08-28 -- Initial (JSON-agent Crew tab).
 */

/** The eleven core tools, one row each. Kept in step with crewaimeat's TOOL_REGISTRY, which is the
 *  resolver: it had twelve entries while this had ten, so `app_tools` and `crew_registry` could be
 *  typed into the JSON editor and never offered as a row. */
export const CORE_TOOLS = [
  'memory', 'web', 'article_fetch', 'schedule', 'dm', 'delegate', 'image', 'app_build', 'local_memory',
  'app_tools', 'crew_registry',
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
