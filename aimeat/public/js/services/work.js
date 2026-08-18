/**
 * @file public/js/services/work.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Frontend service layer for the Work API — wrappers over /v1/work* covering the
 *   work inbox/sent lists and the accept/reject/deliver/progress/rate lifecycle actions.
 *
 * @structure
 *   - listInbox / listSent: read incoming and outgoing work items
 *   - acceptWork / rejectWork / deliverWork / updateProgress: work lifecycle transitions
 *   - submitRating: rate a completed work item
 *
 * @version-history
 *   v1.1.0 — 2026-07-16 — Add getWorkOverview (GET /v1/work/overview) folding the inbox + sent mount reads.
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { apiGet, api } from '/js/api.js';
import { swallowed } from '/js/swallowed.js';

/** Load work inbox items. Returns array. */
export async function listInbox() {
  const data = await apiGet('/v1/work/inbox');
  return data?.data?.items || data?.data || [];
}

/** Load sent work items. Returns array. */
export async function listSent() {
  const data = await apiGet('/v1/work/sent');
  return data?.data?.items || data?.data || [];
}

/**
 * Composite mount for the Work tab: inbox + sent in ONE call. Returns { inbox, sent } (arrays) or null on
 * error so the caller can fall back to the individual listInbox/listSent reads.
 */
export async function getWorkOverview() {
  try {
    const data = await apiGet('/v1/work/overview');
    const d = data?.data;
    if (!d) return null;
    return { inbox: d.inbox || [], sent: d.sent || [] };
  } catch (err) { swallowed('work: getWorkOverview', err); return null; }
}

/** Submit a rating for a completed work item. */
export async function submitRating(workId, rating, comment) {
  return api(`/v1/work/${encodeURIComponent(workId)}/rate`, {
    method: 'POST',
    body: JSON.stringify({ rating, comment }),
  });
}

/** Accept a pending/offered work request. */
export async function acceptWork(tc) {
  return api(`/v1/work/${encodeURIComponent(tc)}/accept`, { method: 'POST' });
}

/** Reject a pending/offered work request. */
export async function rejectWork(tc) {
  return api(`/v1/work/${encodeURIComponent(tc)}/reject`, { method: 'POST' });
}

/** Deliver completed work with optional result. */
export async function deliverWork(tc, result) {
  return api(`/v1/work/${encodeURIComponent(tc)}/deliver`, {
    method: 'POST',
    body: JSON.stringify({ result }),
  });
}

/** Update work progress. */
export async function updateProgress(tc, progress, note) {
  return api(`/v1/work/${encodeURIComponent(tc)}/progress`, {
    method: 'POST',
    body: JSON.stringify({ progress, note }),
  });
}
