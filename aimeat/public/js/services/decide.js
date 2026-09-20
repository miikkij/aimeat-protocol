/**
 * @file public/js/services/decide.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Client for the decision register: read what was decided, and record that a PERSON
 *   confirmed or overrode it.
 *
 *   WHY IT EXISTS. The review is the half of the decision record that says a human was in the loop,
 *   and until now nothing in the browser called it: the gate could stop an agent and put the decision
 *   on the owner's open items, and the only control on that row was "Take it off", which records
 *   nothing. Two surfaces need the same call (the open-items row and the decision-model card), so it
 *   lives here rather than as an apiPost in each of them.
 * @structure reviewDecision · listDecisions
 * @usage
 *   import { reviewDecision } from '/js/services/decide.js';
 *   await reviewDecision(id, 'overridden');
 * @version-history
 *   v1.0.0 — 2026-09-20 — Initial.
 */
import { apiGet, apiPost } from '/js/api.js';

/**
 * Record that a person looked at a decision. The node closes the open item the gate opened for it,
 * so the caller does not have to know that the two are connected.
 *
 * @param {string} id The decision id.
 * @param {'confirmed'|'overridden'} outcome What the person decided about the model's answer.
 * @param {string} [note] Their own words, at most 2000 characters.
 * @returns {Promise<any>} The decision as it now stands, with its review.
 */
export async function reviewDecision(id, outcome, note) {
  const body = { outcome, ...(note ? { note } : {}) };
  const r = await apiPost(`/v1/ai/decisions/${encodeURIComponent(id)}/review`, body);
  // Both the list and the header count read open items, and the row for this decision has just gone.
  window.dispatchEvent(new CustomEvent('aimeat-live-update', {
    detail: { domains: new Set(['open-items', 'ai-decisions']) },
  }));
  return r?.data ?? null;
}

/** One decision by id, or null when it is not this owner's. */
export async function readDecision(id) {
  const r = await apiGet(`/v1/ai/decisions/${encodeURIComponent(id)}`);
  return r?.data ?? null;
}
