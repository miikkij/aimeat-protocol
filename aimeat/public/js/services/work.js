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
 *   v1.2.1 — 2026-11-15 — deliverWork sends the delivery text as `output`, the field POST
 *     /v1/work/:tc/deliver reads; it sent `result`, which the route refused for a missing output.
 *   v1.2.0 — 2026-11-15 — submitRating sends rating 'positive' (four or five stars) or 'negative' (one
 *     to three), the values POST /v1/work/:tc/rate reads; it sent the star count, which the route refused.
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

/**
 * Submit a rating for a delivered work item. The Work tab gives one to five stars; POST
 * /v1/work/:tc/rate takes rating 'positive' or 'negative' (WorkRatingSchema) and stores score 5 or 1.
 * Four and five stars are positive, the same line services/trust.ts draws on a stored score (>= 4).
 */
export async function submitRating(workId, stars, comment) {
  const rating = Number(stars) >= 4 ? 'positive' : 'negative';
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

/** Deliver completed work. POST /v1/work/:tc/deliver reads the delivered result as `output`. */
export async function deliverWork(tc, result) {
  return api(`/v1/work/${encodeURIComponent(tc)}/deliver`, {
    method: 'POST',
    body: JSON.stringify({ output: result }),
  });
}

/** Update work progress. */
export async function updateProgress(tc, progress, note) {
  return api(`/v1/work/${encodeURIComponent(tc)}/progress`, {
    method: 'POST',
    body: JSON.stringify({ progress, note }),
  });
}
