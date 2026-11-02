/**
 * @file public/views/home/agent-names.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The names a person sees for their agents, by short name: the Home feed, the away card
 *   and the activity log name an agent as the Agents page does ("Aamukatsaus"), not by its short name
 *   ("morning-digest"). One read, GET /v1/agents, one key and one shape for every caller, since
 *   useShared caches by key.
 * @structure useAgentNames(on) → (short) => shown
 * @usage const shownName = useAgentNames(); shownName('morning-digest') // 'Aamukatsaus'
 * @version-history
 *   v1.0.0 — 2026-11-02 — Moved out of away.js unchanged, so feed.js can read it without an import
 *     cycle (commercial's crew64 round: the feed still showed short names).
 */
import { getSession } from '/js/services/auth.js';
import { useShared } from '/views/surface/shared-read.js';

/**
 * @param {boolean} [on] false reads nothing (a caller that has no use for the names yet)
 * @returns {(short: string) => string} the shown name, or the short name until the list is read
 */
export function useAgentNames(on = true) {
  const owner = getSession()?.owner || '';
  const { data: names } = useShared('agent-display-names', on && owner ? `/v1/agents?owner=${encodeURIComponent(owner)}` : null,
    ['agents'], (d) => Object.fromEntries((d?.agents || d || []).map((a) => [a.name, a.display_name || a.displayName || a.name])));
  return (short) => (names && names[short]) || short;
}
