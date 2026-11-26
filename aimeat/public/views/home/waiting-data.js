/**
 * @file public/views/home/waiting-data.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One read of what waits for the signed-in person (GET /v1/home/waiting, the answer an
 *   AI reads with aimeat_home_waiting), shared by every part that shows it: the home's "Waiting for
 *   you" band, the count on the top bar's Home link, the count on the side menu's way home and the
 *   counts on the side menu's rows. They all read the same cache entry (surface/shared-read.js), so a
 *   page asks the node once, and they never disagree. The read repeats when the live stream says an
 *   agent, a message, a question, an organism or an open item changed; nothing polls.
 *
 *   `total` is what needs a yes, a no or words from the person (the groups decide and answer);
 *   `unread` is the unread messages, which the node counts apart because a thread that waits for an
 *   answer is already in `total`. `byTab` says on which Settings & Controls page each kind is acted
 *   on, for the kinds whose address is one page: an agent's proposal and an agent's sign-in
 *   (agents, the two the Agents page itself counts as waiting), an invitation and a team's waiting
 *   records (organisms), a request to publish (notifications) and a workflow's question (workflows).
 *   A message is answered in Messages, whose row has its own unread count.
 * @structure WAITING_MAX · WAITING_DOMAINS · waitingKey(max) · waitingPath(max) · useWaiting(on) · waitingByTab(data)
 * @usage const waiting = useWaiting(!!session); // waiting.total, waiting.unread, waiting.byTab.agents
 * @version-history
 *   v1.0.0 — 2026-11-26 — Initial: the home band's read under a shared name, so the top bar and the
 *     side menu show the same numbers from the same request.
 */
import { useShared } from '/views/surface/shared-read.js';

/** How many rows the home band lists by default; the counts cover everything whatever the limit. */
export const WAITING_MAX = 12;

/** The live-update domains that can change what waits. */
export const WAITING_DOMAINS = ['agents', 'messages', 'help', 'organisms', 'memory', 'open-items', 'work'];

export const waitingKey = (max = WAITING_MAX) => `home-waiting|${max}`;
export const waitingPath = (max = WAITING_MAX) => `/v1/home/waiting?limit=${max}`;

/** The Settings & Controls page a kind is acted on, for the kinds whose address is one page. */
const TAB_OF_KIND = {
  agent_proposal: 'agents',
  agent_sign_in: 'agents',
  invitation: 'organisms',
  team: 'organisms',
  publish_request: 'notifications',
  workflow_input: 'workflows',
};

/**
 * How many things wait on each Settings & Controls page: { agents: 2, organisms: 1 }.
 * @param {{ by_kind?: Record<string, number> } | null | undefined} data the answer of GET /v1/home/waiting
 * @returns {Record<string, number>}
 */
export function waitingByTab(data) {
  /** @type {Record<string, number>} */
  const out = {};
  for (const [kind, n] of Object.entries(data?.by_kind || {})) {
    const tab = TAB_OF_KIND[kind];
    if (tab && typeof n === 'number' && n > 0) out[tab] = (out[tab] || 0) + n;
  }
  return out;
}

/**
 * What waits for the signed-in person. `on` false asks nothing (nobody is signed in).
 * @param {boolean} on
 * @returns {{ ready: boolean, total: number, unread: number, byTab: Record<string, number> }}
 */
export function useWaiting(on) {
  const { data, ready } = useShared(waitingKey(), on ? waitingPath() : '', WAITING_DOMAINS);
  return {
    ready,
    total: Number(data?.total) || 0,
    unread: Number(data?.by_kind?.unread) || 0,
    byTab: waitingByTab(data),
  };
}
